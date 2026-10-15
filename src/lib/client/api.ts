"use client";

import { useAuthStore } from "./stores";

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Options = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

export async function refreshSession(): Promise<boolean> {
  try {
    const res = await fetch("/api/v1/auth/refresh", { method: "POST" });
    if (!res.ok) {
      useAuthStore.getState().clear();
      return false;
    }
    const data = (await res.json()) as { user: unknown; accessToken: string };
    useAuthStore.getState().setAuth(data.accessToken, data.user as never);
    return true;
  } catch {
    return false;
  }
}

async function raw(path: string, options: Options, retry: boolean): Promise<Response> {
  const token = useAuthStore.getState().accessToken;
  const res = await fetch(`/api/v1${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401 && retry && !path.startsWith("/auth/")) {
    const okRefresh = await refreshSession();
    if (okRefresh) return raw(path, options, false);
  }
  return res;
}

export async function api<T = unknown>(path: string, options: Options = {}): Promise<T> {
  const res = await raw(path, options, true);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? "error", err?.message ?? `Ошибка ${res.status}`);
  }
  return data as T;
}

/** Ссылка с токеном для открытия файлов/экспорта в новой вкладке. */
export function apiUrl(path: string): string {
  const token = useAuthStore.getState().accessToken;
  const sep = path.includes("?") ? "&" : "?";
  return `/api/v1${path}${sep}token=${encodeURIComponent(token ?? "")}`;
}
