import { timingSafeEqual } from "node:crypto";
import { ecpayCheckMacValue } from "@planet/shared/ecpay";
import { env } from "./env";

const endpoint = () =>
  env.ecpay.production
    ? "https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5"
    : "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5";

const tradeDate = () => {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value;
  return `${g("year")}/${g("month")}/${g("day")} ${g("hour")}:${g("minute")}:${g("second")}`;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** 產生自動送出的綠界付款表單 HTML */
export function ecpayFormHtml(opts: { tradeNo: string; amount: number; itemName: string; choose: "Credit" | "ATM" | "ALL" }) {
  const params: Record<string, string | number> = {
    MerchantID: env.ecpay.merchantId!,
    MerchantTradeNo: opts.tradeNo,
    MerchantTradeDate: tradeDate(),
    PaymentType: "aio",
    TotalAmount: opts.amount,
    TradeDesc: "十二星球",
    ItemName: opts.itemName.replace(/#/g, " ").slice(0, 200),
    ReturnURL: `${env.publicUrl}/webhooks/ecpay`,
    ClientBackURL: `${env.webUrl}/`,
    ChoosePayment: opts.choose,
    EncryptType: 1,
  };
  params.CheckMacValue = ecpayCheckMacValue(params, env.ecpay.hashKey!, env.ecpay.hashIV!);
  const inputs = Object.entries(params)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(String(v))}">`)
    .join("");
  return `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>前往付款…</title><body style="background:#10162e;color:#f6f0e1;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><form id="f" method="post" action="${endpoint()}">${inputs}<noscript><button type="submit">前往付款</button></noscript></form><p>正在前往付款頁面…</p><script>document.getElementById('f').submit()</script></body></html>`;
}

export function verifyEcpay(params: Record<string, string>): boolean {
  const given = params.CheckMacValue ?? "";
  const expected = ecpayCheckMacValue(params, env.ecpay.hashKey!, env.ecpay.hashIV!);
  const a = Buffer.from(given.toUpperCase());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
