import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** RFC 4648 base32 (no padding) for authenticator-app secrets. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/=+$/, "");
  let bits = 0, value = 0; const out: number[] = [];
  for (const c of clean) { const i = ALPHABET.indexOf(c); if (i < 0) throw new Error("Invalid base32"); value = (value << 5) | i; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}

export const TOTP_PERIOD = 30;
export const TOTP_DIGITS = 6;

export function newTotpSecret(): string { return base32Encode(randomBytes(20)); }

/** RFC 6238 / RFC 4226 HOTP over HMAC-SHA1 (the algorithm authenticator apps implement). */
export function totpAt(secretBase32: string, step: number, digits = TOTP_DIGITS, algorithm: "sha1" | "sha256" | "sha512" = "sha1", rawKey?: Buffer): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac(algorithm, rawKey ?? base32Decode(secretBase32)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export function currentStep(nowMs = Date.now()): number { return Math.floor(nowMs / 1000 / TOTP_PERIOD); }

/**
 * Accepts the current step ±1 (clock drift). Returns the matched step so the
 * caller can reject any step <= the last one used (replay protection).
 */
export function matchTotp(secretBase32: string, code: unknown, nowMs = Date.now()): number | null {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return null;
  const now = currentStep(nowMs);
  let found: number | null = null;
  for (const step of [now - 1, now, now + 1]) {
    const expected = Buffer.from(totpAt(secretBase32, step));
    if (timingSafeEqual(expected, Buffer.from(code)) && found === null) found = step;
  }
  return found;
}

export function otpauthUri(secretBase32: string, account: string, issuer = "Justice For All"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
