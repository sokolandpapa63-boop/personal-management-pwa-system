import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { exchangeRates } from "@/db/schema";
import { emit } from "./bus";

const CACHE_MS = 60 * 60 * 1000; // кэш 1 час
const API_URL = "https://open.er-api.com/v6/latest/USD";

export const FAVORITE_CODES = ["USD", "RUB", "EUR", "USDT", "KZT", "GEL", "BYN", "CNY", "GBP"] as const;

// Резервные курсы, если API недоступно и кэш пуст
const FALLBACK: Record<string, number> = {
  USD: 1,
  USDT: 1,
  RUB: 90,
  EUR: 0.92,
  KZT: 450,
  GEL: 2.7,
  BYN: 3.25,
  CNY: 7.2,
  GBP: 0.79,
};

async function latestFetch(): Promise<Date | null> {
  const rows = await db
    .select({ fetchedAt: exchangeRates.fetchedAt })
    .from(exchangeRates)
    .where(eq(exchangeRates.baseCode, "USD"))
    .orderBy(desc(exchangeRates.fetchedAt))
    .limit(1);
  return rows[0]?.fetchedAt ?? null;
}

async function readCachedRates(): Promise<Record<string, number>> {
  const rows = await db.select().from(exchangeRates).where(eq(exchangeRates.baseCode, "USD"));
  const map: Record<string, number> = { USD: 1 };
  for (const r of rows) map[r.quoteCode] = Number(r.rate);
  if (!map.USDT) map.USDT = map.USD ?? 1; // эквайринговая привязка USDT к USD
  return map;
}

const refreshGuard =
  (globalThis as unknown as { __currencyRefresh?: Promise<boolean> }).__currencyRefresh ?? null;

export async function refreshRates(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    const res = await fetch(API_URL, { signal: controller.signal, cache: "no-store" });
    clearTimeout(timeout);
    if (!res.ok) return false;
    const json = (await res.json()) as { result?: string; rates?: Record<string, number> };
    if (json.result !== "success" || !json.rates) return false;
    const now = new Date();
    const wanted: Record<string, number> = { USD: 1 };
    for (const code of FAVORITE_CODES) {
      const v = json.rates[code];
      if (typeof v === "number" && Number.isFinite(v)) wanted[code] = v;
    }
    if (!wanted.USDT) wanted.USDT = 1;
    const rows = await db
      .select({ id: exchangeRates.id, quoteCode: exchangeRates.quoteCode })
      .from(exchangeRates)
      .where(eq(exchangeRates.baseCode, "USD"));
    for (const [quoteCode, rate] of Object.entries(wanted)) {
      if (quoteCode === "USD") continue;
      const row = rows.find((r) => r.quoteCode === quoteCode);
      if (row) {
        await db
          .update(exchangeRates)
          .set({ rate: String(rate), fetchedAt: now })
          .where(eq(exchangeRates.id, row.id));
      } else {
        await db.insert(exchangeRates).values({ baseCode: "USD", quoteCode, rate: String(rate), fetchedAt: now });
      }
    }
    const rates = await readCachedRates();
    emit(null, "currency.updated", { rates, fetchedAt: now.toISOString() });
    return true;
  } catch {
    return false;
  }
}

/** Курсы с кэшем на 1 час (ленивое обновление). */
export async function getRates(): Promise<{ rates: Record<string, number>; fetchedAt: string; stale: boolean }> {
  const last = await latestFetch();
  let stale = !last || Date.now() - last.getTime() > CACHE_MS;
  if (stale) {
    if (!refreshGuard) {
      const p = refreshRates().finally(() => {
        (globalThis as unknown as { __currencyRefresh?: Promise<boolean> }).__currencyRefresh = undefined;
      });
      (globalThis as unknown as { __currencyRefresh?: Promise<boolean> }).__currencyRefresh = p;
      await p;
    }
    const after = await latestFetch();
    stale = !after || Date.now() - after.getTime() > CACHE_MS;
  }
  let rates = await readCachedRates();
  if (Object.keys(rates).length < 3) rates = { ...FALLBACK, ...rates };
  const fetched = (await latestFetch())?.toISOString() ?? new Date().toISOString();
  return { rates, fetchedAt: fetched, stale };
}

/** Конвертация amount из валюты from в to через USD-базу. */
export function convertWith(rates: Record<string, number>, amount: number, from: string, to: string): number | null {
  const rf = rates[from];
  const rt = rates[to];
  if (!rf || !rt) return null;
  return (amount / rf) * rt;
}

export async function convert(amount: number, from: string, to: string): Promise<number | null> {
  const { rates } = await getRates();
  return convertWith(rates, amount, from, to);
}
