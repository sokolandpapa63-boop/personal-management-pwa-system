import { NextResponse, type NextRequest } from "next/server";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  creditPayments,
  sections,
  tableRecords,
  tableSchemas,
  userSettings,
} from "@/db/schema";
import { dateOr, fail, ok, readBody, requireUser } from "@/lib/server/http";
import { emit } from "@/lib/server/bus";
import { isUuid } from "@/lib/server/records";
import { DEFAULT_TZ, type Column } from "@/lib/server/core";
import { convertWith, getRates } from "@/lib/server/currency";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ── helpers ─────────────────────────────────────────────────────────────────
async function getBaseCurrency(userId: string): Promise<string> {
  const rows = await db
    .select({ baseCurrency: userSettings.baseCurrency })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  return rows[0]?.baseCurrency ?? "USD";
}

async function getFinanceTree(userId: string) {
  const rows = await db.select().from(sections).where(eq(sections.userId, userId));
  const finance = rows.find((s) => s.slug === "finance");
  const children = finance ? rows.filter((s) => s.parentId === finance.id) : [];
  return { finance, children };
}

function serializePayment(p: typeof creditPayments.$inferSelect) {
  return {
    id: p.id,
    bank: p.bank,
    logoUrl: p.logoUrl,
    amount: p.amount,
    currency: p.currency,
    dueAt: p.dueAt.toISOString(),
    note: p.note,
    isPaid: p.isPaid,
    paidAt: p.paidAt ? p.paidAt.toISOString() : null,
    recurrence: p.recurrence ?? null,
  };
}

// ── GET ─────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;
  const parts = req.nextUrl.pathname.replace(/^\/api\/v1\/finance\/?/, "").split("/").filter(Boolean);

  if (parts[0] === "summary") return summary(req, userId);

  if (parts[0] === "payments" && parts.length === 1) {
    const rows = await db
      .select()
      .from(creditPayments)
      .where(eq(creditPayments.userId, userId))
      .orderBy(asc(creditPayments.dueAt))
      .limit(500);
    return ok({ items: rows.map(serializePayment) });
  }

  if (parts[0] === "payments" && parts[1] && isUuid(parts[1])) {
    const rows = await db
      .select()
      .from(creditPayments)
      .where(and(eq(creditPayments.id, parts[1]), eq(creditPayments.userId, userId)))
      .limit(1);
    if (!rows[0]) return fail(404, "not_found", "Погашение не найдено");
    return ok({ item: serializePayment(rows[0]) });
  }

  return fail(404, "not_found", "Неизвестный эндпоинт");
}

// ── PATCH ───────────────────────────────────────────────────────────────────
const paymentPatchSchema = z.object({
  bank: z.string().min(1).max(80).optional(),
  logoUrl: z.string().url().nullable().optional(),
  amount: z.number().positive().optional(),
  currency: z.string().min(2).max(8).optional(),
  dueAt: z.string().min(4).optional(),
  note: z.string().max(500).nullable().optional(),
  isPaid: z.boolean().optional(),
  recurrence: z
    .object({
      freq: z.enum(["monthly", "weekly", "daily", "custom"]),
      interval: z.number().int().min(1).max(365).optional(),
      until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    })
    .nullable()
    .optional(),
});

export async function PATCH(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;
  const parts = req.nextUrl.pathname.replace(/^\/api\/v1\/finance\/?/, "").split("/").filter(Boolean);
  if (parts[0] !== "payments" || !parts[1] || !isUuid(parts[1])) {
    return fail(404, "not_found", "Неизвестный эндпоинт");
  }

  const rows = await db
    .select()
    .from(creditPayments)
    .where(and(eq(creditPayments.id, parts[1]), eq(creditPayments.userId, userId)))
    .limit(1);
  const existing = rows[0];
  if (!existing) return fail(404, "not_found", "Погашение не найдено");

  const parsed = paymentPatchSchema.safeParse(await readBody(req));
  if (!parsed.success) {
    return fail(400, "validation", parsed.error.issues[0]?.message ?? "Ошибка валидации");
  }
  const patch: Partial<typeof creditPayments.$inferInsert> = { updatedAt: new Date() };
  const p = parsed.data;
  if (p.bank !== undefined) patch.bank = p.bank.trim();
  if (p.logoUrl !== undefined) patch.logoUrl = p.logoUrl;
  if (p.amount !== undefined) patch.amount = String(p.amount);
  if (p.currency !== undefined) patch.currency = p.currency.toUpperCase();
  if (p.dueAt !== undefined) {
    const d = dateOr(p.dueAt);
    if (!d) return fail(400, "validation", "Некорректная дата платежа");
    patch.dueAt = d;
  }
  if (p.note !== undefined) patch.note = p.note;
  if (p.isPaid !== undefined) {
    patch.isPaid = p.isPaid;
    patch.paidAt = p.isPaid ? new Date() : null;
  }
  if (p.recurrence !== undefined) {
    patch.recurrence = p.recurrence as unknown as Record<string, unknown> | null;
  }

  const [row] = await db
    .update(creditPayments)
    .set(patch)
    .where(eq(creditPayments.id, existing.id))
    .returning();
  emit(userId, "budget.updated", { id: existing.id });
  return ok({ item: serializePayment(row) });
}

