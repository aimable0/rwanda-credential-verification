import React, { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import './App.css';

const API_BASE = 'http://localhost:4000/api';
const SEPOLIA_CHAIN_ID_HEX = '0xaa36a7'; // 11155111
const DEFAULT_CONTRACT_ADDRESS = '0xAaf295EB2b31AC3eFeB0961e0f7E403A462ea590';

const REGISTRY_ABI = [
  'function issueCredential(bytes32 _credentialHash, string calldata _referenceCode) external',
  'function revokeCredential(bytes32 _credentialHash) external',
  'function getRecordByReferenceCode(string calldata _referenceCode) external view returns (bytes32 credentialHash, address issuer, uint256 issuedAt, uint256 revocationTimestamp, bool exists)',
];

const CLASSIFICATIONS = [
  { value: 'FIRST_CLASS_HONOURS', label: 'First Class Honours' },
  { value: 'SECOND_CLASS_UPPER', label: 'Second Class Honours, Upper Division' },
  { value: 'SECOND_CLASS_LOWER', label: 'Second Class Honours, Lower Division' },
  { value: 'PASS', label: 'Pass' },
  { value: 'NOT_APPLICABLE', label: 'Not Applicable (Professional License)' },
];

interface Institution {
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

export default function App() {
  const [activeTab, setActiveTab] = useState<'verifier' | 'institution' | 'logs'>('institution');
  const [walletAddress, setWalletAddress] = useState<string>('');
  const [contractAddress, setContractAddress] = useState<string>(DEFAULT_CONTRACT_ADDRESS);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [credentials, setCredentials] = useState<CredentialRow[]>([]);
  const [logs, setLogs] = useState<VerificationLogRow[]>([]);

  // Institution Onboarding State
  const [selectedOnboardCode, setSelectedOnboardCode] = useState<string>('UNIVA');
  const [onboardStatusMsg, setOnboardStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Issuance Form State (7 Canonical Fields)
  const [issueForm, setIssueForm] = useState({
    institution: 'UNIVA',
    credentialId: '',
    holderName: '',
    degreeTitle: '',
    programme: '',
    classification: 'FIRST_CLASS_HONOURS',
    awardDate: '2026-06-15',
    credentialType: 'ACADEMIC_DEGREE',
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

  // Revocation State
  const [revokingHash, setRevokingHash] = useState<string | null>(null);
  const [revokeMsg, setRevokeMsg] = useState<string | null>(null);

  // Verifier Form State (Mandatory 7-Field + Reference Code Re-entry)
  const [verifyForm, setVerifyForm] = useState({
    referenceCode: '',
    institution: 'UNIVA',
    holderName: '',
    degreeTitle: '',
    programme: '',
    classification: 'FIRST_CLASS_HONOURS',
    awardDate: '2026-06-15',
    scenarioType: 'GENUINE',
  });
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyResponse, setVerifyResponse] = useState<any | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // Load initial data & check URL query params (from QR scan)
  useEffect(() => {
    fetchHealthAndInstitutions();
    fetchCredentials();
    fetchLogs();

    const params = new URLSearchParams(window.location.search);
    const refParam = params.get('ref');
    const instParam = params.get('inst');
    if (refParam) {
      setActiveTab('verifier');
      setVerifyForm((prev) => ({
        ...prev,
        referenceCode: refParam,
        institution: instParam || prev.institution,
      }));
    }
  }, []);

  async function fetchHealthAndInstitutions() {
    try {
      const [hRes, iRes] = await Promise.all([
        fetch(`${API_BASE}/health`),
        fetch(`${API_BASE}/institutions`),
      ]);
      if (hRes.ok) {
        const hData = await hRes.json();
        if (hData.contractAddress) setContractAddress(hData.contractAddress);
      }
      if (iRes.ok) {
        const iData = await iRes.json();
        setInstitutions(iData);
      }
    } catch (err) {
      console.error('Error loading backend config:', err);
    }
  }

  async function fetchCredentials() {
    try {
      const res = await fetch(`${API_BASE}/credentials`);
      if (res.ok) setCredentials(await res.json());
    } catch (err) {
      console.error(err);
    }
  }

  async function fetchLogs() {
    try {
      const res = await fetch(`${API_BASE}/logs`);
      if (res.ok) setLogs(await res.json());
    } catch (err) {
      console.error(err);
    }
  }

  // Connect MetaMask & enforce Sepolia network
  async function connectWallet() {
    const ethereum = (window as any).ethereum;
    if (!ethereum) {
      alert('MetaMask is not installed. Please install MetaMask to act as an Issuing Institution.');
      return;
    }
    try {
      const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
      const chainId = await ethereum.request({ method: 'eth_chainId' });
      if (chainId !== SEPOLIA_CHAIN_ID_HEX) {
        await ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }],
        });
      }
      setWalletAddress(accounts[0]);
    } catch (err: any) {
      alert(`Wallet connection error: ${err.message}`);
    }
  }

  // Use Case 1: Register as Issuer (Gated by Simulated HEC/NCNM Accreditation Check)
  async function handleRegisterIssuer(e: React.FormEvent) {
    e.preventDefault();
    setOnboardStatusMsg(null);
    if (!walletAddress) {
      setOnboardStatusMsg({ type: 'err', text: 'Connect your MetaMask wallet first.' });
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/institutions/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: selectedOnboardCode, walletAddress }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOnboardStatusMsg({ type: 'err', text: data.error });
      } else {
        setOnboardStatusMsg({ type: 'ok', text: data.message });
        fetchHealthAndInstitutions();
      }
    } catch (err: any) {
      setOnboardStatusMsg({ type: 'err', text: err.message });
    }
  }

  // Use Case 2: Issue Credential (Backend Salt/Hash + Browser MetaMask Signing)
  async function handleIssueCredential(e: React.FormEvent) {
    e.preventDefault();
    setIssueError(null);
    setIssuedResult(null);

    if (!walletAddress) {
      setIssueError('Please connect your institution MetaMask wallet before issuing.');
      return;
    }

    setIssuingLoading(true);
    try {
      // Steps 2-5 (Figure 3.5a): Backend checks accreditation, generates salt, hash, reference code & QR
      const prepRes = await fetch(`${API_BASE}/credentials/prepare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...issueForm,
          walletAddress,
        }),
      });
      const prepData = await prepRes.json();
      if (!prepRes.ok) {
        throw new Error(prepData.error || 'Failed to prepare credential');
      }

      const { credentialHash, referenceCode, qrCodeDataUrl } = prepData;

      // Steps 6-8 (Figure 3.5a): Request signature from Institution's MetaMask wallet directly to Sepolia
      const ethereum = (window as any).ethereum;
      const browserProvider = new ethers.BrowserProvider(ethereum);
      const signer = await browserProvider.getSigner();
      const contract = new ethers.Contract(contractAddress, REGISTRY_ABI, signer);

      const tx = await contract.issueCredential(credentialHash, referenceCode);
      const receipt = await tx.wait();

      setIssuedResult({
        referenceCode,
        credentialHash,
        qrCodeDataUrl,
        txHash: receipt.hash,
        gasUsed: receipt.gasUsed.toString(),
      });

      fetchCredentials();
    } catch (err: any) {
      setIssueError(err.shortMessage || err.message || 'Issuance failed');
    } finally {
      setIssuingLoading(false);
    }
  }

  // Use Case 3: Revoke Credential (Single-Issuer On-Chain Revocation Mapping)
  async function handleRevokeCredential(credentialHash: string, referenceCode: string) {
    setRevokeMsg(null);
    if (!walletAddress) {
      alert('Connect your MetaMask wallet first to sign the revocation transaction.');
      return;
    }
    setRevokingHash(credentialHash);
    try {
      const ethereum = (window as any).ethereum;
      const browserProvider = new ethers.BrowserProvider(ethereum);
      const signer = await browserProvider.getSigner();
      const contract = new ethers.Contract(contractAddress, REGISTRY_ABI, signer);

      const tx = await contract.revokeCredential(credentialHash);
      const receipt = await tx.wait();
      setRevokeMsg(
        `Revoked ${referenceCode} on-chain! Tx: ${receipt.hash} (Gas used: ${receipt.gasUsed.toString()})`
      );
    } catch (err: any) {
      setRevokeMsg(`Revocation error: ${err.shortMessage || err.message}`);
    } finally {
      setRevokingHash(null);
    }
  }

  // Use Case 4: Public Verifier Portal (Mandatory 7-Field Re-entry + Reference Code)
  async function handleVerifyCredential(e: React.FormEvent) {
    e.preventDefault();
    setVerifyError(null);
    setVerifyResponse(null);
    setVerifyLoading(true);
    try {
      const res = await fetch(`${API_BASE}/credentials/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(verifyForm),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Verification request failed');
      }
      setVerifyResponse(data);
      fetchLogs();
    } catch (err: any) {
      setVerifyError(err.message);
    } finally {
      setVerifyLoading(false);
    }
  }

  // Helper to copy issued values into the Verifier tab for instant testing
  function copyToVerifier() {
    if (!issuedResult) return;
    setVerifyForm({
      referenceCode: issuedResult.referenceCode,
      institution: issueForm.institution,
      holderName: issueForm.holderName,
      degreeTitle: issueForm.degreeTitle,
      programme: issueForm.programme,
      classification: issueForm.classification,
      awardDate: issueForm.awardDate,
      scenarioType: 'GENUINE',
    });
    setActiveTab('verifier');
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div>
          <h1>Rwanda Blockchain Credential Verification Platform</h1>
          <p>
            Zero-Storage, Single-Issuer Hash-Anchoring on Ethereum Sepolia (
            <span className="mono">{contractAddress}</span>)
          </p>
        </div>
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
      </header>

      <div className="nav-tabs">
        <button
          className={`tab-btn ${activeTab === 'institution' ? 'active' : ''}`}
          onClick={() => setActiveTab('institution')}
        >
          1. Institution Portal (Issuer & Revocation)
        </button>
        <button
          className={`tab-btn ${activeTab === 'verifier' ? 'active' : ''}`}
          onClick={() => setActiveTab('verifier')}
        >
          2. Public Verifier Portal (No Wallet Required)
        </button>
        <button
          className={`tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
          onClick={() => {
            fetchLogs();
            setActiveTab('logs');
          }}
        >
          3. Evaluation Logs ({logs.length})
        </button>
      </div>

      {/* TAB 1: INSTITUTION PORTAL */}
      {activeTab === 'institution' && (
        <>
          <div className="grid-2">
            {/* ONBOARDING CARD */}
            <div className="card">
              <h2>Step A: Institution Onboarding (Accreditation Gate)</h2>
              <p style={{ fontSize: '0.86rem', color: '#4a5568' }}>
                Checks simulated HEC/NCNM accreditation status before binding the connected MetaMask
                wallet as an authorized issuer.
              </p>
              <form onSubmit={handleRegisterIssuer}>
                <div className="form-group">
                  <label>Select Institution (Simulated HEC/NCNM List)</label>
                  <select
                    value={selectedOnboardCode}
                    onChange={(e) => setSelectedOnboardCode(e.target.value)}
                  >
                    {institutions.map((inst) => (
                      <option key={inst.code} value={inst.code}>
                        {inst.code} — {inst.name} [{inst.accreditation_status}]
                      </option>
                    ))}
                  </select>
                </div>
                <button type="submit" className="btn">
                  Verify Accreditation & Bind Connected Wallet
                </button>
              </form>

              {onboardStatusMsg && (
                <div
                  className={`outcome-banner ${
                    onboardStatusMsg.type === 'ok'
                      ? 'outcome-GENUINE_AND_ACTIVE'
                      : 'outcome-MISMATCH_OR_NOT_FOUND'
                  }`}
                >
                  <strong>{onboardStatusMsg.text}</strong>
                </div>
              )}

              <div style={{ marginTop: '18px' }}>
                <strong style={{ fontSize: '0.85rem' }}>Current Institution Registry:</strong>
                <table style={{ marginTop: '8px' }}>
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Name</th>
                      <th>Status</th>
                      <th>Bound Wallet</th>
                    </tr>
                  </thead>
                  <tbody>
                    {institutions.map((i) => (
                      <tr key={i.code}>
                        <td><strong>{i.code}</strong></td>
                        <td>{i.name}</td>
                        <td>
                          <span
                            className={`badge ${
                              i.accreditation_status === 'ACCREDITED' ? 'badge-green' : 'badge-red'
                            }`}
                          >
                            {i.accreditation_status}
                          </span>
                        </td>
                        <td className="mono">
                          {i.wallet_address
                            ? `${i.wallet_address.slice(0, 8)}...${i.wallet_address.slice(-4)}`
                            : 'Not bound'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ISSUANCE CARD */}
            <div className="card">
              <h2>Step B: Issue & Anchor Credential (7 Canonical Fields)</h2>
              <form onSubmit={handleIssueCredential}>
                <div className="form-group">
                  <label>1. Issuing Institution Code *</label>
                  <select
                    value={issueForm.institution}
                    onChange={(e) => setIssueForm({ ...issueForm, institution: e.target.value })}
                  >
                    {institutions.map((inst) => (
                      <option key={inst.code} value={inst.code}>
                        {inst.code} — {inst.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>
                    2. Printed Certificate ID / Reference Code (Leave blank to auto-generate)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 220001624 or leave empty for RW-UNIVA-..."
                    value={issueForm.credentialId}
                    onChange={(e) => setIssueForm({ ...issueForm, credentialId: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>3. Holder Full Name (as printed on certificate) *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. DUKUNDIMANA DESIRE"
                    value={issueForm.holderName}
                    onChange={(e) => setIssueForm({ ...issueForm, holderName: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>4. Degree / License Title (as printed) *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. BACHELOR OF SCIENCE IN SOFTWARE ENGINEERING"
                    value={issueForm.degreeTitle}
                    onChange={(e) => setIssueForm({ ...issueForm, degreeTitle: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>5. Programme / Specialization (Optional — empty slot if none)</label>
                  <input
                    type="text"
                    placeholder="e.g. SOFTWARE ENGINEERING"
                    value={issueForm.programme}
                    onChange={(e) => setIssueForm({ ...issueForm, programme: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>6. Classification (Fixed Enum) *</label>
                  <select
                    value={issueForm.classification}
                    onChange={(e) => setIssueForm({ ...issueForm, classification: e.target.value })}
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
                    onChange={(e) => setIssueForm({ ...issueForm, awardDate: e.target.value })}
                  />
                </div>

                <button type="submit" className="btn" disabled={issuingLoading}>
                  {issuingLoading
                    ? 'Generating Salt/Hash & Waiting for MetaMask...'
                    : 'Generate Salted Hash & Sign On-Chain (MetaMask)'}
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
                    <strong>Reference Code (Stamp on Document):</strong>{' '}
                    <span className="mono">{issuedResult.referenceCode}</span>
                  </p>
                  <p>
                    <strong>Salted SHA-256 Hash:</strong>{' '}
                    <span className="mono">{issuedResult.credentialHash}</span>
                  </p>
                  <p>
                    <strong>Sepolia Transaction Hash:</strong>{' '}
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '10px' }}>
                    <img
                      src={issuedResult.qrCodeDataUrl}
                      alt="Credential QR Code"
                      style={{ width: 120, height: 120, border: '1px solid #ccc', borderRadius: 6 }}
                    />
                    <button type="button" className="btn" onClick={copyToVerifier}>
                      Test This Credential in Verifier Portal →
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ISSUED CREDENTIALS & REVOCATION TABLE */}
          <div className="card">
            <h2>Step C: Issued Credentials & On-Chain Revocation</h2>
            <p style={{ fontSize: '0.86rem', color: '#4a5568' }}>
              Zero-storage compliance: No personal names or PDF documents are stored in PostgreSQL—only
              the salted hash, reference code, and an opaque holder reference. Only the original issuing
              wallet can revoke a credential on-chain.
            </p>
            {revokeMsg && (
              <div className="outcome-banner outcome-GENUINE_BUT_REVOKED" style={{ marginBottom: 12 }}>
                <strong>{revokeMsg}</strong>
              </div>
            )}
            <table>
              <thead>
                <tr>
                  <th>Institution</th>
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
                    <td><strong>{c.institution_code}</strong></td>
                    <td className="mono"><strong>{c.reference_code}</strong></td>
                    <td className="mono">
                      {c.credential_hash.slice(0, 14)}...{c.credential_hash.slice(-8)}
                    </td>
                    <td className="mono">{c.holder_reference}</td>
                    <td>{String(c.issuance_date).slice(0, 10)}</td>
                    <td>
                      <button
                        className="btn btn-danger"
                        style={{ padding: '6px 10px', fontSize: '0.8rem' }}
                        disabled={revokingHash === c.credential_hash}
                        onClick={() =>
                          handleRevokeCredential(c.credential_hash, c.reference_code)
                        }
                      >
                        {revokingHash === c.credential_hash ? 'Revoking...' : 'Revoke On-Chain'}
                      </button>
                    </td>
                  </tr>
                ))}
                {credentials.length === 0 && (
                  <tr>
                    <td colSpan={6}>No credentials issued yet. Issue one above!</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* TAB 2: PUBLIC VERIFIER PORTAL */}
      {activeTab === 'verifier' && (
        <div className="grid-2">
          <div className="card">
            <h2>Public Credential Verification (Mandatory Field Re-Entry)</h2>
            <p style={{ fontSize: '0.86rem', color: '#4a5568' }}>
              Enter the visible fields printed on the presented certificate along with its Reference Code.
              No blockchain wallet or registrar contact is required.
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
                  placeholder="e.g. BACHELOR OF SCIENCE IN SOFTWARE ENGINEERING"
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
                <label>Evaluation Scenario Tag (Logged to verification_logs for Objective 3)</label>
                <select
                  value={verifyForm.scenarioType}
                  onChange={(e) =>
                    setVerifyForm({ ...verifyForm, scenarioType: e.target.value })
                  }
                >
                  <option value="GENUINE">GENUINE (Unaltered Issued Credential)</option>
                  <option value="TAMPERED">TAMPERED (Real Reference Code + Altered Field)</option>
                  <option value="FABRICATED">FABRICATED (Never Issued / Fake Reference Code)</option>
                  <option value="REVOKED">REVOKED (Issued Then Revoked On-Chain)</option>
                </select>
              </div>

              <button type="submit" className="btn" disabled={verifyLoading}>
                {verifyLoading
                  ? 'Recomputing Hash & Querying Sepolia Blockchain...'
                  : 'Verify Credential Against Sepolia Blockchain'}
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
              <p style={{ color: '#4a5568' }}>
                Submit a credential on the left to recompute its salted SHA-256 digest and compare it
                against the immutable Sepolia smart contract record.
              </p>
            ) : (
              <div className={`outcome-banner outcome-${verifyResponse.result}`}>
                <h3 style={{ marginTop: 0 }}>
                  Outcome:{' '}
                  {verifyResponse.result === 'GENUINE_AND_ACTIVE' && '✅ GENUINE AND ACTIVE'}
                  {verifyResponse.result === 'GENUINE_BUT_REVOKED' && '⚠️ GENUINE BUT REVOKED'}
                  {verifyResponse.result === 'MISMATCH_OR_NOT_FOUND' && '❌ MISMATCH OR NOT FOUND'}
                </h3>
                <p>
                  <strong>Reference Code Checked:</strong>{' '}
                  <span className="mono">{verifyResponse.referenceCode}</span>
                </p>
                <p>
                  <strong>Verification Response Time:</strong>{' '}
                  <strong>{verifyResponse.responseTimeMs} ms</strong> (
                  {(verifyResponse.responseTimeMs / 1000).toFixed(2)} seconds)
                </p>
                <p>
                  <strong>Recomputed Hash (from entered fields + salt):</strong>{' '}
                  <span className="mono">{verifyResponse.details?.recomputedHash || 'N/A'}</span>
                </p>
                <p>
                  <strong>On-Chain Anchored Hash (Sepolia):</strong>{' '}
                  <span className="mono">{verifyResponse.details?.anchoredHash || 'Not Found'}</span>
                </p>
                {verifyResponse.details?.issuerAddress && (
                  <p>
                    <strong>Anchored Issuer Wallet:</strong>{' '}
                    <span className="mono">{verifyResponse.details.issuerAddress}</span>
                  </p>
                )}
                {verifyResponse.details?.revocationTimestamp > 0 && (
                  <p>
                    <strong>Revoked On-Chain At:</strong>{' '}
                    {new Date(verifyResponse.details.revocationTimestamp * 1000).toUTCString()}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: EVALUATION LOGS */}
      {activeTab === 'logs' && (
        <div className="card">
          <h2>Objective 3 Evaluation Logs (verification_logs Table)</h2>
          <p style={{ fontSize: '0.86rem', color: '#4a5568' }}>
            Automatically records every verification test scenario, outcome, and response time (ms) for
            Section 3.2.4 evaluation.
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
                  <td><strong>{L.scenario_type}</strong></td>
                  <td>
                    <span
                      className={`badge ${
                        L.result === 'GENUINE_AND_ACTIVE'
                          ? 'badge-green'
                          : L.result === 'GENUINE_BUT_REVOKED'
                          ? 'badge-amber'
                          : 'badge-red'
                      }`}
                    >
                      {L.result}
                    </span>
                  </td>
                  <td><strong>{L.response_time_ms} ms</strong></td>
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
      )}
    </div>
  );
}

