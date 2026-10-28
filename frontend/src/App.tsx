import React, { useEffect, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Link,
  useNavigate,
  useParams,
  useSearchParams,
  useLocation,
} from "react-router-dom";
import { ethers } from "ethers";
import "./App.css";

const API_BASE = "http://localhost:4000/api";
const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7";
const DEFAULT_CONTRACT_ADDRESS = "0xAaf295EB2b31AC3eFeB0961e0f7E403A462ea590";

const REGISTRY_ABI = [
  "function issueCredential(bytes32 _credentialHash, string calldata _referenceCode) external",
  "function revokeCredential(bytes32 _credentialHash) external",
  "function getRecordByReferenceCode(string calldata _referenceCode) external view returns (bytes32 credentialHash, address issuer, uint256 issuedAt, uint256 revocationTimestamp, bool exists)",
];

const CLASSIFICATIONS = [
  { value: "FIRST_CLASS_HONOURS", label: "First Class Honours" },
  {
    value: "SECOND_CLASS_UPPER",
    label: "Second Class Honours, Upper Division",
  },
  {
    value: "SECOND_CLASS_LOWER",
    label: "Second Class Honours, Lower Division",
  },
  { value: "PASS", label: "Pass" },
  { value: "NOT_APPLICABLE", label: "Not Applicable (Professional License)" },
];

export interface Institution {
  institution_id: number;
  code: string;
  name: string;
  institution_type: string;
  wallet_address: string | null;
  accreditation_status: string;
}

interface CredentialRow {
  credential_id: number;
  reference_code: string;
  credential_hash: string;
  holder_reference: string;
  issuance_date: string;
  credential_type: string;
  institution_code: string;
  institution_name: string;
}

interface VerificationLogRow {
  log_id: number;
  reference_code: string;
  scenario_type: string;
  result: string;
  timestamp: string;
  response_time_ms: number;
}

