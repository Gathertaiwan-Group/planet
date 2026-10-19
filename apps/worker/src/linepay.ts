import { createHmac, randomUUID } from "node:crypto";
import { env } from "./env";

const base = () => (env.linepay.production ? "https://api-pay.line.me" : "https://sandbox-api-pay.line.me");

async function call<T>(uri: string, body: unknown): Promise<T> {
  const nonce = randomUUID();
  const json = JSON.stringify(body);
  const secret = env.linepay.channelSecret!;
  const signature = createHmac("sha256", secret).update(secret + uri + json + nonce).digest("base64");
  const res = await fetch(base() + uri, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-LINE-ChannelId": env.linepay.channelId!,
      "X-LINE-Authorization-Nonce": nonce,
      "X-LINE-Authorization": signature,
    },
    body: json,
  });
  return (await res.json()) as T;
}

interface LinePayResp {
  returnCode: string;
  returnMessage: string;
  info?: { paymentUrl?: { web: string } };
}

export async function linepayRequest(opts: { orderId: string; amount: number; name: string }) {
  const r = await call<LinePayResp>("/v3/payments/request", {
    amount: opts.amount,
    currency: "TWD",
    orderId: opts.orderId,
    packages: [{ id: "pkg-1", amount: opts.amount, products: [{ name: opts.name.slice(0, 100), quantity: 1, price: opts.amount }] }],
    redirectUrls: {
      confirmUrl: `${env.publicUrl}/webhooks/linepay`,
      cancelUrl: `${env.webUrl}/`,
    },
  });
  if (r.returnCode !== "0000" || !r.info?.paymentUrl?.web) throw new Error(`LINE Pay request ${r.returnCode} ${r.returnMessage}`);
  return r.info.paymentUrl.web;
}

export async function linepayConfirm(transactionId: string, amount: number) {
  if (!/^\d{1,30}$/.test(transactionId)) throw new Error("invalid transactionId");
  const r = await call<LinePayResp>(`/v3/payments/${transactionId}/confirm`, { amount, currency: "TWD" });
  return r.returnCode === "0000";
}
