// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IUSDC
/// @notice Minimal ERC-20 interface for USDC on Base L2.
/// Base USDC contract: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
interface IUSDC {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function decimals() external view returns (uint8);
}
