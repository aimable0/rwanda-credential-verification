import React, { useEffect, useRef, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  useNavigate,
  useParams,
  useSearchParams,
  useLocation,
} from "react-router-dom";
import { ethers } from "ethers";
import "./App.css";

// Local dev talks to the backend directly. A production build sets VITE_API_BASE=/api.
const API_BASE: string =
  import.meta.env.VITE_API_BASE ?? "http://localhost:4000/api";
const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7";
const DEFAULT_CONTRACT_ADDRESS = "0xAaf295EB2b31AC3eFeB0961e0f7E403A462ea590";

const REGISTRY_ABI = [
  "function issueCredential(bytes32 _credentialHash, string calldata _referenceCode) external",
  "function revokeCredential(bytes32 _credentialHash) external",
  "function accreditIssuer(address _issuer) external",
  "function suspendIssuer(address _issuer) external",
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
  requested_at?: string | null;
  decided_at?: string | null;
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
  revoked_at?: number | null; // unix seconds when revoked on-chain, null if active
}

interface VerificationLogRow {
  log_id: number;
  reference_code: string;
  scenario_type: string;
  result: string;
  timestamp: string;
  response_time_ms: number;
}

type AuthFetch = (url: string, init?: RequestInit) => Promise<Response>;

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

function sameAddress(a?: string | null, b?: string | null) {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

// Stored reference codes look like "UNIVA-220001624". Show only the certificate number.
function certNumberOf(referenceCode: string, institutionCode: string) {
  const prefix = `${institutionCode}-`;
  return referenceCode.startsWith(prefix)
    ? referenceCode.slice(prefix.length)
    : referenceCode;
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
      <circle
        cx="19"
        cy="19"
        r="17.5"
        fill="#0e2a47"
        style={{ fill: "var(--mark-bg)" }}
      />
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

/* ---------- Theme ---------- */

type Theme = "light" | "dark";

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem("theme");
      if (saved === "light" || saved === "dark") return saved;
    } catch {
      /* storage unavailable */
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);

  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))];
}

function ThemeToggle({
  theme,
  onToggle,
}: {
  theme: Theme;
  onToggle: () => void;
}) {
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={onToggle}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {theme === "dark" ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        ) : (
          <path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z" />
        )}
      </svg>
    </button>
  );
}

/* ---------- Top bar and footer ---------- */

type Area = "landing" | "verifier" | "institution" | "admin" | "other";

// Each role gets its own area, header and navigation
function areaFor(pathname: string): Area {
  if (pathname === "/") return "landing";
  if (pathname.startsWith("/verify")) return "verifier";
  if (pathname.startsWith("/admin") || pathname.startsWith("/logs"))
    return "admin";
  if (pathname === "/register" || pathname.endsWith("/issue_degree"))
    return "institution";
  return "other"; // /about, /guide and unknown pages
}

function Header({
  walletAddress,
  institutions,
  connectWallet,
  theme,
  onToggleTheme,
}: {
  walletAddress: string;
  institutions: Institution[];
  connectWallet: () => Promise<void>;
  theme: Theme;
  onToggleTheme: () => void;
}) {
  const path = useLocation().pathname;
  const area = areaFor(path);
  const myInst = institutions.find(
    (i) =>
      sameAddress(i.wallet_address, walletAddress) &&
      i.accreditation_status === "ACCREDITED",
  );
  const link = (to: string, active: boolean, label: string) => (
    <Link to={to} className={`nav-link ${active ? "active" : ""}`}>
      {label}
    </Link>
  );

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to="/" className="brand">
          <BrandMark />
          <span>
            <span className="brand-name">Rwanda Credential Verification</span>
            <span className="brand-sub">Anchored on Ethereum Sepolia</span>
          </span>
        </Link>

        {area === "institution" && (
          <nav className="nav" aria-label="Institution">
            {link("/register", path === "/register", "My institution")}
            {myInst &&
              link(
                `/${myInst.code}/issue_degree`,
                path.endsWith("/issue_degree"),
                "Issue credentials",
              )}
          </nav>
        )}

        {area === "admin" && (
          <nav className="nav" aria-label="HEC admin">
            {link("/admin", path.startsWith("/admin"), "Applications")}
            {link("/logs", path.startsWith("/logs"), "Evaluation logs")}
          </nav>
        )}

        <div className="topbar-actions">
          {area === "verifier" && (
            <Link to="/" className="btn btn-ghost btn-sm">
              Institution or HEC sign in
            </Link>
          )}
          {(area === "institution" || area === "admin") &&
            (walletAddress ? (
              <button
                type="button"
                className="wallet-pill"
                onClick={connectWallet}
                title={`${walletAddress}. Click to switch MetaMask account`}
              >
                {shortAddr(walletAddress)}
              </button>
            ) : (
              <button className="btn btn-sm" onClick={connectWallet}>
                Connect MetaMask
              </button>
            ))}
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </div>
      </div>
    </header>
  );
}

/* ---------- Landing ---------- */

function Landing() {
  return (
    <>
      <PageHead title="Rwanda Credential Verification">
        Degrees and licences are anchored on Ethereum Sepolia by institutions
        that HEC has accredited. Choose how you want to use the platform.
      </PageHead>

      <div className="role-grid">
        <section className="role-card">
          <h2 className="panel-title">Verify a credential</h2>
          <p className="panel-text">
            For employers, schools and anyone checking a certificate. No wallet
            or account is needed.
          </p>
          <Link to="/verify" className="btn btn-blue">
            Verify a credential
          </Link>
        </section>

        <section className="role-card">
          <h2 className="panel-title">Institution</h2>
          <p className="panel-text">
            Apply for HEC accreditation, then issue and revoke credentials.
            Needs your institution's MetaMask wallet.
          </p>
          <Link to="/register" className="btn">
            Institution sign in
          </Link>
        </section>

        <section className="role-card">
          <h2 className="panel-title">HEC admin</h2>
          <p className="panel-text">
            Review applications, accredit or suspend institutions, and read the
            evaluation logs. Needs the HEC wallet.
          </p>
          <Link to="/admin" className="btn">
            HEC sign in
          </Link>
        </section>
      </div>

      <p className="muted" style={{ marginTop: 24 }}>
        New here? Read the <Link to="/guide">user guide</Link> or see{" "}
        <Link to="/about">how it works</Link>.
      </p>
    </>
  );
}

