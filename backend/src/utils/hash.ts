import crypto from "crypto";

export enum DegreeClassification {
  FIRST_CLASS_HONOURS = "FIRST_CLASS_HONOURS",
  SECOND_CLASS_UPPER = "SECOND_CLASS_UPPER",
  SECOND_CLASS_LOWER = "SECOND_CLASS_LOWER",
  PASS = "PASS",
  NOT_APPLICABLE = "NOT_APPLICABLE",
}

export interface CredentialFields {
  institution: string; // 1. Institution code (e.g., UNIVA, UNIVB)
  credentialId: string; // 2. Printed cert number or generated reference_code
  holderName: string; // 3. Holder name as printed
  degreeTitle: string; // 4. Degree title as printed
  programme?: string; // 5. Programme (empty string "" if none)
  classification: DegreeClassification; // 6. Fixed enum
  awardDate: string; // 7. ISO format YYYY-MM-DD
}

/**
 * Normalizes text fields (trims whitespace, collapses multiple spaces, uppercases)
 * so minor spacing/casing differences don't cause false mismatches.
 */
function normalizeText(value: string | undefined): string {
  if (!value) return "";
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

/**
 * Validates YYYY-MM-DD ISO format
 */
export function isValidIsoDate(dateStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim());
}

/**
 * Generates a cryptographically strong 32-byte random hex salt (64 hex chars)
 */
export function generateSalt(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Generates a short human-usable reference code when a certificate does not have a pre-printed ID
 * Example: RW-UNIVA-2026-8F3A9C
 */
export function generateReferenceCode(
  institutionCode: string,
  awardDate: string,
): string {
  const year = awardDate.slice(0, 4);
  const randomSuffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `RW-${normalizeText(institutionCode)}-${year}-${randomSuffix}`;
}

/**
 * Computes the canonical SHA-256 hash (0x-prefixed bytes32) over the 7 fields + salt
 */
export function computeCredentialHash(
  fields: CredentialFields,
  salt: string,
): string {
  if (!isValidIsoDate(fields.awardDate)) {
    throw new Error(
      `Invalid awardDate format: ${fields.awardDate}. Expected YYYY-MM-DD.`,
    );
  }

  if (!Object.values(DegreeClassification).includes(fields.classification)) {
    throw new Error(`Invalid classification enum: ${fields.classification}`);
  }

  const canonicalPayload = [
    normalizeText(fields.institution),
    normalizeText(fields.credentialId),
    normalizeText(fields.holderName),
    normalizeText(fields.degreeTitle),
    normalizeText(fields.programme), // "" if empty, preserving delimiter position
    fields.classification,
    fields.awardDate.trim(),
    salt.trim(),
  ].join("|");

  const digest = crypto
    .createHash("sha256")
    .update(canonicalPayload, "utf8")
    .digest("hex");
  return `0x${digest}`;
}

/**
 * Generates an opaque, non-PII holder_reference for the credentials table
 * (Satisfies Section 3.3.2 Privacy requirement: no raw personal names stored in DB)
 */
export function computeHolderReference(
  holderName: string,
  salt: string,
): string {
  const shortHash = crypto
    .createHash("sha256")
    .update(`${normalizeText(holderName)}|${salt}`, "utf8")
    .digest("hex")
    .slice(0, 12)
    .toUpperCase();
  return `REF-HOLDER-${shortHash}`;
}
