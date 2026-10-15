import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { eq, or } from "drizzle-orm";
import { db } from "@/db";
import { refreshTokens, userSettings, users } from "@/db/schema";
import {
  clearRefreshCookieHeader,
  clientIp,
  getRefreshCookie,
  hashPassword,
  issueRefreshToken,
  rateLimit,
  refreshCookieHeader,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
  verifyPassword,
} from "@/lib/server/auth";
import { fail, readBody, str } from "@/lib/server/http";
import { seedSystemSections } from "@/lib/server/core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const registerSchema = z.object({
  login: z
    .string()
    .min(3, "Логин — минимум 3 символа")
    .max(32, "Логин — максимум 32 символа")
    .regex(/^[a-zA-Z0-9_.-]+$/, "Логин: латиница, цифры, _ . -"),
  email: z.string().email("Некорректный email"),
  password: z.string().min(8, "Пароль — минимум 8 символов"),
});

const loginSchema = z.object({
  identifier: z.string().min(1, "Введите логин или email"),
  password: z.string().min(1, "Введите пароль"),
});

function publicUser(u: typeof users.$inferSelect) {
  return {
    id: u.id,
    login: u.login,
    email: u.email,
    timezone: u.timezone,
    createdAt: u.createdAt,
  };
}

function withRefreshCookie(res: NextResponse, token: string) {
  res.headers.append("Set-Cookie", refreshCookieHeader(token));
  return res;
}

// Заглушка восстановления: токен в памяти + лог (SMTP не настроен)
const resetStore =
  (globalThis as unknown as { __resetTokens?: Map<string, { email: string; expires: number }> })
    .__resetTokens ??
  ((globalThis as unknown as { __resetTokens: Map<string, { email: string; expires: number }> }).__resetTokens =
    new Map());

export async function POST(req: NextRequest) {
  const act = req.nextUrl.pathname.replace(/^\/api\/v1\/auth\/?/, "");
  const ip = clientIp(req);
  const ua = req.headers.get("user-agent");

  if (["register", "login", "forgot-password", "reset-password"].includes(act)) {
    if (!rateLimit(`${ip}:${act}`)) {
      return fail(429, "rate_limited", "Слишком много запросов. Повторите через минуту.");
    }
  }

  if (act === "register") {
    const parsed = registerSchema.safeParse(await readBody(req));
    if (!parsed.success) {
      return fail(400, "validation", parsed.error.issues[0]?.message ?? "Ошибка валидации");
    }
    const { login, email, password } = parsed.data;
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.login, login), eq(users.email, email)))
      .limit(1);
    if (existing.length) {
      return fail(409, "conflict", "Пользователь с таким логином или email уже существует");
    }
    const [user] = await db
      .insert(users)
      .values({ login, email, passwordHash: await hashPassword(password) })
      .returning();
    await db.insert(userSettings).values({ userId: user.id });
    await seedSystemSections(user.id);
    const accessToken = await signAccessToken(user.id);
    const refresh = await issueRefreshToken(user.id, ua);
    return withRefreshCookie(
      NextResponse.json({ user: publicUser(user), accessToken }, { status: 201 }),
      refresh,
    );
  }

  if (act === "login") {
    const parsed = loginSchema.safeParse(await readBody(req));
    if (!parsed.success) {
      return fail(400, "validation", parsed.error.issues[0]?.message ?? "Ошибка валидации");
    }
    const { identifier, password } = parsed.data;
    const rows = await db
      .select()
      .from(users)
      .where(or(eq(users.login, identifier), eq(users.email, identifier)))
      .limit(1);
    const user = rows[0];
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return fail(401, "invalid_credentials", "Неверный логин или пароль");
    }
    const accessToken = await signAccessToken(user.id);
    const refresh = await issueRefreshToken(user.id, ua);
    return withRefreshCookie(NextResponse.json({ user: publicUser(user), accessToken }), refresh);
  }

  if (act === "refresh") {
    const raw = getRefreshCookie(req);
    if (!raw) return fail(401, "no_refresh", "Сессия истекла");
    const rotated = await rotateRefreshToken(raw, ua);
    if (!rotated) {
      const res = fail(401, "invalid_refresh", "Сессия истекла");
      res.headers.append("Set-Cookie", clearRefreshCookieHeader());
      return res;
    }
    const rows = await db.select().from(users).where(eq(users.id, rotated.userId)).limit(1);
    if (!rows[0]) return fail(401, "invalid_refresh", "Сессия истекла");
    const accessToken = await signAccessToken(rotated.userId);
    return withRefreshCookie(
      NextResponse.json({ user: publicUser(rows[0]), accessToken }),
      rotated.token,
    );
  }

  if (act === "logout") {
    await revokeRefreshToken(getRefreshCookie(req));
    const res = NextResponse.json({ ok: true });
    res.headers.append("Set-Cookie", clearRefreshCookieHeader());
    return res;
  }

  if (act === "forgot-password") {
    const body = await readBody(req);
    const email = str(body.email).trim();
    if (email) {
      const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (rows[0]) {
        const token = crypto.randomUUID().replace(/-/g, "");
        resetStore.set(token, { email, expires: Date.now() + 30 * 60 * 1000 });
        console.log(`[auth] Токен восстановления пароля для ${email}: ${token}`);
      }
    }
    return NextResponse.json({ ok: true, message: "Если email существует, письмо отправлено" });
  }

  if (act === "reset-password") {
    const body = await readBody(req);
    const token = str(body.token);
    const password = str(body.password);
    if (password.length < 8) return fail(400, "validation", "Пароль — минимум 8 символов");
    const entry = resetStore.get(token);
    if (!entry || entry.expires < Date.now()) {
      return fail(400, "invalid_token", "Токен недействителен или истёк");
    }
    const rows = await db.select().from(users).where(eq(users.email, entry.email)).limit(1);
    if (!rows[0]) return fail(400, "invalid_token", "Токен недействителен или истёк");
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(password), updatedAt: new Date() })
      .where(eq(users.id, rows[0].id));
    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.userId, rows[0].id));
    resetStore.delete(token);
    return NextResponse.json({ ok: true });
  }

  return fail(404, "not_found", "Неизвестный эндпоинт");
}
