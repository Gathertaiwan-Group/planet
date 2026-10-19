import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { sendReminders, startCron } from "./cron";
import { findByRef, loadPayable, markPaid, setPaymentRef, type PayKind } from "./db";
import { ecpayFormHtml, verifyEcpay } from "./ecpay";
import { dbReady, ecpayReady, env, linepayReady } from "./env";
import { linepayConfirm, linepayRequest } from "./linepay";
import { isEmail, sendMail } from "./mail";

const app = new Hono();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 綠界 MerchantTradeNo：≤20 英數 */
const newTradeNo = (kind: PayKind) => {
  const head = (kind === "order" ? "TPO" : "TPR") + Date.now().toString(36).toUpperCase();
  return (head + randomBytes(8).toString("hex").toUpperCase()).slice(0, 20);
};

app.get("/", (c) => c.json({ service: "twelve-planets-worker" }));

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "twelve-planets-worker",
    time: new Date().toISOString(),
    db: dbReady(),
    payments: { ecpay: ecpayReady(), linepay: linepayReady() },
    mail: Boolean(env.resendKey),
  }),
);

/** 導向金流：/pay/order/:id 或 /pay/reg/:id（web 下單 / 報名後導過來） */
app.get("/pay/:kind/:id", async (c) => {
  const kind = c.req.param("kind") as PayKind;
  const id = c.req.param("id");
  if ((kind !== "order" && kind !== "reg") || !UUID.test(id)) return c.text("not found", 404);
  if (!dbReady()) return c.text("database not configured", 503);
  const p = await loadPayable(kind, id);
  if (!p) return c.text("not found", 404);
  if (p.status !== "pending") return c.redirect(`${env.webUrl}/`);
  if (p.amount <= 0) return c.text("nothing to pay", 400);

  const useLinePay = p.method === "LINE Pay" || (p.method === null && !ecpayReady() && linepayReady());
  const tradeNo = newTradeNo(kind);
  if (useLinePay) {
    if (!linepayReady()) return c.text("LINE Pay not configured", 503);
    await setPaymentRef(kind, id, tradeNo);
    const url = await linepayRequest({ orderId: tradeNo, amount: p.amount, name: p.title });
    return c.redirect(url);
  }
  if (!ecpayReady()) return c.text("ECPay not configured", 503);
  await setPaymentRef(kind, id, tradeNo);
  const choose = p.method === "ATM 轉帳" ? "ATM" : p.method === "信用卡" ? "Credit" : "ALL";
  return c.html(ecpayFormHtml({ tradeNo, amount: p.amount, itemName: p.title, choose }));
});

/** 綠界付款結果通知（server to server, x-www-form-urlencoded），回 1|OK */
app.post("/webhooks/ecpay", async (c) => {
  if (!ecpayReady() || !dbReady()) return c.text("ECPay not configured", 503);
  const body = await c.req.parseBody();
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) if (typeof v === "string") params[k] = v;
  if (!verifyEcpay(params)) {
    console.warn("[ecpay] CheckMacValue 驗證失敗", params.MerchantTradeNo);
    return c.text("0|CheckMacValue Error", 400);
  }
  if (params.MerchantID !== env.ecpay.merchantId) return c.text("0|MerchantID Error", 400);
  if (params.RtnCode !== "1") {
    // 例如 ATM 取號通知（RtnCode=2）：非付款完成，回 OK 即可
    console.log(`[ecpay] ${params.MerchantTradeNo} RtnCode=${params.RtnCode} ${params.RtnMsg ?? ""}`);
    return c.text("1|OK");
  }
  const rec = await findByRef(params.MerchantTradeNo ?? "");
  if (!rec) {
    console.warn("[ecpay] 找不到對應訂單", params.MerchantTradeNo);
    return c.text("1|OK");
  }
  if (Number(params.TradeAmt) !== rec.amount) {
    console.error(`[ecpay] 金額不符 ${params.MerchantTradeNo}: ${params.TradeAmt} != ${rec.amount}`);
    return c.text("0|Amount Mismatch", 400);
  }
  const changed = await markPaid(rec.kind, rec.id);
  console.log(`[ecpay] ${rec.kind} ${rec.id} → paid (${changed ? "updated" : "already"})`);
  if (changed && rec.kind === "reg" && rec.contact && isEmail(rec.contact)) {
    await sendMail(rec.contact, "報名成功，到時候見！", "你的聚會報名費已付款完成。行前通知會在活動前 3 天寄出。別忘了帶你的星球寶寶。\n\n— 十二星球");
  }
  return c.text("1|OK");
});

/** LINE Pay confirmUrl：使用者付款後被導回，這裡呼叫 confirm API 後更新 paid */
const linepayHandler = async (c: any) => {
  if (!linepayReady() || !dbReady()) return c.text("LINE Pay not configured", 503);
  let transactionId = c.req.query("transactionId");
  let orderId = c.req.query("orderId");
  if (c.req.method === "POST" && (!transactionId || !orderId)) {
    const b = await c.req.json().catch(() => ({}));
    transactionId ??= b.transactionId;
    orderId ??= b.orderId;
  }
  if (!transactionId || !orderId) return c.text("missing params", 400);
  const rec = await findByRef(String(orderId));
  if (!rec) return c.text("not found", 404);
  if (rec.status === "pending") {
    const ok = await linepayConfirm(String(transactionId), rec.amount);
    if (!ok) return c.redirect(`${env.webUrl}/?payment=failed`);
    await markPaid(rec.kind, rec.id);
    console.log(`[linepay] ${rec.kind} ${rec.id} → paid`);
  }
  return c.redirect(`${env.webUrl}/${rec.kind === "reg" ? "events" : "me"}?payment=success`);
};
app.get("/webhooks/linepay", linepayHandler);
app.post("/webhooks/linepay", linepayHandler);

app.onError((err, c) => {
  console.error("[worker] error", err);
  return c.text("internal error", 500);
});

// 手動觸發一次行前通知後結束：node dist/index.mjs --remind-now [--as-of=YYYY-MM-DD]
if (process.argv.includes("--remind-now")) {
  const asOf = process.argv.find((a) => a.startsWith("--as-of="))?.slice(8);
  const r = await sendReminders(asOf ? new Date(`${asOf}T09:00:00+08:00`) : new Date());
  console.log(JSON.stringify(r));
  process.exit(0);
}

serve({ fetch: app.fetch, port: env.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`[worker] listening on :${info.port}（ecpay=${ecpayReady()} linepay=${linepayReady()} db=${dbReady()} mail=${Boolean(env.resendKey)}）`);
});
startCron();
