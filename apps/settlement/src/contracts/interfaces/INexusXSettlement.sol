// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title INexusXSettlement
/// @notice Interface for the NexusX settlement contract on Base L2.
/// @dev All amounts are in USDC's native 6-decimal precision.
interface INexusXSettlement {

    // ─────────────────────────────────────────────────────────
    // STRUCTS
    // ─────────────────────────────────────────────────────────

    /// @notice A single settlement item within a batch.
    /// @param provider     Address receiving the provider's share.
    /// @param amount       Total USDC amount for this item (before fee split).
    /// @param settlementId Off-chain UUID mapped to this item for reconciliation.
    struct SettlementItem {
        address provider;
        uint256 amount;
        bytes32 settlementId;
    }

    // ─────────────────────────────────────────────────────────
    // EVENTS
    // ─────────────────────────────────────────────────────────

    /// @notice Emitted when a buyer deposits USDC into escrow.
    event Deposited(address indexed buyer, uint256 amount);

    /// @notice Emitted when a buyer withdraws unspent USDC from escrow.
    event Withdrawn(address indexed buyer, uint256 amount);

    /// @notice Emitted for each item in a batch settlement.
    event Settled(
        bytes32 indexed settlementId,
        address indexed provider,
        uint256 providerAmount,
        uint256 platformFee,
        uint256 totalAmount
    );

    /// @notice Emitted when a batch settlement completes.
    event BatchSettled(
        uint256 indexed batchNonce,
        uint256 itemCount,
        uint256 totalAmount,
        uint256 totalPlatformFees
    );

    /// @notice Emitted when the platform treasury withdraws accumulated fees.
    event TreasuryWithdrawal(address indexed to, uint256 amount);

    /// @notice Emitted when the platform fee rate is updated.
    event FeeRateUpdated(uint256 oldRate, uint256 newRate);

    /// @notice Emitted when the settlement operator is updated.
    event OperatorUpdated(address indexed oldOperator, address indexed newOperator);

    /// @notice Emitted when the contract is paused or unpaused.
    event PauseStatusChanged(bool isPaused);

    // ─────────────────────────────────────────────────────────
    // BUYER FUNCTIONS
    // ─────────────────────────────────────────────────────────

    /// @notice Deposit USDC into escrow. Requires prior ERC-20 approval.
    /// @param amount USDC amount in 6-decimal precision.
    function deposit(uint256 amount) external;

    /// @notice Withdraw unspent USDC from escrow back to the buyer's wallet.
    /// @param amount USDC amount to withdraw.
    function withdraw(uint256 amount) external;

    /// @notice Returns the buyer's current escrow balance.
    /// @param buyer Address to query.
    /// @return Escrow balance in USDC (6 decimals).
    function escrowOf(address buyer) external view returns (uint256);

    // ─────────────────────────────────────────────────────────
    // SETTLEMENT (OPERATOR ONLY)
    // ─────────────────────────────────────────────────────────

    /// @notice Settle a batch of transactions. Debits buyer escrows,
    ///         splits each item into provider payment + platform fee,
    ///         and transfers provider shares immediately.
    /// @param buyer Address of the buyer being charged.
    /// @param items Array of settlement items to process.
    /// @return batchNonce Unique nonce for this batch.
    function settleBatch(
        address buyer,
        SettlementItem[] calldata items
    ) external returns (uint256 batchNonce);

    // ─────────────────────────────────────────────────────────
    // ADMIN FUNCTIONS
    // ─────────────────────────────────────────────────────────

    /// @notice Withdraw accumulated platform fees to the treasury.
    /// @param to Destination address.
    /// @param amount USDC amount to withdraw.
    function withdrawTreasury(address to, uint256 amount) external;

    /// @notice Update the platform fee rate.
    /// @param newFeeRateBps New fee rate in basis points (1200 = 12%).
    function setFeeRate(uint256 newFeeRateBps) external;

    /// @notice Update the settlement operator address.
    /// @param newOperator New operator address.
    function setOperator(address newOperator) external;

    /// @notice Pause or unpause the contract.
    /// @param paused True to pause, false to unpause.
    function setPaused(bool paused) external;

    // ─────────────────────────────────────────────────────────
    // VIEW FUNCTIONS
    // ─────────────────────────────────────────────────────────

    /// @notice Returns the current platform fee rate in basis points.
    function feeRateBps() external view returns (uint256);

    /// @notice Returns the total accumulated platform fees not yet withdrawn.
    function accumulatedFees() external view returns (uint256);

    /// @notice Returns the current batch nonce (number of batches processed).
    function batchNonce() external view returns (uint256);

    /// @notice Returns the USDC token address.
    function usdc() external view returns (address);

    /// @notice Returns the operator address.
    function operator() external view returns (address);

    /// @notice Returns the contract owner (admin).
    function owner() external view returns (address);

    /// @notice Returns whether the contract is paused.
    function paused() external view returns (bool);
}
