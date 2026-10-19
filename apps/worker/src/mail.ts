import { env } from "./env";

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/** 寄信；RESEND_API_KEY 沒設就只 log */
export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  if (!env.resendKey) {
    console.log(`[mail] (RESEND_API_KEY 未設定，僅記錄) to=${to.replace(/(.{2}).*(@.*)/, "$1***$2")} subject=${subject}`);
    return false;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.mailFrom, to: [to], subject, text }),
  });
  if (!res.ok) {
    console.error(`[mail] Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return false;
  }
  return true;
}
