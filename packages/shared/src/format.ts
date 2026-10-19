import type { EventType } from "./types";

export const pad = (n: number) => String(n).padStart(2, "0");
export const orb = (h: number) =>
  `radial-gradient(circle at 32% 28%, oklch(0.96 0.04 ${h}) 0%, oklch(0.8 0.11 ${h}) 40%, oklch(0.5 0.12 ${h}) 100%)`;
export const glow = (h: number) => `oklch(0.75 0.12 ${h} / 0.35)`;
export const nt = (n: number) => "NT$ " + n.toLocaleString("en-US");

export const GOLD_ORB = "radial-gradient(circle at 32% 28%,#fff3c9,#f0c96e 45%,#a8792a)";
export const LOGO_ORB = "radial-gradient(circle at 32% 28%,#fff3c9,#f0c96e 45%,#b9862e)";

export const TYPE_COLORS: Record<EventType, { bg: string; color: string }> = {
  same: { bg: "rgba(240,201,110,.16)", color: "#f0c96e" },
  cross: { bg: "rgba(242,169,154,.18)", color: "#f2a99a" },
  open: { bg: "rgba(159,216,196,.16)", color: "#9fd8c4" },
};

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DOW = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];

/** 以台北時間拆解活動時間 */
export function eventDateParts(startsAt: string) {
  const d = new Date(startsAt);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const m = Number(get("month"));
  const day = Number(get("day"));
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return {
    year: Number(get("year")),
    m,
    mon: MON[m - 1],
    day: pad(day),
    dow: DOW[wd] ?? "",
    time: `${get("hour")}:${get("minute")}`,
    dateText: `${m}/${pad(day)} ${DOW[wd] ?? ""}`,
  };
}

/** 台北時間的 YYYY-MM-DD */
export function taipeiDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function seatText(left: number) {
  if (left <= 0) return { text: "已額滿", color: "#aeb0c6" };
  return left <= 4 ? { text: `只剩 ${left} 位！`, color: "#f2a99a" } : { text: `剩 ${left} 位`, color: "#aeb0c6" };
}
