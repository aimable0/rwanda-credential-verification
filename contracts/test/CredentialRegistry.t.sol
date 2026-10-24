// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/CredentialRegistry.sol";

contract CredentialRegistryTest is Test {
    CredentialRegistry public registry;

    // Mocked institutions per Section 1.5 Project Scope
    address public universityA = makeAddr("UniversityA");
    address public universityB = makeAddr("UniversityB");

    bytes32 public sampleHash =
        sha256(
            abi.encodePacked(
                "ALU|RW-ALU-2023-001|AIMABLE NKURIKIYIMANA|BACHELOR OF SCIENCE|SOFTWARE ENGINEERING|FIRST_CLASS_HONOURS|2023-11-17|random_salt_123"
            )
        );
    string public sampleRefCode = "RW-UNIVA-001";

    function setUp() public {
        registry = new CredentialRegistry();
    }

    function test_IssueCredential_Success() public {
        vm.warp(1780000000); // Set deterministic block timestamp
        vm.prank(universityA);
        registry.issueCredential(sampleHash, sampleRefCode);

        (
            bytes32 anchoredHash,
            address issuer,
            uint256 issuedAt,
            uint256 revocationTimestamp,
            bool exists
        ) = registry.getRecordByReferenceCode(sampleRefCode);

        assertTrue(exists);
        assertEq(anchoredHash, sampleHash);
        assertEq(issuer, universityA);
        assertEq(issuedAt, 1780000000);
        assertEq(revocationTimestamp, 0);
    }

    function test_RevokeCredential_ByOriginalIssuer() public {
        vm.prank(universityA);
        registry.issueCredential(sampleHash, sampleRefCode);

        vm.warp(1780050000);
        vm.prank(universityA);
        registry.revoke(sampleHash);

        uint256 revTime = registry.checkStatus(sampleHash);
        assertEq(revTime, 1780050000);

        (, , , uint256 revocationTimestamp, ) = registry
            .getRecordByReferenceCode(sampleRefCode);
        assertEq(revocationTimestamp, 1780050000);
    }

    function test_RevertWhen_AnotherInstitutionTriesToRevoke() public {
        vm.prank(universityA);
        registry.issueCredential(sampleHash, sampleRefCode);

        // University B attempts to revoke University A's credential -> must revert
        vm.prank(universityB);
        vm.expectRevert(CredentialRegistry.UnauthorizedIssuer.selector);
        registry.revoke(sampleHash);
    }

    function test_UnissuedReferenceCode_ReturnsNotFound() public view {
        (, , , , bool exists) = registry.getRecordByReferenceCode(
            "FAKE-REF-999"
        );
        assertFalse(exists);
    }
}
