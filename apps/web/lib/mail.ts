import "server-only";

/** 寄營運通知信（Resend）。RESEND_API_KEY / ADMIN_NOTIFY_EMAIL 未設定時只 console.error，不丟錯。 */
export async function sendAdminAlert(subject: string, text: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY?.trim();
  const to = process.env.ADMIN_NOTIFY_EMAIL?.trim();
  const from = process.env.MAIL_FROM?.trim() || "十二星球 <noreply@gathertaiwan.com>";
  if (!key || !to) {
    console.error(`[mail] 未設定 RESEND_API_KEY/ADMIN_NOTIFY_EMAIL，未寄出：${subject}`);
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: to.split(",").map((s) => s.trim()).filter(Boolean), subject, text }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`[mail] Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[mail] Resend 連線失敗:", err);
    return false;
  }
}
