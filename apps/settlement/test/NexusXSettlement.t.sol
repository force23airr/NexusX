// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {NexusXSettlement} from "../contracts/NexusXSettlement.sol";
import {INexusXSettlement} from "../contracts/interfaces/INexusXSettlement.sol";
import {MockUSDC} from "./MockUSDC.sol";

/// @title NexusXSettlementTest
/// @notice Comprehensive test suite for the NexusX settlement contract.
contract NexusXSettlementTest is Test {

    // ─── Test actors ───
    address admin    = makeAddr("admin");
    address opsAddr  = makeAddr("operator");
    address buyer1   = makeAddr("buyer1");
    address buyer2   = makeAddr("buyer2");
    address provider1 = makeAddr("provider1");
    address provider2 = makeAddr("provider2");
    address provider3 = makeAddr("provider3");
    address treasury = makeAddr("treasury");
    address attacker = makeAddr("attacker");

    MockUSDC usdc;
    NexusXSettlement settlement;

    // ─── Constants ───
    uint256 constant INITIAL_FEE_BPS = 1200;  // 12%
    uint256 constant USDC_DECIMALS   = 1e6;
    uint256 constant MINT_AMOUNT     = 100_000 * USDC_DECIMALS; // 100k USDC

    // ─── Setup ───
    function setUp() public {
        usdc = new MockUSDC();
        settlement = new NexusXSettlement(
            address(usdc),
            admin,
            opsAddr,
            INITIAL_FEE_BPS
        );

        // Fund buyers.
        usdc.mint(buyer1, MINT_AMOUNT);
        usdc.mint(buyer2, MINT_AMOUNT);

        // Approve settlement contract.
        vm.prank(buyer1);
        usdc.approve(address(settlement), type(uint256).max);
        vm.prank(buyer2);
        usdc.approve(address(settlement), type(uint256).max);
    }

    // ═════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═════════════════════════════════════════════════════════

    function test_constructor_setsState() public view {
        assertEq(address(settlement.usdc()), address(usdc));
        assertEq(settlement.owner(), admin);
        assertEq(settlement.operator(), opsAddr);
        assertEq(settlement.feeRateBps(), INITIAL_FEE_BPS);
        assertEq(settlement.paused(), false);
        assertEq(settlement.batchNonce(), 0);
        assertEq(settlement.accumulatedFees(), 0);
    }

    function test_constructor_revertsOnZeroAddresses() public {
        vm.expectRevert("NXS: zero USDC address");
        new NexusXSettlement(address(0), admin, opsAddr, 1200);

        vm.expectRevert("NXS: zero owner address");
        new NexusXSettlement(address(usdc), address(0), opsAddr, 1200);

        vm.expectRevert("NXS: zero operator address");
        new NexusXSettlement(address(usdc), admin, address(0), 1200);
    }

    function test_constructor_revertsOnExcessiveFee() public {
        vm.expectRevert("NXS: fee rate exceeds max");
        new NexusXSettlement(address(usdc), admin, opsAddr, 2501);
    }

    // ═════════════════════════════════════════════════════════
    // DEPOSITS
    // ═════════════════════════════════════════════════════════

    function test_deposit_creditsEscrow() public {
        uint256 depositAmt = 1000 * USDC_DECIMALS;

        vm.prank(buyer1);
        settlement.deposit(depositAmt);

        assertEq(settlement.escrowOf(buyer1), depositAmt);
        assertEq(usdc.balanceOf(address(settlement)), depositAmt);
        assertEq(usdc.balanceOf(buyer1), MINT_AMOUNT - depositAmt);
    }

    function test_deposit_multipleDepositsAccumulate() public {
        vm.startPrank(buyer1);
        settlement.deposit(500 * USDC_DECIMALS);
        settlement.deposit(300 * USDC_DECIMALS);
        settlement.deposit(200 * USDC_DECIMALS);
        vm.stopPrank();

        assertEq(settlement.escrowOf(buyer1), 1000 * USDC_DECIMALS);
    }

    function test_deposit_emitsEvent() public {
        uint256 depositAmt = 1000 * USDC_DECIMALS;

        vm.expectEmit(true, false, false, true);
        emit INexusXSettlement.Deposited(buyer1, depositAmt);

        vm.prank(buyer1);
        settlement.deposit(depositAmt);
    }

    function test_deposit_revertsOnZero() public {
        vm.prank(buyer1);
        vm.expectRevert("NXS: zero deposit");
        settlement.deposit(0);
    }

    function test_deposit_revertsWhenPaused() public {
        vm.prank(admin);
        settlement.setPaused(true);

        vm.prank(buyer1);
        vm.expectRevert("NXS: contract is paused");
        settlement.deposit(1000 * USDC_DECIMALS);
    }

    // ═════════════════════════════════════════════════════════
    // WITHDRAWALS
    // ═════════════════════════════════════════════════════════

    function test_withdraw_debitsEscrow() public {
        vm.prank(buyer1);
        settlement.deposit(1000 * USDC_DECIMALS);

        vm.prank(buyer1);
        settlement.withdraw(400 * USDC_DECIMALS);

        assertEq(settlement.escrowOf(buyer1), 600 * USDC_DECIMALS);
        assertEq(usdc.balanceOf(buyer1), MINT_AMOUNT - 600 * USDC_DECIMALS);
    }

    function test_withdraw_fullAmount() public {
        vm.prank(buyer1);
        settlement.deposit(1000 * USDC_DECIMALS);

        vm.prank(buyer1);
        settlement.withdraw(1000 * USDC_DECIMALS);

        assertEq(settlement.escrowOf(buyer1), 0);
        assertEq(usdc.balanceOf(buyer1), MINT_AMOUNT);
    }

    function test_withdraw_revertsOnInsufficientEscrow() public {
        vm.prank(buyer1);
        settlement.deposit(1000 * USDC_DECIMALS);

        vm.prank(buyer1);
        vm.expectRevert("NXS: insufficient escrow");
        settlement.withdraw(1001 * USDC_DECIMALS);
    }

    function test_withdraw_revertsOnZero() public {
        vm.prank(buyer1);
        vm.expectRevert("NXS: zero withdrawal");
        settlement.withdraw(0);
    }

    function test_withdraw_emitsEvent() public {
        vm.prank(buyer1);
        settlement.deposit(1000 * USDC_DECIMALS);

        vm.expectEmit(true, false, false, true);
        emit INexusXSettlement.Withdrawn(buyer1, 400 * USDC_DECIMALS);

        vm.prank(buyer1);
        settlement.withdraw(400 * USDC_DECIMALS);
    }

    // ═════════════════════════════════════════════════════════
    // BATCH SETTLEMENT
    // ═════════════════════════════════════════════════════════

    function _depositAndSettle(
        uint256 depositAmt,
        INexusXSettlement.SettlementItem[] memory items
    ) internal returns (uint256) {
        vm.prank(buyer1);
        settlement.deposit(depositAmt);

        vm.prank(opsAddr);
        return settlement.settleBatch(buyer1, items);
    }

    function test_settleBatch_singleItem() public {
        // 100 USDC call, 12% fee = 12 USDC fee, 88 USDC to provider.
        uint256 callAmount = 100 * USDC_DECIMALS;

        INexusXSettlement.SettlementItem[] memory items =
            new INexusXSettlement.SettlementItem[](1);
        items[0] = INexusXSettlement.SettlementItem({
            provider: provider1,
            amount: callAmount,
            settlementId: keccak256("settle-001")
        });

        uint256 nonce = _depositAndSettle(callAmount, items);

        // Verify nonce.
        assertEq(nonce, 0);
        assertEq(settlement.batchNonce(), 1);

        // Verify buyer escrow debited.
        assertEq(settlement.escrowOf(buyer1), 0);

        // Verify provider received 88%.
        uint256 expectedProviderPay = callAmount - (callAmount * 1200 / 10000);
        assertEq(usdc.balanceOf(provider1), expectedProviderPay);

        // Verify platform fees accrued.
        uint256 expectedFee = callAmount * 1200 / 10000;
        assertEq(settlement.accumulatedFees(), expectedFee);

        // Verify settlement marked as processed.
        assertTrue(settlement.settlementProcessed(keccak256("settle-001")));
    }

    function test_settleBatch_multipleItems() public {
        INexusXSettlement.SettlementItem[] memory items =
            new INexusXSettlement.SettlementItem[](3);

        items[0] = INexusXSettlement.SettlementItem({
            provider: provider1,
            amount: 50 * USDC_DECIMALS,
            settlementId: keccak256("batch-a-1")
        });
        items[1] = INexusXSettlement.SettlementItem({
            provider: provider2,
            amount: 30 * USDC_DECIMALS,
            settlementId: keccak256("batch-a-2")
        });
        items[2] = INexusXSettlement.SettlementItem({
            provider: provider3,
            amount: 20 * USDC_DECIMALS,
            settlementId: keccak256("batch-a-3")
        });

        uint256 totalDeposit = 100 * USDC_DECIMALS;
        _depositAndSettle(totalDeposit, items);

        // Provider splits (88% each).
        assertEq(usdc.balanceOf(provider1), 50 * USDC_DECIMALS * 8800 / 10000);
        assertEq(usdc.balanceOf(provider2), 30 * USDC_DECIMALS * 8800 / 10000);
        assertEq(usdc.balanceOf(provider3), 20 * USDC_DECIMALS * 8800 / 10000);

        // Total fees: 12% of 100 = 12 USDC.
        assertEq(settlement.accumulatedFees(), 12 * USDC_DECIMALS);
    }

    function test_settleBatch_feeSplitPrecision() public {
        // Test with a micropayment: 0.000001 USDC (1 unit).
        INexusXSettlement.SettlementItem[] memory items =
            new INexusXSettlement.SettlementItem[](1);
        items[0] = INexusXSettlement.SettlementItem({
            provider: provider1,
            amount: 1, // 0.000001 USDC
            settlementId: keccak256("micro-001")
        });

        _depositAndSettle(1, items);

        // 1 * 1200 / 10000 = 0 (integer division rounds down).
        // Provider gets 1, platform gets 0. Provider always wins on rounding.
        assertEq(usdc.balanceOf(provider1), 1);
        assertEq(settlement.accumulatedFees(), 0);
    }

    function test_settleBatch_feeSplitAccuracy_largeAmount() public {
        // $10,000 transaction.
        uint256 amount = 10_000 * USDC_DECIMALS;

        INexusXSettlement.SettlementItem[] memory items =
            new INexusXSettlement.SettlementItem[](1);
        items[0] = INexusXSettlement.SettlementItem({
            provider: provider1,
            amount: amount,
            settlementId: keccak256("large-001")
        });

        _depositAndSettle(amount, items);

        // 12% of 10000 = 1200 USDC fee.
        assertEq(settlement.accumulatedFees(), 1200 * USDC_DECIMALS);
        assertEq(usdc.balanceOf(provider1), 8800 * USDC_DECIMALS);
    }

    function test_settleBatch_incrementsNonce() public {
        INexusXSettlement.SettlementItem[] memory items =
            new INexusXSettlement.SettlementItem[](1);

        // Batch 0.
        items[0] = INexusXSettlement.SettlementItem({
            provider: provider1, amount: 10 * USDC_DECIMALS,
            settlementId: keccak256("nonce-test-0")
        });
        _depositAndSettle(10 * USDC_DECIMALS, items);
        assertEq(settlement.batchNonce(), 1);

        // Batch 1.
        items[0] = INexusXSettlement.SettlementItem({
            provider: provider1, amount: 10 * USDC_DECIMALS,
            settlementId: keccak256("nonce-test-1")
        });
        _depositAndSettle(10 * USDC_DECIMALS, items);
        assertEq(settlement.batchNonce(), 2);
    }

    function test_settleBatch_emitsSettledAndBatchSettled() public {
        uint256 amount = 100 * USDC_DECIMALS;
        bytes32 sid = keccak256("event-test-001");

        INexusXSettlement.SettlementItem[] memory items =
            new INexusXSettlement.SettlementItem[](1);
        items[0] = INexusXSettlement.SettlementItem({
            provider: provider1, amount: amount, settlementId: sid
        });

        vm.prank(buyer1);
        settlement.deposit(amount);

        uint256 expectedFee = amount * 1200 / 10000;
        uint256 expectedProv = amount - expectedFee;

        // Expect Settled event.
        vm.expectEmit(true, true, false, true);
        emit INexusXSettlement.Settled(sid, provider1, expectedProv, expectedFee, amount);

        // Expect BatchSettled event.
        vm.expectEmit(true, false, false, true);
        emit INexusXSettlement.BatchSettled(0, 1, amount, expectedFee);

        vm.prank(opsAddr);
        settlement.settleBatch(buyer1, items);
    }

    // ─── Settlement failure cases ───

    function test_settleBatch_revertsOnEmptyBatch() public {
        INexusXSettlement.SettlementItem[] memory items =
            new INexusXSettlement.SettlementItem[](0);

        vm.prank(opsAddr);
        vm.expectRevert("NXS: empty batch");
        settlement.settleBatch(buyer1, items);
    }

    function test_settleBatch_revertsOnInsufficientEscrow() public {
        INexusXSettlement.SettlementItem[] memory items =
            new INexusXSettlement.SettlementItem[](1);
        items[0] = INexusXSettlement.SettlementItem({
            provider: provider1,
            amount: 100 * USDC_DECIMALS,
            settlementId: keccak256("insuff-001")
        });

        // Deposit only 50 but try to settle 100.
        vm.prank(buyer1);
        settlement.deposit(50 * USDC_DECIMALS);

        vm.prank(opsAddr);
        vm.expectRevert("NXS: insufficient buyer escrow");
        settlement.settleBatch(buyer1, items);
    }

    function test_settleBatch_revertsOnDuplicateSettlementId() public {
        bytes32 sid = keccak256("dupe-001");

        INexusXSettlement.SettlementItem[] memory items =
            new INexusXSettlement.SettlementItem[](1);
        items[0] = INexusXSettlement.SettlementItem({
            provider: provider1, amount: 10 * USDC_DECIMALS, settlementId: sid
        });

        // First settlement succeeds.
        _depositAndSettle(10 * USDC_DECIMALS, items);

        // Second settlement with same ID reverts.
        vm.prank(buyer1);
        settlement.deposit(10 * USDC_DECIMALS);

        vm.prank(opsAddr);
        vm.expectRevert("NXS: duplicate settlement");
        settlement.settleBatch(buyer1, items);
    }

    function test_settleBatch_revertsOnZeroProvider() public {
        INexusXSettlement.SettlementItem[] memory items =
            new INexusXSettlement.SettlementItem[](1);
        items[0] = INexusXSettlement.SettlementItem({
            provider: address(0),
            amount: 10 * USDC_DECIMALS,
            settlementId: keccak256("zero-prov")
        });

        vm.prank(buyer1);
        settlement.deposit(10 * USDC_DECIMALS);

        vm.prank(opsAddr);
        vm.expectRevert("NXS: zero provider address");
        settlement.settleBatch(buyer1, items);
    }

    function test_settleBatch_revertsOnZeroAmount() public {
        INexusXSettlement.SettlementItem[] memory items =
            new INexusXSettlement.SettlementItem[](1);
        items[0] = INexusXSettlement.SettlementItem({
            provider: provider1,
            amount: 0,
            settlementId: keccak256("zero-amt")
        });

        vm.prank(buyer1);
        settlement.deposit(10 * USDC_DECIMALS);

        vm.prank(opsAddr);
        vm.expectRevert("NXS: zero settlement amount");
        settlement.settleBatch(buyer1, items);
    }

    function test_settleBatch_revertsOnZeroBuyer() public {
        INexusXSettlement.SettlementItem[] memory items =
            new INexusXSettlement.SettlementItem[](1);
        items[0] = INexusXSettlement.SettlementItem({
            provider: provider1,
            amount: 10 * USDC_DECIMALS,
            settlementId: keccak256("zero-buyer")
        });

        vm.prank(opsAddr);
        vm.expectRevert("NXS: zero buyer address");
        settlement.settleBatch(address(0), items);
    }

    // ═════════════════════════════════════════════════════════
    // ACCESS CONTROL
    // ═════════════════════════════════════════════════════════

    function test_settleBatch_revertsForNonOperator() public {
        INexusXSettlement.SettlementItem[] memory items =
            new INexusXSettlement.SettlementItem[](1);
        items[0] = INexusXSettlement.SettlementItem({
            provider: provider1, amount: 10 * USDC_DECIMALS,
            settlementId: keccak256("unauth")
        });

        vm.prank(attacker);
        vm.expectRevert("NXS: caller is not operator");
        settlement.settleBatch(buyer1, items);
    }

    function test_withdrawTreasury_revertsForNonOwner() public {
        vm.prank(attacker);
        vm.expectRevert("NXS: caller is not owner");
        settlement.withdrawTreasury(treasury, 1);
    }

    function test_setFeeRate_revertsForNonOwner() public {
        vm.prank(attacker);
        vm.expectRevert("NXS: caller is not owner");
        settlement.setFeeRate(500);
    }

    function test_setOperator_revertsForNonOwner() public {
        vm.prank(attacker);
        vm.expectRevert("NXS: caller is not owner");
        settlement.setOperator(attacker);
    }

    function test_setPaused_revertsForNonOwner() public {
        vm.prank(attacker);
        vm.expectRevert("NXS: caller is not owner");
        settlement.setPaused(true);
    }

    function test_transferOwnership_revertsForNonOwner() public {
        vm.prank(attacker);
        vm.expectRevert("NXS: caller is not owner");
        settlement.transferOwnership(attacker);
    }

    // ═════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═════════════════════════════════════════════════════════

    function test_withdrawTreasury_transfersFees() public {
        // Generate fees via settlement.
        INexusXSettlement.SettlementItem[] memory items =
            new INexusXSettlement.SettlementItem[](1);
        items[0] = INexusXSettlement.SettlementItem({
            provider: provider1, amount: 1000 * USDC_DECIMALS,
            settlementId: keccak256("treas-001")
        });
        _depositAndSettle(1000 * USDC_DECIMALS, items);

        uint256 fees = settlement.accumulatedFees(); // 120 USDC
        assertEq(fees, 120 * USDC_DECIMALS);

        vm.prank(admin);
        settlement.withdrawTreasury(treasury, fees);

        assertEq(usdc.balanceOf(treasury), fees);
        assertEq(settlement.accumulatedFees(), 0);
    }

    function test_withdrawTreasury_partialWithdrawal() public {
        INexusXSettlement.SettlementItem[] memory items =
            new INexusXSettlement.SettlementItem[](1);
        items[0] = INexusXSettlement.SettlementItem({
            provider: provider1, amount: 1000 * USDC_DECIMALS,
            settlementId: keccak256("partial-001")
        });
        _depositAndSettle(1000 * USDC_DECIMALS, items);

        vm.prank(admin);
        settlement.withdrawTreasury(treasury, 50 * USDC_DECIMALS);

        assertEq(usdc.balanceOf(treasury), 50 * USDC_DECIMALS);
        assertEq(settlement.accumulatedFees(), 70 * USDC_DECIMALS);
    }

    function test_withdrawTreasury_revertsOnExcess() public {
        vm.prank(admin);
        vm.expectRevert("NXS: exceeds accumulated fees");
        settlement.withdrawTreasury(treasury, 1);
    }

    function test_setFeeRate_updatesRate() public {
        vm.prank(admin);
        settlement.setFeeRate(500); // 5%
        assertEq(settlement.feeRateBps(), 500);
    }

    function test_setFeeRate_zeroIsValid() public {
        vm.prank(admin);
        settlement.setFeeRate(0);
        assertEq(settlement.feeRateBps(), 0);
    }

    function test_setFeeRate_revertsAboveMax() public {
        vm.prank(admin);
        vm.expectRevert("NXS: fee rate exceeds max");
        settlement.setFeeRate(2501);
    }

    function test_setFeeRate_emitsEvent() public {
        vm.expectEmit(false, false, false, true);
        emit INexusXSettlement.FeeRateUpdated(1200, 800);

        vm.prank(admin);
        settlement.setFeeRate(800);
    }

    function test_setOperator_updatesOperator() public {
        address newOps = makeAddr("newOps");

        vm.prank(admin);
        settlement.setOperator(newOps);
        assertEq(settlement.operator(), newOps);
    }

    function test_setOperator_emitsEvent() public {
        address newOps = makeAddr("newOps");

        vm.expectEmit(true, true, false, false);
        emit INexusXSettlement.OperatorUpdated(opsAddr, newOps);

        vm.prank(admin);
        settlement.setOperator(newOps);
    }

    function test_setPaused_blocksOperations() public {
        vm.prank(admin);
        settlement.setPaused(true);

        vm.prank(buyer1);
        vm.expectRevert("NXS: contract is paused");
        settlement.deposit(1 * USDC_DECIMALS);

        vm.prank(admin);
        settlement.setPaused(false);

        // Now works.
        vm.prank(buyer1);
        settlement.deposit(1 * USDC_DECIMALS);
        assertEq(settlement.escrowOf(buyer1), 1 * USDC_DECIMALS);
    }

    function test_transferOwnership_works() public {
        address newAdmin = makeAddr("newAdmin");

        vm.prank(admin);
        settlement.transferOwnership(newAdmin);
        assertEq(settlement.owner(), newAdmin);

        // Old admin can no longer act.
        vm.prank(admin);
        vm.expectRevert("NXS: caller is not owner");
        settlement.setFeeRate(500);

        // New admin can.
        vm.prank(newAdmin);
        settlement.setFeeRate(500);
        assertEq(settlement.feeRateBps(), 500);
    }

    // ═════════════════════════════════════════════════════════
    // FEE RATE CHANGES MID-OPERATION
    // ═════════════════════════════════════════════════════════

    function test_settleBatch_usesCurrentFeeRate() public {
        // Change fee to 5% then settle.
        vm.prank(admin);
        settlement.setFeeRate(500);

        uint256 amount = 100 * USDC_DECIMALS;
        INexusXSettlement.SettlementItem[] memory items =
            new INexusXSettlement.SettlementItem[](1);
        items[0] = INexusXSettlement.SettlementItem({
            provider: provider1, amount: amount,
            settlementId: keccak256("fee-change-001")
        });

        _depositAndSettle(amount, items);

        // 5% of 100 = 5 USDC fee, 95 to provider.
        assertEq(settlement.accumulatedFees(), 5 * USDC_DECIMALS);
        assertEq(usdc.balanceOf(provider1), 95 * USDC_DECIMALS);
    }

    function test_settleBatch_zeroFeeRate() public {
        vm.prank(admin);
        settlement.setFeeRate(0);

        uint256 amount = 100 * USDC_DECIMALS;
        INexusXSettlement.SettlementItem[] memory items =
            new INexusXSettlement.SettlementItem[](1);
        items[0] = INexusXSettlement.SettlementItem({
            provider: provider1, amount: amount,
            settlementId: keccak256("zero-fee-001")
        });

        _depositAndSettle(amount, items);

        assertEq(settlement.accumulatedFees(), 0);
        assertEq(usdc.balanceOf(provider1), amount);
    }

    // ═════════════════════════════════════════════════════════
    // EMERGENCY: RESCUE TOKEN
    // ═════════════════════════════════════════════════════════

    function test_rescueToken_canRescueNonUSDC() public {
        MockUSDC strayToken = new MockUSDC();
        strayToken.mint(address(settlement), 500 * USDC_DECIMALS);

        vm.prank(admin);
        settlement.rescueToken(address(strayToken), treasury, 500 * USDC_DECIMALS);

        assertEq(strayToken.balanceOf(treasury), 500 * USDC_DECIMALS);
    }

    function test_rescueToken_cannotRescueUSDC() public {
        vm.prank(admin);
        vm.expectRevert("NXS: cannot rescue USDC");
        settlement.rescueToken(address(usdc), treasury, 1);
    }

    // ═════════════════════════════════════════════════════════
    // INVARIANT: USDC ACCOUNTING
    // ═════════════════════════════════════════════════════════

    function test_accounting_contractBalanceMatchesState() public {
        // Deposit.
        vm.prank(buyer1);
        settlement.deposit(1000 * USDC_DECIMALS);

        // Settle 500 (60 fee, 440 to provider).
        INexusXSettlement.SettlementItem[] memory items =
            new INexusXSettlement.SettlementItem[](1);
        items[0] = INexusXSettlement.SettlementItem({
            provider: provider1, amount: 500 * USDC_DECIMALS,
            settlementId: keccak256("acct-001")
        });
        vm.prank(opsAddr);
        settlement.settleBatch(buyer1, items);

        // Contract balance should equal: escrow(buyer1) + accumulatedFees.
        uint256 expectedBalance = settlement.escrowOf(buyer1) + settlement.accumulatedFees();
        assertEq(usdc.balanceOf(address(settlement)), expectedBalance);

        // Withdraw remaining escrow.
        vm.prank(buyer1);
        settlement.withdraw(settlement.escrowOf(buyer1));

        // Now contract balance = just accumulated fees.
        assertEq(usdc.balanceOf(address(settlement)), settlement.accumulatedFees());

        // Withdraw treasury.
        vm.prank(admin);
        settlement.withdrawTreasury(treasury, settlement.accumulatedFees());

        // Contract should be empty.
        assertEq(usdc.balanceOf(address(settlement)), 0);
    }
}
