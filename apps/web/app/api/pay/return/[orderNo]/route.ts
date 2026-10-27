import { NextResponse } from "next/server";
import { GATEWAY_ORDER_RE } from "@/lib/pay/reconcile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 黑貓PAY success_url（授權成功導回，GET 帶 chk 等參數）：一律 303 轉到付款結果頁（結果頁會回查閘道，不信帶回參數）。
// ⚠️ 統一金流授權失敗不會導回（規格 P48），失敗只能靠 APN／回查得知。
async function handle(req: Request, ctx: { params: Promise<{ orderNo: string }> }) {
  const { orderNo } = await ctx.params;
  const dest = GATEWAY_ORDER_RE.test(orderNo) ? `/pay/${orderNo}` : "/";
  return NextResponse.redirect(new URL(dest, req.url), 303);
}
export const GET = handle;
export const POST = handle;