// Context-aware Header: Completely hides internal tabs when on the public /verify page
function Header({
  walletAddress,
  connectWallet,
  contractAddress,
}: {
  walletAddress: string;
  connectWallet: () => Promise<void>;
  contractAddress: string;
}) {
  const location = useLocation();
  const isVerifierPage = location.pathname.startsWith("/verify");
  const isPortalActive =
    location.pathname === "/register"
      ? true
      : location.pathname.includes("/issue_degree");

  return (
    <>
      <header className="app-header">
        <div>
          <h1>Rwanda Blockchain Credential Verification Platform</h1>
          <p>
            Zero-Storage, Single-Issuer Hash-Anchoring on Ethereum Sepolia (
            <span className="mono">{contractAddress}</span>)
          </p>
        </div>
        {!isVerifierPage && (
          <div>
            {walletAddress ? (
              <span className="badge badge-green mono">
                Wallet: {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
              </span>
            ) : (
              <button className="btn btn-outline" onClick={connectWallet}>
                Connect Registrar MetaMask
              </button>
            )}
          </div>
        )}
      </header>

      {!isVerifierPage && (
        <nav className="nav-tabs">
          <Link
            to="/register"
            className={`tab-btn ${isPortalActive ? "active" : ""}`}
            style={{ textDecoration: "none" }}
          >
            Institution Portal (/register)
          </Link>
          <Link
            to="/verify"
            className={`tab-btn ${location.pathname.startsWith("/verify") ? "active" : ""}`}
            style={{ textDecoration: "none" }}
          >
            Public Verifier (/verify)
          </Link>
          <Link
            to="/logs"
            className={`tab-btn ${location.pathname.startsWith("/logs") ? "active" : ""}`}
            style={{ textDecoration: "none" }}
          >
            Evaluation Logs (/logs)
          </Link>
        </nav>
      )}
    </>
  );
}

function RegisterPage({
  institutions,
  walletAddress,
  connectWallet,
  refreshInstitutions,
  backendError,
}: {
  institutions: Institution[];
  walletAddress: string;
  connectWallet: () => Promise<void>;
  refreshInstitutions: () => Promise<void>;
  backendError: string | null;
}) {
  const navigate = useNavigate();
  const [selectedCode, setSelectedCode] = useState<string>("UNIVA");
  const [statusMsg, setStatusMsg] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (
      institutions.length > 0 &&
      !institutions.find((i) => i.code === selectedCode)
    ) {
      setSelectedCode(institutions[0].code);
    }
  }, [institutions, selectedCode]);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setStatusMsg(null);

    if (!walletAddress) {
      setStatusMsg({
        type: "err",
        text: "Please connect your Registrar MetaMask wallet first.",
      });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/institutions/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: selectedCode, walletAddress }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg({
          type: "err",
          text: data.error ?? "Registration failed",
        });
      } else {
        setStatusMsg({
          type: "ok",
          text: `${data.message}. Redirecting to /${selectedCode}/issue_degree...`,
        });
        await refreshInstitutions();
        setTimeout(() => {
          navigate(`/${selectedCode}/issue_degree`);
        }, 900);
      }
    } catch (err: any) {
      setStatusMsg({ type: "err", text: err.message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h2>
        Institution Onboarding
        (/register)[span_10](start_span)[span_10](end_span)[span_11](start_span)[span_11](end_span)
      </h2>
      <p style={{ fontSize: "0.9rem", color: "#4a5568" }}>
        Gated against simulated HEC / NCNM accreditation
        records[span_12](start_span)[span_12](end_span)[span_13](start_span)[span_13](end_span).
        Only accredited institutions can bind a registrar wallet and access{" "}
        <code>/[university]/issue_degree</code>
        [span_14](start_span)[span_14](end_span)[span_15](start_span)[span_15](end_span).
      </p>

      {backendError && (
        <div
          className="outcome-banner outcome-MISMATCH_OR_NOT_FOUND"
          style={{ marginBottom: 16 }}
        >
          <strong>Backend Connection Issue:</strong> {backendError}
        </div>
      )}

      <form onSubmit={handleRegister}>
        <div className="form-group">
          <label>Select Institution (Simulated HEC/NCNM Registry)</label>
          <select
            value={selectedCode}
            onChange={(e) => setSelectedCode(e.target.value)}
          >
            {institutions.map((inst) => (
              <option key={inst.code} value={inst.code}>
                {inst.code} — {inst.name} [{inst.accreditation_status}]
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          {!walletAddress ? (
            <button type="button" className="btn" onClick={connectWallet}>
              1. Connect MetaMask Wallet
            </button>
          ) : (
            <button
              type="submit"
              className="btn"
              disabled={loading ? true : institutions.length === 0}
            >
              {loading
                ? "Checking Accreditation..."
                : `Verify Accreditation & Enter /${selectedCode}/issue_degree`}
            </button>
          )}
        </div>
      </form>

      {statusMsg && (
        <div
          className={`outcome-banner ${
            statusMsg.type === "ok"
              ? "outcome-GENUINE_AND_ACTIVE"
              : "outcome-MISMATCH_OR_NOT_FOUND"
          }`}
        >
          <strong>{statusMsg.text}</strong>
        </div>
      )}

      <div style={{ marginTop: "24px" }}>
        <h3>Registered Institutions & Direct Portals</h3>
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Institution Name</th>
              <th>Accreditation Status</th>
              <th>Bound Registrar Wallet</th>
              <th>Portal Action</th>
            </tr>
          </thead>
          <tbody>
            {institutions.map((i) => (
              <tr key={i.code}>
                <td>
                  <strong>{i.code}</strong>
                </td>
                <td>{i.name}</td>
                <td>
                  <span
                    className={`badge ${
                      i.accreditation_status === "ACCREDITED"
                        ? "badge-green"
                        : "badge-red"
                    }`}
                  >
                    {i.accreditation_status}
                  </span>
                </td>
                <td className="mono">
                  {i.wallet_address
                    ? `${i.wallet_address.slice(0, 8)}...${i.wallet_address.slice(-6)}`
                    : "Not registered yet"}
                </td>
                <td>
                  {i.accreditation_status === "ACCREDITED" &&
                  i.wallet_address ? (
                    <Link
                      to={`/${i.code}/issue_degree`}
                      className="btn"
                      style={{
                        textDecoration: "none",
                        padding: "6px 12px",
                        fontSize: "0.82rem",
                      }}
                    >
                      Open /{i.code}/issue_degree →
                    </Link>
                  ) : (
                    <span style={{ fontSize: "0.82rem", color: "#718096" }}>
                      {i.accreditation_status === "UNACCREDITED"
                        ? "Blocked (Unaccredited)"
                        : "Bind wallet above first"}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function IssueDegreePage({
  institutions,
  walletAddress,
  contractAddress,
}: {
  institutions: Institution[];
  walletAddress: string;
  contractAddress: string;
}) {
  const { university } = useParams<{ university: string }>();
  const navigate = useNavigate();
  const uniCode = (university ?? "UNIVA").toUpperCase();

  const currentInst = institutions.find((i) => i.code === uniCode);

  const [issueForm, setIssueForm] = useState({
    credentialId: "",
    holderName: "",
    degreeTitle: "",
    programme: "",
    classification: "FIRST_CLASS_HONOURS",
    awardDate: "2026-06-15",
    credentialType: "ACADEMIC_DEGREE",
  });

  const [issuingLoading, setIssuingLoading] = useState(false);
  const [issuedResult, setIssuedResult] = useState<{
    referenceCode: string;
    credentialHash: string;
    qrCodeDataUrl: string;
    txHash: string;
    gasUsed: string;
  } | null>(null);
  const [issueError, setIssueError] = useState<string | null>(null);

  const [credentials, setCredentials] = useState<CredentialRow[]>([]);
  const [revokingHash, setRevokingHash] = useState<string | null>(null);
  const [revokeMsg, setRevokeMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchUniversityCredentials();
  }, [uniCode]);

  async function fetchUniversityCredentials() {
    try {
      const res = await fetch(
        `${API_BASE}/credentials?institutionCode=${uniCode}`,
      );
      if (res.ok) setCredentials(await res.json());
    } catch (err) {
      console.error(err);
    }
  }

  async function handleIssueCredential(e: React.FormEvent) {
    e.preventDefault();
    setIssueError(null);
    setIssuedResult(null);

    if (!walletAddress) {
      setIssueError(
        "Please connect your institution MetaMask wallet in the top-right header.",
      );
      return;
    }

    setIssuingLoading(true);
    try {
      const prepRes = await fetch(`${API_BASE}/credentials/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          institution: uniCode,
          ...issueForm,
          walletAddress,
        }),
      });
      const prepData = await prepRes.json();
      if (!prepRes.ok) {
        throw new Error(prepData.error ?? "Failed to prepare credential");
      }

      const { credentialHash, referenceCode, qrCodeDataUrl } = prepData;

      const ethereum = (window as any).ethereum;
      const browserProvider = new ethers.BrowserProvider(ethereum);
      const signer = await browserProvider.getSigner();
      const contract = new ethers.Contract(
        contractAddress,
        REGISTRY_ABI,
        signer,
      );

      const tx = await contract.issueCredential(credentialHash, referenceCode);
      const receipt = await tx.wait();

      setIssuedResult({
        referenceCode,
        credentialHash,
        qrCodeDataUrl,
        txHash: receipt.hash,
        gasUsed: receipt.gasUsed.toString(),
      });

      fetchUniversityCredentials();
    } catch (err: any) {
      const msg = err.shortMessage ? err.shortMessage : err.message;
      setIssueError(msg ?? "Issuance failed");
    } finally {
      setIssuingLoading(false);
    }
  }

  async function handleRevokeCredential(
    credentialHash: string,
    referenceCode: string,
  ) {
    setRevokeMsg(null);
    if (!walletAddress) {
      alert(
        "Connect your MetaMask wallet first to sign the revocation transaction.",
      );
      return;
    }
    setRevokingHash(credentialHash);
    try {
      const ethereum = (window as any).ethereum;
      const browserProvider = new ethers.BrowserProvider(ethereum);
      const signer = await browserProvider.getSigner();
      const contract = new ethers.Contract(
        contractAddress,
        REGISTRY_ABI,
        signer,
      );

      const tx = await contract.revokeCredential(credentialHash);
      const receipt = await tx.wait();
      setRevokeMsg(
        `Revoked ${referenceCode} on-chain! Tx: ${receipt.hash} (Gas used: ${receipt.gasUsed.toString()})`,
      );
    } catch (err: any) {
      const msg = err.shortMessage ? err.shortMessage : err.message;
      setRevokeMsg(`Revocation error: ${msg}`);
    } finally {
      setRevokingHash(null);
    }
  }

  if (currentInst && currentInst.accreditation_status !== "ACCREDITED") {
    return (
      <div className="card">
        <h2>Access Denied: {uniCode} is Unaccredited</h2>
        <p>
          {currentInst.name} ({uniCode}) is marked as{" "}
          <strong>UNACCREDITED</strong> in the simulated HEC/NCNM registry and
          cannot issue credentials.
        </p>
        <Link to="/register" className="btn" style={{ textDecoration: "none" }}>
          ← Return to /register
        </Link>
      </div>
    );
  }

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <Link to="/register" style={{ color: "#2b6cb0", fontWeight: 600 }}>
          ← Back to Institution Onboarding (/register)
        </Link>
      </div>

      <div className="card">
        <h2>
          Issue & Anchor Degree for{" "}
          {currentInst ? `${currentInst.name} (${uniCode})` : uniCode}
        </h2>
        <p style={{ fontSize: "0.88rem", color: "#4a5568" }}>
          Route: <code>/{uniCode}/issue_degree</code>
          [span_16](start_span)[span_16](end_span)[span_17](start_span)[span_17](end_span)
          | Registered Wallet:{" "}
          <span className="mono">
            {currentInst?.wallet_address ?? "Not bound"}
          </span>
        </p>

        <form onSubmit={handleIssueCredential}>
          <div className="grid-2">
            <div className="form-group">
              <label>1. Issuing Institution Code (Locked to Route)</label>
              <input type="text" value={uniCode} disabled />
            </div>

            <div className="form-group">
              <label>
                2. Printed Certificate ID / Reference Code (Blank =
                auto-generate)
              </label>
              <input
                type="text"
                placeholder="e.g. 220001624 or leave empty for RW-UNIVA-..."
                value={issueForm.credentialId}
                onChange={(e) =>
                  setIssueForm({ ...issueForm, credentialId: e.target.value })
                }
              />
            </div>

            <div className="form-group">
              <label>3. Holder Full Name (as printed on certificate) *</label>
              <input
                type="text"
                required
                placeholder="e.g. DUKUNDIMANA DESIRE"
                value={issueForm.holderName}
                onChange={(e) =>
                  setIssueForm({ ...issueForm, holderName: e.target.value })
                }
              />
            </div>

            <div className="form-group">
              <label>4. Degree / License Title (as printed) *</label>
              <input
                type="text"
                required
                placeholder="e.g. BACHELOR OF EDUCATION WITH HONOURS"
                value={issueForm.degreeTitle}
                onChange={(e) =>
                  setIssueForm({ ...issueForm, degreeTitle: e.target.value })
                }
              />
            </div>

            <div className="form-group">
              <label>5. Programme / Specialization (Optional)</label>
              <input
                type="text"
                placeholder="e.g. FOUNDATIONS OF EDUCATION AND ENGLISH"
                value={issueForm.programme}
                onChange={(e) =>
                  setIssueForm({ ...issueForm, programme: e.target.value })
                }
              />
            </div>

            <div className="form-group">
              <label>6. Classification (Fixed Enum) *</label>
              <select
                value={issueForm.classification}
                onChange={(e) =>
                  setIssueForm({ ...issueForm, classification: e.target.value })
                }
              >
                {CLASSIFICATIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label} ({c.value})
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>7. Award Date (ISO YYYY-MM-DD) *</label>
              <input
                type="date"
                required
                value={issueForm.awardDate}
                onChange={(e) =>
                  setIssueForm({ ...issueForm, awardDate: e.target.value })
                }
              />
            </div>
          </div>

          <button type="submit" className="btn" disabled={issuingLoading}>
            {issuingLoading
              ? "Generating Salt/Hash & Waiting for MetaMask Signature..."
              : "Generate Salted Hash & Sign On-Chain (MetaMask)"}
          </button>
        </form>

        {issueError && (
          <div className="outcome-banner outcome-MISMATCH_OR_NOT_FOUND">
            <strong>Error:</strong> {issueError}
          </div>
        )}

        {issuedResult && (
          <div className="outcome-banner outcome-GENUINE_AND_ACTIVE">
            <h3 style={{ marginTop: 0 }}>Credential Anchored on Sepolia!</h3>
            <p>
              <strong>Reference Code (Stamp on Document):</strong>{" "}
              <span className="mono">{issuedResult.referenceCode}</span>
            </p>
            <p>
              <strong>Salted SHA-256 Hash:</strong>{" "}
              <span className="mono">{issuedResult.credentialHash}</span>
            </p>
            <p>
              <strong>Sepolia Transaction Hash:</strong>{" "}
              <a
                href={`https://sepolia.etherscan.io/tx/${issuedResult.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="mono"
              >
                {issuedResult.txHash}
              </a>
            </p>
            <p>
              <strong>Issuance Gas Used:</strong> {issuedResult.gasUsed} gas
            </p>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "16px",
                marginTop: "10px",
              }}
            >
              <img
                src={issuedResult.qrCodeDataUrl}
                alt="Credential QR Code"
                style={{
                  width: 120,
                  height: 120,
                  border: "1px solid #ccc",
                  borderRadius: 6,
                }}
              />
              <button
                type="button"
                className="btn"
                onClick={() =>
                  navigate(
                    `/verify?ref=${encodeURIComponent(
                      issuedResult.referenceCode,
                    )}&inst=${encodeURIComponent(uniCode)}`,
                  )
                }
              >
                Open Public Verifier (/verify) with Reference Code →
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Issued Credentials by {uniCode} (On-Chain Revocation)</h2>
        {revokeMsg && (
          <div
            className="outcome-banner outcome-GENUINE_BUT_REVOKED"
            style={{ marginBottom: 12 }}
          >
            <strong>{revokeMsg}</strong>
          </div>
        )}
        <table>
          <thead>
            <tr>
              <th>Reference Code</th>
              <th>Salted Hash (On-Chain Anchor)</th>
              <th>Opaque Holder Ref</th>
              <th>Award Date</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {credentials.map((c) => (
              <tr key={c.credential_id}>
                <td className="mono">
                  <strong>{c.reference_code}</strong>
                </td>
                <td className="mono">
                  {c.credential_hash.slice(0, 14)}...
                  {c.credential_hash.slice(-8)}
                </td>
                <td className="mono">{c.holder_reference}</td>
                <td>String(c.issuance_date).slice(0, 10)</td>
                <td>
                  <button
                    className="btn btn-danger"
                    style={{ padding: "6px 10px", fontSize: "0.8rem" }}
                    disabled={revokingHash === c.credential_hash}
                    onClick={() =>
                      handleRevokeCredential(
                        c.credential_hash,
                        c.reference_code,
                      )
                    }
                  >
                    {revokingHash === c.credential_hash
                      ? "Revoking..."
                      : "Revoke On-Chain"}
                  </button>
                </td>
              </tr>
            ))}
            {credentials.length === 0 && (
              <tr>
                <td colSpan={5}>No credentials issued by {uniCode} yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function VerifyPage({ institutions }: { institutions: Institution[] }) {
  const [searchParams] = useSearchParams();
  const [verifyForm, setVerifyForm] = useState({
    referenceCode: searchParams.get("ref") ?? "",
    institution: searchParams.get("inst") ?? "UNIVA",
    holderName: "",
    degreeTitle: "",
    programme: "",
    classification: "FIRST_CLASS_HONOURS",
    awardDate: "2026-06-15",
    scenarioType: "GENUINE",
  });
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyResponse, setVerifyResponse] = useState<any | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  async function handleVerifyCredential(e: React.FormEvent) {
    e.preventDefault();
    setVerifyError(null);
    setVerifyResponse(null);
    setVerifyLoading(true);
    try {
      const res = await fetch(`${API_BASE}/credentials/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(verifyForm),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Verification request failed");
      }
      setVerifyResponse(data);
    } catch (err: any) {
      setVerifyError(err.message);
    } finally {
      setVerifyLoading(false);
    }
  }

  return (
    <div className="grid-2">
      <div className="card">
        <h2>
          Public Credential Verification
          (/verify)[span_18](start_span)[span_18](end_span)[span_19](start_span)[span_19](end_span)
        </h2>
        <p style={{ fontSize: "0.86rem", color: "#4a5568" }}>
          Re-enter the visible fields printed on the presented certificate along
          with its Reference
          Code[span_20](start_span)[span_20](end_span)[span_21](start_span)[span_21](end_span).
          No wallet or registrar contact
          required[span_22](start_span)[span_22](end_span)[span_23](start_span)[span_23](end_span).
        </p>
        <form onSubmit={handleVerifyCredential}>
          <div className="form-group">
            <label>Reference Code / Printed Certificate ID *</label>
            <input
              type="text"
              required
              placeholder="e.g. RW-UNIVA-2026-... or 220001624"
              value={verifyForm.referenceCode}
              onChange={(e) =>
                setVerifyForm({ ...verifyForm, referenceCode: e.target.value })
              }
            />
          </div>

          <div className="form-group">
            <label>1. Issuing Institution *</label>
            <select
              value={verifyForm.institution}
              onChange={(e) =>
                setVerifyForm({ ...verifyForm, institution: e.target.value })
              }
            >
              {institutions.map((inst) => (
                <option key={inst.code} value={inst.code}>
                  {inst.code} — {inst.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>3. Holder Full Name (as printed on document) *</label>
            <input
              type="text"
              required
              placeholder="e.g. DUKUNDIMANA DESIRE"
              value={verifyForm.holderName}
              onChange={(e) =>
                setVerifyForm({ ...verifyForm, holderName: e.target.value })
              }
            />
          </div>

          <div className="form-group">
            <label>4. Degree / License Title *</label>
            <input
              type="text"
              required
              placeholder="e.g. BACHELOR OF EDUCATION WITH HONOURS"
              value={verifyForm.degreeTitle}
              onChange={(e) =>
                setVerifyForm({ ...verifyForm, degreeTitle: e.target.value })
              }
            />
          </div>

          <div className="form-group">
            <label>5. Programme / Specialization (if printed)</label>
            <input
              type="text"
              placeholder="Leave blank if none"
              value={verifyForm.programme}
              onChange={(e) =>
                setVerifyForm({ ...verifyForm, programme: e.target.value })
              }
            />
          </div>

          <div className="form-group">
            <label>6. Classification *</label>
            <select
              value={verifyForm.classification}
              onChange={(e) =>
                setVerifyForm({ ...verifyForm, classification: e.target.value })
              }
            >
              {CLASSIFICATIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label} ({c.value})
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>7. Award Date (YYYY-MM-DD) *</label>
            <input
              type="date"
              required
              value={verifyForm.awardDate}
              onChange={(e) =>
                setVerifyForm({ ...verifyForm, awardDate: e.target.value })
              }
            />
          </div>

          <div className="form-group">
            <label>
              Evaluation Scenario Tag (Logged to verification_logs for Objective
              3)[span_24](start_span)[span_24](end_span)[span_25](start_span)[span_25](end_span)
            </label>
            <select
              value={verifyForm.scenarioType}
              onChange={(e) =>
                setVerifyForm({ ...verifyForm, scenarioType: e.target.value })
              }
            >
              <option value="GENUINE">
                GENUINE (Unaltered Issued Credential)
              </option>
              <option value="TAMPERED">
                TAMPERED (Real Reference Code + Altered Field)
              </option>
              <option value="FABRICATED">
                FABRICATED (Never Issued / Fake Reference Code)
              </option>
              <option value="REVOKED">
                REVOKED (Issued Then Revoked On-Chain)
              </option>
            </select>
          </div>

          <button type="submit" className="btn" disabled={verifyLoading}>
            {verifyLoading
              ? "Recomputing Hash & Querying Sepolia Blockchain..."
              : "Verify Credential Against Sepolia Blockchain"}
          </button>
        </form>

        {verifyError && (
          <div className="outcome-banner outcome-MISMATCH_OR_NOT_FOUND">
            <strong>Error:</strong> {verifyError}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Cryptographic Verification Result</h2>
        {!verifyResponse ? (
          <p style={{ color: "#4a5568" }}>
            Submit the certificate details on the left to recompute its salted
            SHA-256 hash and compare it against the immutable Sepolia smart
            contract record.
          </p>
        ) : (
          <div className={`outcome-banner outcome-${verifyResponse.result}`}>
            <h3 style={{ marginTop: 0 }}>
              Outcome:{" "}
              {verifyResponse.result === "GENUINE_AND_ACTIVE" &&
                "✅ GENUINE AND ACTIVE"}
              {verifyResponse.result === "GENUINE_BUT_REVOKED" &&
                "⚠️ GENUINE BUT REVOKED"}
              {verifyResponse.result === "MISMATCH_OR_NOT_FOUND" &&
                "❌ MISMATCH OR NOT FOUND"}
            </h3>
            <p>
              <strong>Reference Code Checked:</strong>{" "}
              <span className="mono">{verifyResponse.referenceCode}</span>
            </p>
            <p>
              <strong>Verification Response Time:</strong>{" "}
              <strong>{verifyResponse.responseTimeMs} ms</strong> (
              {(verifyResponse.responseTimeMs / 1000).toFixed(2)} seconds)
            </p>
            <p>
              <strong>Recomputed Hash (from entered fields + salt):</strong>{" "}
              <span className="mono">
                {verifyResponse.details?.recomputedHash ?? "N/A"}
              </span>
            </p>
            <p>
              <strong>On-Chain Anchored Hash (Sepolia):</strong>{" "}
              <span className="mono">
                {verifyResponse.details?.anchoredHash ?? "Not Found"}
              </span>
            </p>
            {verifyResponse.details?.issuerAddress && (
              <p>
                <strong>Anchored Issuer Wallet:</strong>{" "}
                <span className="mono">
                  {verifyResponse.details.issuerAddress}
                </span>
              </p>
            )}
            {verifyResponse.details?.revocationTimestamp > 0 && (
              <p>
                <strong>Revoked On-Chain At:</strong>{" "}
                {new Date(
                  verifyResponse.details.revocationTimestamp * 1000,
                ).toUTCString()}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function LogsPage() {
  const [logs, setLogs] = useState<VerificationLogRow[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/logs`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setLogs(data);
      })
      .catch(console.error);
  }, []);

  return (
    <div className="card">
      <h2>
        Objective 3 Evaluation Logs
        (/logs)[span_26](start_span)[span_26](end_span)[span_27](start_span)[span_27](end_span)
      </h2>
      <p style={{ fontSize: "0.86rem", color: "#4a5568" }}>
        Automatically records every verification test scenario, outcome, and
        response time (ms) for Section 3.2.4
        evaluation[span_28](start_span)[span_28](end_span)[span_29](start_span)[span_29](end_span).
      </p>
      <table>
        <thead>
          <tr>
            <th>Log ID</th>
            <th>Reference Code</th>
            <th>Scenario Tested</th>
            <th>Verification Outcome</th>
            <th>Response Time (ms)</th>
            <th>Timestamp</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((L) => (
            <tr key={L.log_id}>
              <td>#{L.log_id}</td>
              <td className="mono">{L.reference_code}</td>
              <td>
                <strong>{L.scenario_type}</strong>
              </td>
              <td>
                <span
                  className={`badge ${
                    L.result === "GENUINE_AND_ACTIVE"
                      ? "badge-green"
                      : L.result === "GENUINE_BUT_REVOKED"
                        ? "badge-amber"
                        : "badge-red"
                  }`}
                >
                  {L.result}
                </span>
              </td>
              <td>
                <strong>{L.response_time_ms} ms</strong>
              </td>
              <td>{new Date(L.timestamp).toLocaleString()}</td>
            </tr>
          ))}
          {logs.length === 0 && (
            <tr>
              <td colSpan={6}>No verification attempts logged yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function App() {
  const [walletAddress, setWalletAddress] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>(
    DEFAULT_CONTRACT_ADDRESS,
  );
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [backendError, setBackendError] = useState<string | null>(null);

  useEffect(() => {
    fetchHealthAndInstitutions();
    checkAlreadyConnectedWallet();
  }, []);

  async function checkAlreadyConnectedWallet() {
    const ethereum = (window as any).ethereum;
    if (ethereum) {
      try {
        const accounts = await ethereum.request({ method: "eth_accounts" });
        if (accounts && accounts.length > 0) {
          setWalletAddress(accounts[0]);
        }
      } catch (e) {
        console.error(e);
      }
    }
  }

  async function fetchHealthAndInstitutions() {
    setBackendError(null);
    try {
      const [hRes, iRes] = await Promise.all([
        fetch(`${API_BASE}/health`),
        fetch(`${API_BASE}/institutions`),
      ]);
      if (hRes.ok) {
        const hData = await hRes.json();
        if (hData.contractAddress) setContractAddress(hData.contractAddress);
      }
      const iData = await iRes.json();
      if (!iRes.ok) {
        setBackendError(
          iData.error ?? "Failed to fetch institutions from PostgreSQL",
        );
      } else if (Array.isArray(iData)) {
        setInstitutions(iData);
      }
    } catch (err: any) {
      setBackendError(`Cannot reach backend at ${API_BASE}: ${err.message}`);
    }
  }

  async function connectWallet() {
    const ethereum = (window as any).ethereum;
    if (!ethereum) {
      alert(
        "MetaMask is not installed. Please install MetaMask to act as an Issuing Institution.",
      );
      return;
    }
    try {
      const accounts = await ethereum.request({
        method: "eth_requestAccounts",
      });
      const chainId = await ethereum.request({ method: "eth_chainId" });
      if (chainId !== SEPOLIA_CHAIN_ID_HEX) {
        await ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }],
        });
      }
      setWalletAddress(accounts[0]);
    } catch (err: any) {
      alert(`Wallet connection error: ${err.message}`);
    }
  }

  return (
    <BrowserRouter>
      <div className="app-container">
        <Header
          walletAddress={walletAddress}
          connectWallet={connectWallet}
          contractAddress={contractAddress}
        />
        <Routes>
          <Route path="/" element={<Navigate to="/register" replace />} />
          <Route
            path="/register"
            element={
              <RegisterPage
                institutions={institutions}
                walletAddress={walletAddress}
                connectWallet={connectWallet}
                refreshInstitutions={fetchHealthAndInstitutions}
                backendError={backendError}
              />
            }
          />
          <Route
            path="/:university/issue_degree"
            element={
              <IssueDegreePage
                institutions={institutions}
                walletAddress={walletAddress}
                contractAddress={contractAddress}
              />
            }
          />
          <Route
            path="/verify"
            element={<VerifyPage institutions={institutions} />}
          />
          <Route path="/logs" element={<LogsPage />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
