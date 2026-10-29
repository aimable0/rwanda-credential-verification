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
  credentialId: string; // 2. Unique certificate number printed on the degree (also the reference code)
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
 * Computes the canonical SHA-256 hash (0x-prefixed bytes32) over the 7 fields.
 * There is no random salt: the unique certificate number (field 2) is part of the
 * input, so two credentials never hash from the same data.
 */
export function computeCredentialHash(fields: CredentialFields): string {
  if (!isValidIsoDate(fields.awardDate)) {
    throw new Error(
      `Invalid awardDate format: ${fields.awardDate}. Expected YYYY-MM-DD.`,
    );
  }

  if (!Object.values(DegreeClassification).includes(fields.classification)) {
    throw new Error(`Invalid classification enum: ${fields.classification}`);
  }

  if (!normalizeText(fields.credentialId)) {
    throw new Error("credentialId (the printed certificate number) is required.");
  }

  const canonicalPayload = [
    normalizeText(fields.institution),
    normalizeText(fields.credentialId),
    normalizeText(fields.holderName),
    normalizeText(fields.degreeTitle),
    normalizeText(fields.programme), // "" if empty, preserving delimiter position
    fields.classification,
    fields.awardDate.trim(),
  ].join("|");

  const digest = crypto
    .createHash("sha256")
    .update(canonicalPayload, "utf8")
    .digest("hex");
  return `0x${digest}`;
}

/**
 * Generates an opaque, non-PII holder_reference for the credentials table
 * (Satisfies Section 3.3.2 Privacy requirement: no raw personal names stored in DB).
 * The certificate number is mixed in so the same name gets a different reference
 * on each credential.
 */
export function computeHolderReference(
  holderName: string,
  credentialId: string,
): string {
  const shortHash = crypto
    .createHash("sha256")
    .update(
      `${normalizeText(holderName)}|${normalizeText(credentialId)}`,
      "utf8",
    )
    .digest("hex")
    .slice(0, 12)
    .toUpperCase();
  return `REF-HOLDER-${shortHash}`;
}
