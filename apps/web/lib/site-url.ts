import { isPublicOrigin } from "../../../scripts/lib/runtime-env.mjs";

/**
 * Canonical public origin from APP_PUBLIC_URL. Returns null in production when
 * unset or invalid so we never advertise a wrong canonical/sitemap host.
 */
export function getSiteUrl(env: NodeJS.ProcessEnv = process.env): URL | null {
  const production = env.NODE_ENV === "production";
  const raw = env.APP_PUBLIC_URL;
  if (raw && isPublicOrigin(raw, production)) return new URL(raw);
  return production ? null : new URL("http://localhost:3000");
}

/** Pages that are public but must not be indexed or listed in the sitemap. */
export const NOINDEX_PATHS = ["/search", "/design-system", "/api/", "/health", "/ready"] as const;
