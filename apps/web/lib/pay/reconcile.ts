// PChomePay 付款狀態對帳（notify 與付款結果頁共用）。純邏輯＋注入依賴，方便單元測試（不可 import server-only）。
// 原則（沿用 PanPan / Realreal 2026-07-12 事件教訓）：
//   - notify 無簽章 → 不信 payload，只拿 order_id，一律回查閘道為準
//   - 成功判準是回查的 status === "S"（成功時 status_code 常為 null，不能只看 status_code）
//   - 回查失敗／DB 失敗 → http 500（PChomePay 會重送）
//   - 金額由 DB 函式比對，不符不標記
//   - 目標轉 paid 為條件式（where status='pending'），只有 transitioned 時才做副作用

export const GATEWAY_ORDER_RE = /^TP\d{6}[0-9A-Z]{8}$/;
/** PChomePay 單筆最低金額 */
export const MIN_GATEWAY_AMOUNT = 30;

/** M6：去個資（email、6 碼以上數字）後取前 200 字，供除錯 */
export function redactBody(raw: string): string {
  return raw
    .replace(/[^\s"'&=:{},]+@[^\s"'&=:{},]+/g, "[email]")
    .replace(/\d{6,}/g, "[num]")
    .slice(0, 200);
}

const ALPHABET = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // 去掉 I、O 避免抄寫誤認

/** TP + 台北 yyMMdd + 8 碼英數（16 字元） */
export function newGatewayOrderId(now: Date, randomBytes: Uint8Array): string {
  const tpe = new Date(now.getTime() + 8 * 3600_000);
  const ymd = `${String(tpe.getUTCFullYear()).slice(2)}${String(tpe.getUTCMonth() + 1).padStart(2, "0")}${String(tpe.getUTCDate()).padStart(2, "0")}`;
  let rand = "";
  for (let i = 0; i < 8; i++) rand += ALPHABET[(randomBytes[i] ?? 0) % ALPHABET.length];
  return `TP${ymd}${rand}`;
}

export function classifyGatewayStatus(q: { status?: string; status_code?: string }): "paid" | "failed" | "pending" {
  const status = String(q.status ?? "").trim().toUpperCase();
  if (status === "S") return "paid";
  if (status === "F") return "failed";
  return "pending"; // W（等待付款）、P（處理中）、其他未知值
}

export interface GatewayResult {
  status?: string;
  status_code?: string;
  pay_type?: string;
  amount?: number;
  payment_info?: Record<string, unknown>;
  raw?: Record<string, unknown>;
}

/** 解析 GET /v1/payment/{order_id} 回應（amount 可能是字串 "30"） */
export function parseGatewayPayment(data: Record<string, unknown>): GatewayResult {
  const payType = Array.isArray(data.pay_type)
    ? data.pay_type.map(String).join(",")
    : data.pay_type != null
      ? String(data.pay_type)
      : undefined;
  const amount =
    data.amount != null && data.amount !== "" && Number.isFinite(Number(data.amount)) ? Number(data.amount) : undefined;
  return {
    status: data.status != null ? String(data.status).trim().toUpperCase() : undefined,
    status_code: data.status_code != null ? String(data.status_code) : undefined,
    pay_type: payType,
    amount,
    payment_info:
      data.payment_info && typeof data.payment_info === "object" && !Array.isArray(data.payment_info)
        ? (data.payment_info as Record<string, unknown>)
        : undefined,
    raw: data,
  };
}

/** PChomePay 日期（"2026/10/20 23:59:59"、"2026-10-20"、"20261020235959"…；台北時間）→ Date */
export function parseGatewayDate(s: string): Date | null {
  const t = s.trim();
  let m = /^(\d{4})[/-](\d{2})[/-](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  if (!m) m = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})?)?$/.exec(t);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  const time = h === undefined ? "23:59:59" : `${h}:${mi}:${se ?? "00"}`;
  const out = new Date(`${y}-${mo}-${d}T${time}+08:00`);
  return Number.isNaN(out.getTime()) ? null : out;
}

function pickString(obj: Record<string, unknown> | undefined, keys: string[]): string {
  if (!obj) return "";
  for (const k of keys) {
    const v = obj[k];
    if (v != null && (typeof v === "string" || typeof v === "number")) {
      const s = String(v).trim();
      if (s) return s;
    }
  }
  return "";
}

/** 從回查結果抽出 ATM 虛擬帳號資訊（沒有則 null） */
export function extractAtmInfo(q: GatewayResult): { bankCode: string; account: string; expireAt: Date | null } | null {
  const account = pickString(q.payment_info, ["virtual_account", "virt_account", "v_account", "atm_virt_account", "account"]);
  if (!account) return null;
  const bankCode = pickString(q.payment_info, ["bank_code", "atm_bank_code", "bank_id", "bank"]);
  const expire = pickString(q.payment_info, ["expire_date", "expired_date", "pay_expire_date", "expire_time", "expired_at"]);
  return { bankCode, account, expireAt: expire ? parseGatewayDate(expire) : null };
}

