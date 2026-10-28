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

/* ---------- Presentation helpers ---------- */

type Tone = "ok" | "warn" | "bad";

function outcomeMeta(result: string): {
  tone: Tone;
  title: string;
  text: string;
} {
  switch (result) {
    case "GENUINE_AND_ACTIVE":
      return {
        tone: "ok",
        title: "Genuine and active",
        text: "The details you entered match the record anchored on-chain.",
      };
    case "GENUINE_BUT_REVOKED":
      return {
        tone: "warn",
        title: "Genuine but revoked",
        text: "The details match, but the issuing institution has revoked this credential.",
      };
    default:
      return {
        tone: "bad",
        title: "Mismatch or not found",
        text: "No on-chain record matches these details. Check each field against the certificate.",
      };
  }
}

function sentence(s: string) {
  const t = s.replace(/_/g, " ").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function shortAddr(a: string, head = 6, tail = 4) {
  return `${a.slice(0, head)}...${a.slice(-tail)}`;
}

function ToneIcon({ tone, size = 24 }: { tone: Tone; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (tone === "ok")
    return (
      <svg {...common}>
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    );
  if (tone === "warn")
    return (
      <svg {...common}>
        <path d="M12 7v6M12 17h.01" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M7 7l10 10M17 7L7 17" />
    </svg>
  );
}

function BrandMark() {
  return (
    <svg
      className="brand-mark"
      width="38"
      height="38"
      viewBox="0 0 38 38"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="19" cy="19" r="17.5" fill="#0e2a47" />
      <circle cx="19" cy="19" r="14" stroke="#d9a400" strokeWidth="1.5" />
      <path
        d="M12.5 19.5l4.2 4.2 8.8-9.2"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

function PageHead({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </div>
  );
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: Tone;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`notice tone-${tone}`}
      role={tone === "bad" ? "alert" : "status"}
    >
      {title && <strong>{title}</strong>}
      {children}
    </div>
  );
}

function BackLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="back-link">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M15 5l-7 7 7 7" />
      </svg>
      {children}
    </Link>
  );
}

/* ---------- Top bar and footer ---------- */

