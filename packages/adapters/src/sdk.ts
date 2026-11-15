/**
 * JFA-30 adapter SDK. Every upstream integration implements ServiceAdapter.
 * Availability is derived only from a successful, recent, contract-compatible
 * probe; configuration alone never makes a module "available".
 */
export type Capability = Readonly<{ name: string; methods: readonly string[] }>;
export type ProbeResult =
  | Readonly<{ status: "verified"; contractVersion: string; capabilities: readonly Capability[]; checkedAt: Date }>
  | Readonly<{ status: "unavailable" | "incompatible" | "unconfigured"; reason: string; checkedAt: Date }>;

export interface ServiceAdapter {
  readonly id: string;
  /** Major contract version this core build understands, e.g. "1". */
  readonly supportedMajor: number;
  probe(signal?: AbortSignal): Promise<ProbeResult>;
}

export const PROBE_FRESHNESS_MS = 15 * 60_000;

/** Fail-closed availability for UI and routing decisions. */
export function availabilityFrom(probe: ProbeResult | null, now: Date, required: readonly string[] = []): "available" | "unavailable" {
  if (!probe || probe.status !== "verified") return "unavailable";
  if (now.getTime() - probe.checkedAt.getTime() > PROBE_FRESHNESS_MS || probe.checkedAt.getTime() > now.getTime() + 60_000) return "unavailable";
  return required.every(r => probe.capabilities.some(c => c.name === r)) ? "available" : "unavailable";
}

/** Adapter used for every integration that has no verified upstream yet. */
export function unconfiguredAdapter(id: string): ServiceAdapter {
  return Object.freeze({ id, supportedMajor: 1, async probe() { return { status: "unconfigured", reason: "no verified upstream", checkedAt: new Date() } as const; } });
}

type FetchLike = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;

/**
 * HTTP capability probe for upstreams that implement the core-proposed
 * `GET /.well-known/jfa-capabilities` contract (an assumption to verify per
 * upstream before enabling). The token is server-side only.
 */
export function httpCapabilityAdapter(opts: { id: string; baseUrl: string; token?: string; supportedMajor?: number; fetchImpl?: FetchLike; timeoutMs?: number }): ServiceAdapter {
  const base = opts.baseUrl.replace(/\/$/, "");
  const doFetch: FetchLike = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const major = opts.supportedMajor ?? 1;
  return Object.freeze({
    id: opts.id, supportedMajor: major,
    async probe(signal?: AbortSignal): Promise<ProbeResult> {
      const checkedAt = new Date();
      if (!/^https:\/\//.test(base) && !/^http:\/\/127\.0\.0\.1[:/]/.test(base)) return { status: "unconfigured", reason: "base url must be https", checkedAt };
      try {
        const r = await doFetch(`${base}/.well-known/jfa-capabilities`, { headers: { Accept: "application/json", ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) }, signal: signal ?? AbortSignal.timeout(opts.timeoutMs ?? 5000) });
        if (r.status !== 200) return { status: "unavailable", reason: `http_${r.status}`, checkedAt };
        const body = await r.json() as { contract_version?: unknown; capabilities?: unknown };
        const v = typeof body.contract_version === "string" ? body.contract_version.match(/^(\d+)\.\d+\.\d+$/) : null;
        if (!v) return { status: "incompatible", reason: "missing contract_version", checkedAt };
        if (Number(v[1]) !== major) return { status: "incompatible", reason: `major ${v[1]} unsupported`, checkedAt };
        if (!Array.isArray(body.capabilities) || body.capabilities.length > 50) return { status: "incompatible", reason: "invalid capabilities", checkedAt };
        const caps: Capability[] = [];
        for (const c of body.capabilities as unknown[]) {
          const cap = c as { name?: unknown; methods?: unknown };
          if (typeof cap?.name !== "string" || !/^[a-z][a-z0-9_.]{1,60}$/.test(cap.name) || !Array.isArray(cap.methods) || !cap.methods.every(m => typeof m === "string" && /^[a-z_]{1,30}$/.test(m))) {
            return { status: "incompatible", reason: "invalid capability entry", checkedAt };
          }
          caps.push({ name: cap.name, methods: [...cap.methods as string[]] });
        }
        return { status: "verified", contractVersion: body.contract_version as string, capabilities: caps, checkedAt };
      } catch {
        return { status: "unavailable", reason: "network_error", checkedAt };
      }
    }
  });
}
