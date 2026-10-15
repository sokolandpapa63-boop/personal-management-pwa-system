import { db } from "@/db";
import { sections, tableSchemas } from "@/db/schema";

// ── Типы колонок таблиц ──────────────────────────────────────────────────────
export type ColumnType =
  | "text"
  | "textarea"
  | "number"
  | "money"
  | "date"
  | "datetime"
  | "select"
  | "multiselect"
  | "checkbox"
  | "formula";

export type Column = {
  key: string;
  name: string;
  type: ColumnType;
  required?: boolean;
  options?: string[];
  formula?: string;
  currency?: string; // 'deposit' — валюта депозита раздела
  showInReport?: boolean;
  order?: number;
};

export const DEFAULT_TZ = "Europe/Moscow";

// ── Часовой пояс (жёстко Europe/Moscow, обобщаемо) ───────────────────────────
function tzOffsetMs(tz: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(at)) if (p.type !== "literal") parts[p.type] = p.value;
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - at.getTime();
}

/** Локальная дата/время в поясе tz → UTC Date. */
export function zonedToUtc(
  tz: string,
  y: number,
  m: number,
  d: number,
  hh = 0,
  mm = 0,
  ss = 0,
): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  const off1 = tzOffsetMs(tz, new Date(guess));
  let utc = guess - off1;
  const off2 = tzOffsetMs(tz, new Date(utc));
  if (off2 !== off1) utc = guess - off2;
  return new Date(utc);
}

/** y/m/d «сегодня» в поясе tz. */
export function zonedNowParts(tz: string, at = new Date()) {
  const shifted = new Date(at.getTime() + tzOffsetMs(tz, at));
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
}

export function zonedDateStr(tz: string, at = new Date()): string {
  const { y, m, d } = zonedNowParts(tz, at);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Границы суток (UTC) для локальной даты y-m-d в поясе tz. */
export function dayBoundsUtc(tz: string, y: number, m: number, d: number) {
  const start = zonedToUtc(tz, y, m, d, 0, 0, 0);
  const nxt = new Date(start.getTime() + 86400000);
  // корректировка на случай перехода DST (в МСК его нет, но поддерживаем)
  const end = zonedToUtc(
    tz,
    ...(() => {
      const p = zonedNowParts(tz, nxt);
      return [p.y, p.m, p.d, 0, 0, 0] as const;
    })(),
  );
  return { start, end };
}

/** Локальный yyyy-mm-dd произвольной даты в поясе tz. */
export function toZonedDateStr(tz: string, at: Date = new Date()): string {
  return zonedDateStr(tz, at);
}

/** Учёт локального времени "HH:mm" сегодня → UTC Date. */
export function timeTodayUtc(tz: string, hhmm: string, at = new Date()): Date {
  const [hh, mm] = hhmm.split(":").map((s) => parseInt(s, 10) || 0);
  const { y, m, d } = zonedNowParts(tz, at);
  return zonedToUtc(tz, y, m, d, hh, mm, 0);
}

// ── Формулы (безопасный арифметический разбор) ───────────────────────────────
export function evalFormula(expr: string, vars: Record<string, number>): number | null {
  if (!expr || !/^[0-9a-zA-Z_+\-*/().\s]+$/.test(expr)) return null;
  const keys = Object.keys(vars).filter((k) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k));
  try {
    const fn = new Function(...keys, `"use strict"; return (${expr});`);
    const out = fn(...keys.map((k) => Number(vars[k]) || 0));
    if (typeof out !== "number" || !Number.isFinite(out)) return null;
    return Math.round(out * 1e8) / 1e8;
  } catch {
    return null;
  }
}

export function sortColumns(columns: Column[]): Column[] {
  return [...columns].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
}

// ── Seed системных разделов при регистрации ─────────────────────────────────
const SPORT_SCHEMA: Column[] = [
  { key: "date", name: "Дата", type: "date", required: true, order: 1 },
  {
    key: "exercise",
    name: "Тип упражнения",
    type: "select",
    required: true,
    options: ["Жим", "Присед", "Тяга", "Подтягивания", "Отжимания"],
    order: 2,
  },
  { key: "approaches", name: "Подходы", type: "number", required: true, order: 3 },
  { key: "reps", name: "Повторения", type: "number", required: true, order: 4 },
  { key: "weight", name: "Сегодняшний вес (кг)", type: "number", required: false, order: 5 },
  {
    key: "volume",
    name: "Объём",
    type: "formula",
    formula: "approaches * reps * weight",
    showInReport: true,
    order: 6,
  },
  { key: "notes", name: "Заметки", type: "textarea", required: false, order: 7 },
];

const EDUCATION_SCHEMA: Column[] = [
  { key: "date", name: "Дата", type: "date", required: true, order: 1 },
  { key: "subject", name: "Предмет", type: "text", required: true, order: 2 },
  {
    key: "type",
    name: "Тип",
    type: "select",
    required: true,
    options: ["Задание", "Зачёт", "Экзамен"],
    order: 3,
  },
  {
    key: "status",
    name: "Статус",
    type: "select",
    required: true,
    options: ["Выполнено", "Сдано", "Провалено"],
    order: 4,
  },
  { key: "grade", name: "Оценка", type: "number", required: false, order: 5 },
  { key: "notes", name: "Заметки", type: "textarea", required: false, order: 6 },
];

