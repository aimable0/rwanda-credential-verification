// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/CredentialRegistry.sol";

contract DeployCredentialRegistry is Script {
    function run() external returns (CredentialRegistry) {
        // The wallet that acts as HEC. Set HEC_ADDRESS in contracts/.env.
        address hec = vm.envAddress("HEC_ADDRESS");

        vm.startBroadcast();
        CredentialRegistry registry = new CredentialRegistry(hec);
        vm.stopBroadcast();
        return registry;
    }
}