/* ---------- Footer ---------- */

function Footer({ contractAddress }: { contractAddress: string }) {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <nav className="footer-links" aria-label="More">
          <Link to="/about">About</Link>
          <Link to="/guide">User guide</Link>
        </nav>
        <span>
          Registry contract on Sepolia{" "}
          <a
            className="footer-contract"
            href={`https://sepolia.etherscan.io/address/${contractAddress}`}
            target="_blank"
            rel="noreferrer"
          >
            {contractAddress}
          </a>
        </span>
        <span className="footer-credit">
          Made by Aimable Nkurikiyimana © 2026
        </span>
      </div>
    </footer>
  );
}

/* ---------- About, guide and 404 ---------- */

function AboutPage() {
  return (
    <>
      <PageHead title="About the platform">
        The Rwanda Credential Verification System lets anyone check that a
        degree or professional licence is real, unchanged and still valid,
        without contacting the institution that issued it.
      </PageHead>

      <div className="stack">
        <section className="panel">
          <h2 className="panel-title">How it works</h2>
          <p className="panel-text">
            Each credential is turned into a fingerprint, and only the
            fingerprint is recorded on the blockchain.
          </p>
          <ol className="steps">
            <li>
              <strong>An accredited institution enters the certificate.</strong>
              <span>
                It enters seven fields: institution, certificate number, holder
                name, degree or licence title, programme, classification and
                award date.
              </span>
            </li>
            <li>
              <strong>The system computes a SHA-256 hash.</strong>
              <span>
                The unique certificate number is one of the hashed fields. It
                plays the part a random salt would, so no two credentials hash
                from the same input.
              </span>
            </li>
            <li>
              <strong>The hash is anchored on Ethereum Sepolia.</strong>
              <span>
                The institution signs a transaction with its MetaMask wallet.
                The contract stores the hash, the certificate number with the
                institution code in front, the issuing wallet and the time.
              </span>
            </li>
            <li>
              <strong>Anyone can verify it.</strong>
              <span>
                The verifier re-enters the printed fields. The system hashes
                them again, compares the result with the record on the
                contract, and checks whether the credential was revoked.
              </span>
            </li>
          </ol>
        </section>

        <div className="role-grid">
          <section className="role-card">
            <h2 className="panel-title">Zero-storage privacy</h2>
            <p className="panel-text">
              No names, degree titles or dates are written to the blockchain,
              only a hash and the certificate number. The database keeps no
              personal documents either.
            </p>
          </section>
          <section className="role-card">
            <h2 className="panel-title">Tamper-evident proof</h2>
            <p className="panel-text">
              Changing any single field, even one letter, produces a different
              hash. An altered certificate fails verification.
            </p>
          </section>
          <section className="role-card">
            <h2 className="panel-title">Verified issuers</h2>
            <p className="panel-text">
              The contract accepts records only from wallets that HEC has
              accredited, and the verifier sees which institution issued the
              credential.
            </p>
          </section>
        </div>

        <section className="panel">
          <h2 className="panel-title">Gated onboarding</h2>
          <p className="panel-text">
            Institutions cannot join on their own. Accreditation is controlled
            by HEC, with licensing bodies such as NCNM handled through the same
            registry.
          </p>
          <ol className="steps">
            <li>
              <strong>The institution applies</strong>
              <span>
                It connects its registrar wallet and applies. The request waits
                as pending.
              </span>
            </li>
            <li>
              <strong>HEC reviews the request</strong>
              <span>
                The HEC admin wallet approves or rejects it. Approval is a
                transaction that adds the institution's wallet to the
                accredited issuer list on the contract.
              </span>
            </li>
            <li>
              <strong>The institution can issue</strong>
              <span>
                Wallets that are not on the list cannot anchor credentials,
                even by calling the contract directly. HEC can suspend an
                institution later, which stops new credentials but keeps the
                existing ones valid.
              </span>
            </li>
          </ol>
        </section>

        <section className="panel">
          <h2 className="panel-title">Limits</h2>
          <p className="panel-text" style={{ marginBottom: 0 }}>
            This is a prototype that runs on the Sepolia test network. It
            confirms that a certificate's details match a record anchored by an
            accredited institution. It does not confirm who is presenting the
            certificate. The certificate number is stored on the chain in
            plain form, with the institution code in front, because it is part
            of the reference code.
          </p>
        </section>
      </div>
    </>
  );
}

