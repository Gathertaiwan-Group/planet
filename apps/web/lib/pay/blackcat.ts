import "server-only";
import { GATEWAY_ORDER_RE } from "./reconcile";
import { isBlackcatPayUrl, MAX_ORDER_AMOUNT, queryMatchesOrder, sanitizeOrderDetail, taipeiTimestamp, toInt } from "./blackcat-core";

// 黑貓PAY COCS 線上刷卡 REST 客戶端（零新套件，一律 fetch）。純函式與安全說明見 blackcat-core.ts。
// env：BLACKCAT_CUST_ID / BLACKCAT_API_PASSWORD / BLACKCAT_HASH_BASE / BLACKCAT_SANDBOX（只有 "false" 才打正式機）
//      BLACKCAT_WEBHOOK_SECRET（APN 網址 ?k= 閘門）/ BLACKCAT_ACQUIRER_TYPE（預設 payuni）/ BLACKCAT_LIMIT_PRODUCT_ID（選填）
// 與小時光書店（IB-）、快樂手（HH-）共用同一個契客帳號 → 本站 cust_order_no 一律 TP 開頭。
// 建單／查詢都只靠 Bearer token，不需 checksum；也沒有 IP 白名單要求（Vercel 浮動 IP 可用）。

export const BLACKCAT_APN_PATH = "/api/pay/blackcat/apn";
/** 建單：客人在等刷卡網址，給 20 秒；回查（APN／排程／結果頁）縮短為 8 秒，避免拖垮排程預算 */
const CREATE_TIMEOUT_MS = 20_000;
const QUERY_TIMEOUT_MS = 8_000;

/** 預設 sandbox：忘了設變數的後果是打測試機付不了錢，而不是拿測試設定收真錢 */
export function blackcatSandbox(): boolean {
  return process.env.BLACKCAT_SANDBOX?.trim() !== "false";
}

function baseUrl(): string {
  const override = process.env.BLACKCAT_BASE_URL?.trim();
  if (override) return override.replace(/\/+$/, "");
  // ⚠️ 測試機 BaseUrl 含 /app
  return blackcatSandbox() ? "https://test.4128888card.com.tw/app" : "https://cocs.4128888card.com.tw";
}

const custId = () => process.env.BLACKCAT_CUST_ID?.trim() ?? "";
const apiPassword = () => process.env.BLACKCAT_API_PASSWORD?.trim() ?? "";
const webhookSecret = () => process.env.BLACKCAT_WEBHOOK_SECRET?.trim() ?? "";

export function blackcatWebhookSecret(): string {
  return webhookSecret();
}

