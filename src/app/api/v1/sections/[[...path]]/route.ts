import { NextResponse, type NextRequest } from "next/server";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { sections, tableRecords, tableSchemas } from "@/db/schema";
import { fail, ok, readBody, requireUser, str, num, boolOr, intOr } from "@/lib/server/http";
import { emit } from "@/lib/server/bus";
import { DEFAULT_TZ, sortColumns, toZonedDateStr, type Column } from "@/lib/server/core";
import {
  getBaseCurrency,
  getOwnedSection,
  parseCsv,
  prepareRecordData,
  toCsv,
} from "@/lib/server/records";
import { convertWith, getRates } from "@/lib/server/currency";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const sectionSchema = z.object({
  name: z.string().min(1, "Введите название").max(80),
  parentId: z.string().uuid().nullable().optional(),
  icon: z.string().max(60).nullable().optional(),
  color: z.string().max(20).nullable().optional(),
  kind: z.enum(["table", "container"]).optional(),
  slug: z.string().max(60).nullable().optional(),
  depositCurrency: z.string().max(8).nullable().optional(),
});

const columnSchema = z.object({
  key: z.string().min(1).max(40).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Ключ: латиница/цифры/_"),
  name: z.string().min(1).max(80),
  type: z.enum(["text", "textarea", "number", "money", "date", "datetime", "select", "multiselect", "checkbox", "formula"]),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  formula: z.string().max(200).optional(),
  currency: z.string().max(16).optional(),
  showInReport: z.boolean().optional(),
  order: z.number().int().optional(),
});

async function getSchemaColumns(sectionId: string): Promise<Column[]> {
  const rows = await db.select().from(tableSchemas).where(eq(tableSchemas.sectionId, sectionId)).limit(1);
  return rows[0] ? (rows[0].columns as unknown as Column[]) : [];
}

function serSection(s: typeof sections.$inferSelect) {
  return s;
}

export async function GET(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;
  const parts = req.nextUrl.pathname.replace(/^\/api\/v1\/sections\/?/, "").split("/").filter(Boolean);

  // GET /sections
  if (parts.length === 0) {
    const rows = await db.select().from(sections).where(eq(sections.userId, userId)).orderBy(asc(sections.order));
    return ok({ sections: rows.map(serSection) });
  }

  const section = await getOwnedSection(userId, parts[0]);
  if (!section) return fail(404, "not_found", "Раздел не найден");

  // GET /sections/:id/schema
  if (parts[1] === "schema") {
    return ok({ columns: await getSchemaColumns(section.id) });
  }

  // GET /sections/:id/records/export.csv
  if (parts[1] === "records" && parts[2] === "export.csv") {
    const columns = await getSchemaColumns(section.id);
    const rows = await db
      .select()
      .from(tableRecords)
      .where(eq(tableRecords.sectionId, section.id))
      .orderBy(desc(tableRecords.createdAt));
    const csv = toCsv(columns, rows.map((r) => r.data as Record<string, unknown>));
    return new NextResponse("﻿" + csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${section.slug ?? section.id}.csv"`,
      },
    });
  }

  // GET /sections/:id/records?from=&to=
  if (parts[1] === "records") {
    const columns = await getSchemaColumns(section.id);
    const from = req.nextUrl.searchParams.get("from");
    const to = req.nextUrl.searchParams.get("to");
    let rows = await db
      .select()
      .from(tableRecords)
      .where(eq(tableRecords.sectionId, section.id))
      .orderBy(desc(tableRecords.createdAt))
      .limit(2000);
    if (from || to) {
      rows = rows.filter((r) => {
        const key =
          typeof (r.data as Record<string, unknown>).date === "string"
            ? ((r.data as Record<string, string>).date as string)
            : toZonedDateStr(DEFAULT_TZ, r.createdAt);
        return (!from || key >= from) && (!to || key <= to);
      });
    }
    return ok({ records: rows, columns });
  }

  // GET /sections/:id/stats?from=&to=
  if (parts[1] === "stats") {
    const q = req.nextUrl.searchParams;
    const to = q.get("to") ?? toZonedDateStr(DEFAULT_TZ);
    const fromDate = new Date(Date.now() - 6 * 86400000);
    const from = q.get("from") ?? toZonedDateStr(DEFAULT_TZ, fromDate);
    const columns = await getSchemaColumns(section.id);
    const rows = (
      await db.select().from(tableRecords).where(eq(tableRecords.sectionId, section.id)).orderBy(desc(tableRecords.createdAt)).limit(5000)
    ).filter((r) => {
      const d = r.data as Record<string, unknown>;
      const key = typeof d.date === "string" ? (d.date as string) : toZonedDateStr(DEFAULT_TZ, r.createdAt);
      return key >= from && key <= to;
    });
    const numericCols = sortColumns(columns).filter((c) => ["number", "money", "formula"].includes(c.type));
    const byDay = new Map<string, Record<string, number> & { count: number }>();
    const sums: Record<string, number> = {};
    let income = 0;
    let expense = 0;
    const { rates } = await getRates();
    const base = await getBaseCurrency(userId);
    const deposit = section.depositCurrency ?? "USD";
    for (const r of rows) {
      const d = r.data as Record<string, unknown>;
      const key = typeof d.date === "string" ? (d.date as string) : toZonedDateStr(DEFAULT_TZ, r.createdAt);
      const day = byDay.get(key) ?? { count: 0 };
      day.count += 1;
      for (const c of numericCols) {
        const v = Number(d[c.key]) || 0;
        day[c.key] = (day[c.key] ?? 0) + v;
        sums[c.key] = (sums[c.key] ?? 0) + v;
      }
      byDay.set(key, day);
      if (typeof d.operation === "string") {
        const amt = r.amountBase != null ? Number(r.amountBase) : convertWith(rates, Number(d.amount) || 0, deposit, base) ?? 0;
        if (d.operation === "Доход") income += amt;
        if (d.operation === "Расход") expense += amt;
      }
    }
    const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, ...v }));
    return ok({ days, sums, recordCount: rows.length, finance: { income, expense, base, deposit } });
  }

  return fail(404, "not_found", "Неизвестный эндпоинт");
}

