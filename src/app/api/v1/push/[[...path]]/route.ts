import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { pushTokens, userSettings } from "@/db/schema";
import { fail, ok, readBody, requireUser, str } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;
  const path = req.nextUrl.pathname.replace(/^\/api\/v1\/push\/?/, "");
  if (path === "settings") {
    const rows = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
    const s = rows[0];
    return ok({
      settings: {
        notifyTask: s?.notifyTask ?? true,
        notifyEvent: s?.notifyEvent ?? true,
        notifyPomodoro: s?.notifyPomodoro ?? true,
        notifyReport: s?.notifyReport ?? true,
        notifySession: s?.notifySession ?? true,
        leadTimeMinutes: s?.leadTimeMinutes ?? 10,
      },
      fcmConfigured: Boolean(process.env.FIREBASE_PROJECT_ID),
    });
  }
  return fail(404, "not_found", "Неизвестный эндпоинт");
}

export async function POST(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;
  const path = req.nextUrl.pathname.replace(/^\/api\/v1\/push\/?/, "");
  const body = await readBody(req);
  if (path === "subscribe") {
    const token = str(body.token).trim();
    const platform = str(body.platform, "web") || "web";
    if (!token) return fail(400, "validation", "Пустой токен");
    const existing = await db.select().from(pushTokens).where(eq(pushTokens.token, token)).limit(1);
    if (existing[0]) {
      await db.update(pushTokens).set({ userId, lastSeenAt: new Date(), platform }).where(eq(pushTokens.token, token));
    } else {
      await db.insert(pushTokens).values({ userId, token, platform });
    }
    return ok({ ok: true });
  }
  return fail(404, "not_found", "Неизвестный эндпоинт");
}

export async function DELETE(req: NextRequest) {
  const userId = await requireUser(req);
  if (userId instanceof NextResponse) return userId;
  const path = req.nextUrl.pathname.replace(/^\/api\/v1\/push\/?/, "");
  if (path === "unsubscribe") {
    const body = await readBody(req);
    const token = str(body.token);
    await db.delete(pushTokens).where(and(eq(pushTokens.token, token), eq(pushTokens.userId, userId)));
    return ok({ ok: true });
  }
  return fail(404, "not_found", "Неизвестный эндпоинт");
}
