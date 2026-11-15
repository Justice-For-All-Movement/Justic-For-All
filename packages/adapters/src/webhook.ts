import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed machine-to-machine webhooks (JFA-30).
 * Signature: HMAC-SHA256(secret, "v1:{source}:{keyId}:{timestamp}:{rawBody}")
 * Headers: X-JFA-Source, X-JFA-Key-Id, X-JFA-Timestamp (unix seconds),
 * X-JFA-Signature: v1=<hex>. Secrets are server-side only.
 */
export type KeyRing = ReadonlyMap<string, ReadonlyMap<string, Buffer>>;
export const MAX_SKEW_PAST_SECONDS = 300;
export const MAX_SKEW_FUTURE_SECONDS = 30;

/** Parses SERVICE_WEBHOOK_SIGNING_KEYS = {"source-slug":{"key-id":"<base64, >=32 bytes>"}}; invalid → empty ring. */
export function parseKeyRing(raw: string | undefined): KeyRing {
  const ring = new Map<string, Map<string, Buffer>>();
  if (!raw) return ring;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
    for (const [source, keys] of Object.entries(parsed)) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source) || !keys || typeof keys !== "object") return new Map();
      const m = new Map<string, Buffer>();
      for (const [kid, secret] of Object.entries(keys as Record<string, unknown>)) {
        if (!/^[A-Za-z0-9_-]{1,40}$/.test(kid) || typeof secret !== "string") return new Map();
        const buf = Buffer.from(secret, "base64");
        if (buf.length < 32) return new Map();
        m.set(kid, buf);
      }
      if (m.size) ring.set(source, m);
    }
  } catch { return new Map(); }
  return ring;
}

export function signWebhook(secret: Buffer, source: string, keyId: string, timestamp: number, body: string): string {
  return "v1=" + createHmac("sha256", secret).update(`v1:${source}:${keyId}:${timestamp}:${body}`, "utf8").digest("hex");
}

export type VerifyResult = { ok: true; source: string; keyId: string } | { ok: false; code: "unknown_source" | "unknown_key" | "malformed_headers" | "stale" | "future" | "bad_signature" };

export function verifyWebhook(ring: KeyRing, source: string, headers: { get(name: string): string | null }, body: string, nowSeconds: number): VerifyResult {
  const keys = ring.get(source);
  if (!keys) return { ok: false, code: "unknown_source" };
  const headerSource = headers.get("x-jfa-source"), keyId = headers.get("x-jfa-key-id"), ts = headers.get("x-jfa-timestamp"), sig = headers.get("x-jfa-signature");
  if (headerSource !== source || !keyId || !ts || !sig || !/^\d{9,11}$/.test(ts) || !/^v1=[0-9a-f]{64}$/.test(sig)) return { ok: false, code: "malformed_headers" };
  const secret = keys.get(keyId);
  if (!secret) return { ok: false, code: "unknown_key" };
  const t = Number(ts);
  if (nowSeconds - t > MAX_SKEW_PAST_SECONDS) return { ok: false, code: "stale" };
  if (t - nowSeconds > MAX_SKEW_FUTURE_SECONDS) return { ok: false, code: "future" };
  const expected = Buffer.from(signWebhook(secret, source, keyId, t, body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, code: "bad_signature" };
  return { ok: true, source, keyId };
}

type PostLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number }>;

/**
 * Outbound signed delivery for the core outbox: the receiver verifies with
 * the same scheme, using source "justice-for-all-core".
 */
export function httpEventDeliverer(opts: { url: string; keyId: string; secret: Buffer; fetchImpl?: PostLike; timeoutMs?: number; now?: () => number }) {
  const doFetch: PostLike = opts.fetchImpl ?? (globalThis.fetch as unknown as PostLike);
  return async (message: { eventId: string; eventType: string; schemaVersion: string; payload: Record<string, unknown> }) => {
    const body = JSON.stringify({ event_id: message.eventId, event_type: message.eventType, schema_version: message.schemaVersion, source_service: "justice-for-all-core", payload: message.payload });
    const ts = Math.floor((opts.now?.() ?? Date.now()) / 1000);
    try {
      const r = await doFetch(opts.url, { method: "POST", body, signal: AbortSignal.timeout(opts.timeoutMs ?? 10000), headers: {
        "Content-Type": "application/json", "Idempotency-Key": message.eventId, "X-JFA-Source": "justice-for-all-core",
        "X-JFA-Key-Id": opts.keyId, "X-JFA-Timestamp": String(ts), "X-JFA-Signature": signWebhook(opts.secret, "justice-for-all-core", opts.keyId, ts, body) } });
      if (r.status >= 200 && r.status < 300) return { ok: true } as const;
      return { ok: false, retryable: r.status === 408 || r.status === 429 || r.status >= 500, code: `http_${r.status}` } as const;
    } catch { return { ok: false, retryable: true, code: "network_error" } as const; }
  };
}
