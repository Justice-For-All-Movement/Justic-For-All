/**
 * JFA-30 versioned event envelope (plan §6). Only allowlisted, public,
 * approved event types are accepted; protected content never travels here.
 */
export const EVENT_TYPES = {
  "public_projection.published.v1": { major: 1, payload: ["public_url", "title"] },
  "public_projection.withdrawn.v1": { major: 1, payload: ["public_url"] },
  "module.status_changed.v1": { major: 1, payload: ["status"] }
} as const satisfies Record<string, { major: number; payload: readonly string[] }>;
export type EventType = keyof typeof EVENT_TYPES;

export type EventEnvelope = Readonly<{
  event_id: string; event_type: EventType; schema_version: string; source_service: string;
  source_resource_id: string; occurred_at: string; projection_version: string;
  classification: "PUBLIC_APPROVED"; payload: Readonly<Record<string, string>>;
}>;

export const MAX_EVENT_BYTES = 16 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KEYS = ["event_id", "event_type", "schema_version", "source_service", "source_resource_id", "occurred_at", "projection_version", "classification", "payload"];
const STATUSES = ["concept", "planning", "building", "pilot", "live", "paused", "retired"];

export type EnvelopeResult = { ok: true; envelope: EventEnvelope } | { ok: false; code: string };

/** Strict validation: exact keys, allowlisted type, compatible major version, public-only payload. */
export function validateEnvelope(raw: string, expectedSource: string): EnvelopeResult {
  if (Buffer.byteLength(raw, "utf8") > MAX_EVENT_BYTES) return { ok: false, code: "payload_too_large" };
  let v: Record<string, unknown>;
  try { v = JSON.parse(raw); } catch { return { ok: false, code: "malformed_json" }; }
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, code: "malformed_envelope" };
  const keys = Object.keys(v);
  if (keys.length !== KEYS.length || !KEYS.every(k => Object.hasOwn(v, k))) return { ok: false, code: "unexpected_fields" };
  if (typeof v.event_type !== "string" || !Object.hasOwn(EVENT_TYPES, v.event_type)) return { ok: false, code: "event_type_not_allowed" };
  const spec: { major: number; payload: readonly string[] } = EVENT_TYPES[v.event_type as EventType];
  const ver = typeof v.schema_version === "string" ? v.schema_version.match(/^(\d+)\.(\d+)\.(\d+)$/) : null;
  if (!ver || Number(ver[1]) !== spec.major) return { ok: false, code: "incompatible_schema_version" };
  if (typeof v.event_id !== "string" || !UUID.test(v.event_id)) return { ok: false, code: "invalid_event_id" };
  if (v.source_service !== expectedSource || !SLUG.test(expectedSource)) return { ok: false, code: "source_mismatch" };
  if (typeof v.source_resource_id !== "string" || !/^[A-Za-z0-9._:-]{1,120}$/.test(v.source_resource_id)) return { ok: false, code: "invalid_resource_id" };
  if (typeof v.occurred_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(v.occurred_at) || !Number.isFinite(Date.parse(v.occurred_at))) return { ok: false, code: "invalid_timestamp" };
  if (typeof v.projection_version !== "string" || !/^v\d{1,9}$/.test(v.projection_version)) return { ok: false, code: "invalid_projection_version" };
  if (v.classification !== "PUBLIC_APPROVED") return { ok: false, code: "classification_not_public" };
  const p = v.payload as Record<string, unknown>;
  if (!p || typeof p !== "object" || Array.isArray(p)) return { ok: false, code: "invalid_payload" };
  const pk = Object.keys(p);
  if (pk.length !== spec.payload.length || !spec.payload.every(k => typeof p[k] === "string" && (p[k] as string).length > 0 && (p[k] as string).length <= 500)) return { ok: false, code: "invalid_payload" };
  if ("public_url" in p && !isSafePublicUrl(p.public_url as string)) return { ok: false, code: "unsafe_public_url" };
  if ("status" in p && !STATUSES.includes(p.status as string)) return { ok: false, code: "invalid_status" };
  if ("title" in p && /[<>]/.test(p.title as string)) return { ok: false, code: "invalid_payload" };
  return { ok: true, envelope: v as unknown as EventEnvelope };
}

/** Relative site path or https URL without credentials. */
export function isSafePublicUrl(value: string): boolean {
  if (/^\/(?!\/)[A-Za-z0-9\-._~/%]*$/.test(value)) return true;
  try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; }
}
