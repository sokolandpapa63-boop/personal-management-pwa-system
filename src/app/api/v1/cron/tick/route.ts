import { NextResponse, type NextRequest } from "next/server";
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { events, reports, studySessions, tasks, userSettings } from "@/db/schema";
import { ok, requireUser } from "@/lib/server/http";
import { getRates } from "@/lib/server/currency";
import { generateReport } from "@/lib/server/report";
import { periodForType } from "@/lib/server/periods";
import { DEFAULT_TZ, timeTodayUtc, zonedNowParts } from "@/lib/server/core";
import { emit } from "@/lib/server/bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const sessionStatusMemory =
  (globalThis as unknown as { __sessionStatus?: Map<string, string> }).__sessionStatus ??
  ((globalThis as unknown as { __sessionStatus: Map<string, string> }).__sessionStatus = new Map());
const remindedMemory =
  (globalThis as unknown as { __reminded?: Set<string> }).__reminded ??
  ((globalThis as unknown as { __reminded: Set<string> }).__reminded = new Set());

function studyStatus(now: Date, startsAt: Date, endsAt: Date) {
  if (now < startsAt) return "not_started";
  if (now > endsAt) return "finished";
  return "active";
}

/** Тик планировщика: курсы, авто-отчёты, переходы сессии, напоминания. Вызывается клиентом раз в 5 минут. */
export async function POST(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;
  const now = new Date();
  const done: string[] = [];

  // 1. Курсы валют (кэш 1 час, currency.updated при обновлении)
  const ratesBefore = await getRates();
  done.push(`rates:${ratesBefore.stale ? "stale" : "fresh"}`);

  // 2. Переходы учебной сессии → push-событие
  const [session] = await db.select().from(studySessions).where(eq(studySessions.userId, userId)).limit(1);
  if (session) {
    const current = studyStatus(now, session.startsAt, session.endsAt);
    const key = userId;
    const prev = sessionStatusMemory.get(key);
    if (prev && prev !== current) {
      emit(userId, "studySession.updated", {
        transition: current === "active" ? "started" : "finished",
        course: session.course,
        sessionType: session.sessionType,
      });
      done.push(`session:${current}`);
    }
    sessionStatusMemory.set(key, current);
  }

  // 3. Напоминания о задачах и событиях (за leadTimeMinutes)
  const settingsRows = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  const settings = settingsRows[0];
  const leadMs = (settings?.leadTimeMinutes ?? 10) * 60000;
  if (settings?.notifyTask !== false) {
    const upcoming = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.status, "active"), gte(tasks.dueAt, now)))
      .limit(200);
    for (const t of upcoming) {
      if (!t.dueAt) continue;
      const delta = t.dueAt.getTime() - now.getTime();
      const key = `task:${t.id}:${t.dueAt.toISOString()}`;
      if (delta >= 0 && delta <= leadMs && !remindedMemory.has(key)) {
        remindedMemory.add(key);
        emit(userId, "task.reminder", { id: t.id, title: t.title, dueAt: t.dueAt });
        done.push("task-reminder");
      }
    }
  }
  if (settings?.notifyEvent !== false) {
    const upcoming = await db
      .select()
      .from(events)
      .where(and(eq(events.userId, userId), gte(events.startAt, now)))
      .limit(200);
    for (const e of upcoming) {
      const delta = e.startAt.getTime() - now.getTime();
      const key = `event:${e.id}:${e.startAt.toISOString()}`;
      if (delta >= 0 && delta <= leadMs && !remindedMemory.has(key)) {
        remindedMemory.add(key);
        emit(userId, "event.reminder", { id: e.id, title: e.title, startAt: e.startAt });
        done.push("event-reminder");
      }
    }
  }
  if (remindedMemory.size > 5000) remindedMemory.clear();

  // 4. Авто-отчёты daily / weekly / monthly по настройкам
  const [dailyH, dailyM] = (settings?.dailyReportTime ?? "21:00").split(":").map((s) => parseInt(s, 10) || 0);
  const { y, m, d } = zonedNowParts(DEFAULT_TZ, now);
  const dailyAt = timeTodayUtc(DEFAULT_TZ, settings?.dailyReportTime ?? "21:00", now);
  const nineAm = timeTodayUtc(DEFAULT_TZ, "09:00", now);
  const weeklyDay = settings?.weeklyReportDay ?? 7; // 1=Пн..7=Вс
  const monthlyDay = settings?.monthlyReportDay ?? 1;
  const todayWeekday = ((new Date(now.getTime() + 3 * 3600000).getUTCDay() + 6) % 7) + 1; // МСК ISO weekday

  const tryGenerate = async (type: "daily" | "weekly" | "monthly", windowStart: Date, due: boolean) => {
    if (!due) return;
    const existing = await db
      .select({ id: reports.id })
      .from(reports)
      .where(and(eq(reports.userId, userId), eq(reports.type, type), gte(reports.createdAt, windowStart)))
      .limit(1);
    if (existing.length) return;
    const period = periodForType(type, now);
    await generateReport(userId, { type, from: period.from, to: period.to });
    done.push(`report:${type}`);
  };

  const todayStart = timeTodayUtc(DEFAULT_TZ, "00:00", now);
  await tryGenerate("daily", todayStart, now >= dailyAt);
  // начало недели (Пн 00:00 МСК)
  const weekStart = new Date(todayStart.getTime() - (todayWeekday - 1) * 86400000);
  await tryGenerate("weekly", weekStart, todayWeekday === weeklyDay && now >= nineAm);
  const monthStartDay = d >= monthlyDay ? monthlyDay : 1;
  void monthStartDay;
  const monthStart = new Date(Date.UTC(y, m - 1, 1) - 3 * 3600000); // 1-е число 00:00 МСК приблизительно
  const monthStartExact = new Date(timeTodayUtc(DEFAULT_TZ, "00:00", new Date(Date.UTC(y, m - 1, 1, 12))).getTime());
  void monthStart;
  await tryGenerate("monthly", monthStartExact, d === monthlyDay && now >= nineAm);
  void dailyH;
  void dailyM;

  return ok({ ok: true, done });
}
