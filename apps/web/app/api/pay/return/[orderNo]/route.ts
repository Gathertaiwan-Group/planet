import { NextResponse } from "next/server";
import { GATEWAY_ORDER_RE } from "@/lib/pay/reconcile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PChomePay return_url：可能以 GET 或 POST 帶回，一律 303 轉到付款結果頁（結果頁會回查閘道，不信帶回參數）
async function handle(req: Request, ctx: { params: Promise<{ orderNo: string }> }) {
  const { orderNo } = await ctx.params;
  const dest = GATEWAY_ORDER_RE.test(orderNo) ? `/pay/${orderNo}` : "/";
  return NextResponse.redirect(new URL(dest, req.url), 303);
}
export const GET = handle;
export const POST = handle;
