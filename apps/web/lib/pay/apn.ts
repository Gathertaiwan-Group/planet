// 黑貓PAY APN（主動通知）處理流程。純邏輯＋注入依賴（不可 import server-only），route 只負責 HTTP。
//
// 四層防護，順序不可顛倒：
//   ① 密鑰閘門：apn_url 建單時附 ?k=<BLACKCAT_WEBHOOK_SECRET>；不符直接 404，連 body 都不解析
//   ② checksum：MD5(api_id:trans_id:amount:status:nonce)，只擋雜訊（沒有祕密，可偽造）
//   ③ 冪等：payment_events unique(provider, trans_id, status_code)（不含 nonce）；以「上次有沒有做完」決定是否重跑
//   ④ 回查＋金額：reconcileOrder() 回查 process_code，並以 payment_detail.pay_amount 三方比對
//
// 回覆：規格要求純文字 OK（否則每 15 分鐘重送、同狀態碼最多 3 次）。
//   業務面的拒絕（金額不符、找不到訂單、偽造）一律回 OK；只有我們自己壞了（DB、回查失敗）才回 5xx 讓它重送。
import {
  APN_STATUS_LABEL,
  apnChecksumMatches,
  apnPaidAmount,
  FAILING_APN_STATUSES,
  GRANTING_APN_STATUSES,
  REVERSAL_APN_STATUSES,
  sanitizeApnBody,
  secretMatches,
  toInt,
} from "./blackcat-core";
import { GATEWAY_ORDER_RE, type ReconcileOpts, type ReconcileResult } from "./reconcile";

/** 上次已處理到終局的 outcome（重送直接 ack）。未列入的（pending / verify_failed / not_authorized…）重送時會重跑 */
export const TERMINAL_OUTCOMES = new Set(["paid", "already_paid", "amount_mismatch", "needs_attention", "ignored", "reversal_notice", "failed", "unknown_order"]);

export type ClaimResult = "new" | "resume" | "already_done" | "db_error";

export interface ApnDeps {
  /** 寫入 payment_events（outcome=pending）；23505 時讀回既有 outcome 判斷 */
  claimEvent(row: { trans_id: string; status_code: string; gateway_order_id: string; amount: number | null; pay_amount: number | null; raw: Record<string, unknown> }): Promise<ClaimResult>;
  finishEvent(transId: string, statusCode: string, outcome: string, note?: string): Promise<void>;
  reconcile(orderId: string, source: string, opts: ReconcileOpts): Promise<ReconcileResult>;
  paymentStatus(orderId: string): Promise<string | null>;
  flagAttention(orderId: string, reason: string): Promise<boolean>;
  alertAttention(orderId: string, reason: string, info: { kind?: string; amount?: number | null }): Promise<void>;
}

export interface ApnResponse {
  status: number;
  body: string;
  outcome: string;
}

const ok = (outcome: string): ApnResponse => ({ status: 200, body: "OK", outcome });

export async function handleApn(input: { key: string | null; expectedKey: string; rawBody: string }, deps: ApnDeps): Promise<ApnResponse> {
  // ① 密鑰閘門
  if (!input.expectedKey) return { status: 503, body: "not_configured", outcome: "not_configured" };
  if (!secretMatches(input.key, input.expectedKey)) return { status: 404, body: "not_found", outcome: "bad_key" };

  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(input.rawBody) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not_object");
    body = parsed as Record<string, unknown>;
  } catch {
    return { status: 400, body: "BAD_REQUEST", outcome: "bad_json" };
  }

  const transId = String(body.trans_id ?? "").trim();
  const status = String(body.status ?? "").trim().toUpperCase();
  const orderNo = String(body.order_no ?? body.cust_order_no ?? "").trim();
  if (!transId || !status) return { status: 400, body: "BAD_REQUEST", outcome: "missing_fields" };

  // ② checksum（用收到的原樣欄位）
  if (!apnChecksumMatches({ apiId: body.api_id, transId: body.trans_id, amount: body.amount, status: body.status, nonce: body.nonce, checksum: body.checksum })) {
    return { status: 400, body: "BAD_CHECKSUM", outcome: "bad_checksum" };
  }

  // 只處理本站訂單（同一契客帳號還有小時光 IB-、快樂手 HH-）
  if (!GATEWAY_ORDER_RE.test(orderNo)) return ok("foreign_order");

  const payAmount = apnPaidAmount(body);

  // ③ 冪等
  const claim = await deps.claimEvent({
    trans_id: transId.slice(0, 64),
    status_code: status.slice(0, 4),
    gateway_order_id: orderNo,
    amount: toInt(body.amount),
    pay_amount: payAmount,
    raw: sanitizeApnBody(body),
  });
  if (claim === "db_error") return { status: 500, body: "DB_ERROR", outcome: "db_error" };
  if (claim === "already_done") return ok("duplicate");

  const finish = (outcome: string, note?: string) => deps.finishEvent(transId.slice(0, 64), status.slice(0, 4), outcome, note);

  // ④ 授權族（B/O/E）：回查＋金額比對後入帳
  if (GRANTING_APN_STATUSES.has(status) || FAILING_APN_STATUSES.has(status)) {
    const r = await deps.reconcile(orderNo, `apn_${status}`, {
      throttle: false,
      apn: GRANTING_APN_STATUSES.has(status) ? { amount: payAmount, transId } : undefined,
    });
    if (r.http !== 200) {
      await finish(r.outcome === "query_failed" ? "verify_failed" : r.outcome, `process_code=${r.processCode ?? "-"}`);
      return { status: 500, body: "RETRY", outcome: r.outcome };
    }
    // 回查不是已授權 → 偽造或比對方早一步；不終局（重送會再查一次）
    const outcome = GRANTING_APN_STATUSES.has(status) && (r.outcome === "pending" || r.outcome === "failed" || r.outcome === "awaiting_apn") ? "not_authorized" : r.outcome;
    await finish(outcome, `process_code=${r.processCode ?? "-"}`);
    return ok(outcome);
  }

  // 沖銷（M/Q/P）：只有本站仍認為已付款時才吵，不自動改狀態（不可逆的事要有人按）
  if (REVERSAL_APN_STATUSES.has(status)) {
    const ps = await deps.paymentStatus(orderNo);
    if (ps === "paid") {
      const reason = `reversal_${status}`;
      if (await deps.flagAttention(orderNo, reason)) await deps.alertAttention(orderNo, reason, { amount: payAmount });
      await finish("reversal_notice", `黑貓PAY 回報「${APN_STATUS_LABEL[status] ?? status}」但本站仍為已付款`);
      return ok("reversal_notice");
    }
  }

  await finish("ignored", `狀態 ${status} 不觸發入帳`);
  return ok("ignored");
}
