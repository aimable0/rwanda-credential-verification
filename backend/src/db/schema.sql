-- Drop tables in correct order if re-initializing
DROP TABLE IF EXISTS verification_logs CASCADE;
DROP TABLE IF EXISTS credentials CASCADE;
DROP TABLE IF EXISTS institutions CASCADE;

-- 1. institutions table
-- accreditation_status lifecycle:
--   UNREGISTERED -> PENDING (institution applies) -> ACCREDITED (HEC approves on-chain)
--   PENDING -> REJECTED (HEC rejects; the institution may apply again)
--   ACCREDITED -> SUSPENDED (HEC suspends on-chain; HEC can approve again later)
-- The HEC wallet itself is not stored here. It is the immutable `hec` address in the contract.
CREATE TABLE institutions (
    institution_id SERIAL PRIMARY KEY,
    code VARCHAR(20) UNIQUE NOT NULL,              -- e.g., 'UNIVA', 'UNIVB', 'FAKEU'
    name VARCHAR(255) NOT NULL,                    -- Full institution name
    institution_type VARCHAR(50) NOT NULL,         -- 'UNIVERSITY' or 'LICENSING_BODY'
    wallet_address VARCHAR(42) UNIQUE,             -- Applicant wallet, always stored in lowercase
    accreditation_status VARCHAR(20) NOT NULL DEFAULT 'UNREGISTERED',
    requested_at TIMESTAMPTZ,                      -- When the current application was sent
    decided_at TIMESTAMPTZ,                        -- When HEC last approved, rejected or suspended
    CONSTRAINT institutions_status_check CHECK (
        accreditation_status IN ('UNREGISTERED', 'PENDING', 'ACCREDITED', 'REJECTED', 'SUSPENDED')
    ),
    CONSTRAINT institutions_wallet_lowercase CHECK (
        wallet_address IS NULL OR wallet_address = LOWER(wallet_address)
    )
);

-- 2. credentials table
-- No salt column: the unique certificate number (reference_code) is part of the hashed input.
CREATE TABLE credentials (
    credential_id SERIAL PRIMARY KEY,
    institution_id INTEGER NOT NULL REFERENCES institutions(institution_id) ON DELETE RESTRICT,
    reference_code VARCHAR(100) UNIQUE NOT NULL,   -- Unique number printed on the certificate
    credential_hash VARCHAR(66) UNIQUE NOT NULL,   -- 0x + 64 hex chars (bytes32 SHA-256 over the 7 fields)
    holder_reference VARCHAR(100) NOT NULL,        -- Opaque registrar reference / masked ID (non-PII)
    issuance_date DATE NOT NULL,                   -- ISO awardDate (YYYY-MM-DD)
    credential_type VARCHAR(100) NOT NULL          -- e.g., 'ACADEMIC_DEGREE', 'PROFESSIONAL_LICENSE'
);

-- 3. verification_logs table (supports Section 3.2.4 evaluation)
CREATE TABLE verification_logs (
    log_id SERIAL PRIMARY KEY,
    reference_code VARCHAR(100) NOT NULL,
    scenario_type VARCHAR(50) NOT NULL,            -- 'GENUINE', 'TAMPERED', 'FABRICATED', 'REVOKED'
    result VARCHAR(50) NOT NULL,                   -- 'GENUINE_AND_ACTIVE', 'GENUINE_BUT_REVOKED', 'MISMATCH_OR_NOT_FOUND'
    timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    response_time_ms INTEGER NOT NULL
);

CREATE INDEX idx_credentials_reference_code ON credentials(reference_code);
CREATE INDEX idx_verification_logs_reference_code ON verification_logs(reference_code);

-- Registry entries. Every institution starts without a wallet and must apply to HEC.
INSERT INTO institutions (code, name, institution_type, wallet_address, accreditation_status)
VALUES
    ('UNIVA', 'University A', 'UNIVERSITY', NULL, 'UNREGISTERED'),
    ('UNIVB', 'University B', 'UNIVERSITY', NULL, 'UNREGISTERED'),
    ('FAKEU', 'Unaccredited Diploma Mill Institute', 'UNIVERSITY', NULL, 'UNREGISTERED');
