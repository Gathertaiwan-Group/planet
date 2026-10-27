import { NextResponse } from "next/server";
import { GATEWAY_ORDER_RE } from "@/lib/pay/reconcile";
import { getPaymentView } from "@/lib/pay/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 重新打開付款頁：未付款且仍是最新一筆嘗試 → 303 到 PChomePay；否則回付款結果頁 */
export async function GET(req: Request, ctx: { params: Promise<{ orderNo: string }> }) {
  const { orderNo } = await ctx.params;
  if (!GATEWAY_ORDER_RE.test(orderNo)) return NextResponse.redirect(new URL("/", req.url), 303);
  const back = new URL(`/pay/${orderNo}`, req.url);
  const v = await getPaymentView(orderNo);
  if (!v || v.paymentStatus !== "init" || v.targetStatus !== "pending" || v.superseded || !v.paymentUrl) {
    return NextResponse.redirect(back, 303);
  }
  const target = new URL(v.paymentUrl);
  if (target.protocol !== "https:" || !/(^|\.)pchomepay\.com\.tw$/.test(target.hostname)) return NextResponse.redirect(back, 303);
  return NextResponse.redirect(target, 303);
}
