import express, { Request, Response } from "express";
import cors from "cors";
import QRCode from "qrcode";
import dotenv from "dotenv";
import { query } from "./db";
import {
  computeCredentialHash,
  computeHolderReference,
  DegreeClassification,
  generateReferenceCode,
  generateSalt,
  isValidIsoDate,
} from "./utils/hash";
import { getOnChainCredential } from "./services/blockchain";
import {
  AuthedRequest,
  loginHandler,
  nonceHandler,
  requireInstitutionOwner,
  requireWallet,
} from "./auth";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// 1. Health & Config Check
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    contractAddress: process.env.CONTRACT_ADDRESS,
    classifications: Object.values(DegreeClassification),
  });
});

// 1b. Wallet sign-in (nonce -> MetaMask signature -> token)
app.post("/api/auth/nonce", nonceHandler);
app.post("/api/auth/login", loginHandler);

// 2. List Institutions (for searchable dropdown in Issuance & Verification UI)
app.get("/api/institutions", async (_req: Request, res: Response) => {
  try {
    const result = await query(
      "SELECT institution_id, code, name, institution_type, wallet_address, accreditation_status FROM institutions ORDER BY code ASC",
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Register / Bind Wallet for an Institution (Gated by Simulated Accreditation Check)
// The wallet comes from the signed token, never from the request body.
app.post(
  "/api/institutions/register",
  requireWallet,
  async (req: Request, res: Response) => {
    try {
      const { code } = req.body;
      const wallet = (req as AuthedRequest).wallet as string; // lowercase, verified
      if (!code) {
        return res.status(400).json({ error: "code is required" });
      }

      const normalizedCode = code.trim().toUpperCase();

      const instResult = await query(
        "SELECT * FROM institutions WHERE code = $1",
        [normalizedCode],
      );

      if (instResult.rows.length === 0) {
        return res
          .status(404)
          .json({ error: "Institution not found in HEC/NCNM registry" });
      }

      const institution = instResult.rows[0];

      // Functional Requirement 1: Gate onboarding against accreditation status
      if (institution.accreditation_status !== "ACCREDITED") {
        return res.status(403).json({
          error: `Onboarding rejected: ${institution.name} (${institution.code}) is UNACCREDITED.`,
        });
      }

      // An institution that already has a registrar wallet cannot be re-bound
      if (institution.wallet_address) {
        if (institution.wallet_address.toLowerCase() === wallet) {
          return res.json({
            message: `${institution.name} (${institution.code}) is already bound to this wallet`,
            institution,
          });
        }
        return res.status(403).json({
          error: `${institution.name} (${institution.code}) is already bound to another wallet. Switch to that account in MetaMask.`,
        });
      }

      // Check if this wallet address is already bound to a DIFFERENT institution
      const existingWalletOwner = await query(
        "SELECT code, name FROM institutions WHERE LOWER(wallet_address) = $1 AND code != $2",
        [wallet, normalizedCode],
      );

      if (existingWalletOwner.rows.length > 0) {
        const other = existingWalletOwner.rows[0];
        return res.status(409).json({
          error: `This MetaMask wallet (${wallet.slice(0, 8)}...) is already bound to ${other.name} (${other.code}). Please switch to a second account in MetaMask to represent ${institution.name} (${institution.code}).`,
        });
      }

      // Only bind while the slot is still empty (guards against a race)
      const updated = await query(
        "UPDATE institutions SET wallet_address = $1 WHERE institution_id = $2 AND wallet_address IS NULL RETURNING *",
        [wallet, institution.institution_id],
      );

      if (updated.rows.length === 0) {
        return res.status(409).json({
          error: `${institution.name} (${institution.code}) was just bound to a wallet. Reload and try again.`,
        });
      }

      res.json({
        message: `${institution.name} (${institution.code}) accredited and bound to wallet ${wallet.slice(0, 8)}...`,
        institution: updated.rows[0],
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// 4. Issuance Step (Figure 3.5a Steps 2-5):
// Checks accreditation, generates salt + SHA-256 hash + reference code + QR code
// Only the registrar wallet bound to the institution may call this.
app.post(
  "/api/credentials/prepare",
  requireWallet,
  requireInstitutionOwner((req) => req.body?.institution),
  async (req: Request, res: Response) => {
    try {
      const {
        institution, // 1. Institution code (e.g. UNIVA)
        credentialId, // 2. Printed certificate number (optional: generated if blank)
        holderName, // 3. Holder name as printed
        degreeTitle, // 4. Degree title as printed
        programme, // 5. Programme ("" if none)
        classification, // 6. Fixed enum
        awardDate, // 7. ISO date YYYY-MM-DD
        credentialType = "ACADEMIC_DEGREE",
      } = req.body;

      if (
        !institution ||
        !holderName ||
        !degreeTitle ||
        !classification ||
        !awardDate
      ) {
        return res.status(400).json({
          error:
            "Missing required fields: institution, holderName, degreeTitle, classification, awardDate",
        });
      }

      if (!isValidIsoDate(awardDate)) {
        return res
          .status(400)
          .json({ error: "awardDate must be in ISO format YYYY-MM-DD" });
      }

      // Step 3 (Figure 3.5a): Check institution accreditation status
      // (requireInstitutionOwner already confirmed accreditation and wallet ownership)
      const instRes = await query(
        "SELECT * FROM institutions WHERE code = $1",
        [institution.trim().toUpperCase()],
      );

      if (instRes.rows.length === 0) {
        return res
          .status(404)
          .json({ error: `Institution ${institution} not found` });
      }

      const instRecord = instRes.rows[0];

      // Step 4 (Figure 3.5a): Generate referenceCode (if certificate has none) and random salt
      const finalReferenceCode =
        credentialId && credentialId.trim().length > 0
          ? credentialId.trim().toUpperCase()
          : generateReferenceCode(instRecord.code, awardDate);

      const salt = generateSalt();

      const credentialHash = computeCredentialHash(
        {
          institution: instRecord.code,
          credentialId: finalReferenceCode,
          holderName,
          degreeTitle,
          programme: programme || "",
          classification,
          awardDate,
        },
        salt,
      );

      const holderReference = computeHolderReference(holderName, salt);

      // Save non-PII credential record (salt + hash + reference_code) in PostgreSQL
      const dbInsert = await query(
        `INSERT INTO credentials
          (institution_id, reference_code, credential_hash, salt, holder_reference, issuance_date, credential_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING credential_id, reference_code, credential_hash, holder_reference, issuance_date, credential_type`,
        [
          instRecord.institution_id,
          finalReferenceCode,
          credentialHash,
          salt,
          holderReference,
          awardDate,
          credentialType,
        ],
      );

      // Generate QR code carrying the verification link with the reference_code pre-filled
      const frontendBase = process.env.FRONTEND_URL || "http://localhost:5173";
      const verifyUrl = `${frontendBase}/verify?ref=${encodeURIComponent(finalReferenceCode)}&inst=${encodeURIComponent(instRecord.code)}`;
      const qrCodeDataUrl = await QRCode.toDataURL(verifyUrl);

      // Step 5 (Figure 3.5a): Return hash, reference code, and QR code for MetaMask signing & document stamping
      res.status(201).json({
        credential: dbInsert.rows[0],
        referenceCode: finalReferenceCode,
        credentialHash,
        qrCodeDataUrl,
        verifyUrl,
        contractAddress: process.env.CONTRACT_ADDRESS,
      });
    } catch (err: any) {
      if (err.code === "23505") {
        return res.status(409).json({
          error:
            "A credential with this reference code or hash already exists.",
        });
      }
      res.status(500).json({ error: err.message });
    }
  },
);

// 5. List Issued Credentials for an Institution (for Registrar Dashboard / Revocation)
// institutionCode is now required, and only that institution's wallet may read it.
app.get(
  "/api/credentials",
  requireWallet,
  requireInstitutionOwner((req) => String(req.query.institutionCode ?? "")),
  async (req: Request, res: Response) => {
    try {
      const institutionCode = String(req.query.institutionCode)
        .trim()
        .toUpperCase();
      const result = await query(
        `SELECT c.credential_id, c.reference_code, c.credential_hash, c.holder_reference,
                c.issuance_date, c.credential_type, i.code as institution_code, i.name as institution_name
         FROM credentials c
         JOIN institutions i ON c.institution_id = i.institution_id
         WHERE i.code = $1
         ORDER BY c.credential_id DESC`,
        [institutionCode],
      );
      res.json(result.rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// 6. Verification Endpoint (Figure 3.5b Steps 2-12):
// Mandatory field re-entry + reference code -> retrieve salt -> recompute hash -> check Sepolia contract -> log result
app.post("/api/credentials/verify", async (req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    const {
      institution,
      credentialId, // Also acts as the reference_code printed on the document
      referenceCode,
      holderName,
      degreeTitle,
      programme,
      classification,
      awardDate,
      scenarioType = "GENUINE", // Supports Section 3.2.4 Evaluation logging ('GENUINE', 'TAMPERED', 'FABRICATED', 'REVOKED')
    } = req.body;

    const lookupCode = (referenceCode || credentialId || "")
      .trim()
      .toUpperCase();

    // Functional Requirement 7: Mandatory field re-entry (no bare reference-code lookup allowed)
    if (
      !lookupCode ||
      !institution ||
      !holderName ||
      !degreeTitle ||
      !classification ||
      !awardDate
    ) {
      return res.status(400).json({
        error:
          "Mandatory field re-entry required: referenceCode/credentialId, institution, holderName, degreeTitle, classification, and awardDate must all be provided.",
      });
    }

    // Step 3 (Figure 3.5b): Retrieve salt for reference_code from PostgreSQL
    const credRes = await query(
      "SELECT * FROM credentials WHERE reference_code = $1",
      [lookupCode],
    );

    let outcome:
      | "GENUINE_AND_ACTIVE"
      | "GENUINE_BUT_REVOKED"
      | "MISMATCH_OR_NOT_FOUND" = "MISMATCH_OR_NOT_FOUND";
    let details: Record<string, any> = {};

    if (credRes.rows.length > 0) {
      const dbRecord = credRes.rows[0];

      // Step 4 (Figure 3.5b): Recompute hash from entered fields + stored salt
      const recomputedHash = computeCredentialHash(
        {
          institution,
          credentialId: lookupCode,
          holderName,
          degreeTitle,
          programme: programme || "",
          classification,
          awardDate,
        },
        dbRecord.salt,
      );

      // Steps 5-8 (Figure 3.5b): Query anchored hash and revocation status from Sepolia Smart Contract
      const onChain = await getOnChainCredential(lookupCode);

      // The on-chain issuer must be the wallet bound to the institution that owns this record.
      // This rejects records anchored by an outside wallet (for example a squatted reference code).
      const ownerRes = await query(
        "SELECT wallet_address FROM institutions WHERE institution_id = $1",
        [dbRecord.institution_id],
      );
      const boundWallet: string | null =
        ownerRes.rows[0]?.wallet_address ?? null;
      const issuerMatchesInstitution =
        onChain.exists &&
        !!boundWallet &&
        onChain.issuer.toLowerCase() === boundWallet.toLowerCase();

      // Step 9 (Figure 3.5b): Compare recomputed hash to on-chain anchored hash & check revocation timestamp
      if (
        onChain.exists &&
        issuerMatchesInstitution &&
        onChain.credentialHash.toLowerCase() === recomputedHash.toLowerCase()
      ) {
        if (onChain.revocationTimestamp > 0) {
          outcome = "GENUINE_BUT_REVOKED";
        } else {
          outcome = "GENUINE_AND_ACTIVE";
        }
      } else {
        outcome = "MISMATCH_OR_NOT_FOUND";
      }

      details = {
        recomputedHash,
        anchoredHash: onChain.exists ? onChain.credentialHash : null,
        onChainExists: onChain.exists,
        issuerAddress: onChain.exists ? onChain.issuer : null,
        issuerMatchesInstitution,
        issuedAtTimestamp: onChain.exists ? onChain.issuedAt : null,
        revocationTimestamp: onChain.exists ? onChain.revocationTimestamp : 0,
      };
    } else {
      // Reference code not found in off-chain salt table -> still check chain for completeness
      const onChain = await getOnChainCredential(lookupCode);
      outcome = "MISMATCH_OR_NOT_FOUND";
      details = {
        recomputedHash: null,
        anchoredHash: onChain.exists ? onChain.credentialHash : null,
        onChainExists: onChain.exists,
        reason: "Reference code not found in registry.",
      };
    }

    const responseTimeMs = Date.now() - startTime;

    // Step 12 (Figure 3.5b): Record attempt in verification_logs for Objective 3 evaluation
    await query(
      `INSERT INTO verification_logs (reference_code, scenario_type, result, response_time_ms)
       VALUES ($1, $2, $3, $4)`,
      [lookupCode, scenarioType.toUpperCase(), outcome, responseTimeMs],
    );

    // Step 10 (Figure 3.5b): Return result
    res.json({
      referenceCode: lookupCode,
      result: outcome,
      responseTimeMs,
      scenarioType: scenarioType.toUpperCase(),
      details,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Get Evaluation Logs (Supports Section 3.2.4 Metrics for Evaluation)
app.get("/api/logs", async (_req: Request, res: Response) => {
  try {
    const logs = await query(
      "SELECT * FROM verification_logs ORDER BY timestamp DESC LIMIT 100",
    );
    res.json(logs.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
  console.log(`Connected to Sepolia Contract: ${process.env.CONTRACT_ADDRESS}`);
});
