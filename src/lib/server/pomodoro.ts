import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { pomodoroSessions } from "@/db/schema";

type Session = typeof pomodoroSessions.$inferSelect;
type Mode = "work" | "short_break" | "long_break";

export type SerializedSession = {
  id: string;
  status: "active" | "paused" | "completed" | "cancelled";
  type: Mode;
  startedAt: string;
  endAt: string | null;
  remainingSec: number | null;
  duration: number;
  sectionId: string | null;
  taskId: string | null;
};

export function serialize(s: Session): SerializedSession {
  return {
    id: s.id,
    status: s.status as SerializedSession["status"],
    type: s.type as Mode,
    startedAt: s.startedAt.toISOString(),
    endAt: s.endAt ? s.endAt.toISOString() : null,
    remainingSec: s.remainingSec,
    duration: s.duration,
    sectionId: s.sectionId,
    taskId: s.taskId,
  };
}

export async function getCurrent(userId: string): Promise<Session | null> {
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
  return rows[0] ?? null;
}

export async function startSession(
  userId: string,
  args: { duration: number; type: Mode; sectionId?: string | null; taskId?: string | null },
): Promise<Session> {
  const existing = await getCurrent(userId);
  if (existing) return existing;

  const endAt = new Date(Date.now() + args.duration * 60 * 1000);
  const [row] = await db
    .insert(pomodoroSessions)
    .values({
      userId,
      duration: args.duration,
      type: args.type,
      sectionId: args.sectionId ?? null,
      taskId: args.taskId ?? null,
      status: "active",
      endAt,
    })
    .returning();
  return row;
}

export async function pauseSession(
  userId: string,
  sessionId: string,
  remainingSec: number,
): Promise<Session | null> {
  const [row] = await db
    .update(pomodoroSessions)
    .set({
      status: "paused",
      pausedAt: new Date(),
      remainingSec,
      endAt: null,
    })
    .where(and(eq(pomodoroSessions.id, sessionId), eq(pomodoroSessions.userId, userId)))
    .returning();
  return row ?? null;
}

export async function resumeSession(
  userId: string,
  sessionId: string,
  remainingSec: number,
): Promise<Session | null> {
  const endAt = new Date(Date.now() + remainingSec * 1000);
  const [row] = await db
    .update(pomodoroSessions)
    .set({
      status: "active",
      pausedAt: null,
      remainingSec: null,
      endAt,
    })
    .where(and(eq(pomodoroSessions.id, sessionId), eq(pomodoroSessions.userId, userId)))
    .returning();
  return row ?? null;
}

export async function finishSession(userId: string, sessionId: string): Promise<Session | null> {
  const [row] = await db
    .update(pomodoroSessions)
    .set({
      status: "completed",
      completed: true,
      finishedAt: new Date(),
      endAt: null,
      remainingSec: 0,
    })
    .where(and(eq(pomodoroSessions.id, sessionId), eq(pomodoroSessions.userId, userId)))
    .returning();
  return row ?? null;
}

export async function cancelSession(userId: string, sessionId: string): Promise<Session | null> {
  const [row] = await db
    .update(pomodoroSessions)
    .set({
      status: "cancelled",
      finishedAt: new Date(),
      endAt: null,
    })
    .where(and(eq(pomodoroSessions.id, sessionId), eq(pomodoroSessions.userId, userId)))
    .returning();
  return row ?? null;
}

export async function getStats(userId: string, from: Date, to: Date) {
  const rows = await db
    .select({
      completedCount: sql<number>`count(*) filter (where ${pomodoroSessions.status} = 'completed' and ${pomodoroSessions.type} = 'work')`,
      totalMinutes: sql<number>`coalesce(sum(${pomodoroSessions.duration}) filter (where ${pomodoroSessions.status} = 'completed' and ${pomodoroSessions.type} = 'work'), 0)`,
    })
    .from(pomodoroSessions)
    .where(
      and(
        eq(pomodoroSessions.userId, userId),
        gte(pomodoroSessions.startedAt, from),
        lte(pomodoroSessions.startedAt, to),
      ),
    );

  const bySection = await db
    .select({
      sectionId: pomodoroSessions.sectionId,
      minutes: sql<number>`coalesce(sum(${pomodoroSessions.duration}), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(pomodoroSessions)
    .where(
      and(
        eq(pomodoroSessions.userId, userId),
        eq(pomodoroSessions.status, "completed"),
        eq(pomodoroSessions.type, "work"),
        gte(pomodoroSessions.startedAt, from),
        lte(pomodoroSessions.startedAt, to),
      ),
    )
    .groupBy(pomodoroSessions.sectionId);

  return {
    completedCount: Number(rows[0]?.completedCount ?? 0),
    totalMinutes: Number(rows[0]?.totalMinutes ?? 0),
    bySection,
  };
}
