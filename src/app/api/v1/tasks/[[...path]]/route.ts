import { NextResponse, type NextRequest } from "next/server";
import { and, asc, desc, eq, gte, lte, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { dateOr, fail, intOr, ok, readBody, requireUser, str } from "@/lib/server/http";
import { emit } from "@/lib/server/bus";
import { isUuid } from "@/lib/server/records";
import { DEFAULT_TZ, nextRecurrenceDate, toZonedDateStr, zonedToUtc, type Recurrence } from "@/lib/server/core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const recurrenceSchema = z
  .object({
    freq: z.enum(["daily", "weekly", "monthly", "custom", "weekdays"]),
    interval: z.number().int().min(1).max(365).optional(),
    weekdays: z.array(z.number().int().min(1).max(7)).optional(),
    until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    baseDate: z.string().optional(),
  })
  .nullable()
  .optional();

const taskSchema = z.object({
  title: z.string().min(1, "Введите название").max(200),
  description: z.string().max(5000).nullable().optional(),
  sectionId: z.string().uuid().nullable().optional(),
  priority: z.number().int().min(1).max(3).optional(),
  dueAt: z.string().nullable().optional(),
  recurrence: recurrenceSchema,
  tags: z.array(z.string().max(40)).max(20).nullable().optional(),
});

async function ownedTask(userId: string, id: string) {
  if (!isUuid(id)) return null;
  const rows = await db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, userId))).limit(1);
  return rows[0] ?? null;
}

function normalizeRecurrence(rec: z.infer<typeof recurrenceSchema>, dueAt: Date | null): Recurrence | null {
  if (!rec) return null;
  const baseDate = dueAt ? toZonedDateStr(DEFAULT_TZ, dueAt) : rec.baseDate;
  return { ...rec, baseDate } as Recurrence;
}

/** Создание следующего экземпляра повторяющейся задачи. */
async function spawnNext(task: typeof tasks.$inferSelect) {
  const rec = task.recurrence as Recurrence | null;
  if (!rec || !task.dueAt) return null;
  const afterKey = toZonedDateStr(DEFAULT_TZ, task.dueAt);
  const nextKey = nextRecurrenceDate({ ...rec, baseDate: rec.baseDate ?? afterKey }, afterKey);
  if (!nextKey) return null;
  if (rec.until && nextKey > rec.until) return null;
  // сохранить время суток исходной задачи (в поясе МСК)
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: DEFAULT_TZ, hour: "2-digit", minute: "2-digit", hour12: false });
  const partsFmt = fmt.format(task.dueAt).split(":").map(Number);
  const hh = partsFmt[0] === 24 ? 0 : partsFmt[0];
  const mm = partsFmt[1] || 0;
  const [y, m, d] = nextKey.split("-").map(Number);
  const dueAt = zonedToUtc(DEFAULT_TZ, y, m, d, hh, mm, 0);
  await db.insert(tasks).values({
    userId: task.userId,
    sectionId: task.sectionId,
    title: task.title,
    description: task.description,
    status: "active",
    priority: task.priority,
    dueAt,
    recurrence: rec as unknown as Record<string, unknown>,
    tags: task.tags,
    parentTaskId: task.parentTaskId ?? task.id,
  });
  return nextKey;
}

export async function GET(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;
  const q = req.nextUrl.searchParams;
  const conds = [eq(tasks.userId, userId), ne(tasks.status, "deleted")];
  const status = q.get("status");
  if (status && status !== "all") conds.push(eq(tasks.status, status));
  const sectionId = q.get("sectionId");
  if (sectionId && isUuid(sectionId)) conds.push(eq(tasks.sectionId, sectionId));
  const from = dateOr(q.get("from"));
  const to = dateOr(q.get("to"));
  if (from) conds.push(gte(tasks.dueAt, from));
  if (to) conds.push(lte(tasks.dueAt, to));
  const rows = await db
    .select()
    .from(tasks)
    .where(and(...conds))
    .orderBy(asc(tasks.dueAt), desc(tasks.priority), asc(tasks.createdAt))
    .limit(2000);
  const search = q.get("search")?.toLowerCase();
  const filtered = search
    ? rows.filter((t) => t.title.toLowerCase().includes(search) || (t.description ?? "").toLowerCase().includes(search))
    : rows;
  return ok({ tasks: filtered });
}

