// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/CredentialRegistry.sol";

contract DeployCredentialRegistry is Script {
    function run() external returns (CredentialRegistry) {
        vm.startBroadcast();
        CredentialRegistry registry = new CredentialRegistry();
        vm.stopBroadcast();
        return registry;
    }
}
