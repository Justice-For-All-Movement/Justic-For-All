import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { listForwardMigrations } from "../packages/db/src/migrations.mjs";

test("migration runner orders forward migrations and skips rollback references", () => {
  assert.deepEqual(
    listForwardMigrations(["0002_b.sql", "0001_core_down.sql", "README.md", "0001_core.sql", "x.sql"]),
    [{ file: "0001_core.sql", version: "0001_core" }, { file: "0002_b.sql", version: "0002_b" }]
  );
});

test("every forward migration is transactional and records its own version", () => {
  const migrations = listForwardMigrations(readdirSync("db/migrations"));
  assert.ok(migrations.length >= 1);
  const seen = new Set();
  for (const { file, version } of migrations) {
    const number = version.slice(0, 4);
    assert.ok(!seen.has(number), `duplicate migration number ${number}`);
    seen.add(number);
    const sql = readFileSync(`db/migrations/${file}`, "utf8");
    assert.match(sql, /^BEGIN;/m, `${file} must run in a transaction`);
    assert.match(sql, /^COMMIT;\s*$/m, `${file} must commit`);
    assert.ok(sql.includes(`VALUES ('${version}')`), `${file} must record version ${version}`);
  }
});
