/** Cloudflare cron expressions use UTC; product schedules use Beijing time. */
export const JOB_CRONS = {
  dca: "0 18 * * *",
  nav: ["0,45 10,13 * * *", "30 11,14 * * *", "15 12,15 * * *"],
  quotaCheck: "0 23 * * *",
  info: "0 17 * * SUN",
} as const;

export function beijingClock(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  return { hour: Number(parts.find((part) => part.type === "hour")!.value), minute: Number(parts.find((part) => part.type === "minute")!.value) };
}

export function navPublicationSlot(now: Date): string | null {
  const { hour, minute } = beijingClock(now);
  if (hour < 18) return null;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const slotMinutes = 18 * 60 + Math.floor(((hour - 18) * 60 + minute) / 45) * 45;
  return `${day}:${String(Math.floor(slotMinutes / 60)).padStart(2, "0")}:${String(slotMinutes % 60).padStart(2, "0")}`;
}
