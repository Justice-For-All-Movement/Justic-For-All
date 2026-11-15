import pg from "pg";
import { parseDatabaseUrl } from "./config.mjs";

let pool: pg.Pool | undefined;
let initializedFor: string | undefined;

/**
 * Shared small pool for public read paths. Returns null (fail closed) when
 * configuration is missing/invalid or changes at runtime. Never logs the URL.
 */
export function getSharedPool(env: NodeJS.ProcessEnv = process.env): pg.Pool | null {
  const parsed = parseDatabaseUrl(env.DATABASE_URL, env.NODE_ENV === "production" ? "production" : "development");
  if (!parsed.ok) return null;
  if (!pool) {
    pool = new pg.Pool({ connectionString: parsed.url, max: 5, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000 });
    pool.on("error", () => undefined);
    initializedFor = parsed.url;
  }
  return initializedFor === parsed.url ? pool : null;
}
