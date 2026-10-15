import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { fail, num, ok, readBody, requireUser, str } from "@/lib/server/http";
import { FAVORITE_CODES, convert, getRates, refreshRates } from "@/lib/server/currency";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;
  const path = req.nextUrl.pathname.replace(/^\/api\/v1\/currencies\/?/, "");

  if (path === "" ) {
    const rows = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
    return ok({
      codes: FAVORITE_CODES,
      baseCurrency: rows[0]?.baseCurrency ?? "USD",
      displayCurrency: rows[0]?.displayCurrency ?? "USD",
    });
  }

  if (path === "rates") {
    const force = req.nextUrl.searchParams.get("force") === "1";
    if (force) await refreshRates();
    const result = await getRates();
    return ok(result);
  }

  return fail(404, "not_found", "Неизвестный эндпоинт");
}

export async function POST(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;
  const path = req.nextUrl.pathname.replace(/^\/api\/v1\/currencies\/?/, "");
  if (path === "convert") {
    const body = await readBody(req);
    const amount = num(body.amount, NaN);
    const from = str(body.from).toUpperCase();
    const to = str(body.to).toUpperCase();
    if (!Number.isFinite(amount) || !from || !to) return fail(400, "validation", "Нужны amount, from, to");
    const result = await convert(amount, from, to);
    if (result === null) return fail(400, "unknown_currency", "Неизвестная валюта");
    return ok({ result: Math.round(result * 1e8) / 1e8, from, to, amount });
  }
  return fail(404, "not_found", "Неизвестный эндпоинт");
}
