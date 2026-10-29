// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title CredentialRegistry
 * @notice Hash-anchoring and revocation registry for Rwandan credentials, with issuer
 *         accreditation controlled by a single HEC (Higher Education Council) wallet.
 * @dev Zero-storage verification: no personal data or documents are stored on-chain.
 *      Only issuers accredited by HEC can anchor credentials. Each credential keeps its
 *      original issuer, and only that issuer can revoke it.
 */
contract CredentialRegistry {
    struct AnchoredCredential {
        bytes32 credentialHash;
        address issuer;
        uint256 issuedAt;
        bool exists;
    }

    /// @notice The HEC wallet. The only address that can accredit or suspend issuers.
    address public immutable hec;

    /// @notice Issuers currently allowed to anchor new credentials.
    mapping(address => bool) public accreditedIssuers;

    // Maps human-usable reference_code -> AnchoredCredential record
    mapping(string => AnchoredCredential) private credentialsByRef;

    // Maps credential_hash -> issuer address (enforces single-issuer revocation rule)
    mapping(bytes32 => address) public hashIssuer;

    // credential_hash -> revocation_timestamp (0 if active, >0 if revoked)
    mapping(bytes32 => uint256) public revocationTimestamps;

    // Auditability events
    event IssuerAccredited(address indexed issuer, uint256 timestamp);
    event IssuerSuspended(address indexed issuer, uint256 timestamp);

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

    error NotHec();
    error ZeroAddress();
    error NotAccreditedIssuer();
    error ReferenceCodeAlreadyUsed();
    error HashAlreadyAnchored();
    error InvalidCredentialHash();
    error EmptyReferenceCode();
    error CredentialNotFound();
    error UnauthorizedIssuer();
    error CredentialAlreadyRevoked();

    modifier onlyHec() {
        if (msg.sender != hec) revert NotHec();
        _;
    }

    /// @param _hec The wallet that represents HEC. It does not have to be the deployer.
    constructor(address _hec) {
        if (_hec == address(0)) revert ZeroAddress();
        hec = _hec;
    }

    /**
     * @notice HEC approves an institution wallet to anchor credentials.
     * @dev Safe to call again for an already accredited or a suspended issuer.
     */
    function accreditIssuer(address _issuer) external onlyHec {
        if (_issuer == address(0)) revert ZeroAddress();
        accreditedIssuers[_issuer] = true;
        emit IssuerAccredited(_issuer, block.timestamp);
    }

    /**
     * @notice HEC stops an issuer from anchoring new credentials.
     * @dev Credentials the issuer already anchored stay valid, and the issuer can still
     *      revoke its own credentials.
     */
    function suspendIssuer(address _issuer) external onlyHec {
        accreditedIssuers[_issuer] = false;
        emit IssuerSuspended(_issuer, block.timestamp);
    }

    /**
     * @notice Anchors a new credential hash and reference code, signed by an accredited issuer.
     * @param _credentialHash SHA-256 hash of the structured credential fields
     * @param _referenceCode The unique certificate number printed on the credential
     */
    function issueCredential(
        bytes32 _credentialHash,
        string calldata _referenceCode
    ) external {
        if (!accreditedIssuers[msg.sender]) revert NotAccreditedIssuer();
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
    function revokeCredential(bytes32 _credentialHash) external {
        address originalIssuer = hashIssuer[_credentialHash];
        if (originalIssuer == address(0)) revert CredentialNotFound();
        if (originalIssuer != msg.sender) revert UnauthorizedIssuer();
        if (revocationTimestamps[_credentialHash] != 0)
            revert CredentialAlreadyRevoked();

        revocationTimestamps[_credentialHash] = block.timestamp;

        emit CredentialRevoked(_credentialHash, msg.sender, block.timestamp);
    }

    /**
     * @notice Checks revocation status directly by credential_hash
     * @param _credentialHash The bytes32 hash of the credential
     * @return revocationTimestamp 0 if active/not revoked, >0 timestamp if revoked
     */
    function checkStatus(
        bytes32 _credentialHash
    ) external view returns (uint256 revocationTimestamp) {
        return revocationTimestamps[_credentialHash];
    }

    /**
     * @notice Retrieves the anchored record and revocation status for a reference code
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
