import { timingSafeEqual } from "node:crypto";
import { adminClient } from "@/lib/supabase";
import { reconcileOpenPayments } from "@/lib/pay/service";

// H1：定期對帳。由 Supabase pg_cron（job planet-pay-reconcile，每 10 分鐘）經 pg_net 呼叫。
// 以 x-cron-secret（= CRON_SECRET，同值存在 Vault planet_cron_secret）保護。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const got = req.headers.get("x-cron-secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  const started = Date.now();
  let result: Record<string, unknown>;
  let status = 200;
  try {
    result = { ok: true, ...(await reconcileOpenPayments()) };
  } catch (err) {
    console.error("[pay/cron] 對帳失敗:", err);
    result = { ok: false, error: String((err as Error)?.message ?? err).slice(0, 200) };
    status = 500;
  }
  result.ms = Date.now() - started;
  const sb = adminClient();
  if (sb) {
    await sb.from("job_runs").upsert({ name: "pay-reconcile", last_run_at: new Date().toISOString(), last_result: result });
  }
  console.log("[pay/cron]", JSON.stringify(result));
  return Response.json(result, { status });
}
export const GET = handle;
export const POST = handle;
