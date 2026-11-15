/**
 * Explicitly unconfigured integration baseline.
 * Never translate mere repository existence into runtime availability.
 */
export type AdapterAvailability = "unconfigured" | "unverified" | "verified";
export type AdapterStatus = Readonly<{ availability: AdapterAvailability; integrationId: string }>;
export function disconnectedAdapter(integrationId: string): AdapterStatus {
  return { integrationId, availability: "unconfigured" };
}

export { disabledEmailSender, createMemoryEmailSender, createLogEmailSender, createResendEmailSender, emailSenderFromEnv, isFromAddress } from "./email.ts";
export type { EmailSender, EmailMessage, EmailCategory, SendResult } from "./email.ts";
export { EVENT_TYPES, MAX_EVENT_BYTES, validateEnvelope, isSafePublicUrl } from "./events.ts";
export type { EventEnvelope, EventType, EnvelopeResult } from "./events.ts";
export { parseKeyRing, signWebhook, verifyWebhook, httpEventDeliverer, MAX_SKEW_PAST_SECONDS, MAX_SKEW_FUTURE_SECONDS } from "./webhook.ts";
export type { KeyRing, VerifyResult } from "./webhook.ts";
export { availabilityFrom, unconfiguredAdapter, httpCapabilityAdapter, PROBE_FRESHNESS_MS } from "./sdk.ts";
export type { ServiceAdapter, ProbeResult, Capability } from "./sdk.ts";