/** APN 網址（含 ?k= 密鑰閘門）。base 必須是 https 且非 localhost；規格上限 250 字 */
export function blackcatApnUrl(base: string): string | null {
  const secret = webhookSecret();
  if (!secret) return null;
  let url: URL;
  try {
    url = new URL(`${base.replace(/\/+$/, "")}${BLACKCAT_APN_PATH}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(url.hostname) || url.hostname.endsWith(".local")) return null;
  url.searchParams.set("k", secret);
  const out = url.toString();
  return out.length <= 250 ? out : null;
}

/** 金流可用：帳密＋APN 密鑰都要有（缺密鑰＝APN 網址沒有閘門，寧可整條關掉） */
export function blackcatConfigured(): boolean {
  return Boolean(custId() && apiPassword() && webhookSecret());
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(timeoutMs: number): Promise<{ ok: true; token: string } | { ok: false; reason: string }> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) return { ok: true, token: cachedToken.token };
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/Token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "password", username: custId(), password: apiPassword() }).toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return { ok: false, reason: `token 連線失敗：${(err as Error)?.message ?? "unknown"}` };
  }
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(await res.text()) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: `token 回應不是 JSON（HTTP ${res.status}）` }; // 不印 body：可能夾帶帳號
  }
  const token = typeof json.access_token === "string" ? json.access_token : "";
  if (!token) {
    const code = json.error ?? json.Error ?? `HTTP ${res.status}`;
    return { ok: false, reason: `token 取得失敗：${String(code)} ${String(json.error_description ?? "")}`.trim() };
  }
  // 有效期以 .expires（帶前導點、GMT 字串）為準，提前 5 分鐘失效；讀不到用 30 分鐘
  let expiresAt = now + 30 * 60_000;
  const exp = json[".expires"];
  if (typeof exp === "string") {
    const t = Date.parse(exp.trim());
    if (Number.isFinite(t)) expiresAt = t;
  }
  cachedToken = { token, expiresAt: expiresAt - 5 * 60_000 };
  return { ok: true, token };
}

async function collect(payload: Record<string, unknown>, timeoutMs: number): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; reason: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const auth = await getToken(timeoutMs);
    if (!auth.ok) return auth;
    let res: Response;
    try {
      res = await fetch(`${baseUrl()}/api/Collect`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      return { ok: false, reason: `連線失敗：${(err as Error)?.message ?? "unknown"}` };
    }
    if (res.status === 401 && attempt === 0) {
      cachedToken = null;
      continue;
    }
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(await res.text()) as Record<string, unknown>;
    } catch {
      return { ok: false, reason: `回應不是 JSON（HTTP ${res.status}）` };
    }
    if (json.status !== "OK") return { ok: false, reason: String(json.msg ?? `HTTP ${res.status}`).slice(0, 200) };
    return { ok: true, data: json };
  }
  return { ok: false, reason: "token 失效" };
}

export interface CheckoutInput {
  orderId: string;
  amount: number;
  detail: string;
  apnUrl: string;
  successUrl: string;
}

/** 建單（CocsOrderAppend）→ 刷卡頁網址。失敗回 null。 */
export async function createGatewayCheckout(input: CheckoutInput): Promise<{ paymentUrl: string } | null> {
  if (!blackcatConfigured()) return null;
  if (!GATEWAY_ORDER_RE.test(input.orderId) || !Number.isInteger(input.amount) || input.amount < 1 || input.amount > MAX_ORDER_AMOUNT) {
    console.error("[blackcat] 建單參數不合法");
    return null;
  }
  const payload: Record<string, unknown> = {
    cmd: "CocsOrderAppend",
    cust_id: custId(),
    cust_order_no: input.orderId,
    order_amount: input.amount,
    order_detail: sanitizeOrderDetail(input.detail),
    acquirer_type: process.env.BLACKCAT_ACQUIRER_TYPE?.trim() || "payuni",
    send_time: taipeiTimestamp(),
    apn_url: input.apnUrl,
    success_url: input.successUrl,
  };
  const limit = process.env.BLACKCAT_LIMIT_PRODUCT_ID?.trim();
  if (limit) payload.limit_product_id = limit;
  const r = await collect(payload, CREATE_TIMEOUT_MS);
  if (!r.ok) {
    console.error(`[blackcat] 建單失敗 order=${input.orderId}: ${r.reason}`);
    return null;
  }
  const url = typeof r.data.url === "string" ? r.data.url : "";
  if (!isBlackcatPayUrl(url)) {
    console.error(`[blackcat] 刷卡頁網址異常 order=${input.orderId}`);
    return null;
  }
  return { paymentUrl: url };
}

export interface GatewayResult {
  processCode: number | null;
  raw: Record<string, unknown>;
}

/** 回查（CocsOrderQuery）——付款狀態唯一權威。失敗回 null（APN 應回 500 讓閘道重送）。 */
export async function queryGatewayPayment(orderId: string): Promise<GatewayResult | null> {
  if (!blackcatConfigured() || !GATEWAY_ORDER_RE.test(orderId)) return null;
  const r = await collect({ cmd: "CocsOrderQuery", cust_id: custId(), cust_order_no: orderId }, QUERY_TIMEOUT_MS);
  if (!r.ok) {
    console.error(`[blackcat] 回查失敗 order=${orderId}: ${r.reason}`);
    return null;
  }
  // 真實回應是扁平的（process_code 在頂層）；保險起見也吃包在 data 裡的形狀
  const inner = r.data.data;
  const data = inner && typeof inner === "object" && !Array.isArray(inner) ? (inner as Record<string, unknown>) : r.data;
  // L3：回應的 cust_order_no 必須就是我們查的那張（真實回應一定帶這欄，2026-10-28 實測）；不符／缺漏一律當查詢失敗
  if (!queryMatchesOrder(data, orderId)) {
    console.error(`[blackcat] 回查回應的 cust_order_no 與查詢不符 order=${orderId}`);
    return null;
  }
  return { processCode: toInt(data.process_code), raw: data };
}
