import request from "supertest";
import { ethers } from "ethers";
import type { Express } from "express";

// Fixed keys so test failures are reproducible. These wallets hold nothing.
export const HEC = new ethers.Wallet("0x" + "11".repeat(32));
export const UNIVA_WALLET = new ethers.Wallet("0x" + "22".repeat(32));
export const OTHER_WALLET = new ethers.Wallet("0x" + "33".repeat(32));

/** Runs the real nonce -> signature -> login flow and returns a bearer token. */
export async function loginAs(app: Express, wallet: ethers.Wallet) {
  const nonce = await request(app)
    .post("/api/auth/nonce")
    .send({ walletAddress: wallet.address });
  const signature = await wallet.signMessage(nonce.body.message);
  const login = await request(app)
    .post("/api/auth/login")
    .send({ walletAddress: wallet.address, signature });
  return login.body.token as string;
}

type Rows = Record<string, unknown>[];
type Route = [match: string, result: Rows | ((params: unknown[]) => Rows)];

/**
 * Builds a fake `query` that answers by matching a fragment of the SQL text.
 * The first matching route wins; unmatched queries return no rows.
 */
export function fakeQuery(routes: Route[]) {
  return async (sql: string, params: unknown[] = []) => {
    for (const [match, result] of routes) {
      if (sql.includes(match)) {
        return { rows: typeof result === "function" ? result(params) : result };
      }
    }
    return { rows: [] };
  };
}

export function institution(overrides: Record<string, unknown> = {}) {
  return {
    institution_id: 1,
    code: "UNIVA",
    name: "University A",
    institution_type: "UNIVERSITY",
    wallet_address: UNIVA_WALLET.address.toLowerCase(),
    accreditation_status: "ACCREDITED",
    requested_at: null,
    decided_at: null,
    ...overrides,
  };
}

export const NOT_ON_CHAIN = {
  credentialHash: ethers.ZeroHash,
  issuer: ethers.ZeroAddress,
  issuedAt: 0,
  revocationTimestamp: 0,
  exists: false,
};
