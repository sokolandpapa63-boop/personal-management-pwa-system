import { NextResponse, type NextRequest } from "next/server";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { events } from "@/db/schema";
import { dateOr, fail, ok, readBody, requireUser, str, boolOr } from "@/lib/server/http";
import { emit } from "@/lib/server/bus";
import { isUuid } from "@/lib/server/records";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const eventSchema = z.object({
  title: z.string().min(1, "Введите название").max(200),
  description: z.string().max(5000).nullable().optional(),
  sectionId: z.string().uuid().nullable().optional(),
  startAt: z.string().min(1, "Укажите дату начала"),
  endAt: z.string().nullable().optional(),
  allDay: z.boolean().optional(),
  color: z.string().max(20).nullable().optional(),
});

async function ownedEvent(userId: string, id: string) {
  if (!isUuid(id)) return null;
  const rows = await db.select().from(events).where(and(eq(events.id, id), eq(events.userId, userId))).limit(1);
  return rows[0] ?? null;
}

export async function GET(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;
  const q = req.nextUrl.searchParams;
  const conds = [eq(events.userId, userId)];
  const from = dateOr(q.get("from"));
  const to = dateOr(q.get("to"));
  if (from) conds.push(gte(events.startAt, from));
  if (to) conds.push(lte(events.startAt, to));
  const rows = await db.select().from(events).where(and(...conds)).orderBy(asc(events.startAt)).limit(1500);
  return ok({ events: rows });
}

export async function POST(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;
  const parsed = eventSchema.safeParse(await readBody(req));
  if (!parsed.success) return fail(400, "validation", parsed.error.issues[0]?.message ?? "Ошибка валидации");
  const startAt = dateOr(parsed.data.startAt);
  if (!startAt) return fail(400, "validation", "Некорректная дата начала");
  const [row] = await db
    .insert(events)
    .values({
      userId,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      sectionId: parsed.data.sectionId ?? null,
      startAt,
      endAt: dateOr(parsed.data.endAt ?? null),
      allDay: parsed.data.allDay ?? false,
      color: parsed.data.color ?? null,
    })
    .returning();
  emit(userId, "event.created", { id: row.id });
  return ok({ event: row }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;
  const parts = req.nextUrl.pathname.replace(/^\/api\/v1\/events\/?/, "").split("/").filter(Boolean);
  const ev = await ownedEvent(userId, parts[0] ?? "");
  if (!ev) return fail(404, "not_found", "Событие не найдено");
  const body = await readBody(req);
  const patch: Partial<typeof events.$inferInsert> = { updatedAt: new Date() };
  if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim().slice(0, 200);
  if (body.description !== undefined) patch.description = body.description === null ? null : str(body.description).slice(0, 5000);
  if (body.sectionId !== undefined) patch.sectionId = body.sectionId === null ? null : isUuid(str(body.sectionId)) ? str(body.sectionId) : ev.sectionId;
  if (body.startAt !== undefined) {
    const d = dateOr(body.startAt);
    if (!d) return fail(400, "validation", "Некорректная дата начала");
    patch.startAt = d;
  }
  if (body.endAt !== undefined) patch.endAt = dateOr(body.endAt);
  if (body.allDay !== undefined) patch.allDay = boolOr(body.allDay, ev.allDay);
  if (body.color !== undefined) patch.color = body.color === null ? null : str(body.color).slice(0, 20);
  const [row] = await db.update(events).set(patch).where(eq(events.id, ev.id)).returning();
  emit(userId, "event.updated", { id: ev.id });
  return ok({ event: row });
}

export async function DELETE(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;
  const parts = req.nextUrl.pathname.replace(/^\/api\/v1\/events\/?/, "").split("/").filter(Boolean);
  const ev = await ownedEvent(userId, parts[0] ?? "");
  if (!ev) return fail(404, "not_found", "Событие не найдено");
  await db.delete(events).where(eq(events.id, ev.id));
  emit(userId, "event.deleted", { id: ev.id });
  return ok({ ok: true });
}
