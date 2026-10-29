import express, { Request, Response } from "express";
import cors from "cors";
import QRCode from "qrcode";
import dotenv from "dotenv";
import { query } from "./db";
import {
  computeCredentialHash,
  computeHolderReference,
  DegreeClassification,
  isValidIsoDate,
} from "./utils/hash";
import {
  getHecAddress,
  getOnChainCredential,
  getRevocationTimestamp,
  isIssuerAccredited,
} from "./services/blockchain";
import {
  AuthedRequest,
  loginHandler,
  nonceHandler,
  requireHec,
  requireInstitutionOwner,
  requireWallet,
} from "./auth";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// 1. Health & Config Check
app.get("/api/health", async (_req: Request, res: Response) => {
  let hecAddress: string | null = null;
  try {
    hecAddress = await getHecAddress();
  } catch {
    /* contract unreachable or CONTRACT_ADDRESS wrong */
  }
  res.json({
    status: "ok",
    contractAddress: process.env.CONTRACT_ADDRESS,
    hecAddress,
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
      "SELECT institution_id, code, name, institution_type, wallet_address, accreditation_status, requested_at, decided_at FROM institutions ORDER BY code ASC",
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Apply for accreditation. The applicant's wallet comes from the signed token.
// The institution becomes PENDING until the HEC wallet approves or rejects it.
app.post(
  "/api/institutions/apply",
  requireWallet,
  async (req: Request, res: Response) => {
    try {
      const { code } = req.body;
      const wallet = (req as AuthedRequest).wallet as string; // lowercase, verified
      if (!code) {
        return res.status(400).json({ error: "code is required" });
      }

      if (wallet === (await getHecAddress()).toLowerCase()) {
        return res.status(400).json({
          error: "The HEC wallet cannot apply as an institution. Use another account.",
        });
      }

      const normalizedCode = code.trim().toUpperCase();
      const instResult = await query(
        "SELECT * FROM institutions WHERE code = $1",
        [normalizedCode],
      );
      if (instResult.rows.length === 0) {
        return res
          .status(404)
          .json({ error: "Institution not found in the registry" });
      }
      const inst = instResult.rows[0];
      const sameWallet =
        !!inst.wallet_address && inst.wallet_address.toLowerCase() === wallet;

      if (inst.accreditation_status === "ACCREDITED") {
        return sameWallet
          ? res.json({ message: `${inst.name} is already accredited`, institution: inst })
          : res.status(403).json({
              error: `${inst.name} (${inst.code}) is already accredited under another wallet.`,
            });
      }
      if (inst.accreditation_status === "PENDING") {
        return sameWallet
          ? res.json({ message: `Your application for ${inst.name} is already pending`, institution: inst })
          : res.status(403).json({
              error: `${inst.name} (${inst.code}) already has a pending application from another wallet.`,
            });
      }
      if (inst.accreditation_status === "SUSPENDED") {
        return res.status(403).json({
          error: `${inst.name} (${inst.code}) is suspended. Contact HEC to be reinstated.`,
        });
      }

      // UNREGISTERED or REJECTED: this wallet must not represent another institution
      const other = await query(
        "SELECT code, name FROM institutions WHERE LOWER(wallet_address) = $1 AND code != $2",
        [wallet, normalizedCode],
      );
      if (other.rows.length > 0) {
        return res.status(409).json({
          error: `This wallet already represents ${other.rows[0].name} (${other.rows[0].code}). Switch to another MetaMask account for ${inst.name} (${inst.code}).`,
        });
      }

      const updated = await query(
        `UPDATE institutions
            SET wallet_address = $1, accreditation_status = 'PENDING',
                requested_at = NOW(), decided_at = NULL
          WHERE institution_id = $2 AND accreditation_status IN ('UNREGISTERED', 'REJECTED')
          RETURNING *`,
        [wallet, inst.institution_id],
      );
      if (updated.rows.length === 0) {
        return res.status(409).json({
          error: "This institution changed status while you applied. Reload and try again.",
        });
      }
      res.status(201).json({
        message: `Application for ${inst.name} (${inst.code}) sent to HEC`,
        institution: updated.rows[0],
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// The HEC admin sends the accredit/suspend transaction from MetaMask first.
// These routes then confirm the on-chain state and mirror it into PostgreSQL.
async function waitForChainState(wallet: string, expected: boolean) {
  for (let i = 0; i < 8; i++) {
    if ((await isIssuerAccredited(wallet)) === expected) return true;
    await new Promise((r) => setTimeout(r, 2000)); // the RPC node can lag a block
  }
  return false;
}

async function loadInstitution(code: string) {
  const r = await query("SELECT * FROM institutions WHERE code = $1", [
    String(code).trim().toUpperCase(),
  ]);
  return r.rows[0] ?? null;
}

// 3a. Approve (or reinstate): the accreditIssuer transaction must already be on-chain
app.post(
  "/api/admin/institutions/:code/approve",
  requireWallet,
  requireHec,
  async (req: Request, res: Response) => {
    try {
      const inst = await loadInstitution(req.params.code as string);
      if (!inst) return res.status(404).json({ error: "Institution not found" });
      if (!["PENDING", "SUSPENDED"].includes(inst.accreditation_status) || !inst.wallet_address) {
        return res.status(409).json({
          error: `${inst.code} is ${inst.accreditation_status} and cannot be approved now.`,
        });
      }
      if (!(await waitForChainState(inst.wallet_address, true))) {
        return res.status(409).json({
          error: "The contract does not list this wallet yet. Send the accreditIssuer transaction first.",
        });
      }
      const updated = await query(
        "UPDATE institutions SET accreditation_status = 'ACCREDITED', decided_at = NOW() WHERE institution_id = $1 RETURNING *",
        [inst.institution_id],
      );
      res.json({
        message: `${inst.name} (${inst.code}) is now accredited`,
        institution: updated.rows[0],
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// 3b. Reject a pending application (off-chain, no gas)
app.post(
  "/api/admin/institutions/:code/reject",
  requireWallet,
  requireHec,
  async (req: Request, res: Response) => {
    try {
      const inst = await loadInstitution(req.params.code as string);
      if (!inst) return res.status(404).json({ error: "Institution not found" });
      if (inst.accreditation_status !== "PENDING") {
        return res.status(409).json({
          error: `${inst.code} is ${inst.accreditation_status}. Only pending applications can be rejected.`,
        });
      }
      const updated = await query(
        "UPDATE institutions SET accreditation_status = 'REJECTED', decided_at = NOW() WHERE institution_id = $1 RETURNING *",
        [inst.institution_id],
      );
      res.json({
        message: `Application from ${inst.name} (${inst.code}) rejected`,
        institution: updated.rows[0],
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// 3c. Suspend an accredited institution: the suspendIssuer transaction must already be on-chain
app.post(
  "/api/admin/institutions/:code/suspend",
  requireWallet,
  requireHec,
  async (req: Request, res: Response) => {
    try {
      const inst = await loadInstitution(req.params.code as string);
      if (!inst) return res.status(404).json({ error: "Institution not found" });
      if (inst.accreditation_status !== "ACCREDITED" || !inst.wallet_address) {
        return res.status(409).json({
          error: `${inst.code} is ${inst.accreditation_status}. Only accredited institutions can be suspended.`,
        });
      }
      if (!(await waitForChainState(inst.wallet_address, false))) {
        return res.status(409).json({
          error: "The contract still lists this wallet. Send the suspendIssuer transaction first.",
        });
      }
      const updated = await query(
        "UPDATE institutions SET accreditation_status = 'SUSPENDED', decided_at = NOW() WHERE institution_id = $1 RETURNING *",
        [inst.institution_id],
      );
      res.json({
        message: `${inst.name} (${inst.code}) suspended`,
        institution: updated.rows[0],
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// 4. Issuance Step (Figure 3.5a Steps 2-5):
// Checks accreditation, generates SHA-256 hash + QR code from the certificate number
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
        !credentialId ||
        !credentialId.trim() ||
        !holderName ||
        !degreeTitle ||
        !classification ||
        !awardDate
      ) {
        return res.status(400).json({
          error:
            "Missing required fields: institution, credentialId (the unique number printed on the certificate), holderName, degreeTitle, classification, awardDate",
        });
      }

      if (!isValidIsoDate(awardDate)) {
        return res
          .status(400)
          .json({ error: "awardDate must be in ISO format YYYY-MM-DD" });
      }

      // The contract is the source of truth: HEC must currently list this wallet
      if (!(await isIssuerAccredited((req as AuthedRequest).wallet as string))) {
        return res.status(403).json({
          error: "HEC has not accredited this wallet on-chain, so it cannot anchor credentials.",
        });
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

      // Step 4 (Figure 3.5a): The unique number printed on the certificate is the reference code.
      // It is part of the hashed fields and does the job a random salt used to do.
      const finalReferenceCode = credentialId.trim().toUpperCase();

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
      );

      const holderReference = computeHolderReference(
        holderName,
        finalReferenceCode,
      );

      // Save non-PII credential record (hash + reference_code) in PostgreSQL
      const dbInsert = await query(
        `INSERT INTO credentials
          (institution_id, reference_code, credential_hash, holder_reference, issuance_date, credential_type)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING credential_id, reference_code, credential_hash, holder_reference, issuance_date, credential_type`,
        [
          instRecord.institution_id,
          finalReferenceCode,
          credentialHash,
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
      // Revocation lives on-chain only, so read it for each credential.
      // revoked_at is null for active credentials and undefined if the chain could not be read.
      const rows = await Promise.all(
        result.rows.map(async (r: any) => {
          try {
            const ts = await getRevocationTimestamp(r.credential_hash);
            return { ...r, revoked_at: ts > 0 ? ts : null };
          } catch {
            return r;
          }
        }),
      );
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// 6. Verification Endpoint (Figure 3.5b Steps 2-12):
// Mandatory field re-entry + reference code -> recompute hash -> check Sepolia contract -> log result
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

    // Step 3 (Figure 3.5b): Look up the stored record for this reference_code
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

      // Step 4 (Figure 3.5b): Recompute the hash from the entered fields (the certificate number is one of the hashed fields)
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
      );

      // Steps 5-8 (Figure 3.5b): Query anchored hash and revocation status from Sepolia Smart Contract
      const onChain = await getOnChainCredential(lookupCode);

      // The on-chain issuer must be the wallet bound to the institution that owns this record.
      // This rejects records anchored by an outside wallet (for example a squatted reference code).
      const ownerRes = await query(
        "SELECT code, name, wallet_address FROM institutions WHERE institution_id = $1",
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

      // Record details are returned only when the entered fields match the anchored record.
      // On a mismatch the caller learns the outcome and nothing else: no on-chain hash,
      // no issuer wallet, and no hint about which field was wrong.
      details =
        outcome === "MISMATCH_OR_NOT_FOUND"
          ? {}
          : {
              recomputedHash,
              anchoredHash: onChain.credentialHash,
              issuerAddress: onChain.issuer,
              issuerInstitution: {
                code: ownerRes.rows[0]?.code,
                name: ownerRes.rows[0]?.name,
              },
              issuedAtTimestamp: onChain.issuedAt,
              revocationTimestamp: onChain.revocationTimestamp,
            };
    } else {
      // Reference code not found in the off-chain table. The chain is still queried so
      // response times stay comparable across scenarios, but nothing from it is returned.
      await getOnChainCredential(lookupCode);
      outcome = "MISMATCH_OR_NOT_FOUND";
      details = {};
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

// 7. Get Evaluation Logs (Supports Section 3.2.4 Metrics for Evaluation). HEC wallet only.
app.get("/api/logs", requireWallet, requireHec, async (_req: Request, res: Response) => {
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
