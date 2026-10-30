// Auth.ts
//
// Wallet sign-in plus per-institution access control.
// it uses node's crypto, ethers and express types.
//
// Flow:
//   1. POST /api/auth/nonce  { walletAddress }            -> { message }
//   2. The browser asks MetaMask to sign `message` (personal_sign)
//   3. POST /api/auth/login  { walletAddress, signature } -> { token }
//   4. The browser sends  Authorization: Bearer <token>  on protected routes

import crypto from "crypto";
import { ethers } from "ethers";
import { Request, Response, NextFunction } from "express";
import { query } from "./db"; // adjust the path or extension to match your other imports
import { getHecAddress } from "./services/blockchain";

const NONCE_TTL_MS = 5 * 60 * 1000;
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

const SECRET =
  process.env.AUTH_SECRET ??
  (() => {
    console.warn(
      "AUTH_SECRET missing in .env. Using a temporary secret, so logins reset when the server restarts.",
    );
    return crypto.randomBytes(32).toString("hex");
  })();

// In-memory nonces are fine for a single dev server
const nonces = new Map<string, { nonce: string; expires: number }>();

export interface AuthedRequest extends Request {
  wallet?: string; // lowercase address taken from the verified token
}

function loginMessage(address: string, nonce: string) {
  return `Sign in to Rwanda Credential Verification\n\nWallet: ${address}\nNonce: ${nonce}`;
}

function b64(input: string | Buffer) {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: object) {
  const body = b64(JSON.stringify(payload));
  const mac = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function verifyToken(token: string): { w: string; exp: number } | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (typeof payload.w !== "string" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------- Route handlers ----------

export function nonceHandler(req: Request, res: Response) {
  const address = String(req.body?.walletAddress ?? "");
  if (!ethers.isAddress(address)) {
    return res.status(400).json({ error: "Invalid wallet address" });
  }
  const lower = address.toLowerCase();
  const nonce = crypto.randomBytes(16).toString("hex");
  nonces.set(lower, { nonce, expires: Date.now() + NONCE_TTL_MS });
  res.json({ message: loginMessage(lower, nonce) });
}

export function loginHandler(req: Request, res: Response) {
  const address = String(req.body?.walletAddress ?? "");
  const signature = String(req.body?.signature ?? "");
  if (!ethers.isAddress(address) || !signature) {
    return res.status(400).json({ error: "walletAddress and signature are required" });
  }
  const lower = address.toLowerCase();
  const entry = nonces.get(lower);
  nonces.delete(lower); // single use, even when the signature is wrong
  if (!entry || entry.expires < Date.now()) {
    return res.status(401).json({ error: "Sign-in expired. Please try again." });
  }
  let recovered: string;
  try {
    recovered = ethers.verifyMessage(loginMessage(lower, entry.nonce), signature);
  } catch {
    return res.status(401).json({ error: "Invalid signature" });
  }
  if (recovered.toLowerCase() !== lower) {
    return res.status(401).json({ error: "Signature does not match this wallet" });
  }
  const token = sign({ w: lower, exp: Date.now() + TOKEN_TTL_MS });
  res.json({ token, walletAddress: lower });
}

// ---------- Middleware ----------

/** Rejects the request unless it carries a valid token. Sets req.wallet. */
export function requireWallet(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    return res.status(401).json({ error: "Wallet sign-in required" });
  }
  req.wallet = payload.w;
  next();
}

/** Use after requireWallet. Only the HEC wallet recorded in the contract may pass. */
export async function requireHec(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const hec = (await getHecAddress()).toLowerCase();
    if (req.wallet !== hec) {
      return res.status(403).json({ error: "Only the HEC wallet can do this" });
    }
    next();
  } catch (err: any) {
    res.status(500).json({ error: `Could not read the HEC address: ${err.message}` });
  }
}

/**
 * Use after requireWallet on routes that act for one institution.
 * `getCode` reads the institution code from the request, for example
 *   requireInstitutionOwner((req) => String(req.query.institutionCode))
 *   requireInstitutionOwner((req) => req.body.institution)
 */
export function requireInstitutionOwner(getCode: (req: Request) => string | undefined) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const code = (getCode(req) ?? "").trim().toUpperCase();
      const result = await query(
        "SELECT accreditation_status, wallet_address FROM institutions WHERE code = $1",
        [code],
      );
      const inst = result.rows[0];
      if (!inst) return res.status(404).json({ error: "Unknown institution" });
      if (inst.accreditation_status !== "ACCREDITED") {
        return res.status(403).json({
          error: `Institution is not accredited (status: ${inst.accreditation_status})`,
        });
      }
      if (!inst.wallet_address || inst.wallet_address.toLowerCase() !== req.wallet) {
        return res
          .status(403)
          .json({ error: "This wallet is not the registrar for that institution" });
      }
      next();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };
}
