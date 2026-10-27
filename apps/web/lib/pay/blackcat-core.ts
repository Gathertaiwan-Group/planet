// 黑貓PAY（統一客樂得多元支付平台 COCS 線上刷卡，收單 統一金流 PAYUNi）— 純函式部分（可單元測試，不可 import server-only）。
// 規格：多元支付平台-WEBAPI介面規格 V1.28.2。參考實作：alice-store src/server/blackcat.ts、happyhand lib/payment/blackcat.ts。
//
// 🔴 APN 的 checksum = MD5(api_id:trans_id:amount:status:nonce)，五個欄位全在通知本體裡、沒有任何祕密，
//    任何人都能自己算出一則「付款成功」。所以：
//      checksum 通過 ≠ 這則通知是真的 ≠ 可以標記付款
//    能標記付款的只有回查 CocsOrderQuery 的 process_code（15/20/21/22）。
// 🔴 實收金額只在 APN 的 payment_detail.pay_amount。checksum 算的是 amount（我們送出去的訂單金額），
//    回查回應也沒有實收欄位（order_amount 是念回我們送的數字；grant_amount 是扣手續費後的撥付淨額）。
//    → apnPaidAmount() 刻意不 fallback 到 amount / order_amount / grant_amount，否則比對變恆真。
import { createHash, timingSafeEqual } from "node:crypto";

/** 規格 P40：金額上限以合約為主，預設 100,000 */
export const MAX_ORDER_AMOUNT = 100_000;

/** 規格附件 1：銀行確實授權過（15 授權完成／20 請求請款／21 請款作業中／22 請款完成） */
export const AUTHORIZED_PROCESS_CODES = new Set<number>([15, 20, 21, 22]);
/** 明確拿不到錢（5 註銷／6 逾期／16 授權失敗／17 取消授權完成／27 退貨完成） */
export const FAILED_PROCESS_CODES = new Set<number>([5, 6, 16, 17, 27]);
/** 23 請款失敗：授權還在但清算失敗，要人看 */
export const CAPTURE_FAILED_PROCESS_CODE = 23;

/** APN 狀態碼（規格 P87-88） */
export const APN_STATUS = {
  AUTHORIZED: "B",
  CAPTURING: "O",
  CAPTURED: "E",
  AUTH_FAILED: "F",
  EXPIRED: "D",
  CAPTURE_FAILED: "P",
  REFUNDED: "M",
  REFUND_FAILED: "N",
  AUTH_CANCELLED: "Q",
  AUTH_CANCEL_FAILED: "R",
} as const;

/** B/O/E 都代表「銀行授權過」——都走入帳流程（同一狀態碼最多重送 3 次，多兩次自癒機會；入帳本身冪等） */
export const GRANTING_APN_STATUSES = new Set<string>(["B", "O", "E"]);
/** 授權失敗／逾期：回查確認後標記失敗 */
export const FAILING_APN_STATUSES = new Set<string>(["F", "D"]);
/** 「本來收到的錢後來沒了」：取消交易／取消授權／請款失敗 → 只通知人工，不自動改狀態 */
export const REVERSAL_APN_STATUSES = new Set<string>(["M", "Q", "P"]);

export const APN_STATUS_LABEL: Record<string, string> = {
  B: "授權完成",
  O: "請款作業中",
  E: "請款完成",
  F: "授權失敗",
  D: "訂單逾期",
  P: "請款失敗",
  M: "取消交易完成",
  N: "取消交易失敗",
  Q: "取消授權完成",
  R: "取消授權失敗",
  I: "開立發票通知",
  J: "開立發票折讓單號通知",
};

export function md5Hex(input: string): string {
  return createHash("md5").update(input, "utf8").digest("hex");
}

/** 常數時間比對十六進位摘要（大小寫不敏感） */
export function digestMatches(expected: string, given: unknown): boolean {
  const g = String(given ?? "").trim().toLowerCase();
  const e = expected.toLowerCase();
  if (g.length === 0 || g.length !== e.length) return false;
  return timingSafeEqual(Buffer.from(g, "utf8"), Buffer.from(e, "utf8"));
}

/** 常數時間比對密鑰字串 */
export function secretMatches(given: string | null | undefined, expected: string): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** number 或數字字串 → 整數；空值／非數字 → null（與 0 意義不同） */
export function toInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const t = v.trim().replace(/["']/g, "");
    if (t === "") return null;
    const n = Number(t);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

/** APN checksum（規格 P89）：MD5(api_id:trans_id:amount:status:nonce)，冒號分隔、不含 hash_base；amount 用收到的原樣 */
export function apnChecksum(input: { apiId: unknown; transId: unknown; amount: unknown; status: unknown; nonce: unknown }): string {
  const part = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  return md5Hex([input.apiId, input.transId, input.amount, input.status, input.nonce].map(part).join(":"));
}

/** checksum 是否一致。⚠️ 不是身分驗證（見檔頭），只擋雜訊 */
export function apnChecksumMatches(input: { apiId: unknown; transId: unknown; amount: unknown; status: unknown; nonce: unknown; checksum: unknown }): boolean {
  const given = String(input.checksum ?? "").trim();
  if (given.length !== 32) return false;
  return digestMatches(apnChecksum(input), given);
}

/** APN 實收金額：payment_detail.pay_amount（COCS）；CVS 代收在頂層。刻意不 fallback 到 amount */
export function apnPaidAmount(body: Record<string, unknown>): number | null {
  const detail = body.payment_detail;
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const nested = toInt((detail as Record<string, unknown>).pay_amount);
    if (nested !== null) return nested;
  }
  return toInt(body.pay_amount);
}

export type ProcessState = "paid" | "failed" | "attention" | "pending";

/** 回查 process_code → 狀態 */
export function classifyProcessCode(code: number | null | undefined): ProcessState {
  if (code == null || !Number.isFinite(code)) return "pending";
  if (AUTHORIZED_PROCESS_CODES.has(code)) return "paid";
  if (FAILED_PROCESS_CODES.has(code)) return "failed";
  if (code === CAPTURE_FAILED_PROCESS_CODE) return "attention";
  return "pending";
}

/** 台北時間 yyyy-MM-dd HH:mm:ss（send_time 必須是傳送當下；不可用 toISOString 的 UTC） */
export function taipeiTimestamp(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")} ${hour}:${get("minute")}:${get("second")}`;
}

/** order_detail：必填、不可含 HTML tag、上限 500 字 */
export function sanitizeOrderDetail(s: string): string {
  const out = s.replace(/<[^>]*>/g, "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 500);
  return out || "十二星球訂單";
}

/** 只允許黑貓PAY 正式／測試網域的 https 刷卡頁 */
export function isBlackcatPayUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && /(^|\.)4128888card\.com\.tw$/.test(url.hostname);
  } catch {
    return false;
  }
}

/** APN body 白名單（存進 payment_events.raw；去掉卡號等） */
const APN_RAW_KEYS = ["api_id", "trans_id", "order_no", "amount", "status", "nonce", "send_time", "notify_time"];
const APN_DETAIL_KEYS = ["pay_amount", "fee", "auth_code", "acquire_time", "period_type", "acquirer_type", "card_type"];
export function sanitizeApnBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of APN_RAW_KEYS) if (body[k] !== undefined) out[k] = body[k];
  const d = body.payment_detail;
  if (d && typeof d === "object" && !Array.isArray(d)) {
    const keep: Record<string, unknown> = {};
    for (const k of APN_DETAIL_KEYS) if ((d as Record<string, unknown>)[k] !== undefined) keep[k] = (d as Record<string, unknown>)[k];
    out.payment_detail = keep;
  }
  return out;
}
