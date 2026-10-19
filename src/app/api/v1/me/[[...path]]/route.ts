import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { refreshTokens, studySessions, userSettings, users } from "@/db/schema";
import { dateOr, fail, intOr, ok, readBody, requireUser, str, boolOr } from "@/lib/server/http";
import { getUserRow, hashPassword, verifyPassword } from "@/lib/server/auth";
import { emit } from "@/lib/server/bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function ensureSettings(userId: string) {
  const rows = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  if (rows[0]) return rows[0];
  const [created] = await db.insert(userSettings).values({ userId }).returning();
  return created;
}

export async function GET(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;
  const path = req.nextUrl.pathname.replace(/^\/api\/v1\/me\/?/, "");

  if (path === "" || path === "settings") {
    const user = await getUserRow(userId);
    if (!user) return fail(404, "not_found", "Пользователь не найден");
    const settings = await ensureSettings(userId);
    if (path === "settings") return ok({ settings });
    return ok({
      user: { id: user.id, login: user.login, email: user.email, timezone: user.timezone, createdAt: user.createdAt },
      settings,
    });
  }

  if (path === "study-session") {
    const rows = await db.select().from(studySessions).where(eq(studySessions.userId, userId)).limit(1);
    return ok({ session: rows[0] ?? null });
  }

  return fail(404, "not_found", "Неизвестный эндпоинт");
}

export async function PATCH(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;
  const path = req.nextUrl.pathname.replace(/^\/api\/v1\/me\/?/, "");
  const body = await readBody(req);

  if (path === "" ) {
    const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
    if (typeof body.timezone === "string" && body.timezone.trim()) patch.timezone = body.timezone.trim().slice(0, 60);
    if (typeof body.email === "string" && body.email.includes("@")) {
      const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
      if (existing[0] && existing[0].id !== userId) return fail(409, "conflict", "Email уже занят");
      patch.email = body.email.trim();
    }
    const [row] = await db.update(users).set(patch).where(eq(users.id, userId)).returning();
    return ok({ user: { id: row.id, login: row.login, email: row.email, timezone: row.timezone } });
  }

  if (path === "password") {
    const current = str(body.current);
    const next = str(body.next);
    if (next.length < 8) return fail(400, "validation", "Новый пароль — минимум 8 символов");
    const user = await getUserRow(userId);
    if (!user || !(await verifyPassword(current, user.passwordHash))) {
      return fail(400, "invalid_password", "Текущий пароль неверен");
    }
    await db.update(users).set({ passwordHash: await hashPassword(next), updatedAt: new Date() }).where(eq(users.id, userId));
    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.userId, userId));
    return ok({ ok: true });
  }

  if (path === "settings" || path === "") {
    return patchSettings(userId, body);
  }

  if (path === "settings") return patchSettings(userId, body);

  return fail(404, "not_found", "Неизвестный эндпоинт");
}

const settingsFields = [
  "theme", "baseCurrency", "displayCurrency", "dailyReportTime",
  "weeklyReportDay", "monthlyReportDay", "pomodoroWork", "pomodoroShortBreak",
  "pomodoroLongBreak", "pomodoroCycles", "notifyTask", "notifyEvent", "notifyPomodoro",
  "notifyReport", "notifySession", "leadTimeMinutes", "hyperfocusPlan",
] as const;

async function patchSettings(userId: string, body: Record<string, unknown>) {
  await ensureSettings(userId);
  const patch: Record<string, unknown> = {};
  const bools = ["notifyTask", "notifyEvent", "notifyPomodoro", "notifyReport", "notifySession"];
  const ints = ["weeklyReportDay", "monthlyReportDay", "pomodoroWork", "pomodoroShortBreak", "pomodoroLongBreak", "pomodoroCycles", "leadTimeMinutes"];
  for (const key of settingsFields) {
    if (body[key] === undefined) continue;
    if (key === "hyperfocusPlan") {
      // Ожидаем объект вида { "1": ["...", "..."], "0": [...] }
      // Валидируем: каждая запись — массив строк (максимум 20 строк по 200 символов)
      const raw = body[key];
      if (raw === null) {
        patch.hyperfocusPlan = {};
        continue;
      }
      if (typeof raw !== "object" || Array.isArray(raw)) continue;
      const clean: Record<string, string[]> = {};
      for (const [day, list] of Object.entries(raw as Record<string, unknown>)) {
        if (!/^[0-6]$/.test(day)) continue;
        if (!Array.isArray(list)) continue;
        const strings = list
          .filter((x): x is string => typeof x === "string")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 20)
          .map((s) => s.slice(0, 200));
        clean[day] = strings;
      }
      patch.hyperfocusPlan = clean;
      continue;
    }
    if (bools.includes(key)) patch[key] = boolOr(body[key], true);
    else if (ints.includes(key)) patch[key] = intOr(body[key], 0);
    else patch[key] = str(body[key]).slice(0, 40);
  }
  if (patch.baseCurrency && !["USD", "USDT"].includes(String(patch.baseCurrency))) {
    return fail(400, "validation", "Базовая валюта: USD или USDT");
  }
  if (Object.keys(patch).length) {
    await db.update(userSettings).set(patch).where(eq(userSettings.userId, userId));
  }
  const settings = await ensureSettings(userId);
  return ok({ settings });
}

const studySchema = z.object({
  course: z.number().int().min(1).max(6),
  sessionType: z.enum(["winter", "summer"]),
  startsAt: z.string().min(4),
  endsAt: z.string().min(4),
});

export async function PUT(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;
  const path = req.nextUrl.pathname.replace(/^\/api\/v1\/me\/?/, "");
  if (path !== "study-session") return fail(404, "not_found", "Неизвестный эндпоинт");
  const parsed = studySchema.safeParse(await readBody(req));
  if (!parsed.success) return fail(400, "validation", parsed.error.issues[0]?.message ?? "Ошибка валидации");
  const startsAt = dateOr(parsed.data.startsAt);
  const endsAt = dateOr(parsed.data.endsAt);
  if (!startsAt || !endsAt) return fail(400, "validation", "Некорректные даты");
  if (endsAt <= startsAt) return fail(400, "validation", "Дата окончания должна быть позже начала");
  const existing = await db.select().from(studySessions).where(eq(studySessions.userId, userId)).limit(1);
  let row: typeof studySessions.$inferSelect;
  if (existing[0]) {
    [row] = await db
      .update(studySessions)
      .set({ course: parsed.data.course, sessionType: parsed.data.sessionType, startsAt, endsAt, updatedAt: new Date() })
      .where(eq(studySessions.userId, userId))
      .returning();
  } else {
    [row] = await db
      .insert(studySessions)
      .values({ userId, course: parsed.data.course, sessionType: parsed.data.sessionType, startsAt, endsAt })
      .returning();
  }
  emit(userId, "studySession.updated", { id: row.id });
  return ok({ session: row });
}

// DELETE /me/study-session — сброс сессии
export async function DELETE(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;
  const path = req.nextUrl.pathname.replace(/^\/api\/v1\/me\/?/, "");
  if (path !== "study-session") return fail(404, "not_found", "Неизвестный эндпоинт");
  await db.delete(studySessions).where(eq(studySessions.userId, userId));
  emit(userId, "studySession.updated", { deleted: true });
  return ok({ ok: true });
}
