import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { sections, userSettings } from "@/db/schema";
import { evalFormula, sortColumns, type Column } from "./core";
import { convert } from "./currency";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID_RE.test(v);

export async function getOwnedSection(userId: string, sectionId: string) {
  if (!isUuid(sectionId)) return null;
  const rows = await db
    .select()
    .from(sections)
    .where(and(eq(sections.id, sectionId), eq(sections.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getBaseCurrency(userId: string): Promise<string> {
  const rows = await db
    .select({ baseCurrency: userSettings.baseCurrency })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  return rows[0]?.baseCurrency ?? "USD";
}

export function parseNumeric(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/ /g, "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export type PreparedRecord = {
  ok: boolean;
  message?: string;
  data?: Record<string, unknown>;
  amountBase?: number | null;
};

/** Валидация данных по схеме + вычисление formula-колонок и amountBase. */
export async function prepareRecordData(
  section: typeof sections.$inferSelect,
  columns: Column[],
  raw: Record<string, unknown>,
): Promise<PreparedRecord> {
  const data: Record<string, unknown> = {};
  let depositAmount: number | null = null;
  for (const col of sortColumns(columns)) {
    const value = raw[col.key];
    const empty = value === undefined || value === null || value === "";
    if (col.type === "formula") {
      // вычисляется после основных полей
      continue;
    }
    if (col.required && empty) {
      return { ok: false, message: `«${col.name}» — обязательное поле` };
    }
    if (empty) {
      data[col.key] = col.type === "checkbox" ? false : null;
      continue;
    }
    switch (col.type) {
      case "number":
      case "money": {
        const n = parseNumeric(value);
        if (n === null) return { ok: false, message: `«${col.name}» — ожидается число` };
        data[col.key] = n;
        if (col.type === "money" && col.currency === "deposit") depositAmount = n;
        break;
      }
      case "date": {
        const s = String(value);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
          return { ok: false, message: `«${col.name}» — формат даты ГГГГ-ММ-ДД` };
        }
        data[col.key] = s;
        break;
      }
      case "datetime": {
        const d = new Date(String(value));
        if (Number.isNaN(d.getTime()))
          return { ok: false, message: `«${col.name}» — некорректная дата/время` };
        data[col.key] = d.toISOString();
        break;
      }
      case "select": {
        data[col.key] = String(value);
        break;
      }
      case "multiselect": {
        data[col.key] = Array.isArray(value) ? value.map(String) : [String(value)];
        break;
      }
      case "checkbox": {
        data[col.key] = value === true || value === "true" || value === "on" || value === 1;
        break;
      }
      default:
        data[col.key] = String(value);
    }
  }

  // Курс в базовую валюту для formula amount * rateToBase
  const deposit = section.depositCurrency ?? "USD";
  let rateToBase = 1;
  let amountBase: number | null = null;
  if (depositAmount !== null || columns.some((c) => c.type === "formula" && c.formula?.includes("rateToBase"))) {
    const base = await getBaseCurrencyFromSection(section);
    rateToBase = deposit === base ? 1 : (await convert(1, deposit, base)) ?? 1;
    if (depositAmount !== null) amountBase = Math.round(depositAmount * rateToBase * 1e8) / 1e8;
  }

  const numericVars: Record<string, number> = { rateToBase };
  for (const [k, v] of Object.entries(data)) if (typeof v === "number") numericVars[k] = v;

  for (const col of sortColumns(columns)) {
    if (col.type !== "formula" || !col.formula) continue;
    const result = evalFormula(col.formula, numericVars);
    data[col.key] = result;
  }

  return { ok: true, data, amountBase };
}

async function getBaseCurrencyFromSection(section: typeof sections.$inferSelect) {
  return getBaseCurrency(section.userId);
}

// ── CSV ─────────────────────────────────────────────────────────────────────
export function toCsv(columns: Column[], rows: Record<string, unknown>[]): string {
  const cols = sortColumns(columns);
  const escCell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : Array.isArray(v) ? v.join("; ") : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = cols.map((c) => c.key).join(",");
  const lines = rows.map((r) => cols.map((c) => escCell(r[c.key])).join(","));
  return [header, ...lines].join("\n");
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      cur.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      cur.push(cell);
      cell = "";
      if (cur.length > 1 || cur[0] !== "") rows.push(cur);
      cur = [];
    } else cell += ch;
  }
  if (cell !== "" || cur.length) {
    cur.push(cell);
    rows.push(cur);
  }
  return rows;
}
