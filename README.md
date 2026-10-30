# Rwanda Blockchain Credential Verification Platform

A web platform where accredited institutions anchor degree and licence credentials on Ethereum Sepolia, and anyone can check a certificate by scanning its QR code or entering the details printed on it. Institutions join only after the HEC admin wallet approves them, and the smart contract enforces that rule.

- **Live demo:** [LIVE_URL]
- **Video walkthrough:** [VIDEO_URL]
- **Technical report:** [REPORT_URL]
- **Contract on Sepolia:** [`CONTRACT_ADDRESS`](https://sepolia.etherscan.io/address/CONTRACT_ADDRESS)

<!-- Add a screenshot of the verification result here: docs/images/verify-genuine.png -->
![Verification result](docs/images/verify-genuine.png)

## How it works

1. **Onboarding.** An institution applies with its registrar wallet. The HEC wallet approves the request by sending `accreditIssuer(wallet)` to the contract. Only wallets on that list can anchor credentials.
2. **Issuing.** The institution enters seven fields (institution, certificate number, holder name, degree title, programme, classification, award date). The backend builds the reference code (`<INSTITUTION>-<certificate number>`, for example `UNIVA-220001624`), computes a SHA-256 hash, and the institution signs `issueCredential(hash, referenceCode)` in MetaMask.
3. **Verifying.** A verifier scans the QR code or opens the verify page, and re-enters the printed fields. The backend recomputes the hash, reads the record from the contract, checks the issuer and the revocation status, and returns one of three outcomes: *Genuine and active*, *Genuine but revoked*, or *Mismatch or not found*.

The blockchain stores only the hash and the reference code. No names, titles or dates are written on-chain. The reference code is hashed together with the other fields and takes the place of a random salt.

A certificate number is unique per institution. One institution cannot use the same number twice, but another institution can use it, because the institution code is part of the reference code.

## Roles

| Role | Needs a wallet | Can do |
|---|---|---|
| Verifier | No | Verify a credential at `/verify` |
| Institution | Yes (registrar wallet) | Apply for accreditation, issue and revoke its own credentials |
| HEC admin | Yes (the `hec` address in the contract) | Approve, reject, suspend and reinstate institutions, read the evaluation logs |

## Features

- On-chain accreditation list controlled by HEC (`accreditIssuer`, `suspendIssuer`)
- Wallet sign-in (nonce, MetaMask signature, short-lived token) and per-institution access control
- QR code and reference code for every issued credential
- Revocation by the original issuer only
- Verification results that reveal no record details on a mismatch
- Evaluation log of every verification with outcome and response time
- Separate areas and headers for verifiers, institutions and HEC, plus light and dark themes

## Tech stack

| Layer | Technology |
|---|---|
| Smart contract | Solidity 0.8.20, Foundry |
| Backend | Node.js, Express, TypeScript, PostgreSQL, ethers v6 |
| Frontend | React, Vite, TypeScript, React Router, ethers v6 |
| Network | Ethereum Sepolia testnet |
| Hosting | Nginx, pm2, PostgreSQL on a DigitalOcean droplet |

## Repository structure

```
.
├── contracts/   Foundry project: CredentialRegistry.sol, tests, deploy script
├── backend/     Express API: routes, wallet auth, hashing, database schema
├── frontend/    React app
└── DEPLOY.md    Server deployment guide
```

## Prerequisites

- Node.js 20.19 or newer (22 recommended)
- PostgreSQL 14 or newer
- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- MetaMask with three accounts: one for HEC, one for each demo institution
- A Sepolia RPC URL (Alchemy or Infura) and some Sepolia test ETH in each account

## Installation

### 1. Clone

```bash
git clone [REPO_URL]
cd [REPO_FOLDER]
```

### 2. Smart contract

Create `contracts/.env`:

```
SEPOLIA_RPC_URL=<your Sepolia RPC URL>
HEC_ADDRESS=<address of the account that acts as HEC>
```

```bash
cd contracts
forge test                                   # 16 tests should pass
source .env
forge create src/CredentialRegistry.sol:CredentialRegistry \
  --rpc-url sepolia \
  --account <your-foundry-keystore> \
  --evm-version paris \
  --broadcast \
  --constructor-args $HEC_ADDRESS
```

Copy the `Deployed to:` address. The HEC account does not have to be the deployer.

### 3. Database

```bash
createdb rwanda_credentials_db
psql rwanda_credentials_db -f backend/src/db/schema.sql
```

`schema.sql` drops and recreates all tables, so run it only on a new database. It seeds three institutions (UNIVA, UNIVB, FAKEU) that have not applied yet.

### 4. Backend

Create `backend/.env`:

```
PORT=4000
DATABASE_URL=postgresql://<user>:<password>@localhost/rwanda_credentials_db
SEPOLIA_RPC_URL=<your Sepolia RPC URL>
CONTRACT_ADDRESS=<address from step 2>
AUTH_SECRET=<run: openssl rand -hex 32>
FRONTEND_URL=http://localhost:5173
```

```bash
cd backend
npm install
npm run build
npm start          # http://localhost:4000/api/health
```

### 5. Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

The frontend reads the API address from `VITE_API_BASE` (default `http://localhost:4000/api`). A production build uses `VITE_API_BASE=/api` behind Nginx.

## Try it

1. Open the app with the HEC account and check that **HEC admin** works at `/admin`.
2. Switch to the UNIVA account, open **Institution sign in**, and apply. The status becomes *Pending*.
3. Switch back to HEC, open `/admin`, and approve UNIVA. MetaMask asks you to sign one transaction.
4. As UNIVA, open **Issue credentials**, sign in with MetaMask, and issue a credential. Keep the QR code.
5. Open `/verify` (or scan the QR code), enter the printed details, and verify. The result is *Genuine and active*.
6. Change one letter in the name and verify again. The result is *Mismatch or not found* and shows no record details.
7. Revoke the credential as UNIVA and verify again. The result is *Genuine but revoked*.

<!-- Add screenshots: docs/images/hec-admin.png, docs/images/issue-credential.png -->
![HEC admin](docs/images/hec-admin.png)
![Issue credential](docs/images/issue-credential.png)

## Testing

```bash
cd contracts && forge test
```

The Foundry suite covers HEC-only accreditation, rejection of unaccredited issuers, duplicate reference codes and hashes, issuer-only revocation, and suspension behaviour.

To summarise the evaluation runs recorded by the verifier (HEC admin can also see them at `/logs`):

```sql
SELECT scenario_type, result, COUNT(*) AS runs,
       ROUND(AVG(response_time_ms)) AS avg_ms,
       MIN(response_time_ms) AS min_ms, MAX(response_time_ms) AS max_ms
FROM verification_logs
GROUP BY scenario_type, result
ORDER BY scenario_type;
```

## API summary

| Method and path | Access | Purpose |
|---|---|---|
| `GET /api/health` | Public | Contract and HEC address |
| `GET /api/institutions` | Public | Institutions and their status |
| `POST /api/auth/nonce`, `POST /api/auth/login` | Public | Wallet sign-in |
| `POST /api/institutions/apply` | Signed-in wallet | Apply for accreditation |
| `POST /api/admin/institutions/:code/approve`, `reject`, `suspend` | HEC wallet | Review applications |
| `POST /api/credentials/prepare` | Accredited institution | Hash a credential and create its QR code |
| `GET /api/credentials?institutionCode=` | Accredited institution | List its credentials and revocation status |
| `POST /api/credentials/verify` | Public | Verify a credential |
| `GET /api/logs` | HEC wallet | Evaluation logs |

## Security and privacy notes

- The contract rejects `issueCredential` from any wallet HEC has not accredited, even if the backend is bypassed.
- Only the original issuer can revoke a credential.
- Sign-in nonces are single use and expire in 5 minutes. Tokens are HMAC-signed, last 2 hours and are tied to one wallet.
- The server holds no private keys.
- A failed verification returns the outcome only, with no hashes or issuer details.

## Known limitations

- Runs on the Sepolia test network, not on a production chain.
- One HEC wallet controls accreditation. A multi-signature wallet would be the next step.
- Without a random salt, someone who knows a certificate number can test guesses of the other fields against the on-chain hash.
- The system checks a certificate's details, not the identity of the person presenting it.

## Author

Aimable Nkurikiyimana, African Leadership University, 2026.
