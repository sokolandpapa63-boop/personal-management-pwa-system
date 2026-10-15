"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

// ── Типы ────────────────────────────────────────────────────────────────────
export type ColumnType =
  | "text" | "textarea" | "number" | "money" | "date" | "datetime"
  | "select" | "multiselect" | "checkbox" | "formula";

export type Column = {
  key: string;
  name: string;
  type: ColumnType;
  required?: boolean;
  options?: string[];
  formula?: string;
  currency?: string;
  showInReport?: boolean;
  order?: number;
};

export type Section = {
  id: string;
  userId: string;
  parentId: string | null;
  name: string;
  icon: string | null;
  color: string | null;
  order: number;
  isSystem: boolean;
  kind: "table" | "container";
  slug: string | null;
  depositCurrency: string | null;
};

export type Task = {
  id: string;
  userId: string;
  sectionId: string | null;
  title: string;
  description: string | null;
  status: "active" | "completed" | "cancelled" | "deleted";
  priority: number;
  dueAt: string | null;
  recurrence: { freq: string; interval?: number; weekdays?: number[]; until?: string | null } | null;
  tags: string[] | null;
  cancelReason: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AppEvent = {
  id: string;
  userId: string;
  sectionId: string | null;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  color: string | null;
};

export type Settings = {
  theme: string;
  baseCurrency: string;
  displayCurrency: string;
  dailyReportTime: string;
  weeklyReportDay: number;
  monthlyReportDay: number;
  pomodoroWork: number;
  pomodoroShortBreak: number;
  pomodoroLongBreak: number;
  pomodoroCycles: number;
  notifyTask: boolean;
  notifyEvent: boolean;
  notifyPomodoro: boolean;
  notifyReport: boolean;
  notifySession: boolean;
  leadTimeMinutes: number;
};

export type StudySession = {
  id: string;
  course: number;
  sessionType: "winter" | "summer";
  startsAt: string;
  endsAt: string;
};

export type RecordRow = {
  id: string;
  sectionId: string;
  data: Record<string, unknown>;
  amountBase: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReportRow = {
  id: string;
  type: "daily" | "weekly" | "monthly" | "manual";
  periodFrom: string;
  periodTo: string;
  fileUrl: string;
  fileSize: number | null;
  createdAt: string;
  summary: { tasksCompleted?: number; pomodoroSessions?: number; focusMinutes?: number } | null;
};

// ── Запросы ─────────────────────────────────────────────────────────────────
export function useSections() {
  return useQuery({
    queryKey: ["sections"],
    queryFn: () => api<{ sections: Section[] }>("/sections").then((r) => r.sections),
    staleTime: 30_000,
  });
}

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => api<{ settings: Settings }>("/me/settings").then((r) => r.settings),
    staleTime: 30_000,
  });
}

export function useTasks(params?: { from?: string; to?: string; status?: string }) {
  const search = new URLSearchParams();
  if (params?.from) search.set("from", params.from);
  if (params?.to) search.set("to", params.to);
  if (params?.status) search.set("status", params.status);
  const qs = search.toString();
  return useQuery({
    queryKey: ["tasks", params ?? {}],
    queryFn: () => api<{ tasks: Task[] }>(`/tasks${qs ? `?${qs}` : ""}`).then((r) => r.tasks),
    staleTime: 15_000,
  });
}

export function useEvents(from?: string, to?: string) {
  const search = new URLSearchParams();
  if (from) search.set("from", from);
  if (to) search.set("to", to);
  const qs = search.toString();
  return useQuery({
    queryKey: ["events", from ?? "", to ?? ""],
    queryFn: () => api<{ events: AppEvent[] }>(`/events${qs ? `?${qs}` : ""}`).then((r) => r.events),
    staleTime: 15_000,
  });
}

export function useRates() {
  return useQuery({
    queryKey: ["rates"],
    queryFn: () => api<{ rates: Record<string, number>; fetchedAt: string; stale: boolean }>("/currencies/rates"),
    staleTime: 10 * 60_000,
  });
}

export function useStudySession() {
  return useQuery({
    queryKey: ["study"],
    queryFn: () => api<{ session: StudySession | null }>("/me/study-session").then((r) => r.session),
    staleTime: 60_000,
  });
}

export function useReports(type?: string) {
  return useQuery({
    queryKey: ["reports", type ?? "all"],
    queryFn: () => api<{ reports: ReportRow[] }>(`/reports${type && type !== "all" ? `?type=${type}` : ""}`).then((r) => r.reports),
    staleTime: 30_000,
  });
}

export function usePomodoroStats() {
  return useQuery({
    queryKey: ["pomodoro", "stats"],
    queryFn: () => api<{ days: { date: string; minutes: number; completed: number }[]; total: number }>("/pomodoro/stats"),
    staleTime: 30_000,
  });
}

// ── Форматирование (Europe/Moscow) ──────────────────────────────────────────
export const TZ = "Europe/Moscow";

const dateFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, day: "numeric", month: "long" });
const dateShortFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, day: "2-digit", month: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dateTimeFmt = new Intl.DateTimeFormat("ru-RU", {
  timeZone: TZ, day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
});
const fullFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" });

export function fmtDate(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  return dateFmt.format(typeof iso === "string" ? new Date(iso) : iso);
}

export function fmtDateShort(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  return dateShortFmt.format(typeof iso === "string" ? new Date(iso) : iso);
}

export function fmtDateFull(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  return fullFmt.format(typeof iso === "string" ? new Date(iso) : iso);
}

export function fmtTime(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  return timeFmt.format(typeof iso === "string" ? new Date(iso) : iso);
}

export function fmtDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  return dateTimeFmt.format(typeof iso === "string" ? new Date(iso) : iso);
}

function keyFmt(): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
}

export function dateKey(d: Date | string): string {
  return keyFmt().format(typeof d === "string" ? new Date(d) : d);
}

export function todayKey(): string {
  return dateKey(new Date());
}

export function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

const CURRENCY_SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", RUB: "₽", USDT: "USDT", GBP: "£" };

/** Денежный формат с разделителями тысяч (ru-RU). */
export function fmtMoney(n: number | null | undefined, currency?: string | null): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const str = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Math.round(n * 100) / 100);
  if (!currency) return str;
  return `${str} ${CURRENCY_SYMBOLS[currency] ?? currency}`;
}

export function ruPlural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

// ── Тикающее время / обратный отсчёт ────────────────────────────────────────
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d;
}

export type CountdownParts = { months: number; days: number; hours: number; minutes: number; seconds: number; past: boolean };

/** Разбор разницы «X мес Y дн Z ч M мин S сек». */
export function countdownParts(fromMs: number, toMs: number): CountdownParts {
  let past = false;
  let start = fromMs;
  let end = toMs;
  if (toMs < fromMs) {
    past = true;
    start = toMs;
    end = fromMs;
  }
  const startDate = new Date(start);
  let months = 0;
  while (addMonths(startDate, months + 1).getTime() <= end) months++;
  const afterMonths = addMonths(startDate, months).getTime();
  let rest = Math.max(0, end - afterMonths);
  const days = Math.floor(rest / 86400000);
  rest -= days * 86400000;
  const hours = Math.floor(rest / 3600000);
  rest -= hours * 3600000;
  const minutes = Math.floor(rest / 60000);
  rest -= minutes * 60000;
  const seconds = Math.floor(rest / 1000);
  return { months, days, hours, minutes, seconds, past };
}
