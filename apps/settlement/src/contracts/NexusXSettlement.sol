// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IUSDC} from "./interfaces/IUSDC.sol";
import {INexusXSettlement} from "./interfaces/INexusXSettlement.sol";

/// @title NexusXSettlement
/// @author NexusX (SwiftShopr Inc)
/// @notice Settlement contract for the NexusX AI Data & API Marketplace.
///
/// Architecture:
///   1. Buyers deposit USDC into on-chain escrow.
///   2. The off-chain auction engine prices each API call.
///   3. The settlement operator batches transactions and calls settleBatch().
///   4. For each item, the contract debits buyer escrow, pays the provider
///      their share (totalAmount - platformFee), and accrues the platform fee.
///   5. Platform fees are withdrawn to treasury by the admin.
///
/// Security model:
///   - Owner (admin): Can set fee rate, change operator, pause, withdraw treasury.
///   - Operator: Can call settleBatch(). This is the backend settlement service.
///   - Buyers: Can deposit/withdraw their own escrow at any time (when not paused).
///   - ReentrancyGuard on all state-mutating functions.
///   - All USDC transfers use SafeTransfer patterns with return-value checks.
///
/// Deployed on Base L2 (chainId 8453).
/// USDC on Base: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
contract NexusXSettlement is INexusXSettlement {

    // ─────────────────────────────────────────────────────────
    // CONSTANTS
    // ─────────────────────────────────────────────────────────

    /// @notice Maximum fee rate: 25% (2500 bps). Safety cap.
    uint256 public constant MAX_FEE_RATE_BPS = 2500;

    /// @notice Basis points denominator.
    uint256 public constant BPS_DENOMINATOR = 10000;

    /// @notice Maximum items per batch to bound gas consumption.
    uint256 public constant MAX_BATCH_SIZE = 100;

    // ─────────────────────────────────────────────────────────
    // STATE
    // ─────────────────────────────────────────────────────────

    /// @notice USDC token contract.
    IUSDC public immutable override usdc;

    /// @notice Contract owner (admin).
    address public override owner;

    /// @notice Settlement operator (backend service).
    address public override operator;

    /// @notice Platform fee rate in basis points (1200 = 12%).
    uint256 public override feeRateBps;

    /// @notice Accumulated platform fees available for treasury withdrawal.
    uint256 public override accumulatedFees;

    /// @notice Monotonically increasing batch counter.
    uint256 public override batchNonce;

    /// @notice Emergency pause flag.
    bool public override paused;

    /// @notice Buyer address → escrowed USDC balance.
    mapping(address => uint256) private _escrows;

    /// @notice Reentrancy guard state.
    uint256 private _reentrancyStatus;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    /// @notice Settlement ID → whether it has been processed.
    /// Prevents double-settlement of the same off-chain batch.
    mapping(bytes32 => bool) public settlementProcessed;

    // ─────────────────────────────────────────────────────────
    // MODIFIERS
    // ─────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "NXS: caller is not owner");
        _;
    }

    modifier onlyOperator() {
        require(msg.sender == operator, "NXS: caller is not operator");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "NXS: contract is paused");
        _;
    }

    modifier nonReentrant() {
        require(_reentrancyStatus != _ENTERED, "NXS: reentrant call");
        _reentrancyStatus = _ENTERED;
        _;
        _reentrancyStatus = _NOT_ENTERED;
    }

    // ─────────────────────────────────────────────────────────
    // CONSTRUCTOR
    // ─────────────────────────────────────────────────────────

    /// @param _usdc        USDC token address on Base L2.
    /// @param _owner       Admin address (multisig recommended).
    /// @param _operator    Backend settlement service address.
    /// @param _feeRateBps  Initial fee rate in basis points (e.g. 1200 = 12%).
    constructor(
        address _usdc,
        address _owner,
        address _operator,
        uint256 _feeRateBps
    ) {
        require(_usdc != address(0), "NXS: zero USDC address");
        require(_owner != address(0), "NXS: zero owner address");
        require(_operator != address(0), "NXS: zero operator address");
        require(_feeRateBps <= MAX_FEE_RATE_BPS, "NXS: fee rate exceeds max");

        usdc = IUSDC(_usdc);
        owner = _owner;
        operator = _operator;
        feeRateBps = _feeRateBps;
        _reentrancyStatus = _NOT_ENTERED;
    }

    // ─────────────────────────────────────────────────────────
    // BUYER FUNCTIONS
    // ─────────────────────────────────────────────────────────

    /// @inheritdoc INexusXSettlement
    function deposit(uint256 amount) external override whenNotPaused nonReentrant {
        require(amount > 0, "NXS: zero deposit");

        // Transfer USDC from buyer to this contract.
        // Buyer must have called usdc.approve(thisContract, amount) first.
        bool success = usdc.transferFrom(msg.sender, address(this), amount);
        require(success, "NXS: USDC transfer failed");

        _escrows[msg.sender] += amount;

        emit Deposited(msg.sender, amount);
    }

    /// @inheritdoc INexusXSettlement
    function withdraw(uint256 amount) external override whenNotPaused nonReentrant {
        require(amount > 0, "NXS: zero withdrawal");
        require(_escrows[msg.sender] >= amount, "NXS: insufficient escrow");

        // Debit escrow BEFORE transfer (checks-effects-interactions).
        _escrows[msg.sender] -= amount;

        bool success = usdc.transfer(msg.sender, amount);
        require(success, "NXS: USDC transfer failed");

        emit Withdrawn(msg.sender, amount);
    }

    /// @inheritdoc INexusXSettlement
    function escrowOf(address buyer) external view override returns (uint256) {
        return _escrows[buyer];
    }

    // ─────────────────────────────────────────────────────────
    // SETTLEMENT
    // ─────────────────────────────────────────────────────────

    /// @inheritdoc INexusXSettlement
    function settleBatch(
        address buyer,
        SettlementItem[] calldata items
    ) external override onlyOperator whenNotPaused nonReentrant returns (uint256) {
        uint256 itemCount = items.length;
        require(itemCount > 0, "NXS: empty batch");
        require(itemCount <= MAX_BATCH_SIZE, "NXS: batch too large");
        require(buyer != address(0), "NXS: zero buyer address");

        uint256 totalAmount = 0;
        uint256 totalPlatformFees = 0;
        uint256 currentFeeRate = feeRateBps;

        // First pass: validate and compute totals.
        for (uint256 i = 0; i < itemCount; ) {
            SettlementItem calldata item = items[i];

            require(item.provider != address(0), "NXS: zero provider address");
            require(item.amount > 0, "NXS: zero settlement amount");
            require(!settlementProcessed[item.settlementId], "NXS: duplicate settlement");

            totalAmount += item.amount;

            unchecked { ++i; }
        }

        // Verify buyer has sufficient escrow for the entire batch.
        require(_escrows[buyer] >= totalAmount, "NXS: insufficient buyer escrow");

        // Debit buyer escrow atomically for the full batch.
        _escrows[buyer] -= totalAmount;

        // Second pass: process each item — split fees and pay providers.
        for (uint256 i = 0; i < itemCount; ) {
            SettlementItem calldata item = items[i];

            // Mark as processed to prevent double-settlement.
            settlementProcessed[item.settlementId] = true;

            // Compute fee split.
            // platformFee = amount * feeRateBps / 10000
            // providerAmount = amount - platformFee
            uint256 platformFee = (item.amount * currentFeeRate) / BPS_DENOMINATOR;
            uint256 providerAmount = item.amount - platformFee;

            totalPlatformFees += platformFee;

            // Transfer provider's share immediately.
            if (providerAmount > 0) {
                bool success = usdc.transfer(item.provider, providerAmount);
                require(success, "NXS: provider transfer failed");
            }

            emit Settled(
                item.settlementId,
                item.provider,
                providerAmount,
                platformFee,
                item.amount
            );

            unchecked { ++i; }
        }

        // Accrue platform fees (withdrawn later by admin).
        accumulatedFees += totalPlatformFees;

        // Increment batch nonce.
        uint256 currentNonce;
        unchecked {
            currentNonce = batchNonce++;
        }

        emit BatchSettled(currentNonce, itemCount, totalAmount, totalPlatformFees);

        return currentNonce;
    }

    // ─────────────────────────────────────────────────────────
    // ADMIN FUNCTIONS
    // ─────────────────────────────────────────────────────────

    /// @inheritdoc INexusXSettlement
    function withdrawTreasury(address to, uint256 amount) external override onlyOwner nonReentrant {
        require(to != address(0), "NXS: zero treasury address");
        require(amount > 0, "NXS: zero withdrawal amount");
        require(amount <= accumulatedFees, "NXS: exceeds accumulated fees");

        accumulatedFees -= amount;

        bool success = usdc.transfer(to, amount);
        require(success, "NXS: treasury transfer failed");

        emit TreasuryWithdrawal(to, amount);
    }

    /// @inheritdoc INexusXSettlement
    function setFeeRate(uint256 newFeeRateBps) external override onlyOwner {
        require(newFeeRateBps <= MAX_FEE_RATE_BPS, "NXS: fee rate exceeds max");

        uint256 oldRate = feeRateBps;
        feeRateBps = newFeeRateBps;

        emit FeeRateUpdated(oldRate, newFeeRateBps);
    }

    /// @inheritdoc INexusXSettlement
    function setOperator(address newOperator) external override onlyOwner {
        require(newOperator != address(0), "NXS: zero operator address");

        address oldOperator = operator;
        operator = newOperator;

        emit OperatorUpdated(oldOperator, newOperator);
    }

    /// @inheritdoc INexusXSettlement
    function setPaused(bool _paused) external override onlyOwner {
        paused = _paused;
        emit PauseStatusChanged(_paused);
    }

    /// @notice Transfer ownership to a new admin.
    /// @param newOwner New owner address.
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "NXS: zero owner address");
        owner = newOwner;
    }

    // ─────────────────────────────────────────────────────────
    // EMERGENCY
    // ─────────────────────────────────────────────────────────

    /// @notice Emergency: allow owner to rescue accidentally sent tokens
    ///         that are NOT USDC. Cannot touch USDC — that's escrow/fees.
    /// @param token ERC-20 token address (must not be USDC).
    /// @param to Destination address.
    /// @param amount Amount to rescue.
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        require(token != address(usdc), "NXS: cannot rescue USDC");
        require(to != address(0), "NXS: zero rescue address");

        (bool success, bytes memory data) = token.call(
            abi.encodeWithSignature("transfer(address,uint256)", to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "NXS: rescue failed");
    }
}
