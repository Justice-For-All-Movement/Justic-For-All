import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import { parseDatabaseUrl } from "../src/config.mjs";
import { listForwardMigrations } from "../src/migrations.mjs";

const MIGRATION_LOCK_KEY = 7340512; // Arbitrary constant: serializes concurrent deploys.
const dir = new URL("../../../db/migrations/", import.meta.url);

const parsed = parseDatabaseUrl(process.env.DATABASE_URL, process.env.NODE_ENV === "production" ? "production" : "development");
if (!parsed.ok) {
  console.error(`Migration blocked: database configuration is ${parsed.reason === "unconfigured" ? "missing" : "invalid (production requires sslmode=require or verify-full)"}.`);
  process.exitCode = 1;
} else {
  const migrations = listForwardMigrations(await readdir(dir));
  const client = new pg.Client({connectionString:parsed.url,connectionTimeoutMillis:10000});
  let current = "connect";
  try {
    await client.connect();
    current = "lock";
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    const known = await client.query("SELECT to_regclass('jfa_schema_migrations') IS NOT NULL AS present");
    const applied = new Set(known.rows[0].present
      ? (await client.query("SELECT version FROM jfa_schema_migrations")).rows.map(r => r.version)
      : []);
    let count = 0;
    for (const { file, version } of migrations) {
      if (applied.has(version)) continue;
      current = file;
      // Each migration owns its BEGIN/COMMIT and records its own version.
      await client.query(await readFile(new URL(file, dir), "utf8"));
      count++;
    }
    console.info(`Database schema is current (${migrations.length} known, ${count} applied now).`);
  } catch (error) {
    // SQLSTATE codes are safe to log; messages could echo connection details.
    console.error(`Migration failed at ${current} (SQLSTATE ${error?.code ?? "unknown"}); inspect protected database logs.`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(()=>undefined);
  }
}
