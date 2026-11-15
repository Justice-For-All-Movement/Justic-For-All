/**
 * Data-classification helper. Confidential workflows belong in specialized systems.
 * Classification alone does not establish encryption/conformance.
 */
export type DataClassification = "approved-public" | "internal" | "restricted";
export function mayPublish(classification: DataClassification, editorialApproval: boolean): boolean {
  return classification === "approved-public" && editorialApproval === true;
}

export { newBearerToken, tokenDigest, isWellFormedToken, parseKey, lookupHmac, sealText, openText, safeEqual, normalizeEmail } from "./crypto.ts";
export type { KeyMaterial } from "./crypto.ts";