// ── POST ────────────────────────────────────────────────────────────────────
const paymentCreateSchema = z.object({
  bank: z.string().min(1, "Укажите банк").max(80),
  logoUrl: z.string().url().nullable().optional(),
  amount: z.number().positive("Сумма должна быть > 0"),
  currency: z.string().min(2).max(8).default("RUB"),
  dueAt: z.string().min(4, "Укажите дату платежа"),
  note: z.string().max(500).nullable().optional(),
  recurrence: z
    .object({
      freq: z.enum(["monthly", "weekly", "daily", "custom"]),
      interval: z.number().int().min(1).max(365).optional(),
      until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    })
    .nullable()
    .optional(),
});

export async function POST(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;
  const parts = req.nextUrl.pathname.replace(/^\/api\/v1\/finance\/?/, "").split("/").filter(Boolean);

  if (parts[0] === "payments" && parts.length === 1) {
    const parsed = paymentCreateSchema.safeParse(await readBody(req));
    if (!parsed.success) {
      return fail(400, "validation", parsed.error.issues[0]?.message ?? "Ошибка валидации");
    }
    const dueAt = dateOr(parsed.data.dueAt);
    if (!dueAt) return fail(400, "validation", "Некорректная дата платежа");
    const [row] = await db
      .insert(creditPayments)
      .values({
        userId,
        bank: parsed.data.bank.trim(),
        logoUrl: parsed.data.logoUrl ?? null,
        amount: String(parsed.data.amount),
        currency: parsed.data.currency.toUpperCase(),
        dueAt,
        note: parsed.data.note ?? null,
        recurrence: (parsed.data.recurrence ?? null) as unknown as Record<string, unknown> | null,
      })
      .returning();
    emit(userId, "budget.updated", { id: row.id });
    return ok({ item: serializePayment(row) }, { status: 201 });
  }

  if (parts[0] === "payments" && parts[1] && parts[2] === "pay" && isUuid(parts[1])) {
    const rows = await db
      .select()
      .from(creditPayments)
      .where(and(eq(creditPayments.id, parts[1]), eq(creditPayments.userId, userId)))
      .limit(1);
    const existing = rows[0];
    if (!existing) return fail(404, "not_found", "Погашение не найдено");
    const [row] = await db
      .update(creditPayments)
      .set({ isPaid: true, paidAt: new Date(), updatedAt: new Date() })
      .where(eq(creditPayments.id, existing.id))
      .returning();
    emit(userId, "budget.updated", { id: existing.id });
    return ok({ item: serializePayment(row) });
  }

  return fail(404, "not_found", "Неизвестный эндпоинт");
}

// ── DELETE ──────────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;
  const parts = req.nextUrl.pathname.replace(/^\/api\/v1\/finance\/?/, "").split("/").filter(Boolean);
  if (parts[0] !== "payments" || !parts[1] || !isUuid(parts[1])) {
    return fail(404, "not_found", "Неизвестный эндпоинт");
  }
  const rows = await db
    .select()
    .from(creditPayments)
    .where(and(eq(creditPayments.id, parts[1]), eq(creditPayments.userId, userId)))
    .limit(1);
  if (!rows[0]) return fail(404, "not_found", "Погашение не найдено");
  await db.delete(creditPayments).where(eq(creditPayments.id, rows[0].id));
  emit(userId, "budget.updated", { id: rows[0].id });
  return ok({ ok: true });
}

