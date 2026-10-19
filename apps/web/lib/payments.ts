import "server-only";

interface Health {
  payments?: { ecpay?: boolean; linepay?: boolean };
}

const enabledProviders = () =>
  (process.env.PAYMENT_PROVIDER ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

const workerUrl = () => process.env.WORKER_URL?.trim().replace(/\/$/, "") || null;

/**
 * 判斷要不要導向金流：PAYMENT_PROVIDER 有啟用、WORKER_URL 有設、且 worker 回報該金流憑證已設定。
 * 任何一項不成立就回 null（訂單/報名維持 pending，顯示完成畫面）。
 */
export async function paymentRedirect(kind: "order" | "reg", id: string, method: string | null): Promise<string | null> {
  const providers = enabledProviders();
  const base = workerUrl();
  if (!providers.length || !base) return null;
  const want = method === "LINE Pay" ? "linepay" : method === null ? providers[0] : "ecpay";
  if (!providers.includes(want)) return null;
  try {
    const res = await fetch(`${base}/health`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const h = (await res.json()) as Health;
    if (!h.payments?.[want as "ecpay" | "linepay"]) return null;
  } catch {
    return null;
  }
  return `${base}/pay/${kind}/${id}`;
}
