// 光貿 Amego 電子發票 —— 簽章、開立、查詢（移植自 alice-store src/server/amego.ts，已在小時光正式站實測）。
// 不 import server-only，方便單元測試；只會被 server 端模組（lib/invoice/issuer.ts）引用。
//
// 協定：base https://invoice-api.amego.tw（測試與正式同網址，靠統編＋App Key 區分）。
//   每支 API 都是 POST application/x-www-form-urlencoded，四個欄位：
//     invoice=賣方統編  data=業務 JSON 字串  time=Unix 秒（與伺服器差 ±60 秒內）  sign=md5(data + time + AppKey)
//   /json/f0401（開立）吃物件、/json/invoice_query 吃物件。
//   🔴 所有回應都是 HTTP 200，成敗只看 body.code（0 才成功）。
//   🔴 「JSON 解得開」≠「這是 Amego 的回應」：中繼自己的 {"error":"path_not_allowed"} 也是 JSON。
//      沒有 number 型別的 code 一律當 transport（可重試），否則會被誤判成永久失敗（小時光 2026-09 卡了 5 張）。
//
// 中繼：Amego 有來源 IP 白名單，Vercel 出口 IP 浮動 → 經 Railway 固定 IP 中繼（AMEGO_RELAY_URL + AMEGO_RELAY_SECRET）。
//   中繼只換 host、多帶 x-relay-secret header；sign 在這裡用 AMEGO_APP_KEY 算好，AppKey 不會送給中繼。
//   中繼白名單只有 POST /json/f0401、/json/f0501、/json/invoice_query 與 GET /json/time（alice-store ops/amego-relay/server.js）。
//   ⚠️ AMEGO_RELAY_SECRET 只能出現在送給中繼的 header，絕不可進 console.*。
import { createHash } from "node:crypto";

export const AMEGO_DEFAULT_BASE = "https://invoice-api.amego.tw";
export const AMEGO_OK = 0;
export const AMEGO_CODE_TIME = 15;
export const AMEGO_CODE_SIGN = 16;
export const AMEGO_CODE_NOT_FOUND = 71;
export const AMEGO_CODE_DUPLICATE_ORDER = 3040171;
export const ANONYMOUS_BUYER_ID = "0000000000";
export const ANONYMOUS_BUYER_NAME = "消費者";
export const AMEGO_RELAY_SECRET_HEADER = "x-relay-secret";
/** 中繼允許的 POST 路徑（與 alice-store 中繼白名單一致；本站只用前後兩支，不作廢） */
export const AMEGO_PATHS = { issue: "/json/f0401", query: "/json/invoice_query", time: "/json/time" } as const;

export const amegoBan = () => (process.env.AMEGO_INVOICE_BAN ?? "").trim();
const amegoAppKey = () => (process.env.AMEGO_APP_KEY ?? "").trim();

export function amegoConfigured(): boolean {
  return amegoBan().length > 0 && amegoAppKey().length > 0;
}

/** 中繼網址：必須 https、非 localhost；不合格回 null（改走直連） */
export function amegoRelayUrl(): string | null {
  const raw = (process.env.AMEGO_RELAY_URL ?? "").trim().replace(/\/+$/, "");
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(u.hostname) || u.hostname.endsWith(".local")) return null;
  } catch {
    return null;
  }
  return raw;
}

export function amegoTransport(): { base: string; extraHeaders: Record<string, string>; relay: boolean } {
  const relayUrl = amegoRelayUrl();
  const secret = (process.env.AMEGO_RELAY_SECRET ?? "").trim();
  if (relayUrl && secret) return { base: relayUrl, extraHeaders: { [AMEGO_RELAY_SECRET_HEADER]: secret }, relay: true };
  return { base: (process.env.AMEGO_API_BASE ?? AMEGO_DEFAULT_BASE).replace(/\/+$/, ""), extraHeaders: {}, relay: false };
}

/** sign = md5(未 url-encode 的 data JSON 字串 + time + AppKey) */
export function amegoSign(dataJson: string, time: number | string, appKey: string): string {
  return createHash("md5").update(`${dataJson}${time}${appKey}`, "utf8").digest("hex");
}

