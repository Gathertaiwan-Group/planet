import cron from "node-cron";
import { eventDateParts, taipeiDate } from "@planet/shared";
import { db } from "./db";
import { dbReady } from "./env";
import { isEmail, sendMail } from "./mail";

/** 台北時間某日 00:00 的 ISO 字串 */
const taipeiMidnight = (ymd: string) => new Date(`${ymd}T00:00:00+08:00`);

/** 找出 3 天後（台北日期）的活動，寄行前通知給尚未通知過的報名者 */
export async function sendReminders(now = new Date()) {
  if (!dbReady()) {
    console.log("[cron] DB 未設定，略過行前通知。");
    return { events: 0, sent: 0 };
  }
  const target = taipeiDate(new Date(now.getTime() + 3 * 86400_000));
  const from = taipeiMidnight(target);
  const to = new Date(from.getTime() + 86400_000);

  const { data: events, error } = await db()
    .from("events")
    .select("id,title,starts_at,city,venue")
    .eq("published", true)
    .gte("starts_at", from.toISOString())
    .lt("starts_at", to.toISOString());
  if (error) throw error;

  let sent = 0;
  for (const ev of events ?? []) {
    const { data: regs, error: rErr } = await db()
      .from("registrations")
      .select("id,nickname,contact")
      .eq("event_id", ev.id)
      .in("status", ["pending", "paid"])
      .is("reminder_sent_at", null);
    if (rErr) throw rErr;
    const d = eventDateParts(ev.starts_at);
    for (const r of regs ?? []) {
      const text = `${r.nickname} 你好：\n\n提醒你，「${ev.title}」就在 ${d.dateText} ${d.time}（${ev.city}${ev.venue ? " · " + ev.venue : ""}）。\n別忘了帶你的星球寶寶，到時候見！\n\n— 十二星球`;
      if (!isEmail(r.contact)) {
        console.log(`[cron] 報名 ${r.id} 聯絡方式非 Email，簡訊通知尚未串接。`);
        continue;
      }
      // 只有真的寄出才標記；沒設 RESEND_API_KEY 時只 log、不標記
      if (await sendMail(r.contact, `行前通知：${ev.title}`, text)) {
        await db().from("registrations").update({ reminder_sent_at: new Date().toISOString() }).eq("id", r.id);
        sent++;
      }
    }
  }
  console.log(`[cron] 行前通知 ${target}：${events?.length ?? 0} 場活動、${sent} 位報名者。`);
  return { events: events?.length ?? 0, sent };
}

export function startCron() {
  cron.schedule(
    "0 9 * * *",
    () => {
      sendReminders().catch((e) => console.error("[cron] 行前通知失敗", e));
    },
    { timezone: "Asia/Taipei" },
  );
  console.log("[cron] 已排程：每日 09:00 Asia/Taipei 行前通知。");
}
