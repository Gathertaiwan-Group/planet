import { NextResponse } from "next/server";
import { GATEWAY_ORDER_RE } from "@/lib/pay/reconcile";
import { retryCheckout } from "@/lib/pay/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 重新付款（結果頁表單 POST）：開一筆新的付款嘗試 → 303 到 PChomePay；不允許時回結果頁 */
export async function POST(req: Request) {
  const fd = await req.formData().catch(() => null);
  const o = String(fd?.get("o") ?? "");
  const t = String(fd?.get("pay_type") ?? "CARD").toUpperCase();
  if (!GATEWAY_ORDER_RE.test(o)) return NextResponse.redirect(new URL("/", req.url), 303);
  const r = await retryCheckout(o, t === "ATM" ? "ATM" : "CARD");
  if (r.ok) return NextResponse.redirect(r.paymentUrl, 303);
  const back = new URL(`/pay/${o}`, req.url);
  back.searchParams.set("e", r.reason);
  return NextResponse.redirect(back, 303);
}
