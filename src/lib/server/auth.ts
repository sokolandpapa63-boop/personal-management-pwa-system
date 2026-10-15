import { createHash, randomBytes } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { refreshTokens, users } from "@/db/schema";
import type { NextRequest } from "next/server";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "my-system-dev-secret-change-in-production",
);
const ACCESS_TTL_SECONDS = 15 * 60; // 15 минут
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 дней
export const REFRESH_COOKIE = "ms_refresh";

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function signAccessToken(userId: string) {
  return new SignJWT({ scope: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(JWT_SECRET);
}

export async function verifyAccessToken(token: string): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (!payload.sub) return null;
    return { userId: payload.sub };
  } catch {
    return null;
  }
}

function sha256(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

export async function issueRefreshToken(userId: string, userAgent?: string | null) {
  const secret = randomBytes(48).toString("hex");
  const [row] = await db
    .insert(refreshTokens)
    .values({
      userId,
      tokenHash: sha256(secret),
      userAgent: userAgent ?? null,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    })
    .returning({ id: refreshTokens.id });
  return `${row.id}.${secret}`;
}

/** Ротация refresh-токена: старый инвалидируется, выдаётся новый. */
export async function rotateRefreshToken(raw: string, userAgent?: string | null) {
  const [id, secret] = raw.split(".");
  if (!id || !secret) return null;
  const rows = await db
    .select()
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.id, id),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row || row.tokenHash !== sha256(secret)) return null;
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.id, row.id));
  const next = await issueRefreshToken(row.userId, userAgent);
  return { userId: row.userId, token: next };
}

export async function revokeRefreshToken(raw: string | undefined | null) {
  if (!raw) return;
  const [id] = raw.split(".");
  if (!id) return;
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.id, id));
}

export function refreshCookieHeader(token: string, maxAgeSec = REFRESH_TTL_MS / 1000) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${REFRESH_COOKIE}=${token}; Path=/api/v1/auth; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(
    maxAgeSec,
  )}${secure}`;
}

export function clearRefreshCookieHeader() {
  return `${REFRESH_COOKIE}=; Path=/api/v1/auth; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function getRefreshCookie(req: NextRequest) {
  return req.cookies.get(REFRESH_COOKIE)?.value ?? null;
}

/** Сессия из Bearer-токена (или ?token= для SSE/файлов). */
export async function getSession(req: NextRequest): Promise<{ userId: string } | null> {
  const header = req.headers.get("authorization");
  let token: string | null = null;
  if (header?.startsWith("Bearer ")) token = header.slice(7);
  if (!token) token = req.nextUrl.searchParams.get("token");
  if (!token) return null;
  const session = await verifyAccessToken(token);
  if (!session) return null;
  return session;
}

export async function getUserRow(userId: string) {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0] ?? null;
}

// ── Rate limiting (10 запросов/мин на IP для /auth/*) ────────────────────────
const buckets =
  (globalThis as unknown as { __rateBuckets?: Map<string, { count: number; reset: number }> })
    .__rateBuckets ??
  ((globalThis as unknown as { __rateBuckets: Map<string, { count: number; reset: number }> }).__rateBuckets =
    new Map());

export function rateLimit(key: string, limit = 10, windowMs = 60_000): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  bucket.count += 1;
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
  }
  return bucket.count <= limit;
}

export function clientIp(req: NextRequest) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local"
  );
}