// ── summary ─────────────────────────────────────────────────────────────────
async function summary(req: NextRequest, userId: string) {
  const q = req.nextUrl.searchParams;
  const base = await getBaseCurrency(userId);

  // Период: по умолчанию — текущий календарный месяц (МСК)
  const now = new Date();
  const y = Number(new Intl.DateTimeFormat("en-CA", { timeZone: DEFAULT_TZ, year: "numeric" }).format(now));
  const m = Number(new Intl.DateTimeFormat("en-CA", { timeZone: DEFAULT_TZ, month: "2-digit" }).format(now));
  const fromDefault = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
  const toDefault = new Date(Date.UTC(y, m, 1, 0, 0, 0));
  const from = dateOr(q.get("from")) ?? fromDefault;
  const to = dateOr(q.get("to")) ?? toDefault;

  const { finance, children } = await getFinanceTree(userId);
  if (!finance) {
    return ok({
      period: { from: from.toISOString(), to: to.toISOString() },
      baseCurrency: base,
      pnl: { income: 0, expense: 0, net: 0 },
      bySection: [],
      plan: [],
      upcomingPayments: [],
    });
  }

  const { rates } = await getRates();

  const bySection: {
    id: string;
    name: string;
    slug: string | null;
    depositCurrency: string;
    income: number;
    expense: number;
    pnl: number;
  }[] = [];

  // Кэшируем схемы подразделов — через inArray (корректно для uuid[])
  const sectionIds = children.map((c) => c.id);
  const schemaRows = sectionIds.length
    ? await db.select().from(tableSchemas).where(inArray(tableSchemas.sectionId, sectionIds))
    : [];
  const schemaBySection = new Map(
    schemaRows.map((s) => [s.sectionId, s.columns as unknown as Column[]]),
  );

  let totalIncome = 0;
  let totalExpense = 0;
  const planByCategory = new Map<string, number>();

  for (const child of children) {
    const dep = child.depositCurrency ?? "USD";
    const records = await db
      .select()
      .from(tableRecords)
      .where(
        and(
          eq(tableRecords.sectionId, child.id),
          gte(tableRecords.createdAt, from),
          lte(tableRecords.createdAt, to),
        ),
      )
      .limit(5000);

    const cols = schemaBySection.get(child.id) ?? [];
    const hasOperation = cols.some((c) => c.key === "operation");
    if (!hasOperation) continue;

    let income = 0;
    let expense = 0;
    for (const r of records) {
      const d = r.data as Record<string, unknown>;
      const op = String(d.operation ?? "");
      const amountBase =
        r.amountBase != null
          ? Number(r.amountBase)
          : convertWith(rates, Number(d.amount) || 0, dep, base) ?? 0;
      if (op === "Доход") {
        income += amountBase;
        totalIncome += amountBase;
      } else if (op === "Расход") {
        expense += amountBase;
        totalExpense += amountBase;
        const cat = String(d.category ?? "Прочее");
        planByCategory.set(cat, (planByCategory.get(cat) ?? 0) + amountBase);
      }
    }

    bySection.push({
      id: child.id,
      name: child.name,
      slug: child.slug,
      depositCurrency: dep,
      income: Math.round(income * 100) / 100,
      expense: Math.round(expense * 100) / 100,
      pnl: Math.round((income - expense) * 100) / 100,
    });
  }

  const plan = [...planByCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category, amount]) => ({ category, amount: Math.round(amount * 100) / 100 }));

  const upcoming = await db
    .select()
    .from(creditPayments)
    .where(and(eq(creditPayments.userId, userId), eq(creditPayments.isPaid, false)))
    .orderBy(asc(creditPayments.dueAt))
    .limit(5);

  return ok({
    period: { from: from.toISOString(), to: to.toISOString() },
    baseCurrency: base,
    pnl: {
      income: Math.round(totalIncome * 100) / 100,
      expense: Math.round(totalExpense * 100) / 100,
      net: Math.round((totalIncome - totalExpense) * 100) / 100,
    },
    bySection,
    plan,
    upcomingPayments: upcoming.map(serializePayment),
  });
}