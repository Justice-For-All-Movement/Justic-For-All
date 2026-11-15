import { NextResponse } from "next/server";
import { MAX_EVENT_BYTES, parseKeyRing, validateEnvelope, verifyWebhook } from "@jfa/adapters";
import { getSharedPool, ingestEvent } from "@jfa/db";

export const dynamic = "force-dynamic";

const reply = (status: number, code: string) =>
  NextResponse.json({ api_version: "1", status: code }, { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

/**
 * Signed machine-to-machine event ingestion (plan §6 `POST /api/internal/v1/events`).
 * Without configured keys every request is refused (fail closed).
 */
export async function POST(request: Request, { params }: { params: Promise<{ source: string }> }) {
  const { source } = await params;
  const ring = parseKeyRing(process.env.SERVICE_WEBHOOK_SIGNING_KEYS);
  if (!ring.size) return reply(503, "ingestion_not_configured");
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_EVENT_BYTES) return reply(413, "payload_too_large");
  const body = await request.text();
  const verified = verifyWebhook(ring, source, request.headers, body, Math.floor(Date.now() / 1000));
  if (!verified.ok) return reply(401, verified.code);
  const envelope = validateEnvelope(body, source);
  if (!envelope.ok) return reply(422, envelope.code);
  const pool = getSharedPool();
  if (!pool) return reply(503, "database_unavailable");
  try {
    const client = await pool.connect();
    try {
      const result = await ingestEvent(client, envelope.envelope, verified.keyId);
      if (result.status === "source_not_enabled") return reply(403, result.status);
      return reply(result.status === "accepted" ? 202 : 200, result.status);
    } finally { client.release(); }
  } catch {
    return reply(503, "database_unavailable");
  }
}