export function buildAmegoBody(p: { ban: string; dataJson: string; time: number; appKey: string }): URLSearchParams {
  return new URLSearchParams({ invoice: p.ban, data: p.dataJson, time: String(p.time), sign: amegoSign(p.dataJson, p.time, p.appKey) });
}

export type InvoiceLine = { description: string; quantity: number; unitPrice: number; amount: number };

/**
 * B2C（無統編）：SalesAmount = 明細加總、TaxAmount = 0、TotalAmount = SalesAmount（Amego 規則，照直覺拆 5% 會得到 3040178）。
 * 本站只開 B2C（結帳不收統編）。
 */
export function computeB2CAmounts(lines: InvoiceLine[]): { salesAmount: number; taxAmount: number; totalAmount: number } {
  const sales = Math.round(lines.reduce((a, l) => a + l.amount, 0));
  return { salesAmount: sales, taxAmount: 0, totalAmount: sales };
}

export type IssueInvoiceInput = { orderId: string; buyerName?: string | null; buyerEmail?: string | null; lines: InvoiceLine[] };

export function buildIssuePayload(input: IssueInvoiceInput): Record<string, unknown> {
  const a = computeB2CAmounts(input.lines);
  const payload: Record<string, unknown> = {
    OrderId: input.orderId,
    BuyerIdentifier: ANONYMOUS_BUYER_ID,
    BuyerName: (input.buyerName ?? "").trim().slice(0, 60) || ANONYMOUS_BUYER_NAME,
    ProductItem: input.lines.map((l) => ({
      Description: l.description.replace(/[<>]/g, "").slice(0, 100),
      Quantity: String(l.quantity),
      UnitPrice: String(l.unitPrice),
      Amount: String(l.amount),
      TaxType: "1",
    })),
    SalesAmount: String(a.salesAmount),
    FreeTaxSalesAmount: "0",
    ZeroTaxSalesAmount: "0",
    TaxType: "1",
    TaxRate: "0.05",
    TaxAmount: String(a.taxAmount),
    TotalAmount: String(a.totalAmount),
  };
  const email = (input.buyerEmail ?? "").trim();
  if (email) payload.BuyerEmailAddress = email;
  return payload;
}

export type AmegoResponse = { code: number; msg: string; [k: string]: unknown };
export type AmegoResult =
  | { ok: true; data: AmegoResponse; http: number }
  | { ok: false; kind: "business"; code: number; msg: string; data: AmegoResponse; http: number }
  | { ok: false; kind: "transport"; code: null; msg: string; http: number | null };

/** 只有傳輸層失敗（code null）與時間戳錯誤（15）可重試；其餘業務錯誤碼都是資料／設定問題 → 永久 */
export function isPermanentAmegoError(code: number | null | undefined): boolean {
  if (code === null || code === undefined || typeof code !== "number") return false;
  return code !== AMEGO_CODE_TIME;
}

/** fetch 失敗時 err.message 常只有 "fetch failed"，真正原因在 cause／errors */
export function describeFetchFailure(err: unknown, depth = 0): string {
  if (err == null) return "unknown_error";
  if (!(err instanceof Error)) return String(err);
  let line = err.message ? `${err.name || "Error"}: ${err.message}` : err.name || "Error";
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" || typeof code === "number") line += ` code=${code}`;
  if (depth >= 3) return line;
  const errors = (err as { errors?: unknown }).errors;
  if (Array.isArray(errors) && errors.length) return `${line} [${errors.map((e) => describeFetchFailure(e, depth + 1)).join(" | ")}]`;
  const cause = (err as { cause?: unknown }).cause;
  return cause != null ? `${line} <- ${describeFetchFailure(cause, depth + 1)}` : line;
}

let clockOffsetSeconds = 0;
export function resetAmegoClock(): void {
  clockOffsetSeconds = 0;
}
const amegoNow = () => Math.floor(Date.now() / 1000) + clockOffsetSeconds;

