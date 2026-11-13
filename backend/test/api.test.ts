import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { query } from "../src/db";
import {
  getHecAddress,
  getOnChainCredential,
  isIssuerAccredited,
} from "../src/services/blockchain";
import { computeCredentialHash, DegreeClassification } from "../src/utils/hash";
import app from "../src/app";
import {
  fakeQuery,
  HEC,
  institution,
  loginAs,
  NOT_ON_CHAIN,
  OTHER_WALLET,
  UNIVA_WALLET,
} from "./helpers";

vi.mock("../src/db", () => ({ query: vi.fn(), pool: { on: vi.fn() } }));
vi.mock("../src/services/blockchain", () => ({
  getHecAddress: vi.fn(),
  getOnChainCredential: vi.fn(),
  isIssuerAccredited: vi.fn(),
}));

const mockQuery = vi.mocked(query);
const mockChain = vi.mocked(getOnChainCredential);

/** SQL text of every query the route ran, for asserting what was (not) written. */
const sqlCalls = () => mockQuery.mock.calls.map(([sql]) => String(sql));

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockImplementation(fakeQuery([]) as never);
  mockChain.mockReset();
  vi.mocked(getHecAddress).mockResolvedValue(HEC.address);
  vi.mocked(isIssuerAccredited).mockResolvedValue(true);
});

/* ---------- Basics ---------- */

describe("GET /api/health", () => {
  it("answers even when the contract cannot be reached", async () => {
    vi.mocked(getHecAddress).mockRejectedValue(new Error("RPC down"));
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.hecAddress).toBeNull();
  });
});

