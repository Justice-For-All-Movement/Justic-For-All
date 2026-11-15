import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** 256-bit random bearer secret, base64url. Only its digest is ever stored. */
export function newBearerToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 digest of a high-entropy token (not suitable for passwords). */
export function tokenDigest(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export function isWellFormedToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export type KeyMaterial = Readonly<{ id: string; key: Buffer }>;

/** Parses a base64/base64url 32-byte key. Returns null rather than throwing. */
export function parseKey(raw: string | undefined): KeyMaterial | null {
  if (!raw) return null;
  const key = Buffer.from(raw.trim(), raw.includes("-") || raw.includes("_") ? "base64url" : "base64");
  if (key.length !== 32) return null;
  return Object.freeze({ id: "k_" + createHash("sha256").update(key).digest("hex").slice(0, 12), key });
}

/** Keyed, deterministic lookup value (e.g. for an email) without storing it in clear. */
export function lookupHmac(key: KeyMaterial, normalizedValue: string): Buffer {
  return createHmac("sha256", key.key).update(normalizedValue, "utf8").digest();
}

/** AES-256-GCM with random 96-bit nonce. Output: nonce(12) | tag(16) | ciphertext. */
export function sealText(key: KeyMaterial, plaintext: string, aad: string): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key.key, nonce);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), body]);
}

export function openText(key: KeyMaterial, sealed: Buffer, aad: string): string {
  if (sealed.length < 29) throw new Error("Invalid sealed value");
  const decipher = createDecipheriv("aes-256-gcm", key.key, sealed.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]).toString("utf8");
}

export function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Lower-cases and trims; rejects anything that is not a plausible single address. */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim().toLowerCase();
  if (value.length < 6 || value.length > 254) return null;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(value)) return null;
  return value;
}
