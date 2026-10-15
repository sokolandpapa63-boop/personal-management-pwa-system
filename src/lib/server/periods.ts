import { DEFAULT_TZ, timeTodayUtc, zonedNowParts, zonedToUtc } from "./core";

/** Период отчёта по типу в поясе Europe/Moscow. */
export function periodForType(type: string, now = new Date()): { from: Date; to: Date } {
  const { y, m, d } = zonedNowParts(DEFAULT_TZ, now);
  if (type === "daily") {
    return { from: zonedToUtc(DEFAULT_TZ, y, m, d), to: now };
  }
  if (type === "weekly") {
    // начало недели — понедельник
    const dayStart = zonedToUtc(DEFAULT_TZ, y, m, d);
    const dow = (dayStart.getUTCDay() + 6) % 7; // 0 = Пн
    void dow;
    const jsDay = new Intl.DateTimeFormat("en-US", { timeZone: DEFAULT_TZ, weekday: "short" }).format(dayStart);
    const idx = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(jsDay);
    const from = new Date(dayStart.getTime() - Math.max(0, idx) * 86400000);
    return { from, to: now };
  }
  if (type === "monthly") {
    return { from: zonedToUtc(DEFAULT_TZ, y, m, 1), to: now };
  }
  return { from: timeTodayUtc(DEFAULT_TZ, "00:00"), to: now };
}
