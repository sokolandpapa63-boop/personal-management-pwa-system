import { NextResponse, type NextRequest } from "next/server";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { tasks, events, sections } from "@/db/schema";
import { fail, ok, readBody, requireUser } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const importItemSchema = z.object({
  type: z.enum(["task", "event"]),
  title: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
  time: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  duration_min: z.number().int().min(0).optional().default(0),
  section: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
});

const importSchema = z.object({
  items: z.array(importItemSchema),
});

export async function POST(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;

  const parsed = importSchema.safeParse(await readBody(req));
  if (!parsed.success) {
    return fail(400, "validation", "Неверный формат данных: " + parsed.error.issues[0]?.message);
  }

  const { items } = parsed.data;
  if (items.length === 0) return ok({ imported: 0 });

  // 1. Собираем все уникальные названия разделов
  const sectionNames = Array.from(new Set(items.map((i) => i.section).filter(Boolean) as string[]));
  
  // 2. Ищем их в базе (или создаем новые)
  const sectionMap = new Map<string, string>(); // name -> id
  if (sectionNames.length > 0) {
    const existing = await db.select().from(sections).where(
      and(eq(sections.userId, userId), inArray(sections.name, sectionNames))
    );
    existing.forEach((s) => sectionMap.set(s.name, s.id));

    const missing = sectionNames.filter((name) => !sectionMap.has(name));
    if (missing.length > 0) {
      const created = await db.insert(sections).values(
        missing.map((name) => ({
          userId,
          name,
          kind: "container",
        }))
      ).returning();
      created.forEach((s) => sectionMap.set(s.name, s.id));
    }
  }

  // 3. Разделяем на задачи и события
  const tasksToInsert = items.filter((i) => i.type === "task").map((i) => {
    // Если есть время — ставим dueAt, если нет — на начало дня
    const dateStr = i.time ? `${i.date}T${i.time}:00` : `${i.date}T12:00:00`;
    const dueAt = new Date(dateStr);
    return {
      userId,
      title: i.title,
      description: i.description || null,
      sectionId: i.section ? sectionMap.get(i.section) || null : null,
      dueAt: isNaN(dueAt.getTime()) ? null : dueAt,
      status: "active" as const,
    };
  });

  const eventsToInsert = items.filter((i) => i.type === "event").map((i) => {
    const dateStr = i.time ? `${i.date}T${i.time}:00` : `${i.date}T12:00:00`;
    const startAt = new Date(dateStr);
    const endAt = new Date(startAt.getTime() + (i.duration_min || 0) * 60000);
    return {
      userId,
      title: i.title,
      description: i.description || null,
      sectionId: i.section ? sectionMap.get(i.section) || null : null,
      startAt: isNaN(startAt.getTime()) ? new Date() : startAt,
      endAt: isNaN(endAt.getTime()) ? null : endAt,
    };
  });

  // 4. Вставляем пачками
  if (tasksToInsert.length > 0) {
    await db.insert(tasks).values(tasksToInsert);
  }
  if (eventsToInsert.length > 0) {
    await db.insert(events).values(eventsToInsert);
  }

  return ok({ imported: items.length });
}