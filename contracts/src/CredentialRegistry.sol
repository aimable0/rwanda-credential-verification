// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title CredentialRegistry
 * @notice Single-issuer hash-anchoring and mutable revocation registry for Rwandan credentials.
 * @dev Implements zero-storage verification: no personal data or documents are stored on-chain.
 */
contract CredentialRegistry {
    struct AnchoredCredential {
        bytes32 credentialHash;
        address issuer;
        uint256 issuedAt;
        bool exists;
    }

    // Maps human-usable reference_code -> AnchoredCredential record
    mapping(string => AnchoredCredential) private credentialsByRef;

    // Maps credential_hash -> issuer address (enforces single-issuer revocation rule)
    mapping(bytes32 => address) public hashIssuer;

    // On-chain RevocationStatus mapping (Figure 3.1 & Figure 3.3):
    // credential_hash -> revocation_timestamp (0 if active, >0 if revoked)
    mapping(bytes32 => uint256) public revocationTimestamps;

    // Auditability events (Section 3.3.2 Non-functional requirements)
    event CredentialIssued(
        string indexed referenceCodeIdx,
        string referenceCode,
        bytes32 indexed credentialHash,
        address indexed issuer,
        uint256 timestamp
    );

    event CredentialRevoked(
        bytes32 indexed credentialHash,
        address indexed issuer,
        uint256 revocationTimestamp
    );

    error ReferenceCodeAlreadyUsed();
    error HashAlreadyAnchored();
    error InvalidCredentialHash();
    error EmptyReferenceCode();
    error CredentialNotFound();
    error UnauthorizedIssuer();
    error CredentialAlreadyRevoked();

    /**
     * @notice Anchors a new credential hash and reference code on-chain, signed by the issuing institution.
     * @param _credentialHash SHA-256 hash of the salted structured credential fields
     * @param _referenceCode Short human-usable reference code (e.g., "RW-UNIVA-2026-8F3A")
     */
    function issueCredential(
        bytes32 _credentialHash,
        string calldata _referenceCode
    ) external {
        if (_credentialHash == bytes32(0)) revert InvalidCredentialHash();
        if (bytes(_referenceCode).length == 0) revert EmptyReferenceCode();
        if (credentialsByRef[_referenceCode].exists)
            revert ReferenceCodeAlreadyUsed();
        if (hashIssuer[_credentialHash] != address(0))
            revert HashAlreadyAnchored();

        credentialsByRef[_referenceCode] = AnchoredCredential({
            credentialHash: _credentialHash,
            issuer: msg.sender,
            issuedAt: block.timestamp,
            exists: true
        });

        hashIssuer[_credentialHash] = msg.sender;

        emit CredentialIssued(
            _referenceCode,
            _referenceCode,
            _credentialHash,
            msg.sender,
            block.timestamp
        );
    }

    /**
     * @notice Revokes an existing credential. Writable ONLY by the original issuing institution.
     * @param _credentialHash The bytes32 hash of the credential to revoke
     */
    function revoke(bytes32 _credentialHash) external {
        address originalIssuer = hashIssuer[_credentialHash];
        if (originalIssuer == address(0)) revert CredentialNotFound();
        if (originalIssuer != msg.sender) revert UnauthorizedIssuer();
        if (revocationTimestamps[_credentialHash] != 0)
            revert CredentialAlreadyRevoked();

        revocationTimestamps[_credentialHash] = block.timestamp;

        emit CredentialRevoked(_credentialHash, msg.sender, block.timestamp);
    }

    /**
     * @notice Checks revocation status directly by credential_hash (Figure 3.1 RevocationStatus.check_status)
     * @param _credentialHash The bytes32 hash of the credential
     * @return revocationTimestamp 0 if active/not revoked, >0 timestamp if revoked
     */
    function checkStatus(
        bytes32 _credentialHash
    ) external view returns (uint256 revocationTimestamp) {
        return revocationTimestamps[_credentialHash];
    }

    /**
     * @notice Retrieves the anchored record and revocation status for a reference code (Figure 3.5b Steps 5-8)
     * @param _referenceCode The reference code printed on the credential
     */
    function getRecordByReferenceCode(
        string calldata _referenceCode
    )
        external
        view
        returns (
            bytes32 credentialHash,
            address issuer,
            uint256 issuedAt,
            uint256 revocationTimestamp,
            bool exists
        )
    {
        AnchoredCredential memory cred = credentialsByRef[_referenceCode];
        if (!cred.exists) {
            return (bytes32(0), address(0), 0, 0, false);
        }
        return (
            cred.credentialHash,
            cred.issuer,
            cred.issuedAt,
            revocationTimestamps[cred.credentialHash],
            true
        );
    }
}
