import { reconcile } from "@/lib/pay/service";
import { GATEWAY_ORDER_RE, redactBody } from "@/lib/pay/reconcile";

// PChomePay notify（公開 webhook）。
// ⚠️ 沒有簽章 → 只取 order_id，其餘一律以 GET /v1/payment/{order_id} 回查為準。
// 處理完成回純文字 success（停止重送）；回查／DB 失敗回 500（讓 PChomePay 重送）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function POST(req: Request) {
  let notifyType = "";
  let orderId = "";
  let raw = "";
  try {
    raw = await req.text();
    const sp = new URLSearchParams(raw);
    notifyType = (sp.get("notify_type") ?? "").trim().slice(0, 40);
    let msg: Record<string, unknown> = {};
    const nm = sp.get("notify_message");
    if (nm) msg = JSON.parse(nm) as Record<string, unknown>;
    else if (raw.trim().startsWith("{")) {
      const j = JSON.parse(raw) as Record<string, unknown>;
      msg = typeof j.notify_message === "string" ? (JSON.parse(j.notify_message) as Record<string, unknown>) : j;
      notifyType ||= String(j.notify_type ?? "").slice(0, 40);
    }
    orderId = String(msg?.order_id ?? "").trim();
  } catch {
    console.warn("[pay/notify] 無法解析 body:", redactBody(raw));
    return text("success", 200); // 格式錯誤，重送也不會變好
  }
  // 只處理本站訂單（TP 開頭）
  if (!GATEWAY_ORDER_RE.test(orderId)) {
    console.warn("[pay/notify] 抽不到本站 order_id，略過:", redactBody(raw));
    return text("success", 200);
  }

  const r = await reconcile(orderId, notifyType || null);
  console.log(`[pay/notify] order=${orderId} type=${notifyType} → ${r.outcome}`);
  return r.http === 200 ? text("success", 200) : text("retry", 500);
}
