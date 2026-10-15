import { NextResponse, type NextRequest } from "next/server";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { reports } from "@/db/schema";
import { dateOr, fail, ok, readBody, requireUser } from "@/lib/server/http";
import { isUuid } from "@/lib/server/records";
import { generateReport } from "@/lib/server/report";
import { periodForType } from "@/lib/server/periods";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const generateSchema = z.object({
  type: z.enum(["daily", "weekly", "monthly", "manual"]).default("manual"),
  from: z.string().optional(),
  to: z.string().optional(),
  sections: z.array(z.string().uuid()).max(30).optional(),
});

function listRow(r: typeof reports.$inferSelect) {
  const meta = (r.meta ?? {}) as Record<string, unknown>;
  return {
    id: r.id,
    type: r.type,
    periodFrom: r.periodFrom,
    periodTo: r.periodTo,
    fileUrl: r.fileUrl,
    fileSize: r.fileSize,
    createdAt: r.createdAt,
    summary: meta.summary ?? null,
  };
}

export async function GET(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;
  const parts = req.nextUrl.pathname.replace(/^\/api\/v1\/reports\/?/, "").split("/").filter(Boolean);

  // GET /reports
  if (parts.length === 0) {
    const q = req.nextUrl.searchParams;
    const conds = [eq(reports.userId, userId)];
    const type = q.get("type");
    if (type && type !== "all") conds.push(eq(reports.type, type));
    const from = dateOr(q.get("from"));
    const to = dateOr(q.get("to"));
    if (from) conds.push(gte(reports.createdAt, from));
    if (to) conds.push(lte(reports.createdAt, to));
    const rows = await db.select().from(reports).where(and(...conds)).orderBy(desc(reports.createdAt)).limit(300);
    return ok({ reports: rows.map(listRow) });
  }

  if (!isUuid(parts[0])) return fail(404, "not_found", "Отчёт не найден");
  const rows = await db.select().from(reports).where(and(eq(reports.id, parts[0]), eq(reports.userId, userId))).limit(1);
  const report = rows[0];
  if (!report) return fail(404, "not_found", "Отчёт не найден");

  // GET /reports/:id/file — HTML-файл (печать → PDF)
  if (parts[1] === "file") {
    const meta = (report.meta ?? {}) as Record<string, unknown>;
    const html = typeof meta.html === "string" ? meta.html : "<h1>Файл недоступен</h1>";
    return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  return ok({ report: listRow(report) });
}

export async function POST(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;
  const parts = req.nextUrl.pathname.replace(/^\/api\/v1\/reports\/?/, "").split("/").filter(Boolean);
  if (parts[0] !== "generate") return fail(404, "not_found", "Неизвестный эндпоинт");
  const parsed = generateSchema.safeParse(await readBody(req));
  if (!parsed.success) return fail(400, "validation", parsed.error.issues[0]?.message ?? "Ошибка валидации");
  const { type, sections: sectionIds } = parsed.data;
  let from: Date;
  let to: Date;
  if (type === "manual") {
    from = dateOr(parsed.data.from ?? null) ?? new Date(Date.now() - 7 * 86400000);
    to = dateOr(parsed.data.to ?? null) ?? new Date();
  } else {
    const period = periodForType(type);
    from = period.from;
    to = period.to;
  }
  if (to < from) return fail(400, "validation", "Конец периода раньше начала");
  const report = await generateReport(userId, { type, from, to, sectionIds });
  return ok({ report: listRow(report) }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;
  const parts = req.nextUrl.pathname.replace(/^\/api\/v1\/reports\/?/, "").split("/").filter(Boolean);
  if (!isUuid(parts[0] ?? "")) return fail(404, "not_found", "Отчёт не найден");
  const rows = await db.select().from(reports).where(and(eq(reports.id, parts[0]), eq(reports.userId, userId))).limit(1);
  if (!rows[0]) return fail(404, "not_found", "Отчёт не найден");
  await db.delete(reports).where(eq(reports.id, rows[0].id));
  return ok({ ok: true });
}