/** 解析 Amego（或中繼）的回應文字。沒有 number 型別的 code → transport（不可判永久失敗） */
export function parseAmegoResponse(http: number, text: string): AmegoResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, kind: "transport", code: null, msg: `non_json_response http=${http} body=${text.slice(0, 200)}`, http };
  }
  const body = parsed as Partial<AmegoResponse> | null;
  if (!body || typeof body.code !== "number") {
    return { ok: false, kind: "transport", code: null, msg: `unexpected_response http=${http} body=${text.slice(0, 200)}`, http };
  }
  const full = body as AmegoResponse;
  if (full.code === AMEGO_OK) return { ok: true, data: full, http };
  return { ok: false, kind: "business", code: full.code, msg: String(full.msg ?? ""), data: full, http };
}

async function syncClock(timeoutMs: number): Promise<number> {
  const t = amegoTransport();
  const res = await fetch(`${t.base}${AMEGO_PATHS.time}`, { method: "GET", headers: t.extraHeaders, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  const body = (await res.json()) as { timestamp?: number };
  if (typeof body.timestamp !== "number") throw new Error("json/time 沒有 timestamp");
  clockOffsetSeconds = body.timestamp - Math.floor(Date.now() / 1000);
  return clockOffsetSeconds;
}

/** 打一支 Amego API。收到 code 15（時鐘漂移）才校時並重送一次。 */
export async function amegoRequest(path: string, data: unknown, timeoutMs = 15_000): Promise<AmegoResult> {
  const ban = amegoBan();
  const appKey = amegoAppKey();
  if (!ban || !appKey) return { ok: false, kind: "transport", code: null, msg: "amego_not_configured", http: null };
  const dataJson = JSON.stringify(data); // 只序列化一次：簽章與 body 必須是同一個字串
  const t = amegoTransport();
  const send = async (time: number): Promise<AmegoResult> => {
    let res: Response;
    try {
      res = await fetch(`${t.base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", ...t.extraHeaders },
        body: buildAmegoBody({ ban, dataJson, time, appKey }),
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      return { ok: false, kind: "transport", code: null, msg: describeFetchFailure(err), http: null };
    }
    return parseAmegoResponse(res.status, await res.text());
  };
  const first = await send(amegoNow());
  if (first.ok || first.kind !== "business" || first.code !== AMEGO_CODE_TIME) return first;
  try {
    const offset = await syncClock(timeoutMs);
    console.warn(`[amego] 時鐘漂移已校正 offset=${offset}s`);
  } catch (err) {
    console.error("[amego] 校時失敗", describeFetchFailure(err));
    return first;
  }
  return send(amegoNow());
}

export type IssuedInvoice = { invoiceNumber: string; randomNumber: string; invoiceTime: number };

/** 開立發票（自動配號）—— 會產生真實稅務發票 */
export async function issueInvoice(input: IssueInvoiceInput): Promise<AmegoResult & { invoice?: IssuedInvoice }> {
  const r = await amegoRequest(AMEGO_PATHS.issue, buildIssuePayload(input));
  if (!r.ok) return r;
  return {
    ...r,
    invoice: {
      invoiceNumber: String(r.data.invoice_number ?? ""),
      randomNumber: String(r.data.random_number ?? ""),
      invoiceTime: Number(r.data.invoice_time ?? 0),
    },
  };
}

/** 用 OrderId 反查（唯讀）。null = 查無（code 71，還沒開過） */
export async function findInvoiceByOrderId(orderId: string): Promise<{ ok: true; hit: { invoiceNumber: string; randomNumber: string; totalAmount: number } | null } | { ok: false; msg: string }> {
  const r = await amegoRequest(AMEGO_PATHS.query, { type: "order", order_id: orderId });
  if (r.ok) {
    const d = (r.data.data ?? {}) as Record<string, unknown>;
    const num = String(d.invoice_number ?? "");
    return { ok: true, hit: num ? { invoiceNumber: num, randomNumber: String(d.random_number ?? ""), totalAmount: Number(d.total_amount ?? 0) } : null };
  }
  if (r.kind === "business" && r.code === AMEGO_CODE_NOT_FOUND) return { ok: true, hit: null };
  return { ok: false, msg: `code=${r.kind === "business" ? r.code : "transport"} ${r.msg}` };
}
