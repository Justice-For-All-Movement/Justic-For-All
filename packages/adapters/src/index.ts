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