/** M7：raw 只存白名單欄位（不存 items、buyer 資料等） */
const RAW_KEYS = ["order_id", "status", "status_code", "amount", "trade_amount", "platform_amount", "pp_fee", "pay_type", "create_date", "pay_date", "actual_pay_date", "fail_date", "available_date"];
const PAYMENT_INFO_KEYS = [
  "bank_code", "atm_bank_code", "bank_id", "bank",
  "virtual_account", "virt_account", "v_account", "atm_virt_account", "account",
  "expire_date", "expired_date", "pay_expire_date", "expire_time", "expired_at",
];
export function sanitizeRaw(raw: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!raw) return out;
  for (const k of RAW_KEYS) if (raw[k] !== undefined) out[k] = raw[k];
  const pi = raw.payment_info;
  if (pi && typeof pi === "object" && !Array.isArray(pi)) {
    const keep: Record<string, unknown> = {};
    for (const k of PAYMENT_INFO_KEYS) if ((pi as Record<string, unknown>)[k] !== undefined) keep[k] = (pi as Record<string, unknown>)[k];
    out.payment_info = keep;
  }
  return out;
}

export interface MarkPaidResult {
  result: "paid" | "already_paid" | "amount_mismatch" | "needs_attention" | "not_found";
  transitioned: boolean;
  attention_new?: boolean;
  kind?: "order" | "reg";
  target_id?: string;
  reason?: string;
}

export interface ReconcileDeps {
  findPayment(orderId: string): Promise<{ status: string } | null>;
  /** L11 節流：取得回查權（同單號 N 秒內只回查一次）。回 false = 被節流 */
  claimCheck(orderId: string): Promise<boolean>;
  /** 成功回查後記錄閘道狀態與時間（報名逾時釋出依賴這個時間） */
  recordCheck(orderId: string, gatewayStatus: string | null): Promise<void>;
  /** 新出現的需人工處理（金額不符、取消後才付款、重複付款）→ 通知營運 */
  alertAttention(orderId: string, reason: string, info: { kind?: string; amount?: number }): Promise<void>;
  query(orderId: string): Promise<GatewayResult | null>;
  markPaid(orderId: string, amount: number, payType: string | null, raw: Record<string, unknown>): Promise<MarkPaidResult | null>;
  recordAtm(orderId: string, info: { bankCode: string; account: string; expireAt: Date | null }, raw: Record<string, unknown>): Promise<void>;
  markFailed(orderId: string, raw: Record<string, unknown>): Promise<void>;
  /** 只有這次真的轉成 paid（transitioned）才呼叫 */
  onPaid(kind: "order" | "reg", targetId: string): Promise<void>;
}

export type ReconcileOutcome =
  | "unknown_order"
  | "query_failed"
  | "amount_missing"
  | "db_failed"
  | "paid"
  | "already_paid"
  | "amount_mismatch"
  | "needs_attention"
  | "atm_issued"
  | "failed"
  | "processing"
  | "throttled"
  | "pending";

export interface ReconcileResult {
  http: 200 | 500;
  outcome: ReconcileOutcome;
}

export async function reconcileOrder(
  orderId: string,
  notifyType: string | null,
  deps: ReconcileDeps,
  opts: { throttle?: boolean } = {},
): Promise<ReconcileResult> {
  if (!GATEWAY_ORDER_RE.test(orderId)) return { http: 200, outcome: "unknown_order" };
  const payment = await deps.findPayment(orderId);
  if (!payment) return { http: 200, outcome: "unknown_order" };

  // 節流：被節流時回 500（notify 會被閘道重送；頁面／排程忽略 http）
  if (opts.throttle && !(await deps.claimCheck(orderId))) return { http: 500, outcome: "throttled" };

  const q = await deps.query(orderId);
  if (!q) return { http: 500, outcome: "query_failed" };
  await deps.recordCheck(orderId, q.status ?? null);
  const raw: Record<string, unknown> = { notify_type: notifyType ? notifyType.slice(0, 40) : null, query: sanitizeRaw(q.raw) };

  const state = classifyGatewayStatus(q);
  if (state === "paid") {
    if (q.amount == null || !Number.isFinite(Number(q.amount))) return { http: 500, outcome: "amount_missing" };
    const r = await deps.markPaid(orderId, Math.round(Number(q.amount)), q.pay_type ?? null, raw);
    if (!r) return { http: 500, outcome: "db_failed" };
    if (r.result === "not_found") return { http: 200, outcome: "unknown_order" };
    if (r.attention_new) await deps.alertAttention(orderId, r.reason ?? r.result, { kind: r.kind, amount: q.amount });
    if (r.result === "amount_mismatch") return { http: 200, outcome: "amount_mismatch" };
    if (r.transitioned && r.kind && r.target_id) await deps.onPaid(r.kind, r.target_id);
    if (r.result === "paid") return { http: 200, outcome: "paid" };
    if (r.result === "already_paid") return { http: 200, outcome: "already_paid" };
    return { http: 200, outcome: "needs_attention" };
  }

  if (payment.status === "paid") return { http: 200, outcome: "already_paid" };

  // 失敗只依伺服器回查狀態判斷（notify_type 未簽章，任何人都能偽造）
  if (state === "failed") {
    await deps.markFailed(orderId, raw);
    return { http: 200, outcome: "failed" };
  }

  const atm = extractAtmInfo(q);
  if (atm) {
    await deps.recordAtm(orderId, atm, raw);
    return { http: 200, outcome: "atm_issued" };
  }
  if (String(q.status ?? "").trim().toUpperCase() === "P") return { http: 200, outcome: "processing" };
  return { http: 200, outcome: "pending" };
}