function GuidePage() {
  return (
    <>
      <PageHead title="User guide">
        Institutions follow the first list. Anyone checking a certificate
        follows the second and needs no wallet or account.
      </PageHead>

      <div className="two-col">
        <section className="panel">
          <h2 className="panel-title">For institutions</h2>
          <p className="panel-text">Issuing and revoking credentials.</p>
          <ol className="steps">
            <li>
              <strong>Set up MetaMask</strong>
              <span>
                Install MetaMask and use the account that will act as your
                registrar. You need a little Sepolia test ETH for gas.
              </span>
            </li>
            <li>
              <strong>Open the institution page</strong>
              <span>
                Choose Institution sign in and connect MetaMask. The app
                switches you to the Sepolia network.
              </span>
            </li>
            <li>
              <strong>Apply for accreditation</strong>
              <span>
                Pick your institution and select Apply to HEC. Its status shows
                as pending.
              </span>
            </li>
            <li>
              <strong>Wait for HEC to approve</strong>
              <span>
                When the status changes to accredited, Issue credentials
                appears in the menu.
              </span>
            </li>
            <li>
              <strong>Sign in and issue</strong>
              <span>
                Sign in with MetaMask (a free signature). Enter the certificate
                details exactly as printed, including the unique certificate
                number, then select Hash and sign with MetaMask and confirm the
                transaction.
              </span>
            </li>
            <li>
              <strong>Add the QR code to the certificate</strong>
              <span>
                The result shows a QR code and the certificate number. Print the
                QR code on the document so verifiers can find the record.
              </span>
            </li>
            <li>
              <strong>Revoke if needed</strong>
              <span>
                In the list of issued credentials, select Revoke on-chain and
                confirm in MetaMask. A revocation cannot be undone.
              </span>
            </li>
          </ol>
        </section>

        <section className="panel">
          <h2 className="panel-title">For verifiers</h2>
          <p className="panel-text">Checking a certificate.</p>
          <ol className="steps">
            <li>
              <strong>Scan the QR code</strong>
              <span>
                Use a phone camera. The verify page opens with the certificate
                number and institution already filled in. Without a QR code,
                open Verify a credential and type the certificate number.
              </span>
            </li>
            <li>
              <strong>Enter the printed details</strong>
              <span>
                Type the holder name, degree or licence title, programme (if
                printed), classification and award date as they appear on the
                certificate. Capital letters and extra spaces do not matter.
                Spelling does.
              </span>
            </li>
            <li>
              <strong>Select Verify credential</strong>
              <span>
                Leave the evaluation scenario tag on Genuine. It is only used
                for testing.
              </span>
            </li>
            <li>
              <strong>Read the result</strong>
              <span>
                <b>Genuine and active</b> means the details match a record from
                an accredited institution and it has not been revoked.{" "}
                <b>Genuine but revoked</b> means the record is real, but the
                institution withdrew it. <b>Mismatch or not found</b> means no
                record matches. Check every field against the certificate, and
                if it still fails, treat the certificate as unverified and
                contact the institution.
              </span>
            </li>
          </ol>
          <div className="form-actions">
            <Link to="/verify" className="btn btn-blue">
              Verify a credential
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}

function NotFoundPage() {
  const { pathname } = useLocation();
  return (
    <section className="panel notfound">
      <span className="notfound-code">404</span>
      <h1 className="panel-title">Page not found</h1>
      <p className="panel-text" style={{ marginBottom: 0 }}>
        There is no page at <span className="mono">{pathname}</span>.
      </p>
      <div className="form-actions">
        <Link to="/" className="btn">
          Go to the home page
        </Link>
        <Link to="/verify" className="btn btn-ghost">
          Verify a credential
        </Link>
      </div>
    </section>
  );
}

/* ---------- Accreditation status ---------- */

const STATUS_META: Record<string, { label: string; tone: Tone | "muted" }> = {
  UNREGISTERED: { label: "Not registered", tone: "muted" },
  PENDING: { label: "Pending HEC review", tone: "warn" },
  ACCREDITED: { label: "Accredited", tone: "ok" },
  REJECTED: { label: "Rejected", tone: "bad" },
  SUSPENDED: { label: "Suspended", tone: "bad" },
};

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? {
    label: sentence(status),
    tone: "muted" as const,
  };
  return <span className={`badge tone-${m.tone}`}>{m.label}</span>;
}

/* ---------- Register ---------- */

