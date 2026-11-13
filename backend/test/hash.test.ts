import { describe, expect, it } from "vitest";
import {
  computeCredentialHash,
  computeHolderReference,
  DegreeClassification,
  isValidIsoDate,
} from "../src/utils/hash";

const base = {
  institution: "UNIVA",
  credentialId: "UNIVA-220001624",
  holderName: "DUKUNDIMANA DESIRE",
  degreeTitle: "BACHELOR OF EDUCATION WITH HONOURS",
  programme: "FOUNDATIONS OF EDUCATION AND ENGLISH",
  classification: DegreeClassification.FIRST_CLASS_HONOURS,
  awardDate: "2026-06-15",
};

describe("computeCredentialHash", () => {
  it("returns a 0x-prefixed 32-byte hex string", () => {
    expect(computeCredentialHash(base)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("is deterministic for the same fields", () => {
    expect(computeCredentialHash(base)).toBe(computeCredentialHash({ ...base }));
  });

  it("ignores case and extra whitespace in text fields", () => {
    const messy = {
      ...base,
      holderName: "  dukundimana    desire ",
      degreeTitle: "bachelor of education   with honours",
      institution: " univa",
    };
    expect(computeCredentialHash(messy)).toBe(computeCredentialHash(base));
  });

  it.each([
    ["holderName", "DUKUNDIMANA DESIRA"],
    ["degreeTitle", "BACHELOR OF EDUCATION"],
    ["programme", ""],
    ["credentialId", "UNIVA-220001625"],
    ["institution", "UNIVB"],
    ["awardDate", "2026-06-16"],
    ["classification", DegreeClassification.PASS],
  ])("changes when %s changes", (field, value) => {
    expect(computeCredentialHash({ ...base, [field]: value })).not.toBe(
      computeCredentialHash(base),
    );
  });

  it("treats a missing programme the same as an empty one", () => {
    const { programme: _omit, ...withoutProgramme } = base;
    expect(computeCredentialHash(withoutProgramme)).toBe(
      computeCredentialHash({ ...base, programme: "" }),
    );
  });

  it("rejects a date that is not YYYY-MM-DD", () => {
    expect(() => computeCredentialHash({ ...base, awardDate: "15/06/2026" })).toThrow(
      /awardDate/,
    );
  });

  it("rejects an unknown classification", () => {
    expect(() =>
      computeCredentialHash({ ...base, classification: "DISTINCTION" as never }),
    ).toThrow(/classification/);
  });

  it("rejects an empty certificate number", () => {
    expect(() => computeCredentialHash({ ...base, credentialId: "   " })).toThrow(
      /credentialId/,
    );
  });
});

describe("computeHolderReference", () => {
  it("has a fixed, opaque format that does not contain the name", () => {
    const ref = computeHolderReference("DUKUNDIMANA DESIRE", "UNIVA-1");
    expect(ref).toMatch(/^REF-HOLDER-[0-9A-F]{12}$/);
    expect(ref).not.toContain("DUKUNDIMANA");
  });

  it("differs per certificate for the same holder", () => {
    expect(computeHolderReference("A B", "UNIVA-1")).not.toBe(
      computeHolderReference("A B", "UNIVA-2"),
    );
  });
});

describe("isValidIsoDate", () => {
  it.each([
    ["2026-06-15", true],
    [" 2026-06-15 ", true],
    ["2026-6-15", false],
    ["15-06-2026", false],
    ["", false],
  ])("%j -> %s", (input, expected) => {
    expect(isValidIsoDate(input)).toBe(expected);
  });
});
