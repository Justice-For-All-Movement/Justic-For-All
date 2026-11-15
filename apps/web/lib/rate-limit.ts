/**
 * Per-instance sliding-window limiter for public, unauthenticated endpoints.
 * Keys are hashed client addresses kept only in memory for the window. It is
 * deliberately generous so assistive-technology and shared-IP users (libraries,
 * Tor exits) are not locked out; abuse needing stronger limits is handled per
 * feature (sign-in uses DB-backed throttles).
 */
import { createHash } from "node:crypto";

type Bucket = { hits: number[] };
const buckets = new Map<string, Bucket>();
let lastSweep = 0;

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
  if (now - lastSweep > windowMs) {
    for (const [k, b] of buckets) if (!b.hits.length || now - b.hits[b.hits.length - 1] > windowMs) buckets.delete(k);
    lastSweep = now;
  }
  const id = createHash("sha256").update(key).digest("base64url").slice(0, 22);
  const bucket = buckets.get(id) ?? { hits: [] };
  bucket.hits = bucket.hits.filter(t => now - t < windowMs);
  if (bucket.hits.length >= limit) {
    buckets.set(id, bucket);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.hits[0] + windowMs - now) / 1000)) };
  }
  bucket.hits.push(now);
  buckets.set(id, bucket);
  if (buckets.size > 50_000) buckets.delete(buckets.keys().next().value!);
  return { allowed: true, retryAfterSeconds: 0 };
}

export function clientAddress(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}
