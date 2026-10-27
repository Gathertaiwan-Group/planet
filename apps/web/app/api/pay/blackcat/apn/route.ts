import { adminClient } from "@/lib/supabase";
import { blackcatWebhookSecret } from "@/lib/pay/blackcat";
import { handleApn, TERMINAL_OUTCOMES, type ApnDeps } from "@/lib/pay/apn";
import { alertAttention, flagAttention, reconcile } from "@/lib/pay/service";

// 黑貓PAY APN 主動通知（公開 webhook；建單時以 apn_url 指定，網址帶 ?k=<BLACKCAT_WEBHOOK_SECRET>）。
// 流程與防護見 lib/pay/apn.ts。回覆一律純文字（規格要求 "OK"）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const text = (body: string, status: number) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

function db() {
  const sb = adminClient();
  if (!sb) throw new Error("db_unavailable");
  return sb;
}

const deps: ApnDeps = {
  async claimEvent(row) {
    try {
      const sb = db();
      const { error } = await sb.from("payment_events").insert({ provider: "blackcat", outcome: "pending", ...row });
      if (!error) return "new";
      if (error.code !== "23505") {
        console.error("[blackcat/apn] 寫入 payment_events 失敗:", error.message);
        return "db_error";
      }
      const { data: prev, error: e2 } = await sb
        .from("payment_events")
        .select("outcome")
        .eq("provider", "blackcat")
        .eq("trans_id", row.trans_id)
        .eq("status_code", row.status_code)
        .maybeSingle();
      // 衝突卻讀不回來 → 狀況不明，當成我們自己壞了讓它重送（不要猜「大概處理過了」把一筆付款吞掉）
      if (e2 || !prev) return "db_error";
      return TERMINAL_OUTCOMES.has(String(prev.outcome)) ? "already_done" : "resume";
    } catch (err) {
      console.error("[blackcat/apn] claimEvent 例外:", err);
      return "db_error";
    }
  },
  async finishEvent(transId, statusCode, outcome, note) {
    const { error } = await db()
      .from("payment_events")
      .update({ outcome, note: note ?? null })
      .eq("provider", "blackcat")
      .eq("trans_id", transId)
      .eq("status_code", statusCode);
    if (error) console.error("[blackcat/apn] 更新 payment_events 失敗:", error.message);
  },
  reconcile: (orderId, source, opts) => reconcile(orderId, source, opts),
  async paymentStatus(orderId) {
    const { data } = await db().from("payments").select("status").eq("gateway_order_id", orderId).maybeSingle();
    return (data?.status as string) ?? null;
  },
  flagAttention,
  alertAttention,
};

export async function POST(req: Request) {
  const key = new URL(req.url).searchParams.get("k");
  const rawBody = await req.text().catch(() => "");
  try {
    const r = await handleApn({ key, expectedKey: blackcatWebhookSecret(), rawBody }, deps);
    if (r.outcome !== "bad_key") console.log(`[blackcat/apn] → ${r.outcome} (${r.status})`);
    return text(r.body, r.status);
  } catch (err) {
    console.error("[blackcat/apn] 處理例外:", err);
    return text("ERROR", 500);
  }
}

/** GET 用來確認網址可達（黑貓PAY 只會 POST） */
export async function GET() {
  return text("blackcat APN endpoint", 200);
}
