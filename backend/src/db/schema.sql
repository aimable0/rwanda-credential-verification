-- Drop tables in correct order if re-initializing
DROP TABLE IF EXISTS verification_logs CASCADE;
DROP TABLE IF EXISTS credentials CASCADE;
DROP TABLE IF EXISTS institutions CASCADE;

-- 1. institutions table (Figure 3.3 ERD)
CREATE TABLE institutions (
    institution_id SERIAL PRIMARY KEY,
    code VARCHAR(20) UNIQUE NOT NULL,              -- e.g., 'UNIVA', 'UNIVB', 'FAKEU'
    name VARCHAR(255) NOT NULL,                    -- Full institution name
    institution_type VARCHAR(50) NOT NULL,         -- 'UNIVERSITY' or 'LICENSING_BODY'
    wallet_address VARCHAR(42) UNIQUE,             -- Ethereum address (0x...) bound at onboarding
    accreditation_status VARCHAR(50) NOT NULL      -- 'ACCREDITED' or 'UNACCREDITED'
);

-- 2. credentials table (Figure 3.3 ERD)
CREATE TABLE credentials (
    credential_id SERIAL PRIMARY KEY,
    institution_id INTEGER NOT NULL REFERENCES institutions(institution_id) ON DELETE RESTRICT,
    reference_code VARCHAR(100) UNIQUE NOT NULL,   -- Printed certificate number or generated code
    credential_hash VARCHAR(66) UNIQUE NOT NULL,   -- 0x + 64 hex chars (bytes32 SHA-256 over 7 fields + salt)
    salt VARCHAR(64) NOT NULL,                     -- Unique random salt per credential
    holder_reference VARCHAR(100) NOT NULL,        -- Opaque registrar reference / masked ID (non-PII)
    issuance_date DATE NOT NULL,                   -- ISO awardDate (YYYY-MM-DD)
    credential_type VARCHAR(100) NOT NULL          -- e.g., 'ACADEMIC_DEGREE', 'PROFESSIONAL_LICENSE'
);

-- 3. verification_logs table (Figure 3.3 ERD - Supports Section 3.2.4 Evaluation)
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

-- Seed Scoped Institutions (Section 1.5 Project Scope)
INSERT INTO institutions (code, name, institution_type, wallet_address, accreditation_status)
VALUES
    ('UNIVA', 'University A', 'UNIVERSITY', '0xFc1311749B672F3E5F5c3B3ecebbb03C6FD5BaC9', 'ACCREDITED'),
    ('UNIVB', 'University B', 'UNIVERSITY', NULL, 'ACCREDITED'),
    ('FAKEU', 'Unaccredited Diploma Mill Institute', 'UNIVERSITY', NULL, 'UNACCREDITED');
