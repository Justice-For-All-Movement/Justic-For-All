/**
 * One-shot outbox delivery run (JFA-30). Schedule externally (e.g. a Render
 * cron job running `pnpm worker:outbox` every few minutes). It is safe to run
 * concurrently: claims use SKIP LOCKED leases. Without a configured receiver
 * it delivers nothing and exits non-zero, so messages stay pending rather
 * than being falsely marked delivered.
 */
import pg from "pg";
import { httpEventDeliverer } from "../../../packages/adapters/src/webhook.ts";
import { parseDatabaseUrl } from "../../../packages/db/src/config.mjs";
import { deliverOutbox, outboxBacklog } from "../../../packages/db/src/integration.ts";

const env = process.env;
const db = parseDatabaseUrl(env.DATABASE_URL, env.NODE_ENV === "production" ? "production" : "development");
const url = env.OUTBOX_WEBHOOK_URL, keyId = env.OUTBOX_SIGNING_KEY_ID, secret = env.OUTBOX_SIGNING_KEY ? Buffer.from(env.OUTBOX_SIGNING_KEY, "base64") : null;

if (!db.ok) { console.error("Outbox worker: DATABASE_URL missing or invalid."); process.exit(1); }
if (!url || !/^https:\/\//.test(url) || !keyId || !secret || secret.length < 32) {
  console.error("Outbox worker: OUTBOX_WEBHOOK_URL (https), OUTBOX_SIGNING_KEY_ID and OUTBOX_SIGNING_KEY (>=32 bytes base64) are required; nothing delivered.");
  process.exit(2);
}
const pool = new pg.Pool({ connectionString: db.url, max: 1, connectionTimeoutMillis: 10000 });
const client = await pool.connect();
try {
  const result = await deliverOutbox(client, httpEventDeliverer({ url, keyId, secret }), 50);
  console.info(`Outbox run: ${JSON.stringify(result)} backlog=${JSON.stringify(await outboxBacklog(client))}`);
} finally {
  client.release();
  await pool.end();
}
