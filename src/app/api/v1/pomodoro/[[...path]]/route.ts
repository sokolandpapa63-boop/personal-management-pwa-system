import { NextResponse, type NextRequest } from "next/server";
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { pomodoroSessions } from "@/db/schema";
import { dateOr, fail, ok, readBody, requireUser } from "@/lib/server/http";
import { emit } from "@/lib/server/bus";
import { isUuid } from "@/lib/server/records";
import { DEFAULT_TZ, toZonedDateStr } from "@/lib/server/core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const startSchema = z.object({
  sectionId: z.string().uuid().nullable().optional(),
  taskId: z.string().uuid().nullable().optional(),
  duration: z.number().int().min(1).max(240),
  type: z.enum(["work", "short_break", "long_break"]),
});

const remainingSchema = z.object({
  remainingSec: z.number().int().min(0).max(86400),
});

type Row = typeof pomodoroSessions.$inferSelect;

function serialize(s: Row) {
  return {
    id: s.id,
    status: s.status,
    type: s.type,
    startedAt: s.startedAt.toISOString(),
    endAt: s.endAt ? s.endAt.toISOString() : null,
    remainingSec: s.remainingSec,
    duration: s.duration,
    sectionId: s.sectionId,
    taskId: s.taskId,
  };
}

export async function GET(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;

  const path = req.nextUrl.pathname.replace(/^\/api\/v1\/pomodoro\/?/, "");

  if (path === "current") {
    const rows = await db
      .select()
      .from(pomodoroSessions)
      .where(
        and(
          eq(pomodoroSessions.userId, userId),
          inArray(pomodoroSessions.status, ["active", "paused"]),
        ),
      )
      .orderBy(desc(pomodoroSessions.startedAt))
      .limit(1);
    return ok({ session: rows[0] ? serialize(rows[0]) : null });
  }

  if (path === "stats") {
    const from = dateOr(req.nextUrl.searchParams.get("from")) ?? new Date(Date.now() - 30 * 86400000);
    const rows = await db
      .select()
      .from(pomodoroSessions)
      .where(and(eq(pomodoroSessions.userId, userId), gte(pomodoroSessions.startedAt, from)))
      .orderBy(asc(pomodoroSessions.startedAt))
      .limit(3000);

    const byDay = new Map<string, { minutes: number; completed: number }>();
    for (const r of rows) {
      const key = toZonedDateStr(DEFAULT_TZ, r.startedAt);
      const day = byDay.get(key) ?? { minutes: 0, completed: 0 };
      if (r.completed && r.type === "work") {
        day.minutes += r.duration;
        day.completed += 1;
      }
      byDay.set(key, day);
    }
    return ok({
      days: [...byDay.entries()].map(([date, v]) => ({ date, ...v })),
      total: rows.filter((r) => r.completed && r.type === "work").length,
    });
  }

  return fail(404, "not_found", "Неизвестный эндпоинт");
}

export async function POST(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;

  const parts = req.nextUrl.pathname
    .replace(/^\/api\/v1\/pomodoro\/?/, "")
    .split("/")
    .filter(Boolean);

  if (parts[0] === "start") {
    const parsed = startSchema.safeParse(await readBody(req));
    if (!parsed.success) {
      return fail(400, "validation", parsed.error.issues[0]?.message ?? "Ошибка валидации");
    }

    const existing = await db
      .select()
      .from(pomodoroSessions)
      .where(
        and(
          eq(pomodoroSessions.userId, userId),
          inArray(pomodoroSessions.status, ["active", "paused"]),
        ),
      )
      .orderBy(desc(pomodoroSessions.startedAt))
      .limit(1);

    if (existing[0]) {
      return ok({ session: serialize(existing[0]) });
    }

    const endAt = new Date(Date.now() + parsed.data.duration * 60 * 1000);
    const [row] = await db
      .insert(pomodoroSessions)
      .values({
        userId,
        sectionId: parsed.data.sectionId ?? null,
        taskId: parsed.data.taskId ?? null,
        duration: parsed.data.duration,
        type: parsed.data.type,
        status: "active",
        endAt,
      })
      .returning();

    emit(userId, "pomodoro.updated", serialize(row) as unknown as Record<string, unknown>);
    return ok({ session: serialize(row) }, { status: 201 });
  }

  const sessionId = parts[0];
  if (!isUuid(sessionId ?? "")) return fail(404, "not_found", "Сессия не найдена");

  const rows = await db
    .select()
    .from(pomodoroSessions)
    .where(and(eq(pomodoroSessions.id, sessionId), eq(pomodoroSessions.userId, userId)))
    .limit(1);
  const session = rows[0];
  if (!session) return fail(404, "not_found", "Сессия не найдена");

  const action = parts[1];

  if (action === "pause") {
    const parsed = remainingSchema.safeParse(await readBody(req));
    if (!parsed.success) return fail(400, "validation", "remainingSec обязателен");

    const [row] = await db
      .update(pomodoroSessions)
      .set({
        status: "paused",
        pausedAt: new Date(),
        remainingSec: parsed.data.remainingSec,
        endAt: null,
      })
      .where(eq(pomodoroSessions.id, session.id))
      .returning();

    emit(userId, "pomodoro.updated", serialize(row) as unknown as Record<string, unknown>);
    return ok({ session: serialize(row) });
  }

  if (action === "resume") {
    const parsed = remainingSchema.safeParse(await readBody(req));
    if (!parsed.success) return fail(400, "validation", "remainingSec обязателен");

    const endAt = new Date(Date.now() + parsed.data.remainingSec * 1000);
    const [row] = await db
      .update(pomodoroSessions)
      .set({
        status: "active",
        pausedAt: null,
        remainingSec: null,
        endAt,
      })
      .where(eq(pomodoroSessions.id, session.id))
      .returning();

    emit(userId, "pomodoro.updated", serialize(row) as unknown as Record<string, unknown>);
    return ok({ session: serialize(row) });
  }

  if (action === "finish") {
    const [row] = await db
      .update(pomodoroSessions)
      .set({
        status: "completed",
        completed: true,
        finishedAt: new Date(),
        endAt: null,
        remainingSec: 0,
      })
      .where(eq(pomodoroSessions.id, session.id))
      .returning();

    emit(userId, "pomodoro.updated", serialize(row) as unknown as Record<string, unknown>);
    return ok({ session: serialize(row) });
  }

  if (action === "cancel") {
    const [row] = await db
      .update(pomodoroSessions)
      .set({
        status: "cancelled",
        completed: false,
        finishedAt: new Date(),
        endAt: null,
      })
      .where(eq(pomodoroSessions.id, session.id))
      .returning();

    emit(userId, "pomodoro.updated", serialize(row) as unknown as Record<string, unknown>);
    return ok({ session: serialize(row) });
  }

  return fail(404, "not_found", "Неизвестный эндпоинт");
}