const financeSchema = (): Column[] => [
  { key: "date", name: "Дата", type: "date", required: true, order: 1 },
  { key: "amount", name: "Сумма", type: "money", required: true, currency: "deposit", order: 2 },
  {
    key: "operation",
    name: "Тип операции",
    type: "select",
    required: true,
    options: ["Доход", "Расход", "Перевод"],
    order: 3,
  },
  {
    key: "category",
    name: "Категория",
    type: "select",
    required: false,
    options: ["Депозит", "Вывод", "Комиссия", "Прочее"],
    order: 4,
  },
  { key: "notes", name: "Комментарий", type: "textarea", required: false, order: 5 },
  {
    key: "amountBase",
    name: "В базовой валюте",
    type: "formula",
    formula: "amount * rateToBase",
    showInReport: true,
    order: 6,
  },
];

type SeedItem = {
  slug: string;
  name: string;
  kind: "table" | "container";
  icon: string;
  color: string;
  parent?: string;
  schema?: Column[];
  depositCurrency?: string;
};

const SEED: SeedItem[] = [
  { slug: "sport", name: "Спорт", kind: "table", icon: "dumbbell", color: "#22d3ee", schema: SPORT_SCHEMA },
  { slug: "education", name: "Образование", kind: "table", icon: "graduation-cap", color: "#a78bfa", schema: EDUCATION_SCHEMA },
  { slug: "finance", name: "Финансы", kind: "container", icon: "wallet", color: "#34d399" },
  { slug: "finance-fxpro", name: "FxPro", kind: "table", icon: "candlestick-chart", color: "#34d399", parent: "finance", schema: financeSchema(), depositCurrency: "USD" },
  { slug: "finance-bk", name: "БК", kind: "table", icon: "landmark", color: "#f59e0b", parent: "finance", schema: financeSchema(), depositCurrency: "RUB" },
  { slug: "finance-motiv", name: "Мотив", kind: "table", icon: "sparkles", color: "#fb7185", parent: "finance", schema: financeSchema(), depositCurrency: "RUB" },
  { slug: "finance-naim", name: "Найм", kind: "table", icon: "briefcase", color: "#60a5fa", parent: "finance", schema: financeSchema(), depositCurrency: "RUB" },
  { slug: "control", name: "Управление системой", kind: "container", icon: "sliders-horizontal", color: "#e2e8f0" },
  { slug: "reports", name: "Отчёты системы", kind: "container", icon: "file-text", color: "#e2e8f0" },
];

export async function seedSystemSections(userId: string) {
  const ids = new Map<string, string>();
  for (const item of SEED) {
    const [row] = await db
      .insert(sections)
      .values({
        userId,
        parentId: item.parent ? ids.get(item.parent)! : null,
        name: item.name,
        slug: item.slug,
        kind: item.kind,
        icon: item.icon,
        color: item.color,
        isSystem: true,
        order: SEED.indexOf(item),
        depositCurrency: item.depositCurrency ?? null,
      })
      .returning({ id: sections.id });
    ids.set(item.slug, row.id);
    if (item.schema) {
      await db.insert(tableSchemas).values({ sectionId: row.id, columns: item.schema });
    }
  }
}

// ── Повторения задач ─────────────────────────────────────────────────────────
export type Recurrence = {
  freq: "daily" | "weekly" | "monthly" | "custom" | "weekdays";
  interval?: number;
  weekdays?: number[]; // 1=Пн ... 7=Вс
  until?: string | null; // yyyy-mm-dd
  baseDate?: string; // yyyy-mm-dd дня первого срока
};

function isoDay(date: Date): number {
  const d = date.getUTCDay();
  return d === 0 ? 7 : d;
}

function toKey(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function matchesRecurrence(rec: Recurrence, key: string): boolean {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const base = rec.baseDate ?? key;
  const [by, bm, bd] = base.split("-").map(Number);
  const baseDate = new Date(Date.UTC(by, bm - 1, bd));
  const diffDays = Math.round((date.getTime() - baseDate.getTime()) / 86400000);
  if (diffDays < 0) return false;
  const interval = Math.max(1, rec.interval ?? 1);
  switch (rec.freq) {
    case "daily":
      return diffDays % interval === 0;
    case "custom":
      return diffDays % interval === 0;
    case "weekdays":
      return (rec.weekdays ?? [isoDay(baseDate)]).includes(isoDay(date));
    case "weekly": {
      const days = rec.weekdays?.length ? rec.weekdays : [isoDay(baseDate)];
      if (!days.includes(isoDay(date))) return false;
      return Math.floor(diffDays / 7) % interval === 0;
    }
    case "monthly": {
      if (date.getUTCDate() !== baseDate.getUTCDate()) return false;
      const months = (y - by) * 12 + (m - bm);
      return months % interval === 0;
    }
    default:
      return false;
  }
}

/** Следующая дата повторения (yyyy-mm-dd в tz) после даты-ключ afterKey. */
export function nextRecurrenceDate(rec: Recurrence, afterKey: string): string | null {
  const [y, m, d] = afterKey.split("-").map(Number);
  const until = rec.until ?? null;
  for (let i = 1; i <= 400; i++) {
    const date = new Date(Date.UTC(y, m - 1, d + i));
    const key = toKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    if (until && key > until) return null;
    if (matchesRecurrence(rec, key)) return key;
  }
  return null;
}
