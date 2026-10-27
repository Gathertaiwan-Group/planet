import { NextResponse } from "next/server";
import { GATEWAY_ORDER_RE } from "@/lib/pay/reconcile";
import { retryCheckout, siteUrl } from "@/lib/pay/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** L10：只接受本站送出的表單（Origin，沒有 Origin 時看 Referer） */
function sameOrigin(req: Request): boolean {
  const allowed = new Set([new URL(req.url).origin, new URL(siteUrl()).origin]);
  const origin = req.headers.get("origin");
  if (origin) return allowed.has(origin);
  const ref = req.headers.get("referer");
  if (!ref) return false;
  try {
    return allowed.has(new URL(ref).origin);
  } catch {
    return false;
  }
}

/** 重新付款（結果頁表單 POST）：開一筆新的付款嘗試 → 303 到黑貓PAY 刷卡頁；不允許時回結果頁 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return new Response("forbidden", { status: 403 });
  const fd = await req.formData().catch(() => null);
  const o = String(fd?.get("o") ?? "");
  if (!GATEWAY_ORDER_RE.test(o)) return NextResponse.redirect(new URL("/", req.url), 303);
  const r = await retryCheckout(o);
  if (r.ok) return NextResponse.redirect(r.paymentUrl, 303);
  const back = new URL(`/pay/${o}`, req.url);
  back.searchParams.set("e", r.reason);
  return NextResponse.redirect(back, 303);
}