// Context-aware header: hides internal navigation on the public /verify page
function Header({
  walletAddress,
  connectWallet,
}: {
  walletAddress: string;
  connectWallet: () => Promise<void>;
}) {
  const location = useLocation();
  const isVerifierPage = location.pathname.startsWith("/verify");
  const isPortalActive =
    location.pathname === "/register"
      ? true
      : location.pathname.includes("/issue_degree");

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to="/register" className="brand">
          <BrandMark />
          <span>
            <span className="brand-name">Rwanda Credential Verification</span>
            <span className="brand-sub">Anchored on Ethereum Sepolia</span>
          </span>
        </Link>

        {!isVerifierPage && (
          <nav className="nav" aria-label="Main">
            <Link
              to="/register"
              className={`nav-link ${isPortalActive ? "active" : ""}`}
            >
              Institution portal
            </Link>
            <Link
              to="/verify"
              className={`nav-link ${isVerifierPage ? "active" : ""}`}
            >
              Public verifier
            </Link>
            <Link
              to="/logs"
              className={`nav-link ${location.pathname.startsWith("/logs") ? "active" : ""}`}
            >
              Evaluation logs
            </Link>
          </nav>
        )}

        {!isVerifierPage && (
          <div className="topbar-actions">
            {walletAddress ? (
              <span className="wallet-pill" title={walletAddress}>
                {shortAddr(walletAddress)}
              </span>
            ) : (
              <button className="btn btn-sm" onClick={connectWallet}>
                Connect MetaMask
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

function Footer({ contractAddress }: { contractAddress: string }) {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <span>Registry contract on Sepolia</span>
        <a
          href={`https://sepolia.etherscan.io/address/${contractAddress}`}
          target="_blank"
          rel="noreferrer"
        >
          {contractAddress}
        </a>
      </div>
    </footer>
  );
}

/* ---------- Register ---------- */

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
    <>
      <PageHead title="Institution onboarding">
        Institutions are checked against simulated HEC and NCNM accreditation
        records. Only accredited institutions can bind a registrar wallet and
        open their issuing portal.
      </PageHead>

      {backendError && (
        <Notice tone="bad" title="Backend connection issue.">
          {backendError}
        </Notice>
      )}

      <div className="stack">
        <section className="panel">
          <h2 className="panel-title">Bind your registrar wallet</h2>
          <p className="panel-text">
            Choose your institution, connect MetaMask, then confirm
            accreditation.
          </p>

          <form onSubmit={handleRegister}>
            <div className="inline-form">
              <label className="field">
                <span className="field-label">Institution</span>
                <select
                  value={selectedCode}
                  onChange={(e) => setSelectedCode(e.target.value)}
                >
                  {institutions.map((inst) => (
                    <option key={inst.code} value={inst.code}>
                      {inst.code} - {inst.name} ({inst.accreditation_status})
                    </option>
                  ))}
                </select>
              </label>

              {!walletAddress ? (
                <button
                  type="button"
                  className="btn btn-blue"
                  onClick={connectWallet}
                >
                  Connect MetaMask wallet
                </button>
              ) : (
                <button
                  type="submit"
                  className="btn btn-blue"
                  disabled={loading ? true : institutions.length === 0}
                >
                  {loading && <Spinner />}
                  {loading
                    ? "Checking accreditation"
                    : "Verify accreditation and continue"}
                </button>
              )}
            </div>
          </form>

          {statusMsg && (
            <Notice tone={statusMsg.type === "ok" ? "ok" : "bad"}>
              {statusMsg.text}
            </Notice>
          )}
        </section>

        <section className="panel">
          <h2 className="panel-title">Registered institutions</h2>
          <p className="panel-text">
            Each accredited institution with a bound wallet has its own issuing
            portal.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Institution</th>
                  <th>Accreditation</th>
                  <th>Registrar wallet</th>
                  <th>Portal</th>
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
                            ? "tone-ok"
                            : "tone-bad"
                        }`}
                      >
                        {sentence(i.accreditation_status)}
                      </span>
                    </td>
                    <td className="mono">
                      {i.wallet_address
                        ? shortAddr(i.wallet_address, 8, 6)
                        : "Not registered yet"}
                    </td>
                    <td>
                      {i.accreditation_status === "ACCREDITED" &&
                      i.wallet_address ? (
                        <Link
                          to={`/${i.code}/issue_degree`}
                          className="btn btn-ghost btn-sm"
                        >
                          Open portal
                        </Link>
                      ) : (
                        <span className="muted">
                          {i.accreditation_status === "UNACCREDITED"
                            ? "Blocked, unaccredited"
                            : "Bind a wallet first"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {institutions.length === 0 && (
                  <tr>
                    <td colSpan={5} className="cell-empty">
                      No institutions loaded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

/* ---------- Issue degree ---------- */

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
      <>
        <BackLink to="/register">Back to institution onboarding</BackLink>
        <section className="panel">
          <h2 className="panel-title">Access denied for {uniCode}</h2>
          <p className="panel-text">
            {currentInst.name} ({uniCode}) is marked as unaccredited in the
            simulated HEC and NCNM registry, so it cannot issue credentials.
          </p>
          <Link to="/register" className="btn">
            Return to onboarding
          </Link>
        </section>
      </>
    );
  }

  return (
    <>
      <BackLink to="/register">Back to institution onboarding</BackLink>

      <PageHead title="Issue a credential">
        Issuing as {currentInst ? `${currentInst.name} (${uniCode})` : uniCode}.
        Registered wallet:{" "}
        <span className="mono">
          {currentInst?.wallet_address ?? "Not bound"}
        </span>
      </PageHead>

      <div className="stack">
        <section className="panel">
          <h2 className="panel-title">Certificate details</h2>
          <p className="panel-text">
            Enter the fields exactly as printed. They are salted and hashed, and
            only the hash is written to the chain.
          </p>

          <form onSubmit={handleIssueCredential}>
            <div className="field-grid">
              <label className="field">
                <span className="field-label">Institution code</span>
                <input type="text" value={uniCode} disabled />
                <span className="field-hint">Set by the portal route.</span>
              </label>

              <label className="field">
                <span className="field-label">Certificate ID</span>
                <input
                  type="text"
                  placeholder="e.g. 220001624"
                  value={issueForm.credentialId}
                  onChange={(e) =>
                    setIssueForm({ ...issueForm, credentialId: e.target.value })
                  }
                />
                <span className="field-hint">
                  Leave blank to auto-generate a reference code.
                </span>
              </label>

              <label className="field">
                <span className="field-label">Holder full name *</span>
                <input
                  type="text"
                  required
                  placeholder="e.g. DUKUNDIMANA DESIRE"
                  value={issueForm.holderName}
                  onChange={(e) =>
                    setIssueForm({ ...issueForm, holderName: e.target.value })
                  }
                />
              </label>

              <label className="field">
                <span className="field-label">Degree or license title *</span>
                <input
                  type="text"
                  required
                  placeholder="e.g. BACHELOR OF EDUCATION WITH HONOURS"
                  value={issueForm.degreeTitle}
                  onChange={(e) =>
                    setIssueForm({ ...issueForm, degreeTitle: e.target.value })
                  }
                />
              </label>

              <label className="field span-2">
                <span className="field-label">Programme or specialization</span>
                <input
                  type="text"
                  placeholder="e.g. FOUNDATIONS OF EDUCATION AND ENGLISH"
                  value={issueForm.programme}
                  onChange={(e) =>
                    setIssueForm({ ...issueForm, programme: e.target.value })
                  }
                />
                <span className="field-hint">Optional.</span>
              </label>

              <label className="field">
                <span className="field-label">Classification *</span>
                <select
                  value={issueForm.classification}
                  onChange={(e) =>
                    setIssueForm({
                      ...issueForm,
                      classification: e.target.value,
                    })
                  }
                >
                  {CLASSIFICATIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span className="field-label">Award date *</span>
                <input
                  type="date"
                  required
                  value={issueForm.awardDate}
                  onChange={(e) =>
                    setIssueForm({ ...issueForm, awardDate: e.target.value })
                  }
                />
              </label>
            </div>

            <div className="form-actions">
              <button
                type="submit"
                className="btn btn-blue"
                disabled={issuingLoading}
              >
                {issuingLoading && <Spinner />}
                {issuingLoading
                  ? "Waiting for MetaMask signature"
                  : "Hash and sign with MetaMask"}
              </button>
              {issuingLoading && (
                <span className="muted">
                  Generating the salted hash, then waiting for your signature.
                </span>
              )}
            </div>
          </form>

          {issueError && (
            <Notice tone="bad" title="Issuance failed.">
              {issueError}
            </Notice>
          )}
        </section>

        {issuedResult && (
          <section className="panel">
            <div className="verdict tone-ok">
              <span className="verdict-icon">
                <ToneIcon tone="ok" />
              </span>
              <div>
                <h3>Credential anchored on Sepolia</h3>
                <p>
                  Write the reference code on the document so anyone can verify
                  it.
                </p>
              </div>
            </div>

            <div className="issued-grid">
              <dl className="facts">
                <div className="fact">
                  <dt>Reference code</dt>
                  <dd className="mono">{issuedResult.referenceCode}</dd>
                </div>
                <div className="fact">
                  <dt>Salted SHA-256 hash</dt>
                  <dd>
                    <span className="hash">{issuedResult.credentialHash}</span>
                  </dd>
                </div>
                <div className="fact">
                  <dt>Transaction</dt>
                  <dd>
                    <a
                      href={`https://sepolia.etherscan.io/tx/${issuedResult.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mono"
                    >
                      {issuedResult.txHash}
                    </a>
                  </dd>
                </div>
                <div className="fact">
                  <dt>Gas used</dt>
                  <dd>{issuedResult.gasUsed}</dd>
                </div>
              </dl>

              <div className="qr">
                <img src={issuedResult.qrCodeDataUrl} alt="Credential QR code" />
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    navigate(
                      `/verify?ref=${encodeURIComponent(
                        issuedResult.referenceCode,
                      )}&inst=${encodeURIComponent(uniCode)}`,
                    )
                  }
                >
                  Open in public verifier
                </button>
              </div>
            </div>
          </section>
        )}

        <section className="panel">
          <h2 className="panel-title">Credentials issued by {uniCode}</h2>
          <p className="panel-text">
            Revoking a credential writes the revocation to the chain and needs a
            MetaMask signature.
          </p>

          {revokeMsg && <Notice tone="warn">{revokeMsg}</Notice>}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Reference code</th>
                  <th>Anchored hash</th>
                  <th>Holder reference</th>
                  <th>Award date</th>
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
                    <td>{String(c.issuance_date).slice(0, 10)}</td>
                    <td>
                      <button
                        className="btn btn-danger btn-sm"
                        disabled={revokingHash === c.credential_hash}
                        onClick={() =>
                          handleRevokeCredential(
                            c.credential_hash,
                            c.reference_code,
                          )
                        }
                      >
                        {revokingHash === c.credential_hash && <Spinner />}
                        {revokingHash === c.credential_hash
                          ? "Revoking"
                          : "Revoke on-chain"}
                      </button>
                    </td>
                  </tr>
                ))}
                {credentials.length === 0 && (
                  <tr>
                    <td colSpan={5} className="cell-empty">
                      No credentials issued by {uniCode} yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

/* ---------- Public verifier ---------- */

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

  const meta = verifyResponse ? outcomeMeta(verifyResponse.result) : null;
  const recomputed = verifyResponse?.details?.recomputedHash;
  const anchored = verifyResponse?.details?.anchoredHash;
  const hashesMatch = !!recomputed && !!anchored && recomputed === anchored;

  return (
    <>
      <PageHead title="Verify a credential">
        Re-enter the fields printed on the certificate along with its reference
        code. No wallet or contact with the issuing institution is needed.
      </PageHead>

      <div className="split">
        <section className="panel">
          <h2 className="panel-title">Certificate details</h2>
          <p className="panel-text">
            Spelling and spacing must match the printed document.
          </p>

          <form onSubmit={handleVerifyCredential}>
            <div className="field-grid">
              <label className="field">
                <span className="field-label">Reference code *</span>
                <input
                  type="text"
                  required
                  placeholder="e.g. RW-UNIVA-2026-... or 220001624"
                  value={verifyForm.referenceCode}
                  onChange={(e) =>
                    setVerifyForm({
                      ...verifyForm,
                      referenceCode: e.target.value,
                    })
                  }
                />
              </label>

              <label className="field">
                <span className="field-label">Issuing institution *</span>
                <select
                  value={verifyForm.institution}
                  onChange={(e) =>
                    setVerifyForm({ ...verifyForm, institution: e.target.value })
                  }
                >
                  {institutions.map((inst) => (
                    <option key={inst.code} value={inst.code}>
                      {inst.code} - {inst.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field span-2">
                <span className="field-label">Holder full name *</span>
                <input
                  type="text"
                  required
                  placeholder="e.g. DUKUNDIMANA DESIRE"
                  value={verifyForm.holderName}
                  onChange={(e) =>
                    setVerifyForm({ ...verifyForm, holderName: e.target.value })
                  }
                />
              </label>

              <label className="field span-2">
                <span className="field-label">Degree or license title *</span>
                <input
                  type="text"
                  required
                  placeholder="e.g. BACHELOR OF EDUCATION WITH HONOURS"
                  value={verifyForm.degreeTitle}
                  onChange={(e) =>
                    setVerifyForm({
                      ...verifyForm,
                      degreeTitle: e.target.value,
                    })
                  }
                />
              </label>

              <label className="field span-2">
                <span className="field-label">Programme or specialization</span>
                <input
                  type="text"
                  placeholder="Leave blank if none is printed"
                  value={verifyForm.programme}
                  onChange={(e) =>
                    setVerifyForm({ ...verifyForm, programme: e.target.value })
                  }
                />
              </label>

              <label className="field">
                <span className="field-label">Classification *</span>
                <select
                  value={verifyForm.classification}
                  onChange={(e) =>
                    setVerifyForm({
                      ...verifyForm,
                      classification: e.target.value,
                    })
                  }
                >
                  {CLASSIFICATIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span className="field-label">Award date *</span>
                <input
                  type="date"
                  required
                  value={verifyForm.awardDate}
                  onChange={(e) =>
                    setVerifyForm({ ...verifyForm, awardDate: e.target.value })
                  }
                />
              </label>
            </div>

            <h3 className="section-title">Evaluation</h3>
            <label className="field">
              <span className="field-label">Scenario tag</span>
              <select
                value={verifyForm.scenarioType}
                onChange={(e) =>
                  setVerifyForm({ ...verifyForm, scenarioType: e.target.value })
                }
              >
                <option value="GENUINE">Genuine (unaltered credential)</option>
                <option value="TAMPERED">
                  Tampered (real reference code, altered field)
                </option>
                <option value="FABRICATED">
                  Fabricated (never issued, fake reference code)
                </option>
                <option value="REVOKED">
                  Revoked (issued, then revoked on-chain)
                </option>
              </select>
              <span className="field-hint">
                Saved to the evaluation logs with the outcome and response time.
              </span>
            </label>

            <div className="form-actions">
              <button
                type="submit"
                className="btn btn-blue"
                disabled={verifyLoading}
              >
                {verifyLoading && <Spinner />}
                {verifyLoading ? "Checking Sepolia" : "Verify credential"}
              </button>
            </div>
          </form>

          {verifyError && (
            <Notice tone="bad" title="Verification failed.">
              {verifyError}
            </Notice>
          )}
        </section>

        <section className="panel sticky" aria-live="polite">
          <h2 className="panel-title">Verification result</h2>
          <p className="panel-text">
            The salted SHA-256 hash is recomputed and compared with the record
            on the Sepolia contract.
          </p>

          {verifyLoading && (
            <div className="empty">
              <Spinner />
              <p>Recomputing the hash and querying the blockchain.</p>
            </div>
          )}

          {!verifyLoading && !verifyResponse && (
            <div className="empty">
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6l8-3z" />
                <path d="M9 12l2.2 2.2L15.5 10" />
              </svg>
              <p>
                Submit the certificate details and the result will appear here.
              </p>
            </div>
          )}

          {!verifyLoading && verifyResponse && meta && (
            <>
              <div className={`verdict tone-${meta.tone}`}>
                <span className="verdict-icon">
                  <ToneIcon tone={meta.tone} />
                </span>
                <div>
                  <h3>{meta.title}</h3>
                  <p>{meta.text}</p>
                </div>
              </div>

              <dl className="facts">
                <div className="fact">
                  <dt>Reference code</dt>
                  <dd className="mono">{verifyResponse.referenceCode}</dd>
                </div>
                <div className="fact">
                  <dt>Response time</dt>
                  <dd>
                    {verifyResponse.responseTimeMs} ms (
                    {(verifyResponse.responseTimeMs / 1000).toFixed(2)} s)
                  </dd>
                </div>
                <div className="fact">
                  <dt>Recomputed hash</dt>
                  <dd>
                    <span className="hash">{recomputed ?? "N/A"}</span>
                  </dd>
                </div>
                <div className="fact">
                  <dt>On-chain hash</dt>
                  <dd>
                    <span className="hash">{anchored ?? "Not found"}</span>
                    {recomputed && anchored && (
                      <span
                        className={`match-line ${hashesMatch ? "tone-ok" : "tone-bad"}`}
                      >
                        {hashesMatch ? "Hashes match" : "Hashes differ"}
                      </span>
                    )}
                  </dd>
                </div>
                {verifyResponse.details?.issuerAddress && (
                  <div className="fact">
                    <dt>Issuer wallet</dt>
                    <dd className="mono">
                      {verifyResponse.details.issuerAddress}
                    </dd>
                  </div>
                )}
                {verifyResponse.details?.revocationTimestamp > 0 && (
                  <div className="fact">
                    <dt>Revoked at</dt>
                    <dd>
                      {new Date(
                        verifyResponse.details.revocationTimestamp * 1000,
                      ).toUTCString()}
                    </dd>
                  </div>
                )}
              </dl>
            </>
          )}
        </section>
      </div>
    </>
  );
}

/* ---------- Logs ---------- */

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

  const avgMs =
    logs.length > 0
      ? Math.round(
          logs.reduce((sum, l) => sum + Number(l.response_time_ms), 0) /
            logs.length,
        )
      : 0;
  const genuineCount = logs.filter(
    (l) => l.result === "GENUINE_AND_ACTIVE",
  ).length;

  return (
    <>
      <PageHead title="Evaluation logs">
        Every verification attempt is recorded with its test scenario, outcome
        and response time, ready for the Section 3.2.4 evaluation.
      </PageHead>

      <div className="stats">
        <div className="stat">
          <span className="stat-value">{logs.length}</span>
          <span className="stat-label">Verifications logged</span>
        </div>
        <div className="stat">
          <span className="stat-value">{logs.length ? `${avgMs} ms` : "-"}</span>
          <span className="stat-label">Average response time</span>
        </div>
        <div className="stat">
          <span className="stat-value">{genuineCount}</span>
          <span className="stat-label">Genuine and active</span>
        </div>
      </div>

      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Log ID</th>
                <th>Reference code</th>
                <th>Scenario</th>
                <th>Outcome</th>
                <th>Response time</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((L) => (
                <tr key={L.log_id}>
                  <td>#{L.log_id}</td>
                  <td className="mono">{L.reference_code}</td>
                  <td>{sentence(L.scenario_type)}</td>
                  <td>
                    <span
                      className={`badge tone-${outcomeMeta(L.result).tone}`}
                      title={L.result}
                    >
                      {outcomeMeta(L.result).title}
                    </span>
                  </td>
                  <td>{L.response_time_ms} ms</td>
                  <td>{new Date(L.timestamp).toLocaleString()}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={6} className="cell-empty">
                    No verification attempts logged yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/* ---------- App ---------- */

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
      <div className="app-shell">
        <Header walletAddress={walletAddress} connectWallet={connectWallet} />
        <main className="page">
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
        </main>
        <Footer contractAddress={contractAddress} />
      </div>
    </BrowserRouter>
  );
}
