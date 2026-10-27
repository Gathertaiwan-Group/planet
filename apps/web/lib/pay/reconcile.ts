// 黑貓PAY 付款狀態對帳（APN、付款結果頁、重新付款前檢查、定期排程共用）。純邏輯＋注入依賴，方便單元測試（不可 import server-only）。
// 原則（沿用 PChomePay 版與快樂手／小時光的教訓）：
//   - APN checksum 沒有祕密 → 不信通知內容，一律回查 CocsOrderQuery，process_code ∈ {15,20,21,22} 才算授權
//   - 金額三方比對：APN 實收 pay_amount = payments.amount = 訂單／報名應收（DB 函式 mark_blackcat_paid 內比對）
//     回查沒有實收金額 → 沒有 APN 實收金額時「不標記付款」，改標 needs_attention 交人工（不拿 order_amount 充數）
//   - 回查失敗／DB 失敗 → http 500（APN 會重送）
//   - 目標轉 paid 為條件式（where status='pending'），只有 transitioned 時才做副作用（開發票等）
import { classifyProcessCode } from "./blackcat-core";

export const GATEWAY_ORDER_RE = /^TP\d{6}[0-9A-Z]{8}$/;
/** 黑貓PAY 單筆金額範圍 */
export const MIN_GATEWAY_AMOUNT = 1;

