import "server-only";
import { GATEWAY_ORDER_RE, MIN_GATEWAY_AMOUNT, parseGatewayPayment, type GatewayResult } from "./reconcile";

// PChomePay 支付連 REST 客戶端（沿用 PanPan / gather-landing 模式；零新套件，一律 fetch）。
// env：PCHOMEPAY_APP_ID / PCHOMEPAY_SECRET / PCHOMEPAY_SANDBOX（"true"=測試環境）/ PCHOMEPAY_PAY_TYPES（預設 CARD,ATM）
// ⚠️ notify 沒有簽章：絕不信 payload，一律 GET /v1/payment/{order_id} 回查為準（見 reconcile.ts）。
// 與給樂其他站共用同一組商店金鑰 → 本站 order_id 一律 TP 開頭。

export type PayType = "CARD" | "ATM";

function baseUrl(): string {
  return process.env.PCHOMEPAY_SANDBOX === "true" ? "https://sandbox-api.pchomepay.com.tw" : "https://api.pchomepay.com.tw";
}

export function pchomepayConfigured(): boolean {
  return Boolean(process.env.PCHOMEPAY_APP_ID?.trim() && process.env.PCHOMEPAY_SECRET?.trim());
}

/** 允許的付款方式（PCHOMEPAY_PAY_TYPES，預設 CARD,ATM） */
export function enabledPayTypes(): PayType[] {
  const list = (process.env.PCHOMEPAY_PAY_TYPES || "CARD,ATM")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is PayType => s === "CARD" || s === "ATM");
  return list.length ? list : ["CARD"];
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string | null> {
  if (!pchomepayConfigured()) return null;
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.token;
  const basic = Buffer.from(`${process.env.PCHOMEPAY_APP_ID!.trim()}:${process.env.PCHOMEPAY_SECRET!.trim()}`).toString("base64");
  try {
    const res = await fetch(`${baseUrl()}/v1/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error("[pchomepay] token 換發失敗:", res.status, text.slice(0, 200));
      return null;
    }
    const data = JSON.parse(text) as { token?: string; expired_timestamp?: number };
    if (!data.token) return null;
    const expiresAt = Number(data.expired_timestamp) > 0 ? Number(data.expired_timestamp) * 1000 : now + 25 * 60_000;
    cachedToken = { token: data.token, expiresAt };
    return data.token;
  } catch (err) {
    console.error("[pchomepay] token 換發連線失敗:", err);
    return null;
  }
}

async function pcpayFetch(path: string, init: { method: "GET" | "POST"; body?: string }): Promise<Response | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getToken();
    if (!token) return null;
    try {
      const res = await fetch(`${baseUrl()}${path}`, {
        method: init.method,
        headers: { "pcpay-token": token, "Content-Type": "application/json" },
        body: init.body,
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 401 && attempt === 0) {
        cachedToken = null;
        continue;
      }
      return res;
    } catch (err) {
      console.error("[pchomepay] API 連線失敗:", err);
      return null;
    }
  }
  return null;
}

export interface CheckoutInput {
  orderId: string;
  amount: number;
  payTypes: PayType[];
  itemName: string;
  itemUrl: string;
  returnUrl: string;
  notifyUrl: string;
  buyerEmail?: string | null;
  atmExpireDays: number;
}

/** 建單（POST /v1/payment）→ payment_url。失敗回 null。 */
export async function createGatewayCheckout(input: CheckoutInput): Promise<{ paymentUrl: string } | null> {
  if (!pchomepayConfigured()) return null;
  if (!GATEWAY_ORDER_RE.test(input.orderId) || input.amount < MIN_GATEWAY_AMOUNT || !input.payTypes.length) {
    console.error("[pchomepay] 建單參數不合法");
    return null;
  }
  const body: Record<string, unknown> = {
    order_id: input.orderId,
    pay_type: input.payTypes,
    amount: Math.round(input.amount),
    return_url: input.returnUrl,
    notify_url: input.notifyUrl,
    items: [{ name: input.itemName.slice(0, 100), url: input.itemUrl }],
  };
  if (input.buyerEmail) body.buyer_email = input.buyerEmail;
  if (input.payTypes.includes("ATM")) body.atm_info = { expire_days: input.atmExpireDays };
  try {
    const res = await pcpayFetch("/v1/payment", { method: "POST", body: JSON.stringify(body) });
    if (!res) return null;
    const text = await res.text();
    if (!res.ok) {
      console.error("[pchomepay] 建單失敗:", res.status, text.slice(0, 300));
      return null;
    }
    const data = JSON.parse(text) as { payment_url?: string };
    if (!data.payment_url) return null;
    const host = new URL(data.payment_url).hostname;
    if (!/(^|\.)pchomepay\.com\.tw$/.test(host)) {
      console.error("[pchomepay] payment_url 網域異常:", host);
      return null;
    }
    return { paymentUrl: data.payment_url };
  } catch (err) {
    console.error("[pchomepay] createGatewayCheckout failed:", err);
    return null;
  }
}

/** 查單（GET /v1/payment/{order_id}）——付款狀態唯一權威。失敗回 null（notify 應回 500 讓閘道重試）。 */
export async function queryGatewayPayment(orderId: string): Promise<GatewayResult | null> {
  if (!pchomepayConfigured() || !GATEWAY_ORDER_RE.test(orderId)) return null;
  try {
    const res = await pcpayFetch(`/v1/payment/${encodeURIComponent(orderId)}`, { method: "GET" });
    if (!res) return null;
    const text = await res.text();
    if (!res.ok) {
      console.error("[pchomepay] 查單失敗:", res.status, text.slice(0, 200));
      return null;
    }
    return parseGatewayPayment(JSON.parse(text) as Record<string, unknown>);
  } catch (err) {
    console.error("[pchomepay] queryGatewayPayment failed:", err);
    return null;
  }
}