function RegisterPage({
  institutions,
  walletAddress,
  hecAddress,
  connectWallet,
  refreshInstitutions,
  backendError,
  authFetch,
}: {
  institutions: Institution[];
  walletAddress: string;
  hecAddress: string | null;
  connectWallet: () => Promise<void>;
  refreshInstitutions: () => Promise<void>;
  backendError: string | null;
  authFetch: AuthFetch;
}) {
  const [selectedCode, setSelectedCode] = useState<string>("UNIVA");
  const [statusMsg, setStatusMsg] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const selectedInst = institutions.find((i) => i.code === selectedCode);
  const isHec = sameAddress(walletAddress, hecAddress);
  const status = selectedInst?.accreditation_status ?? "UNREGISTERED";
  const mine = sameAddress(walletAddress, selectedInst?.wallet_address);
  const myInstitutions = institutions.filter((i) =>
    sameAddress(walletAddress, i.wallet_address),
  );
  const canApply =
    !!walletAddress &&
    !isHec &&
    (status === "UNREGISTERED" || status === "REJECTED");

  let hint: { tone: Tone; text: string } | null = null;
  if (isHec) {
    hint = {
      tone: "warn",
      text: "You are connected as the HEC wallet. Review applications on the HEC admin tab.",
    };
  } else if (status === "PENDING") {
    hint = {
      tone: "warn",
      text: mine
        ? "Your application is waiting for HEC review."
        : `${selectedCode} has a pending application from another wallet.`,
    };
  } else if (status === "ACCREDITED") {
    hint = mine
      ? { tone: "ok", text: "Accredited. Open your portal from the table below." }
      : {
          tone: "warn",
          text: `${selectedCode} is accredited under another wallet.`,
        };
  } else if (status === "SUSPENDED") {
    hint = {
      tone: "bad",
      text: `HEC has suspended ${selectedCode}. Contact HEC to be reinstated.`,
    };
  } else if (status === "REJECTED" && mine) {
    hint = {
      tone: "bad",
      text: "HEC rejected your last application. You can apply again.",
    };
  }

  useEffect(() => {
    if (
      institutions.length > 0 &&
      !institutions.find((i) => i.code === selectedCode)
    ) {
      setSelectedCode(institutions[0].code);
    }
  }, [institutions, selectedCode]);

  async function handleApply(e: React.FormEvent) {
    e.preventDefault();
    setStatusMsg(null);

    if (!walletAddress) {
      setStatusMsg({
        type: "err",
        text: "Please connect your institution's MetaMask wallet first.",
      });
      return;
    }

    setLoading(true);
    try {
      const res = await authFetch(`${API_BASE}/institutions/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: selectedCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg({
          type: "err",
          text: data.error ?? "Application failed",
        });
      } else {
        setStatusMsg({ type: "ok", text: data.message });
        await refreshInstitutions();
      }
    } catch (err: any) {
      setStatusMsg({ type: "err", text: err.shortMessage ?? err.message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageHead title="Institution portal">
        Apply for HEC accreditation with your registrar wallet. Once HEC
        approves, your wallet is added to the accredited issuer list on the
        contract and your issuing portal opens below.
      </PageHead>

      {backendError && (
        <Notice tone="bad" title="Backend connection issue.">
          {backendError}
        </Notice>
      )}

      <div className="stack">
        <section className="panel">
          <h2 className="panel-title">Apply for accreditation</h2>
          <p className="panel-text">
            Choose your institution and connect the wallet that will issue its
            credentials.
          </p>

          <form onSubmit={handleApply}>
            <div className="inline-form">
              <label className="field">
                <span className="field-label">Institution</span>
                <select
                  value={selectedCode}
                  onChange={(e) => setSelectedCode(e.target.value)}
                >
                  {institutions.map((inst) => (
                    <option key={inst.code} value={inst.code}>
                      {inst.code} - {inst.name} (
                      {STATUS_META[inst.accreditation_status]?.label ??
                        sentence(inst.accreditation_status)}
                      )
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
                  disabled={loading || !canApply}
                >
                  {loading && <Spinner />}
                  {loading ? "Sending application" : "Apply to HEC"}
                </button>
              )}
            </div>
          </form>

          {hint && <Notice tone={hint.tone}>{hint.text}</Notice>}

          {statusMsg && (
            <Notice tone={statusMsg.type === "ok" ? "ok" : "bad"}>
              {statusMsg.text}
            </Notice>
          )}
        </section>

        <section className="panel">
          <h2 className="panel-title">Open portal</h2>
          <p className="panel-text">
            Your issuing portal opens once HEC accredits your institution.
          </p>

          {!walletAddress ? (
            <div className="empty">
              <p>Connect your wallet to see your institution.</p>
              <button
                type="button"
                className="btn btn-blue btn-sm"
                onClick={connectWallet}
              >
                Connect MetaMask
              </button>
            </div>
          ) : isHec ? (
            <Notice tone="warn">
              You are connected as the HEC wallet, which has no institution
              portal. <Link to="/admin">Go to HEC admin</Link>
            </Notice>
          ) : myInstitutions.length === 0 ? (
            <div className="empty">
              <p>
                No institution is linked to this wallet yet. Send an
                application above.
              </p>
            </div>
          ) : (
            <div className="stack" style={{ gap: 12 }}>
              {myInstitutions.map((i) => (
                <div className="portal-card" key={i.code}>
                  <div>
                    <strong>
                      {i.name} ({i.code})
                    </strong>
                    <div className="muted mono" style={{ marginTop: 4 }}>
                      {i.wallet_address}
                    </div>
                  </div>
                  <div className="portal-actions">
                    <StatusBadge status={i.accreditation_status} />
                    {i.accreditation_status === "ACCREDITED" ? (
                      <Link
                        to={`/${i.code}/issue_degree`}
                        className="btn btn-blue btn-sm"
                      >
                        Open portal
                      </Link>
                    ) : (
                      <span className="muted">
                        {i.accreditation_status === "PENDING"
                          ? "Waiting for HEC"
                          : i.accreditation_status === "SUSPENDED"
                            ? "Suspended by HEC"
                            : "Rejected by HEC"}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

/* ---------- HEC admin ---------- */

function AdminPage({
  institutions,
  walletAddress,
  hecAddress,
  contractAddress,
  connectWallet,
  refreshInstitutions,
  authFetch,
  token,
  signIn,
}: {
  institutions: Institution[];
  walletAddress: string;
  hecAddress: string | null;
  contractAddress: string;
  connectWallet: () => Promise<void>;
  refreshInstitutions: () => Promise<void>;
  authFetch: AuthFetch;
  token: string | null;
  signIn: () => Promise<string>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(
    null,
  );
  const isHec = sameAddress(walletAddress, hecAddress);

  async function decide(
    inst: Institution,
    action: "approve" | "reject" | "suspend",
  ) {
    setMsg(null);
    setBusy(inst.code);
    try {
      if (!token) await signIn(); // sign in first so MetaMask prompts come in a logical order
      if (action !== "reject") {
        if (!inst.wallet_address) {
          throw new Error("This institution has no applicant wallet.");
        }
        const ethereum = (window as any).ethereum;
        const signer = await new ethers.BrowserProvider(ethereum).getSigner(
          walletAddress,
        );
        const contract = new ethers.Contract(
          contractAddress,
          REGISTRY_ABI,
          signer,
        );
        const tx =
          action === "approve"
            ? await contract.accreditIssuer(inst.wallet_address)
            : await contract.suspendIssuer(inst.wallet_address);
        await tx.wait();
      }
      const res = await authFetch(
        `${API_BASE}/admin/institutions/${inst.code}/${action}`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      await refreshInstitutions();
      setMsg({ type: "ok", text: data.message });
    } catch (err: any) {
      setMsg({ type: "err", text: err.shortMessage ?? err.message });
    } finally {
      setBusy(null);
    }
  }

  if (!isHec) {
    return (
      <HecGate
        walletAddress={walletAddress}
        hecAddress={hecAddress}
        connectWallet={connectWallet}
      />
    );
  }

  const pending = institutions.filter(
    (i) => i.accreditation_status === "PENDING",
  );
  const accredited = institutions.filter(
    (i) => i.accreditation_status === "ACCREDITED",
  );
  const closed = institutions.filter((i) =>
    ["SUSPENDED", "REJECTED"].includes(i.accreditation_status),
  );

  const walletCell = (i: Institution) => (
    <td className="mono">{i.wallet_address ?? "None"}</td>
  );

  return (
    <>
      <PageHead title="HEC admin">
        Review institution applications. Approving sends one transaction from
        the HEC wallet that adds the applicant's wallet to the accredited
        issuer list on the contract.
      </PageHead>

      {msg && <Notice tone={msg.type === "ok" ? "ok" : "bad"}>{msg.text}</Notice>}

      <div className="stack">
        <section className="panel">
          <h2 className="panel-title">Pending applications</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Institution</th>
                  <th>Applicant wallet</th>
                  <th>Requested</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((i) => (
                  <tr key={i.code}>
                    <td>
                      <strong>{i.code}</strong>
                    </td>
                    <td>{i.name}</td>
                    {walletCell(i)}
                    <td>
                      {i.requested_at
                        ? new Date(i.requested_at).toLocaleString()
                        : "-"}
                    </td>
                    <td>
                      <div className="form-actions" style={{ margin: 0 }}>
                        <button
                          className="btn btn-blue btn-sm"
                          disabled={busy === i.code}
                          onClick={() => decide(i, "approve")}
                        >
                          {busy === i.code && <Spinner />}
                          Approve
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          disabled={busy === i.code}
                          onClick={() => decide(i, "reject")}
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {pending.length === 0 && (
                  <tr>
                    <td colSpan={5} className="cell-empty">
                      No pending applications.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <h2 className="panel-title">Accredited institutions</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Institution</th>
                  <th>Issuer wallet</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {accredited.map((i) => (
                  <tr key={i.code}>
                    <td>
                      <strong>{i.code}</strong>
                    </td>
                    <td>{i.name}</td>
                    {walletCell(i)}
                    <td>
                      <button
                        className="btn btn-danger btn-sm"
                        disabled={busy === i.code}
                        onClick={() => decide(i, "suspend")}
                      >
                        {busy === i.code && <Spinner />}
                        Suspend
                      </button>
                    </td>
                  </tr>
                ))}
                {accredited.length === 0 && (
                  <tr>
                    <td colSpan={4} className="cell-empty">
                      No accredited institutions yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {closed.length > 0 && (
          <section className="panel">
            <h2 className="panel-title">Suspended and rejected</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Institution</th>
                    <th>Status</th>
                    <th>Wallet</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {closed.map((i) => (
                    <tr key={i.code}>
                      <td>
                        <strong>{i.code}</strong>
                      </td>
                      <td>{i.name}</td>
                      <td>
                        <StatusBadge status={i.accreditation_status} />
                      </td>
                      {walletCell(i)}
                      <td>
                        {i.accreditation_status === "SUSPENDED" ? (
                          <button
                            className="btn btn-ghost btn-sm"
                            disabled={busy === i.code}
                            onClick={() => decide(i, "approve")}
                          >
                            {busy === i.code && <Spinner />}
                            Reinstate
                          </button>
                        ) : (
                          <span className="muted">Waiting for a new application</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </>
  );
}

/* ---------- Issue degree ---------- */

function IssueDegreePage({
  institutions,
  walletAddress,
  connectWallet,
  contractAddress,
  token,
  signIn,
  authFetch,
}: {
  institutions: Institution[];
  walletAddress: string;
  connectWallet: () => Promise<void>;
  contractAddress: string;
  token: string | null;
  signIn: () => Promise<string>;
  authFetch: AuthFetch;
}) {
  const { university } = useParams<{ university: string }>();
  const navigate = useNavigate();
  const uniCode = (university ?? "UNIVA").toUpperCase();

  const currentInst = institutions.find((i) => i.code === uniCode);
  // Only the wallet bound to this institution may use its portal
  const boundWallet = currentInst?.wallet_address ?? null;
  const isOwner = sameAddress(walletAddress, boundWallet);

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
    certificateNumber: string;
    credentialHash: string;
    qrCodeDataUrl: string;
    txHash: string;
    gasUsed: string;
  } | null>(null);
  const [issueError, setIssueError] = useState<string | null>(null);

  const [credentials, setCredentials] = useState<CredentialRow[]>([]);
  const [revokingHash, setRevokingHash] = useState<string | null>(null);
  const [revokeMsg, setRevokeMsg] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  useEffect(() => {
    if (isOwner && token) {
      fetchUniversityCredentials();
    } else {
      // Never keep another institution's data on screen after an account switch
      setCredentials([]);
      setIssuedResult(null);
      setRevokeMsg(null);
    }
  }, [uniCode, isOwner, token]);

  async function fetchUniversityCredentials() {
    try {
      const res = await authFetch(
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

    if (!isOwner) {
      setIssueError(
        "The connected wallet is not the registrar wallet for this institution.",
      );
      return;
    }

    if (!walletAddress) {
      setIssueError(
        "Please connect your institution MetaMask wallet in the top-right header.",
      );
      return;
    }

    setIssuingLoading(true);
    try {
      const prepRes = await authFetch(`${API_BASE}/credentials/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          institution: uniCode,
          ...issueForm,
        }),
      });
      const prepData = await prepRes.json();
      if (!prepRes.ok) {
        throw new Error(prepData.error ?? "Failed to prepare credential");
      }

      const { credentialHash, referenceCode, certificateNumber, qrCodeDataUrl } =
        prepData;

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
        certificateNumber,
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
    if (credentials.find((c) => c.credential_hash === credentialHash)?.revoked_at) {
      return; // already revoked, the contract would reject a second revocation
    }
    if (!isOwner) {
      setRevokeMsg(
        "Revocation error: the connected wallet is not the registrar wallet for this institution.",
      );
      return;
    }
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
      // Show it as revoked straight away; the next load reads the real time from the chain
      setCredentials((prev) =>
        prev.map((c) =>
          c.credential_hash === credentialHash
            ? { ...c, revoked_at: Math.floor(Date.now() / 1000) }
            : c,
        ),
      );
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
    const st = currentInst.accreditation_status;
    return (
      <>
        <BackLink to="/register">Back to my institution</BackLink>
        <section className="panel">
          <h2 className="panel-title">
            {st === "PENDING"
              ? `${uniCode} is waiting for HEC approval`
              : st === "SUSPENDED"
                ? `${uniCode} is suspended`
                : st === "REJECTED"
                  ? `HEC rejected ${uniCode}`
                  : `${uniCode} is not accredited yet`}
          </h2>
          <p className="panel-text">
            {st === "PENDING"
              ? "The application is with HEC. The portal opens after approval."
              : st === "SUSPENDED"
                ? "HEC has suspended this institution, so it cannot issue new credentials."
                : st === "REJECTED"
                  ? "The last application was rejected. The institution can apply again."
                  : "Apply for accreditation before using this portal."}
          </p>
          <Link to="/register" className="btn">
            Return to onboarding
          </Link>
        </section>
      </>
    );
  }

  if (!currentInst) {
    return (
      <>
        <BackLink to="/register">Back to my institution</BackLink>
        <section className="panel">
          <h2 className="panel-title">
            {institutions.length === 0
              ? "Loading institution"
              : `Unknown institution: ${uniCode}`}
          </h2>
          <p className="panel-text">
            {institutions.length === 0
              ? "Waiting for the institution registry to load."
              : "This code is not in the institution registry."}
          </p>
        </section>
      </>
    );
  }

  if (!boundWallet) {
    return (
      <>
        <BackLink to="/register">Back to my institution</BackLink>
        <section className="panel">
          <h2 className="panel-title">No registrar wallet bound to {uniCode}</h2>
          <p className="panel-text">
            Bind a wallet on the onboarding page before opening this portal.
          </p>
          <Link to="/register" className="btn">
            Go to onboarding
          </Link>
        </section>
      </>
    );
  }

  if (!walletAddress) {
    return (
      <>
        <BackLink to="/register">Back to my institution</BackLink>
        <section className="panel">
          <h2 className="panel-title">Connect the {uniCode} wallet</h2>
          <p className="panel-text">
            This portal opens only for the registrar wallet bound to{" "}
            {currentInst.name}. Connect MetaMask with that account to continue.
          </p>
          <button type="button" className="btn btn-blue" onClick={connectWallet}>
            Connect MetaMask
          </button>
        </section>
      </>
    );
  }

  if (!isOwner) {
    return (
      <>
        <BackLink to="/register">Back to my institution</BackLink>
        <section className="panel">
          <h2 className="panel-title">Wrong account for {uniCode}</h2>
          <p className="panel-text">
            The {currentInst.name} portal is limited to its registrar wallet.
            Switch MetaMask to that account to continue.
          </p>
          <dl className="facts">
            <div className="fact">
              <dt>Connected wallet</dt>
              <dd className="mono">{walletAddress}</dd>
            </div>
            <div className="fact">
              <dt>Required wallet</dt>
              <dd className="mono">{boundWallet}</dd>
            </div>
          </dl>
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-blue"
              onClick={connectWallet}
            >
              Switch account
            </button>
            <Link to="/register" className="btn btn-ghost">
              Back to onboarding
            </Link>
          </div>
        </section>
      </>
    );
  }

  if (!token) {
    return (
      <>
        <BackLink to="/register">Back to my institution</BackLink>
        <section className="panel">
          <h2 className="panel-title">Sign in as the {uniCode} registrar</h2>
          <p className="panel-text">
            Sign a short message in MetaMask to prove you control this wallet.
            It costs no gas and sends no transaction.
          </p>
          <button
            type="button"
            className="btn btn-blue"
            disabled={signingIn}
            onClick={async () => {
              setSignInError(null);
              setSigningIn(true);
              try {
                await signIn();
              } catch (err: any) {
                setSignInError(err.shortMessage ?? err.message);
              } finally {
                setSigningIn(false);
              }
            }}
          >
            {signingIn && <Spinner />}
            {signingIn ? "Waiting for MetaMask" : "Sign in with MetaMask"}
          </button>
          {signInError && (
            <Notice tone="bad" title="Sign-in failed.">
              {signInError}
            </Notice>
          )}
        </section>
      </>
    );
  }

  return (
    <>
      <BackLink to="/register">Back to my institution</BackLink>

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
                <span className="field-label">Certificate number *</span>
                <input
                  type="text"
                  required
                  placeholder="e.g. 220001624"
                  value={issueForm.credentialId}
                  onChange={(e) =>
                    setIssueForm({ ...issueForm, credentialId: e.target.value })
                  }
                />
                <span className="field-hint">
                  The unique number printed on the certificate. An institution
                  can use each number once. Other institutions may use the
                  same number.
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
                  Print the QR code and the certificate number on the document so
                  anyone can verify it.
                </p>
              </div>
            </div>

            <div className="issued-grid">
              <dl className="facts">
                <div className="fact">
                  <dt>Certificate number</dt>
                  <dd className="mono">{issuedResult.certificateNumber}</dd>
                </div>
                <div className="fact">
                  <dt>On-chain reference</dt>
                  <dd className="mono">{issuedResult.referenceCode}</dd>
                </div>
                <div className="fact">
                  <dt>SHA-256 hash</dt>
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
                        issuedResult.certificateNumber,
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
                  <th>Certificate number</th>
                  <th>Anchored hash</th>
                  <th>Holder reference</th>
                  <th>Award date</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {credentials.map((c) => (
                  <tr key={c.credential_id}>
                    <td className="mono">
                      <strong>{certNumberOf(c.reference_code, uniCode)}</strong>
                    </td>
                    <td className="mono">
                      {c.credential_hash.slice(0, 14)}...
                      {c.credential_hash.slice(-8)}
                    </td>
                    <td className="mono">{c.holder_reference}</td>
                    <td>{String(c.issuance_date).slice(0, 10)}</td>
                    <td>
                      <span
                        className={`badge ${c.revoked_at ? "tone-warn" : "tone-ok"}`}
                      >
                        {c.revoked_at ? "Revoked" : "Active"}
                      </span>
                    </td>
                    <td>
                      {c.revoked_at ? (
                        <span className="muted">
                          Revoked on{" "}
                          {new Date(c.revoked_at * 1000).toLocaleDateString()}
                        </span>
                      ) : (
                        <button
                          className="btn btn-danger btn-sm"
                          disabled={revokingHash === c.credential_hash}
                          onClick={() =>
                            handleRevokeCredential(
                              c.credential_hash,
                              certNumberOf(c.reference_code, uniCode),
                            )
                          }
                        >
                          {revokingHash === c.credential_hash && <Spinner />}
                          {revokingHash === c.credential_hash
                            ? "Revoking"
                            : "Revoke on-chain"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {credentials.length === 0 && (
                  <tr>
                    <td colSpan={6} className="cell-empty">
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
  // On a mismatch the backend returns no record details, so none are shown
  const hasDetails =
    !!verifyResponse && verifyResponse.result !== "MISMATCH_OR_NOT_FOUND";

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
                <span className="field-label">Certificate number *</span>
                <input
                  type="text"
                  required
                  placeholder="e.g. 220001624"
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
            The SHA-256 hash of the details you entered is recomputed and
            compared with the record on the Sepolia contract.
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
                  <dt>Certificate number</dt>
                  <dd className="mono">
                    {verifyResponse.certificateNumber ??
                      verifyResponse.referenceCode}
                  </dd>
                </div>
                <div className="fact">
                  <dt>Response time</dt>
                  <dd>
                    {verifyResponse.responseTimeMs} ms (
                    {(verifyResponse.responseTimeMs / 1000).toFixed(2)} s)
                  </dd>
                </div>
                {hasDetails && (
                  <>
                    {verifyResponse.details?.issuerInstitution?.name && (
                      <div className="fact">
                        <dt>Issued by</dt>
                        <dd>
                          {verifyResponse.details.issuerInstitution.name} (
                          {verifyResponse.details.issuerInstitution.code})
                        </dd>
                      </div>
                    )}
                    {verifyResponse.details?.issuedAtTimestamp > 0 && (
                      <div className="fact">
                        <dt>Issued on</dt>
                        <dd>
                          {new Date(
                            verifyResponse.details.issuedAtTimestamp * 1000,
                          ).toLocaleDateString()}
                        </dd>
                      </div>
                    )}
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
                  </>
                )}
              </dl>
            </>
          )}
        </section>
      </div>
    </>
  );
}

/* ---------- Shared gates ---------- */

function HecGate({
  walletAddress,
  hecAddress,
  connectWallet,
}: {
  walletAddress: string;
  hecAddress: string | null;
  connectWallet: () => Promise<void>;
}) {
  if (!walletAddress) {
    return (
      <section className="panel">
        <h2 className="panel-title">Connect the HEC wallet</h2>
        <p className="panel-text">
          This area is limited to the HEC wallet recorded in the contract.
        </p>
        <button type="button" className="btn btn-blue" onClick={connectWallet}>
          Connect MetaMask
        </button>
      </section>
    );
  }
  return (
    <section className="panel">
      <h2 className="panel-title">HEC wallet required</h2>
      <p className="panel-text">
        Only the HEC wallet can use this area. Switch MetaMask to that account
        to continue.
      </p>
      <dl className="facts">
        <div className="fact">
          <dt>Connected wallet</dt>
          <dd className="mono">{walletAddress}</dd>
        </div>
        <div className="fact">
          <dt>HEC wallet</dt>
          <dd className="mono">{hecAddress ?? "Could not be loaded"}</dd>
        </div>
      </dl>
      <div className="form-actions">
        <button type="button" className="btn btn-blue" onClick={connectWallet}>
          Switch account
        </button>
      </div>
    </section>
  );
}

function SignInPanel({
  title,
  signIn,
}: {
  title: string;
  signIn: () => Promise<string>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="panel">
      <h2 className="panel-title">{title}</h2>
      <p className="panel-text">
        Sign a short message in MetaMask to prove you control this wallet. It
        costs no gas and sends no transaction.
      </p>
      <button
        type="button"
        className="btn btn-blue"
        disabled={busy}
        onClick={async () => {
          setError(null);
          setBusy(true);
          try {
            await signIn();
          } catch (err: any) {
            setError(err.shortMessage ?? err.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy && <Spinner />}
        {busy ? "Waiting for MetaMask" : "Sign in with MetaMask"}
      </button>
      {error && (
        <Notice tone="bad" title="Sign-in failed.">
          {error}
        </Notice>
      )}
    </section>
  );
}

/* ---------- Logs (HEC only) ---------- */

function LogsPage({
  walletAddress,
  hecAddress,
  connectWallet,
  token,
  signIn,
  authFetch,
}: {
  walletAddress: string;
  hecAddress: string | null;
  connectWallet: () => Promise<void>;
  token: string | null;
  signIn: () => Promise<string>;
  authFetch: AuthFetch;
}) {
  const [logs, setLogs] = useState<VerificationLogRow[]>([]);
  const isHec = sameAddress(walletAddress, hecAddress);

  useEffect(() => {
    if (!isHec || !token) {
      setLogs([]);
      return;
    }
    authFetch(`${API_BASE}/logs`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setLogs(data);
      })
      .catch(console.error);
  }, [isHec, token]);

  if (!isHec) {
    return (
      <HecGate
        walletAddress={walletAddress}
        hecAddress={hecAddress}
        connectWallet={connectWallet}
      />
    );
  }
  if (!token) {
    return <SignInPanel title="Sign in as HEC" signIn={signIn} />;
  }

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
  const [hecAddress, setHecAddress] = useState<string | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [theme, toggleTheme] = useTheme();
  const [auth, setAuth] = useState<{ token: string; wallet: string } | null>(
    () => {
      try {
        const raw = sessionStorage.getItem("auth");
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
  );
  // A token only counts for the wallet it was issued to
  const token =
    auth && walletAddress && auth.wallet === walletAddress.toLowerCase()
      ? auth.token
      : null;
  // authFetch reads this ref, so a sign-in made earlier in the same click is not repeated
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;

  useEffect(() => {
    try {
      if (auth) sessionStorage.setItem("auth", JSON.stringify(auth));
      else sessionStorage.removeItem("auth");
    } catch {
      /* storage unavailable */
    }
  }, [auth]);

  useEffect(() => {
    fetchHealthAndInstitutions();
    checkAlreadyConnectedWallet();

    const ethereum = (window as any).ethereum;
    if (ethereum && ethereum.on) {
      const handleAccountsChanged = (accounts: string[]) => {
        setWalletAddress(accounts && accounts.length > 0 ? accounts[0] : "");
      };
      ethereum.on("accountsChanged", handleAccountsChanged);
      return () => {
        if (ethereum.removeListener) {
          ethereum.removeListener("accountsChanged", handleAccountsChanged);
        }
      };
    }
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
        if (hData.hecAddress) setHecAddress(hData.hecAddress);
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
      // If already connected, prompt MetaMask's account picker so the user can switch universities
      if (walletAddress) {
        await ethereum.request({
          method: "wallet_requestPermissions",
          params: [{ eth_accounts: {} }],
        });
      }
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

  // Proves control of the connected wallet: nonce -> MetaMask signature -> token
  async function signIn(): Promise<string> {
    const ethereum = (window as any).ethereum;
    if (!ethereum || !walletAddress) {
      throw new Error("Connect your MetaMask wallet first.");
    }
    const nRes = await fetch(`${API_BASE}/auth/nonce`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress }),
    });
    const nData = await nRes.json();
    if (!nRes.ok) throw new Error(nData.error ?? "Could not start sign-in");

    const signer = await new ethers.BrowserProvider(ethereum).getSigner(
      walletAddress,
    );
    const signature = await signer.signMessage(nData.message);

    const lRes = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress, signature }),
    });
    const lData = await lRes.json();
    if (!lRes.ok) throw new Error(lData.error ?? "Sign-in failed");

    tokenRef.current = lData.token;
    setAuth({ token: lData.token, wallet: lData.walletAddress });
    return lData.token;
  }

  // fetch() with the wallet token attached; signs in first if there is none
  async function authFetch(url: string, init: RequestInit = {}) {
    const t = tokenRef.current ?? (await signIn());
    const res = await fetch(url, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string>),
        Authorization: `Bearer ${t}`,
      },
    });
    if (res.status === 401) setAuth(null); // expired, ask again next time
    return res;
  }

  return (
    <BrowserRouter>
      <div className="app-shell">
        <Header
          walletAddress={walletAddress}
          institutions={institutions}
          connectWallet={connectWallet}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
        <main className="page">
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/guide" element={<GuidePage />} />
            <Route
              path="/register"
              element={
                <RegisterPage
                  institutions={institutions}
                  walletAddress={walletAddress}
                  hecAddress={hecAddress}
                  connectWallet={connectWallet}
                  refreshInstitutions={fetchHealthAndInstitutions}
                  backendError={backendError}
                  authFetch={authFetch}
                />
              }
            />
            <Route
              path="/admin"
              element={
                <AdminPage
                  institutions={institutions}
                  walletAddress={walletAddress}
                  hecAddress={hecAddress}
                  contractAddress={contractAddress}
                  connectWallet={connectWallet}
                  refreshInstitutions={fetchHealthAndInstitutions}
                  authFetch={authFetch}
                  token={token}
                  signIn={signIn}
                />
              }
            />
            <Route
              path="/:university/issue_degree"
              element={
                <IssueDegreePage
                  institutions={institutions}
                  walletAddress={walletAddress}
                  connectWallet={connectWallet}
                  contractAddress={contractAddress}
                  token={token}
                  signIn={signIn}
                  authFetch={authFetch}
                />
              }
            />
            <Route
              path="/verify"
              element={<VerifyPage institutions={institutions} />}
            />
            <Route
              path="/logs"
              element={
                <LogsPage
                  walletAddress={walletAddress}
                  hecAddress={hecAddress}
                  connectWallet={connectWallet}
                  token={token}
                  signIn={signIn}
                  authFetch={authFetch}
                />
              }
            />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </main>
        <Footer contractAddress={contractAddress} />
      </div>
    </BrowserRouter>
  );
}