export async function POST(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;
  const raw = req.nextUrl.pathname.replace(/^\/api\/v1\/sections\/?/, "");
  const parts = raw.split("/").filter(Boolean);

  // POST /sections
  if (parts.length === 0) {
    const parsed = sectionSchema.safeParse(await readBody(req));
    if (!parsed.success) return fail(400, "validation", parsed.error.issues[0]?.message ?? "Ошибка валидации");
    const existing = await db.select().from(sections).where(eq(sections.userId, userId));
    const siblings = existing.filter((s) => (s.parentId ?? null) === (parsed.data.parentId ?? null));
    const [row] = await db
      .insert(sections)
      .values({
        userId,
        parentId: parsed.data.parentId ?? null,
        name: parsed.data.name,
        icon: parsed.data.icon ?? null,
        color: parsed.data.color ?? null,
        kind: parsed.data.kind ?? "table",
        slug: parsed.data.slug ?? null,
        depositCurrency: parsed.data.depositCurrency ?? null,
        isSystem: false,
        order: siblings.length ? Math.max(...siblings.map((s) => s.order)) + 1 : 0,
      })
      .returning();
    emit(userId, "section.created", { id: row.id });
    return ok({ section: row }, { status: 201 });
  }

  // POST /sections/reorder
  if (parts[0] === "reorder") {
    const body = await readBody(req);
    const orders = Array.isArray(body.orders) ? (body.orders as { id: string; order: number }[]) : [];
    for (const o of orders) {
      await db
        .update(sections)
        .set({ order: intOr(o.order, 0), updatedAt: new Date() })
        .where(and(eq(sections.id, str(o.id)), eq(sections.userId, userId)));
    }
    emit(userId, "section.updated", {});
    return ok({ ok: true });
  }

  const section = await getOwnedSection(userId, parts[0]);
  if (!section) return fail(404, "not_found", "Раздел не найден");

  // POST /sections/:id/records
  if (parts[1] === "records" && parts.length === 2) {
    const body = await readBody(req);
    const columns = await getSchemaColumns(section.id);
    const prepared = await prepareRecordData(section, columns, (body.data as Record<string, unknown>) ?? {});
    if (!prepared.ok) return fail(400, "validation", prepared.message!);
    const [row] = await db
      .insert(tableRecords)
      .values({ sectionId: section.id, data: prepared.data!, amountBase: prepared.amountBase != null ? String(prepared.amountBase) : null })
      .returning();
    emit(userId, "record.created", { sectionId: section.id, id: row.id });
    return ok({ record: row }, { status: 201 });
  }

  // POST /sections/:id/records/import.csv  { csv: "..." }
  if (parts[1] === "records" && parts[2] === "import.csv") {
    const body = await readBody(req);
    const csv = str(body.csv);
    if (!csv) return fail(400, "validation", "Пустой CSV");
    const columns = await getSchemaColumns(section.id);
    const grid = parseCsv(csv);
    if (grid.length < 2) return fail(400, "validation", "CSV должен содержать заголовок и строки");
    const header = grid[0].map((h) => h.trim());
    const errors: string[] = [];
    let imported = 0;
    for (let i = 1; i < grid.length; i++) {
      const raw: Record<string, unknown> = {};
      header.forEach((key, idx) => {
        raw[key] = grid[i][idx] ?? "";
      });
      const prepared = await prepareRecordData(section, columns, raw);
      if (!prepared.ok) {
        errors.push(`Строка ${i}: ${prepared.message}`);
        continue;
      }
      await db.insert(tableRecords).values({
        sectionId: section.id,
        data: prepared.data!,
        amountBase: prepared.amountBase != null ? String(prepared.amountBase) : null,
      });
      imported++;
    }
    emit(userId, "record.created", { sectionId: section.id, bulk: true });
    return ok({ imported, errors: errors.slice(0, 10) });
  }

  return fail(404, "not_found", "Неизвестный эндпоинт");
}

