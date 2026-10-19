import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

/**
 * Пул соединений с БД.
 *
 * ВАЖНО для serverless (Vercel):
 *  - max: 3 — маленький пул на инстанс функции. При всплеске трафика
 *    Vercel запускает несколько инстансов, и 3 соединения × N инстансов
 *    не должны превышать max_client_conn у PgBouncer (ONREZA Pooled).
 *  - idleTimeoutMillis — быстро освобождать простаивающие соединения,
 *    чтобы они не копились и не упирались в лимит пулера.
 *  - allowExitOnIdle — позволяет Node-процессу завершиться, когда пул
 *    простаивает (важно для serverless, чтобы не «висеть» зря).
 *  - singleton сохраняется ВСЕГДА (не только в dev), чтобы «тёплые»
 *    вызовы функции переиспользовали пул, а не создавали новый.
 */
export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  });

// Сохраняем пул глобально во всех окружениях, а не только в development.
globalForDb.__arenaNextJsPostgresqlPool = pool;

export const db = drizzle(pool);