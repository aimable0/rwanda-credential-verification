import { describe, expect, it } from "vitest";
import {
  certNumberOf,
  outcomeMeta,
  sameAddress,
  sentence,
  shortAddr,
  txErrorMessage,
} from "../src/utils";

describe("txErrorMessage", () => {
  it.each([
    ["ACTION_REJECTED", /rejected the transaction in MetaMask/],
    ["INSUFFICIENT_FUNDS", /no Sepolia ETH/],
    ["CALL_EXCEPTION", /blockchain rejected this transaction/],
  ])("explains %s in plain words", (code, message) => {
    expect(txErrorMessage({ code, shortMessage: "raw" })).toMatch(message);
  });

  it("falls back to ethers' short message, then the error message", () => {
    expect(txErrorMessage({ code: "OTHER", shortMessage: "short", message: "long" })).toBe("short");
    expect(txErrorMessage(new Error("plain"))).toBe("plain");
    expect(txErrorMessage(undefined)).toBe("Issuance failed");
  });
});

describe("certNumberOf", () => {
  it("strips the institution prefix", () => {
    expect(certNumberOf("UNIVA-220001624", "UNIVA")).toBe("220001624");
  });
  it("keeps dashes inside the certificate number", () => {
    expect(certNumberOf("UNIVA-T-001", "UNIVA")).toBe("T-001");
  });
  it("leaves codes from another institution untouched", () => {
    expect(certNumberOf("UNIVB-1", "UNIVA")).toBe("UNIVB-1");
  });
});

describe("sameAddress", () => {
  it("compares wallet addresses without case", () => {
    expect(sameAddress("0xAbC", "0xabc")).toBe(true);
    expect(sameAddress("0xabc", "0xabd")).toBe(false);
  });
  it("is false when either side is missing", () => {
    expect(sameAddress(null, "0xabc")).toBe(false);
    expect(sameAddress("", "")).toBe(false);
  });
});

describe("outcomeMeta", () => {
  it.each([
    ["GENUINE_AND_ACTIVE", "ok", "Genuine and active"],
    ["GENUINE_BUT_REVOKED", "warn", "Genuine but revoked"],
    ["MISMATCH_OR_NOT_FOUND", "bad", "Mismatch or not found"],
    ["ANYTHING_ELSE", "bad", "Mismatch or not found"],
  ])("%s -> %s", (result, tone, title) => {
    expect(outcomeMeta(result)).toMatchObject({ tone, title });
  });
});

describe("formatting", () => {
  it("shortens addresses", () => {
    expect(shortAddr("0x1234567890abcdef")).toBe("0x1234...cdef");
  });
  it("turns enum values into sentences", () => {
    expect(sentence("PENDING_HEC_REVIEW")).toBe("Pending hec review");
  });
});