export async function PUT(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;
  const parts = req.nextUrl.pathname.replace(/^\/api\/v1\/sections\/?/, "").split("/").filter(Boolean);
  const section = await getOwnedSection(userId, parts[0] ?? "");
  if (!section) return fail(404, "not_found", "Раздел не найден");

  // PUT /sections/:id/schema
  if (parts[1] === "schema") {
    const body = await readBody(req);
    const parsed = z.array(columnSchema).max(60).safeParse(body.columns);
    if (!parsed.success) return fail(400, "validation", parsed.error.issues[0]?.message ?? "Ошибка схемы");
    const keys = new Set<string>();
    for (const c of parsed.data) {
      if (keys.has(c.key)) return fail(400, "validation", `Дублирующийся ключ «${c.key}»`);
      keys.add(c.key);
    }
    const columns = parsed.data.map((c, i) => ({ ...c, order: c.order ?? i + 1 }));
    const existing = await db.select().from(tableSchemas).where(eq(tableSchemas.sectionId, section.id)).limit(1);
    if (existing[0]) {
      await db.update(tableSchemas).set({ columns, updatedAt: new Date() }).where(eq(tableSchemas.sectionId, section.id));
    } else {
      await db.insert(tableSchemas).values({ sectionId: section.id, columns });
    }
    emit(userId, "section.updated", { id: section.id, schema: true });
    return ok({ columns });
  }

  return fail(404, "not_found", "Неизвестный эндпоинт");
}

export async function PATCH(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;
  const parts = req.nextUrl.pathname.replace(/^\/api\/v1\/sections\/?/, "").split("/").filter(Boolean);
  const section = await getOwnedSection(userId, parts[0] ?? "");
  if (!section) return fail(404, "not_found", "Раздел не найден");
  const body = await readBody(req);
  const patch: Partial<typeof sections.$inferInsert> = { updatedAt: new Date() };
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 80);
  if (body.icon !== undefined) patch.icon = body.icon === null ? null : str(body.icon).slice(0, 60);
  if (body.color !== undefined) patch.color = body.color === null ? null : str(body.color).slice(0, 20);
  if (body.depositCurrency !== undefined) patch.depositCurrency = body.depositCurrency === null ? null : str(body.depositCurrency).slice(0, 8).toUpperCase();
  if (body.order !== undefined) patch.order = num(body.order, section.order);
  if (body.kind !== undefined && ["table", "container"].includes(String(body.kind))) patch.kind = str(body.kind);
  if (body.isSystem !== undefined && section.isSystem) patch.isSystem = boolOr(body.isSystem, true);
  const [row] = await db.update(sections).set(patch).where(eq(sections.id, section.id)).returning();
  emit(userId, "section.updated", { id: section.id });
  return ok({ section: row });
}

export async function DELETE(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;
  const parts = req.nextUrl.pathname.replace(/^\/api\/v1\/sections\/?/, "").split("/").filter(Boolean);
  const section = await getOwnedSection(userId, parts[0] ?? "");
  if (!section) return fail(404, "not_found", "Раздел не найден");
  const all = await db.select().from(sections).where(eq(sections.userId, userId));
  const ids = [section.id];
  for (let i = 0; i < ids.length; i++) {
    for (const s of all) if (s.parentId === ids[i] && !ids.includes(s.id)) ids.push(s.id);
  }
  // отвязываем задачи/события (set null) происходит по FK; записи и схемы удаляются каскадом
  await db.delete(sections).where(inArray(sections.id, ids));
  emit(userId, "section.deleted", { ids });
  return ok({ ok: true, deleted: ids.length });
}