/** 去個資（email、6 碼以上數字）後取前 200 字，供除錯 */
export function redactBody(raw: string): string {
  return raw
    .replace(/[^\s"'&=:{},]+@[^\s"'&=:{},]+/g, "[email]")
    .replace(/\d{6,}/g, "[num]")
    .slice(0, 200);
}

const ALPHABET = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // 去掉 I、O 避免抄寫誤認

/** TP + 台北 yyMMdd + 8 碼英數（16 字元；黑貓PAY cust_order_no 統一金流上限 25） */
export function newGatewayOrderId(now: Date, randomBytes: Uint8Array): string {
  const tpe = new Date(now.getTime() + 8 * 3600_000);
  const ymd = `${String(tpe.getUTCFullYear()).slice(2)}${String(tpe.getUTCMonth() + 1).padStart(2, "0")}${String(tpe.getUTCDate()).padStart(2, "0")}`;
  let rand = "";
  for (let i = 0; i < 8; i++) rand += ALPHABET[(randomBytes[i] ?? 0) % ALPHABET.length];
  return `TP${ymd}${rand}`;
}

export interface GatewayResult {
  processCode: number | null;
  raw: Record<string, unknown>;
}

/** raw 只存白名單欄位 */
const RAW_KEYS = ["cust_order_no", "process_code", "order_amount", "request_amount", "grant_amount", "acquirer_type", "period_type", "trans_id", "create_time", "acquire_time"];
export function sanitizeRaw(raw: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!raw) return out;
  for (const k of RAW_KEYS) if (raw[k] !== undefined) out[k] = raw[k];
  return out;
}

export interface MarkPaidResult {
  result: "paid" | "already_paid" | "amount_mismatch" | "needs_attention" | "not_found";
  transitioned: boolean;
  attention_new?: boolean;
  kind?: "order" | "reg";
  target_id?: string;
  payment_id?: string;
  reason?: string;
}

export interface ReconcileDeps {
  findPayment(orderId: string): Promise<{ status: string; createdAt: string } | null>;
  /** 節流：取得回查權（同單號 N 秒內只回查一次）。回 false = 被節流 */
  claimCheck(orderId: string): Promise<boolean>;
  /** 成功回查後記錄閘道狀態（process_code）與時間（報名逾時釋出、重新付款判斷依賴這個） */
  recordCheck(orderId: string, gatewayStatus: string | null): Promise<void>;
  /** 新出現的需人工處理 → 通知營運 */
  alertAttention(orderId: string, reason: string, info: { kind?: string; amount?: number | null }): Promise<void>;
  query(orderId: string): Promise<GatewayResult | null>;
  /** 已收過、checksum 正確的 APN（B/O/E）帶的實收金額（cron／結果頁補入帳用）；沒有回 null */
  storedApnAmount(orderId: string): Promise<{ amount: number | null; transId: string } | null>;
  markPaid(orderId: string, amount: number | null, transId: string | null, raw: Record<string, unknown>): Promise<MarkPaidResult | null>;
  markFailed(orderId: string, raw: Record<string, unknown>): Promise<void>;
  /** 標記需人工處理；回 true = 這是新狀況（才寄通知） */
  flagAttention(orderId: string, reason: string): Promise<boolean>;
  /** 只有這次真的轉成 paid（transitioned）才呼叫（開發票、revalidate） */
  onPaid(kind: "order" | "reg", targetId: string, paymentId: string | null): Promise<void>;
}

export type ReconcileOutcome =
  | "unknown_order"
  | "query_failed"
  | "db_failed"
  | "paid"
  | "already_paid"
  | "amount_mismatch"
  | "needs_attention"
  | "awaiting_apn"
  | "failed"
  | "throttled"
  | "pending";

export interface ReconcileResult {
  http: 200 | 500;
  outcome: ReconcileOutcome;
  processCode?: number | null;
}

/** 授權成功卻一直沒收到 APN（沒有實收金額可比對）超過這麼久 → 通知人工 */
export const AWAITING_APN_ALERT_MS = 30 * 60_000;

export interface ReconcileOpts {
  throttle?: boolean;
  /** 由 APN 觸發時帶入：該則 APN 的實收金額與交易序號（checksum 已驗、密鑰閘門已過） */
  apn?: { amount: number | null; transId: string };
  now?: number;
}

export async function reconcileOrder(orderId: string, source: string | null, deps: ReconcileDeps, opts: ReconcileOpts = {}): Promise<ReconcileResult> {
  if (!GATEWAY_ORDER_RE.test(orderId)) return { http: 200, outcome: "unknown_order" };
  const payment = await deps.findPayment(orderId);
  if (!payment) return { http: 200, outcome: "unknown_order" };

  if (opts.throttle && !(await deps.claimCheck(orderId))) return { http: 500, outcome: "throttled" };

  const q = await deps.query(orderId);
  if (!q) return { http: 500, outcome: "query_failed" };
  await deps.recordCheck(orderId, q.processCode == null ? null : String(q.processCode));
  const raw: Record<string, unknown> = { source: source ? source.slice(0, 40) : null, query: sanitizeRaw(q.raw) };
  const state = classifyProcessCode(q.processCode);
  const pc = q.processCode;

  if (state === "paid") {
    // 實收金額只認 APN（這一則，或先前已收過的那一則）
    const apn = opts.apn ?? (await deps.storedApnAmount(orderId));
    if (!apn) {
      if (payment.status === "paid") return { http: 200, outcome: "already_paid", processCode: pc };
      const age = (opts.now ?? Date.now()) - new Date(payment.createdAt).getTime();
      if (age >= AWAITING_APN_ALERT_MS && (await deps.flagAttention(orderId, "authorized_without_apn"))) {
        await deps.alertAttention(orderId, "authorized_without_apn", {});
      }
      return { http: 200, outcome: "awaiting_apn", processCode: pc };
    }
    const r = await deps.markPaid(orderId, apn.amount, apn.transId, raw);
    if (!r) return { http: 500, outcome: "db_failed", processCode: pc };
    if (r.result === "not_found") return { http: 200, outcome: "unknown_order", processCode: pc };
    if (r.attention_new) await deps.alertAttention(orderId, r.reason ?? r.result, { kind: r.kind, amount: apn.amount });
    if (r.result === "amount_mismatch") return { http: 200, outcome: "amount_mismatch", processCode: pc };
    if (r.transitioned && r.kind && r.target_id) await deps.onPaid(r.kind, r.target_id, r.payment_id ?? null);
    if (r.result === "paid") return { http: 200, outcome: "paid", processCode: pc };
    if (r.result === "already_paid") return { http: 200, outcome: "already_paid", processCode: pc };
    return { http: 200, outcome: "needs_attention", processCode: pc };
  }

  if (payment.status === "paid") return { http: 200, outcome: "already_paid", processCode: pc };

  if (state === "attention") {
    if (await deps.flagAttention(orderId, "capture_failed")) await deps.alertAttention(orderId, "capture_failed", {});
    return { http: 200, outcome: "needs_attention", processCode: pc };
  }

  // 失敗只依伺服器回查判斷（APN 的 status 可偽造）
  if (state === "failed") {
    await deps.markFailed(orderId, raw);
    return { http: 200, outcome: "failed", processCode: pc };
  }
  return { http: 200, outcome: "pending", processCode: pc };
}

/** 重新付款是否應拒絕：閘道已授權／請款中／請款失敗（避免重複扣款） */
export function gatewayBlocksRetry(gatewayStatus: string | null | undefined): boolean {
  const s = String(gatewayStatus ?? "").trim().toUpperCase();
  if (!s) return false;
  if (s === "P" || s === "S") return true; // PChomePay 時代的舊值
  const n = Number(s);
  return Number.isFinite(n) && classifyProcessCode(n) !== "pending" && classifyProcessCode(n) !== "failed";
}
