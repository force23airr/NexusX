// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {NexusXSettlement} from "../contracts/NexusXSettlement.sol";

/// @title DeploySettlement
/// @notice Foundry script to deploy NexusXSettlement to Base L2.
///
/// Usage:
///   Base Sepolia (testnet):
///     forge script scripts/Deploy.s.sol --rpc-url base-sepolia --broadcast --verify
///
///   Base Mainnet:
///     forge script scripts/Deploy.s.sol --rpc-url base --broadcast --verify
///
/// Required env vars:
///   DEPLOYER_PRIVATE_KEY  — Private key for the deploying wallet.
///   ADMIN_ADDRESS         — Multisig or EOA that will own the contract.
///   OPERATOR_ADDRESS      — Backend settlement service address.
///   INITIAL_FEE_BPS       — Fee rate in basis points (default: 1200 = 12%).
contract DeploySettlement is Script {

    // Base L2 Mainnet USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
    // Base Sepolia USDC:    0x036CbD53842c5426634e7929541eC2318f3dCF7e
    address constant BASE_MAINNET_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant BASE_SEPOLIA_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address admin = vm.envAddress("ADMIN_ADDRESS");
        address ops = vm.envAddress("OPERATOR_ADDRESS");
        uint256 feeBps = vm.envOr("INITIAL_FEE_BPS", uint256(1200));

        // Auto-detect USDC address based on chain ID.
        address usdcAddr;
        if (block.chainid == 8453) {
            usdcAddr = BASE_MAINNET_USDC;
            console.log("Deploying to Base Mainnet");
        } else if (block.chainid == 84532) {
            usdcAddr = BASE_SEPOLIA_USDC;
            console.log("Deploying to Base Sepolia");
        } else {
            revert("Unsupported chain. Use Base Mainnet (8453) or Base Sepolia (84532).");
        }

        console.log("USDC:", usdcAddr);
        console.log("Admin:", admin);
        console.log("Operator:", ops);
        console.log("Fee rate (bps):", feeBps);

        vm.startBroadcast(deployerKey);

        NexusXSettlement settlement = new NexusXSettlement(
            usdcAddr,
            admin,
            ops,
            feeBps
        );

        vm.stopBroadcast();

        console.log("NexusXSettlement deployed at:", address(settlement));
    }
}
