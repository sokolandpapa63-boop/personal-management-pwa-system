import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sections, tableRecords, tableSchemas } from "@/db/schema";
import { fail, ok, readBody, requireUser } from "@/lib/server/http";
import { emit } from "@/lib/server/bus";
import { isUuid, prepareRecordData } from "@/lib/server/records";
import type { Column } from "@/lib/server/core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function getOwnedRecord(userId: string, recordId: string) {
  if (!isUuid(recordId)) return null;
  const rows = await db.select().from(tableRecords).where(eq(tableRecords.id, recordId)).limit(1);
  const record = rows[0];
  if (!record) return null;
  const sec = await db.select().from(sections).where(eq(sections.id, record.sectionId)).limit(1);
  if (!sec[0] || sec[0].userId !== userId) return null;
  return { record, section: sec[0] };
}

export async function PATCH(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;
  const parts = req.nextUrl.pathname.replace(/^\/api\/v1\/records\/?/, "").split("/").filter(Boolean);
  const owned = await getOwnedRecord(userId, parts[0] ?? "");
  if (!owned) return fail(404, "not_found", "Запись не найдена");
  const body = await readBody(req);
  const schemaRows = await db.select().from(tableSchemas).where(eq(tableSchemas.sectionId, owned.section.id)).limit(1);
  const columns = schemaRows[0] ? (schemaRows[0].columns as unknown as Column[]) : [];
  const merged = { ...(owned.record.data as Record<string, unknown>), ...((body.data as Record<string, unknown>) ?? body) };
  const prepared = await prepareRecordData(owned.section, columns, merged);
  if (!prepared.ok) return fail(400, "validation", prepared.message!);
  const [row] = await db
    .update(tableRecords)
    .set({ data: prepared.data!, amountBase: prepared.amountBase != null ? String(prepared.amountBase) : null, updatedAt: new Date() })
    .where(eq(tableRecords.id, owned.record.id))
    .returning();
  emit(userId, "record.updated", { sectionId: owned.section.id, id: row.id });
  return ok({ record: row });
}

export async function DELETE(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;
  const parts = req.nextUrl.pathname.replace(/^\/api\/v1\/records\/?/, "").split("/").filter(Boolean);
  const owned = await getOwnedRecord(userId, parts[0] ?? "");
  if (!owned) return fail(404, "not_found", "Запись не найдена");
  await db.delete(tableRecords).where(eq(tableRecords.id, owned.record.id));
  emit(userId, "record.deleted", { sectionId: owned.section.id, id: owned.record.id });
  return ok({ ok: true });
}
