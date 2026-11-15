/**
 * Provider-neutral transactional email boundary (JFA-19/24).
 * Messages carry no case details; templates are fixed server-side.
 */
export type EmailCategory = "sign_in_link" | "subscription_confirmation" | "notification";
export type EmailMessage = Readonly<{ to: string; subject: string; text: string; category: EmailCategory; idempotencyKey: string; headers?: Readonly<Record<string, string>> }>;
export type SendResult = Readonly<{ status: "sent"; providerMessageId: string } | { status: "failed"; retryable: boolean; reason: string }>;
export type EmailSender = Readonly<{
  id: "disabled" | "memory" | "log" | "resend";
  /** False means the feature must tell users it is unavailable, never fake success. */
  available: boolean;
  send(message: EmailMessage): Promise<SendResult>;
}>;

export const disabledEmailSender: EmailSender = Object.freeze({
  id: "disabled", available: false,
  async send() { return { status: "failed", retryable: false, reason: "email_disabled" } as const; }
});

/** Development/test only: records messages in memory. Refused in production. */
export function createMemoryEmailSender(): EmailSender & { readonly outbox: EmailMessage[] } {
  const outbox: EmailMessage[] = [];
  return {
    id: "memory", available: true, outbox,
    async send(message) { outbox.push(message); return { status: "sent", providerMessageId: `memory-${outbox.length}` }; }
  };
}

/** Local development only: prints messages (including sign-in links) to stdout. Refused in production. */
export function createLogEmailSender(write: (line: string) => void = line => process.stdout.write(line + "\n")): EmailSender {
  let n = 0;
  return Object.freeze({
    id: "log", available: true,
    async send(message: EmailMessage): Promise<SendResult> {
      n++;
      write(`[dev-email ${message.category}] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`);
      return { status: "sent", providerMessageId: `log-${n}` };
    }
  });
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) =>
  Promise<{ status: number; json(): Promise<unknown> }>;

/** Resend HTTP API adapter (POST /emails). `baseUrl` is overridable for contract tests. */
export function createResendEmailSender(opts: { apiKey: string; from: string; baseUrl?: string; fetchImpl?: FetchLike; timeoutMs?: number }): EmailSender {
  const base = (opts.baseUrl ?? "https://api.resend.com").replace(/\/$/, "");
  const doFetch: FetchLike = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  return Object.freeze({
    id: "resend", available: true,
    async send(message: EmailMessage): Promise<SendResult> {
      try {
        const response = await doFetch(`${base}/emails`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${opts.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": message.idempotencyKey },
          body: JSON.stringify({ from: opts.from, to: [message.to], subject: message.subject, text: message.text, ...(message.headers ? { headers: message.headers } : {}) }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 10000)
        });
        if (response.status >= 200 && response.status < 300) {
          const body = await response.json().catch(() => ({})) as { id?: unknown };
          return typeof body.id === "string" ? { status: "sent", providerMessageId: body.id } : { status: "failed", retryable: true, reason: "malformed_response" };
        }
        return { status: "failed", retryable: response.status === 429 || response.status >= 500, reason: `http_${response.status}` };
      } catch {
        return { status: "failed", retryable: true, reason: "network_error" };
      }
    }
  });
}

/**
 * Selects the sender from env. Fails closed to `disabled` on any missing or
 * invalid configuration; `memory` is never allowed in production.
 */
export function emailSenderFromEnv(env: Record<string, string | undefined>): EmailSender {
  const provider = env.EMAIL_PROVIDER ?? "disabled";
  if (provider === "memory" && env.NODE_ENV !== "production") return createMemoryEmailSender();
  if (provider === "log" && env.NODE_ENV !== "production") return createLogEmailSender();
  if (provider === "resend" && env.EMAIL_PROVIDER_API_KEY && isFromAddress(env.EMAIL_FROM_ADDRESS)) {
    return createResendEmailSender({ apiKey: env.EMAIL_PROVIDER_API_KEY, from: env.EMAIL_FROM_ADDRESS! });
  }
  return disabledEmailSender;
}

export function isFromAddress(value: string | undefined): boolean {
  return typeof value === "string" && /^([^<>@\r\n]{1,80} <)?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(value) && !/[\r\n]/.test(value);
}
