/**
 * Forward migrations are `NNNN_name.sql`; `*_down.sql` files are manual
 * rollback references and are never applied automatically.
 * Each migration must record `NNNN_name` in jfa_schema_migrations.
 * @param {string[]} names
 * @returns {{file:string, version:string}[]}
 */
export function listForwardMigrations(names) {
  return names
    .filter(n => /^\d{4}_[a-z0-9_]+\.sql$/.test(n) && !n.endsWith("_down.sql"))
    .sort()
    .map(file => ({ file, version: file.slice(0, -4) }));
}
