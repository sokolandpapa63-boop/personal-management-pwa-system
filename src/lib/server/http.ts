import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "./auth";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return (body ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Возвращает userId или NextResponse с 401. */
export async function requireUser(req: NextRequest): Promise<string | NextResponse> {
  const session = await getSession(req);
  if (!session) return fail(401, "unauthorized", "Требуется авторизация");
  return session.userId;
}

export function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

export function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function intOr(v: unknown, fallback: number): number {
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fallback;
}

export function boolOr(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return fallback;
}

export function dateOr(v: unknown): Date | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Разбор rest-пути для catch-all маршрутов: /api/v1/<base>/<a>/<b>/... */
export function restParts(req: NextRequest, base: string): string[] {
  const path = req.nextUrl.pathname.replace(new RegExp(`^/api/v1/${base}/?`), "");
  return path.split("/").filter(Boolean);
}
