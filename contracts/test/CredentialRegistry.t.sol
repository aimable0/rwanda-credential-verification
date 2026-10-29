// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/CredentialRegistry.sol";

contract CredentialRegistryTest is Test {
    CredentialRegistry public registry;

    address public hec = address(0xEC);
    address public univA = address(0x1111);
    address public univB = address(0x2222);
    address public outsider = address(0x9999);

    // Redeclared so the test also compiles on Solidity 0.8.20 (events cannot be
    // referenced through the contract name before 0.8.21)
    event IssuerAccredited(address indexed issuer, uint256 timestamp);

    bytes32 public sampleHash = keccak256("UNIVA|220001624|HOLDER|BSC|SE|FIRST_CLASS_HONOURS|2026-06-15");
    string public sampleRef = "220001624";

    function setUp() public {
        registry = new CredentialRegistry(hec);
        vm.startPrank(hec);
        registry.accreditIssuer(univA);
        registry.accreditIssuer(univB);
        vm.stopPrank();
    }

    // ---------- HEC control ----------

    function testHecIsSetFromConstructor() public view {
        assertEq(registry.hec(), hec);
    }

    function testConstructorRejectsZeroHec() public {
        vm.expectRevert(CredentialRegistry.ZeroAddress.selector);
        new CredentialRegistry(address(0));
    }

    function testOnlyHecCanAccredit() public {
        vm.prank(univA);
        vm.expectRevert(CredentialRegistry.NotHec.selector);
        registry.accreditIssuer(outsider);
    }

    function testOnlyHecCanSuspend() public {
        vm.prank(univA);
        vm.expectRevert(CredentialRegistry.NotHec.selector);
        registry.suspendIssuer(univB);
    }

    function testAccreditEmitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit IssuerAccredited(outsider, block.timestamp);
        vm.prank(hec);
        registry.accreditIssuer(outsider);
        assertTrue(registry.accreditedIssuers(outsider));
    }

    // ---------- Issuance ----------

    function testAccreditedIssuerCanIssueAndVerify() public {
        vm.prank(univA);
        registry.issueCredential(sampleHash, sampleRef);

        (bytes32 credHash, address issuer, uint256 issuedAt, uint256 revokedAt, bool exists) =
            registry.getRecordByReferenceCode(sampleRef);

        assertTrue(exists);
        assertEq(credHash, sampleHash);
        assertEq(issuer, univA);
        assertGt(issuedAt, 0);
        assertEq(revokedAt, 0);
    }

    function testUnaccreditedWalletCannotIssue() public {
        vm.prank(outsider);
        vm.expectRevert(CredentialRegistry.NotAccreditedIssuer.selector);
        registry.issueCredential(sampleHash, sampleRef);
    }

    function testSuspendedIssuerCannotIssueNewButOldStaysValid() public {
        vm.prank(univA);
        registry.issueCredential(sampleHash, sampleRef);

        vm.prank(hec);
        registry.suspendIssuer(univA);

        vm.prank(univA);
        vm.expectRevert(CredentialRegistry.NotAccreditedIssuer.selector);
        registry.issueCredential(keccak256("other"), "OTHER-1");

        (, , , uint256 revokedAt, bool exists) = registry.getRecordByReferenceCode(sampleRef);
        assertTrue(exists);
        assertEq(revokedAt, 0);
    }

    function testReinstatedIssuerCanIssueAgain() public {
        vm.startPrank(hec);
        registry.suspendIssuer(univA);
        registry.accreditIssuer(univA);
        vm.stopPrank();

        vm.prank(univA);
        registry.issueCredential(sampleHash, sampleRef);
    }

    function testDuplicateReferenceCodeReverts() public {
        vm.prank(univA);
        registry.issueCredential(sampleHash, sampleRef);

        vm.prank(univB);
        vm.expectRevert(CredentialRegistry.ReferenceCodeAlreadyUsed.selector);
        registry.issueCredential(keccak256("different"), sampleRef);
    }

    function testDuplicateHashReverts() public {
        vm.prank(univA);
        registry.issueCredential(sampleHash, sampleRef);

        vm.prank(univB);
        vm.expectRevert(CredentialRegistry.HashAlreadyAnchored.selector);
        registry.issueCredential(sampleHash, "ANOTHER-REF");
    }

    function testEmptyInputsRevert() public {
        vm.startPrank(univA);
        vm.expectRevert(CredentialRegistry.InvalidCredentialHash.selector);
        registry.issueCredential(bytes32(0), sampleRef);
        vm.expectRevert(CredentialRegistry.EmptyReferenceCode.selector);
        registry.issueCredential(sampleHash, "");
        vm.stopPrank();
    }

    // ---------- Revocation ----------

    function testOnlyOriginalIssuerCanRevoke() public {
        vm.prank(univA);
        registry.issueCredential(sampleHash, sampleRef);

        vm.prank(univB);
        vm.expectRevert(CredentialRegistry.UnauthorizedIssuer.selector);
        registry.revokeCredential(sampleHash);

        vm.prank(hec);
        vm.expectRevert(CredentialRegistry.UnauthorizedIssuer.selector);
        registry.revokeCredential(sampleHash);

        vm.prank(univA);
        registry.revokeCredential(sampleHash);
        assertGt(registry.checkStatus(sampleHash), 0);
    }

    function testSuspendedIssuerCanStillRevokeOwnCredential() public {
        vm.prank(univA);
        registry.issueCredential(sampleHash, sampleRef);

        vm.prank(hec);
        registry.suspendIssuer(univA);

        vm.prank(univA);
        registry.revokeCredential(sampleHash);
        assertGt(registry.checkStatus(sampleHash), 0);
    }

    function testRevokeTwiceReverts() public {
        vm.startPrank(univA);
        registry.issueCredential(sampleHash, sampleRef);
        registry.revokeCredential(sampleHash);
        vm.expectRevert(CredentialRegistry.CredentialAlreadyRevoked.selector);
        registry.revokeCredential(sampleHash);
        vm.stopPrank();
    }

    function testRevokeUnknownReverts() public {
        vm.prank(univA);
        vm.expectRevert(CredentialRegistry.CredentialNotFound.selector);
        registry.revokeCredential(sampleHash);
    }
}