export async function POST(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;
  const parts = req.nextUrl.pathname.replace(/^\/api\/v1\/tasks\/?/, "").split("/").filter(Boolean);

  // POST /tasks/bulk-duplicate { ids, dates }
  if (parts[0] === "bulk-duplicate") {
    const body = await readBody(req);
    const ids = Array.isArray(body.ids) ? (body.ids as string[]).filter((s) => isUuid(String(s))) : [];
    const dates = Array.isArray(body.dates) ? (body.dates as string[]).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s))) : [];
    if (!ids.length || !dates.length) return fail(400, "validation", "Нужны ids и dates");
    let created = 0;
    for (const id of ids.slice(0, 50)) {
      const task = await ownedTask(userId, String(id));
      if (!task) continue;
      created += await duplicateToDates(task, dates);
    }
    emit(userId, "task.created", { bulk: true });
    return ok({ created });
  }

  // POST /tasks
  if (parts.length === 0) {
    const parsed = taskSchema.safeParse(await readBody(req));
    if (!parsed.success) return fail(400, "validation", parsed.error.issues[0]?.message ?? "Ошибка валидации");
    const dueAt = dateOr(parsed.data.dueAt ?? null);
    const [row] = await db
      .insert(tasks)
      .values({
        userId,
        sectionId: parsed.data.sectionId ?? null,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        priority: parsed.data.priority ?? 2,
        dueAt,
        recurrence: normalizeRecurrence(parsed.data.recurrence, dueAt) as unknown as Record<string, unknown>,
        tags: parsed.data.tags ?? null,
      })
      .returning();
    emit(userId, "task.created", { id: row.id });
    return ok({ task: row }, { status: 201 });
  }

  const task = await ownedTask(userId, parts[0]);
  if (!task) return fail(404, "not_found", "Задача не найдена");

  // POST /tasks/:id/complete
  if (parts[1] === "complete") {
    const completed = task.status !== "completed";
    const [row] = await db
      .update(tasks)
      .set({ status: completed ? "completed" : "active", completedAt: completed ? new Date() : null, updatedAt: new Date() })
      .where(eq(tasks.id, task.id))
      .returning();
    if (completed) await spawnNext(task);
    emit(userId, "task.completed", { id: task.id, completed });
    return ok({ task: row });
  }

  // POST /tasks/:id/cancel { reason }
  if (parts[1] === "cancel") {
    const body = await readBody(req);
    const reason = str(body.reason).trim();
    if (!reason) return fail(400, "validation", "Укажите причину отмены");
    const [row] = await db
      .update(tasks)
      .set({ status: "cancelled", cancelReason: reason, updatedAt: new Date() })
      .where(eq(tasks.id, task.id))
      .returning();
    await spawnNext(task);
    emit(userId, "task.updated", { id: task.id, status: "cancelled" });
    return ok({ task: row });
  }

  // POST /tasks/:id/duplicate { dates }
  if (parts[1] === "duplicate") {
    const body = await readBody(req);
    const dates = Array.isArray(body.dates) ? (body.dates as string[]).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s))) : [];
    if (!dates.length) return fail(400, "validation", "Выберите хотя бы одну дату");
    const created = await duplicateToDates(task, dates);
    emit(userId, "task.created", { bulk: true });
    return ok({ created });
  }

  return fail(404, "not_found", "Неизвестный эндпоинт");
}

async function duplicateToDates(task: typeof tasks.$inferSelect, dates: string[]) {
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: DEFAULT_TZ, hour: "2-digit", minute: "2-digit", hour12: false });
  const partsFmt = task.dueAt ? fmt.format(task.dueAt).split(":").map(Number) : [9, 0];
  const hh = partsFmt[0] === 24 ? 0 : partsFmt[0];
  const mm = partsFmt[1] || 0;
  let created = 0;
  for (const key of dates.slice(0, 60)) {
    const [y, m, d] = key.split("-").map(Number);
    const dueAt = zonedToUtc(DEFAULT_TZ, y, m, d, hh, mm, 0);
    await db.insert(tasks).values({
      userId: task.userId,
      sectionId: task.sectionId,
      title: task.title,
      description: task.description,
      status: "active",
      priority: task.priority,
      dueAt,
      recurrence: null,
      tags: task.tags,
      parentTaskId: task.parentTaskId ?? (task.recurrence ? task.id : null),
    });
    created++;
  }
  return created;
}

export async function PATCH(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;
  const parts = req.nextUrl.pathname.replace(/^\/api\/v1\/tasks\/?/, "").split("/").filter(Boolean);
  const task = await ownedTask(userId, parts[0] ?? "");
  if (!task) return fail(404, "not_found", "Задача не найдена");
  const body = await readBody(req);
  const patch: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date() };
  if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim().slice(0, 200);
  if (body.description !== undefined) patch.description = body.description === null ? null : str(body.description).slice(0, 5000);
  if (body.sectionId !== undefined) patch.sectionId = body.sectionId === null ? null : isUuid(str(body.sectionId)) ? str(body.sectionId) : task.sectionId;
  if (body.priority !== undefined) patch.priority = Math.min(3, Math.max(1, intOr(body.priority, task.priority)));
  if (body.dueAt !== undefined) patch.dueAt = dateOr(body.dueAt);
  if (body.status !== undefined && ["active", "completed", "cancelled"].includes(str(body.status))) {
    patch.status = str(body.status);
    patch.completedAt = body.status === "completed" ? new Date() : null;
  }
  if (body.tags !== undefined) patch.tags = Array.isArray(body.tags) ? (body.tags as string[]).slice(0, 20) : null;
  if (body.recurrence !== undefined) {
    const parsed = recurrenceSchema.safeParse(body.recurrence);
    if (parsed.success) {
      const due = body.dueAt !== undefined ? dateOr(body.dueAt) : task.dueAt;
      patch.recurrence = normalizeRecurrence(parsed.data, due) as unknown as Record<string, unknown> | null;
    }
  }
  const [row] = await db.update(tasks).set(patch).where(eq(tasks.id, task.id)).returning();
  emit(userId, "task.updated", { id: task.id });
  return ok({ task: row });
}

export async function DELETE(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;
  const parts = req.nextUrl.pathname.replace(/^\/api\/v1\/tasks\/?/, "").split("/").filter(Boolean);
  const task = await ownedTask(userId, parts[0] ?? "");
  if (!task) return fail(404, "not_found", "Задача не найдена");
  const body = await readBody(req);
  const reason = str(body.reason).trim();
  if (!reason) return fail(400, "validation", "Укажите причину удаления");
  const [row] = await db
    .update(tasks)
    .set({ status: "deleted", cancelReason: reason, updatedAt: new Date() })
    .where(eq(tasks.id, task.id))
    .returning();
  emit(userId, "task.deleted", { id: task.id });
  return ok({ task: row });
}