describe("error handling", () => {
  it("hides database error text and returns a reference id", async () => {
    mockQuery.mockRejectedValue(
      new Error('password authentication failed for user "app"'),
    );
    const res = await request(app).get("/api/institutions");
    expect(res.status).toBe(500);
    expect(res.body.errorId).toMatch(/^[0-9a-f]{8}$/);
    expect(res.body.error).toContain(res.body.errorId);
    expect(JSON.stringify(res.body)).not.toContain("password");
  });

  it("answers malformed JSON with a 400 in JSON", async () => {
    const res = await request(app)
      .post("/api/credentials/verify")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not valid JSON/);
  });

  it("answers unknown API paths with a JSON 404", async () => {
    const res = await request(app).get("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });
});

/* ---------- Wallet sign-in ---------- */

describe("wallet sign-in", () => {
  it("issues a token for a valid signature", async () => {
    const token = await loginAs(app, UNIVA_WALLET);
    expect(token).toMatch(/^[\w-]+\.[\w-]+$/);
  });

  it("rejects a signature from a different wallet", async () => {
    const nonce = await request(app)
      .post("/api/auth/nonce")
      .send({ walletAddress: UNIVA_WALLET.address });
    const signature = await OTHER_WALLET.signMessage(nonce.body.message);
    const res = await request(app)
      .post("/api/auth/login")
      .send({ walletAddress: UNIVA_WALLET.address, signature });
    expect(res.status).toBe(401);
  });

  it("does not accept the same nonce twice", async () => {
    const nonce = await request(app)
      .post("/api/auth/nonce")
      .send({ walletAddress: UNIVA_WALLET.address });
    const signature = await UNIVA_WALLET.signMessage(nonce.body.message);
    const body = { walletAddress: UNIVA_WALLET.address, signature };
    expect((await request(app).post("/api/auth/login").send(body)).status).toBe(200);
    expect((await request(app).post("/api/auth/login").send(body)).status).toBe(401);
  });

  it("rejects an invalid wallet address", async () => {
    const res = await request(app)
      .post("/api/auth/nonce")
      .send({ walletAddress: "not-an-address" });
    expect(res.status).toBe(400);
  });

  it("blocks protected routes without a token or with a forged one", async () => {
    expect((await request(app).get("/api/logs")).status).toBe(401);
    const forged = await request(app)
      .get("/api/logs")
      .set("Authorization", "Bearer eyJ3IjoiMHgxIn0.fake");
    expect(forged.status).toBe(401);
  });
});

/* ---------- Institution applications ---------- */

describe("POST /api/institutions/apply", () => {
  const apply = async (wallet: typeof UNIVA_WALLET, body: object) =>
    request(app)
      .post("/api/institutions/apply")
      .set("Authorization", `Bearer ${await loginAs(app, wallet)}`)
      .send(body);

  it("registers a new institution as pending, bound to the caller's wallet", async () => {
    mockQuery.mockImplementation(
      fakeQuery([
        ["INSERT INTO institutions", (p) => [institution({
          code: p[0], name: p[1], accreditation_status: "PENDING",
        })]],
      ]) as never,
    );
    const res = await apply(UNIVA_WALLET, { code: " univx ", name: " Test Uni " });

    expect(res.status).toBe(201);
    const insert = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO institutions"),
    );
    expect(insert?.[1]).toEqual([
      "UNIVX",
      "Test Uni",
      "UNIVERSITY",
      UNIVA_WALLET.address.toLowerCase(),
    ]);
  });

  it("keeps a licensing body type and defaults anything else to university", async () => {
    await apply(UNIVA_WALLET, { code: "NCNM", name: "Nursing Council", institutionType: "licensing_body" });
    await apply(OTHER_WALLET, { code: "UNIVY", name: "Y", institutionType: "SCHOOL" });
    const inserts = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO institutions"),
    );
    expect(inserts[0][1]?.[2]).toBe("LICENSING_BODY");
    expect(inserts[1][1]?.[2]).toBe("UNIVERSITY");
  });

  it.each([
    [{ code: "U" }, /2-20 letters or digits/],
    [{ code: "UNI-A" }, /2-20 letters or digits/],
    [{ code: "" }, /code is required/],
    [{ code: "UNIVX" }, /name is required/],
  ])("rejects %j", async (body, message) => {
    const res = await apply(UNIVA_WALLET, body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  it("does not let the HEC wallet apply", async () => {
    const res = await apply(HEC, { code: "UNIVX", name: "X" });
    expect(res.status).toBe(400);
    expect(sqlCalls().some((s) => s.includes("INSERT"))).toBe(false);
  });

  it("refuses a wallet that already represents another institution", async () => {
    mockQuery.mockImplementation(
      fakeQuery([["LOWER(wallet_address) = $1", [{ code: "UNIVA", name: "University A" }]]]) as never,
    );
    const res = await apply(UNIVA_WALLET, { code: "UNIVX", name: "X" });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("University A (UNIVA)");
  });

  it("refuses a code that another wallet has a pending application for", async () => {
    mockQuery.mockImplementation(
      fakeQuery([
        ["FROM institutions WHERE code", [institution({ accreditation_status: "PENDING" })]],
      ]) as never,
    );
    const res = await apply(OTHER_WALLET, { code: "UNIVA", name: "Anything" });
    expect(res.status).toBe(403);
  });

  it("lets a rejected institution apply again", async () => {
    mockQuery.mockImplementation(
      fakeQuery([
        ["SELECT * FROM institutions WHERE code", [institution({ accreditation_status: "REJECTED" })]],
        ["UPDATE institutions", [institution({ accreditation_status: "PENDING" })]],
      ]) as never,
    );
    const res = await apply(UNIVA_WALLET, { code: "UNIVA" });
    expect(res.status).toBe(201);
    expect(res.body.institution.accreditation_status).toBe("PENDING");
  });
});

/* ---------- HEC decisions ---------- */

describe("HEC admin routes", () => {
  it("refuses non-HEC wallets", async () => {
    const token = await loginAs(app, UNIVA_WALLET);
    const res = await request(app)
      .post("/api/admin/institutions/UNIVA/reject")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("rejects a pending application", async () => {
    mockQuery.mockImplementation(
      fakeQuery([
        ["SELECT * FROM institutions", [institution({ accreditation_status: "PENDING" })]],
        ["UPDATE institutions", [institution({ accreditation_status: "REJECTED" })]],
      ]) as never,
    );
    const token = await loginAs(app, HEC);
    const res = await request(app)
      .post("/api/admin/institutions/univa/reject")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.institution.accreditation_status).toBe("REJECTED");
  });

  it("only approves once the contract lists the wallet", async () => {
    mockQuery.mockImplementation(
      fakeQuery([
        ["SELECT * FROM institutions", [institution({ accreditation_status: "PENDING" })]],
        ["UPDATE institutions", [institution()]],
      ]) as never,
    );
    const token = await loginAs(app, HEC);
    const res = await request(app)
      .post("/api/admin/institutions/UNIVA/approve")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(isIssuerAccredited).toHaveBeenCalledWith(UNIVA_WALLET.address.toLowerCase());
  });

  it("will not reject an institution that is already accredited", async () => {
    mockQuery.mockImplementation(
      fakeQuery([["SELECT * FROM institutions", [institution()]]]) as never,
    );
    const token = await loginAs(app, HEC);
    const res = await request(app)
      .post("/api/admin/institutions/UNIVA/reject")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);
  });
});

/* ---------- Issuing ---------- */

const certificate = {
  institution: "UNIVA",
  credentialId: "t-001",
  holderName: "Dukundimana Desire",
  degreeTitle: "Bachelor of Education",
  programme: "",
  classification: "FIRST_CLASS_HONOURS",
  awardDate: "2026-06-15",
};

describe("POST /api/credentials/prepare", () => {
  beforeEach(() => {
    mockQuery.mockImplementation(
      fakeQuery([
        ["FROM institutions WHERE code", [institution()]],
        ["INSERT INTO credentials", (p) => [{ credential_id: 7, reference_code: p[1] }]],
      ]) as never,
    );
    mockChain.mockResolvedValue(NOT_ON_CHAIN);
  });

  const prepare = async (body: object, wallet = UNIVA_WALLET) =>
    request(app)
      .post("/api/credentials/prepare")
      .set("Authorization", `Bearer ${await loginAs(app, wallet)}`)
      .send(body);

  it("builds the reference code, hash and QR code, and upserts the row", async () => {
    const res = await prepare(certificate);

    expect(res.status).toBe(201);
    expect(res.body.referenceCode).toBe("UNIVA-T-001");
    expect(res.body.certificateNumber).toBe("T-001");
    expect(res.body.credentialHash).toBe(
      computeCredentialHash({
        ...certificate,
        credentialId: "UNIVA-T-001",
        classification: DegreeClassification.FIRST_CLASS_HONOURS,
      }),
    );
    expect(res.body.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(res.body.verifyUrl).toBe(
      "http://localhost:5173/verify?ref=T-001&inst=UNIVA",
    );
    expect(sqlCalls().find((s) => s.includes("INSERT INTO credentials"))).toContain(
      "ON CONFLICT (reference_code) DO UPDATE",
    );
  });

  it("refuses a number already anchored on-chain without writing to the database", async () => {
    mockChain.mockResolvedValue({ ...NOT_ON_CHAIN, exists: true });
    const res = await prepare(certificate);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already been anchored/);
    expect(sqlCalls().some((s) => s.includes("INSERT INTO credentials"))).toBe(false);
  });

  it("returns 503 without writing when the blockchain cannot be read", async () => {
    mockChain.mockRejectedValue(new Error("RPC timeout"));
    const res = await prepare(certificate);
    expect(res.status).toBe(503);
    expect(sqlCalls().some((s) => s.includes("INSERT INTO credentials"))).toBe(false);
  });

  it("refuses a wallet that is not the institution's registrar", async () => {
    const res = await prepare(certificate, OTHER_WALLET);
    expect(res.status).toBe(403);
  });

  it("refuses when HEC no longer lists the wallet on-chain", async () => {
    vi.mocked(isIssuerAccredited).mockResolvedValue(false);
    const res = await prepare(certificate);
    expect(res.status).toBe(403);
  });

  it.each([
    [{ ...certificate, credentialId: "  " }, /Missing required fields/],
    [{ ...certificate, holderName: "" }, /Missing required fields/],
    [{ ...certificate, awardDate: "15/06/2026" }, /YYYY-MM-DD/],
  ])("rejects incomplete input %#", async (body, message) => {
    const res = await prepare(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });
});

/* ---------- Credential list ---------- */

describe("GET /api/credentials", () => {
  it("reports each row's chain status and only trusts revocation on anchored rows", async () => {
    const row = (ref: string, hash: string) => ({
      credential_id: 1,
      reference_code: ref,
      credential_hash: hash,
    });
    mockQuery.mockImplementation(
      fakeQuery([
        ["FROM institutions WHERE code", [institution()]],
        ["FROM credentials c", [
          row("UNIVA-1", "0xAAA"),
          row("UNIVA-2", "0xbbb"),
          row("UNIVA-3", "0xccc"),
          row("UNIVA-4", "0xddd"),
          row("UNIVA-5", "0xeee"),
        ]],
      ]) as never,
    );
    const onChain: Record<string, object | Error> = {
      "UNIVA-1": { ...NOT_ON_CHAIN, exists: true, credentialHash: "0xaaa" },
      "UNIVA-2": { ...NOT_ON_CHAIN, exists: true, credentialHash: "0xbbb", revocationTimestamp: 1700000000 },
      "UNIVA-3": NOT_ON_CHAIN,
      "UNIVA-4": { ...NOT_ON_CHAIN, exists: true, credentialHash: "0xother", revocationTimestamp: 1700000000 },
      "UNIVA-5": new Error("RPC timeout"),
    };
    mockChain.mockImplementation(async (ref) => {
      const r = onChain[ref];
      if (r instanceof Error) throw r;
      return r as typeof NOT_ON_CHAIN;
    });

    const token = await loginAs(app, UNIVA_WALLET);
    const res = await request(app)
      .get("/api/credentials?institutionCode=UNIVA")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const summary = res.body.map((r: any) => [r.reference_code, r.chain_status, r.revoked_at]);
    expect(summary).toEqual([
      ["UNIVA-1", "ANCHORED", null],
      ["UNIVA-2", "ANCHORED", 1700000000],
      ["UNIVA-3", "NOT_ANCHORED", null],
      ["UNIVA-4", "HASH_MISMATCH", null],
      ["UNIVA-5", "UNKNOWN", null],
    ]);
  });
});

/* ---------- Public verification ---------- */

describe("POST /api/credentials/verify", () => {
  const anchoredHash = computeCredentialHash({
    ...certificate,
    credentialId: "UNIVA-T-001",
    classification: DegreeClassification.FIRST_CLASS_HONOURS,
  });
  const verifyBody = { ...certificate, referenceCode: "T-001", credentialId: undefined };

  function setup(chain: Partial<typeof NOT_ON_CHAIN> = {}, inDb = true) {
    mockQuery.mockImplementation(
      fakeQuery([
        ["FROM credentials WHERE reference_code", inDb ? [{ institution_id: 1 }] : []],
        ["FROM institutions WHERE institution_id", [institution()]],
      ]) as never,
    );
    mockChain.mockResolvedValue({
      ...NOT_ON_CHAIN,
      exists: true,
      credentialHash: anchoredHash,
      issuer: UNIVA_WALLET.address,
      issuedAt: 1760000000,
      ...chain,
    });
  }

  const loggedResult = () =>
    mockQuery.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO verification_logs"))?.[1];

  it("confirms a genuine credential and logs the attempt", async () => {
    setup();
    const res = await request(app).post("/api/credentials/verify").send(verifyBody);
    expect(res.status).toBe(200);
    expect(res.body.result).toBe("GENUINE_AND_ACTIVE");
    expect(res.body.referenceCode).toBe("UNIVA-T-001");
    expect(res.body.details.issuerInstitution).toEqual({ code: "UNIVA", name: "University A" });
    expect(loggedResult()?.slice(0, 3)).toEqual(["UNIVA-T-001", "GENUINE", "GENUINE_AND_ACTIVE"]);
  });

  it("ignores case and spacing in what the verifier types", async () => {
    setup();
    const res = await request(app)
      .post("/api/credentials/verify")
      .send({ ...verifyBody, holderName: "  DUKUNDIMANA   desire", referenceCode: " t-001 " });
    expect(res.body.result).toBe("GENUINE_AND_ACTIVE");
  });

  it("reports a revoked credential", async () => {
    setup({ revocationTimestamp: 1770000000 });
    const res = await request(app).post("/api/credentials/verify").send(verifyBody);
    expect(res.body.result).toBe("GENUINE_BUT_REVOKED");
  });

  it("returns no record details when one field was altered", async () => {
    setup();
    const res = await request(app)
      .post("/api/credentials/verify")
      .send({ ...verifyBody, holderName: "Someone Else", scenarioType: "tampered" });
    expect(res.body.result).toBe("MISMATCH_OR_NOT_FOUND");
    expect(res.body.details).toEqual({});
    expect(loggedResult()?.[1]).toBe("TAMPERED");
  });

  it("rejects a record anchored by a wallet that is not the institution's", async () => {
    setup({ issuer: OTHER_WALLET.address });
    const res = await request(app).post("/api/credentials/verify").send(verifyBody);
    expect(res.body.result).toBe("MISMATCH_OR_NOT_FOUND");
  });

  it("reports a certificate number that was never issued", async () => {
    setup({}, false);
    const res = await request(app).post("/api/credentials/verify").send(verifyBody);
    expect(res.body.result).toBe("MISMATCH_OR_NOT_FOUND");
    expect(res.body.details).toEqual({});
  });

  it("requires every printed field", async () => {
    const res = await request(app)
      .post("/api/credentials/verify")
      .send({ ...verifyBody, degreeTitle: "" });
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
