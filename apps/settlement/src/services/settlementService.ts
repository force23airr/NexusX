// ═══════════════════════════════════════════════════════════════
// NexusX — Settlement Service
// apps/settlement/src/services/settlementService.ts
//
// Bridges the off-chain auction engine to the on-chain
// NexusXSettlement contract. Batches pending transactions by
// buyer, submits them to Base L2, and updates the database
// with settlement status and tx hashes.
// ═══════════════════════════════════════════════════════════════

import { ethers } from "ethers";

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

/** Matches the Prisma Transaction model. */
export interface PendingTransaction {
  id: string;
  listingId: string;
  buyerId: string;
  priceUsdc: string;         // Decimal string, e.g. "0.005000"
  platformFeeUsdc: string;
  providerAmountUsdc: string;
  requestId: string;
  /** Provider's on-chain wallet address. */
  providerAddress: string;
  /** Buyer's on-chain wallet address. */
  buyerAddress: string;
}

/** On-chain settlement item matching the contract struct. */
export interface OnChainSettlementItem {
  provider: string;
  amount: bigint;
  settlementId: string;  // bytes32 hex
}

/** Result of a batch submission. */
export interface BatchResult {
  settlementDbId: string;
  batchNonce: number;
  txHash: string;
  blockNumber: number;
  gasUsed: bigint;
  itemCount: number;
  totalUsdc: string;
  totalPlatformFees: string;
  status: "CONFIRMED" | "FAILED";
  failureReason?: string;
}

/** Configuration for the settlement service. */
export interface SettlementConfig {
  /** RPC endpoint for Base L2. */
  rpcUrl: string;
  /** Private key of the operator wallet. */
  operatorPrivateKey: string;
  /** Deployed NexusXSettlement contract address. */
  contractAddress: string;
  /** Maximum items per batch (contract caps at 100). */
  maxBatchSize: number;
  /** Minimum USDC value to trigger a batch (avoids dust batches). */
  minBatchValueUsdc: number;
  /** How often to poll for pending transactions (ms). */
  pollIntervalMs: number;
  /** Max gas price willing to pay (in gwei). */
  maxGasPriceGwei: number;
  /** Number of block confirmations to wait. */
  confirmations: number;
}

export const DEFAULT_SETTLEMENT_CONFIG: SettlementConfig = {
  rpcUrl: "https://mainnet.base.org",
  operatorPrivateKey: "",
  contractAddress: "",
  maxBatchSize: 50,
  minBatchValueUsdc: 1.0,
  pollIntervalMs: 30_000,
  maxGasPriceGwei: 5,
  confirmations: 2,
};

// ─────────────────────────────────────────────────────────────
// CONTRACT ABI (minimal — only functions we call)
// ─────────────────────────────────────────────────────────────

const SETTLEMENT_ABI = [
  "function settleBatch(address buyer, tuple(address provider, uint256 amount, bytes32 settlementId)[] items) external returns (uint256)",
  "function escrowOf(address buyer) external view returns (uint256)",
  "function batchNonce() external view returns (uint256)",
  "function feeRateBps() external view returns (uint256)",
  "function accumulatedFees() external view returns (uint256)",
  "function paused() external view returns (bool)",
  "event BatchSettled(uint256 indexed batchNonce, uint256 itemCount, uint256 totalAmount, uint256 totalPlatformFees)",
  "event Settled(bytes32 indexed settlementId, address indexed provider, uint256 providerAmount, uint256 platformFee, uint256 totalAmount)",
];

// ─────────────────────────────────────────────────────────────
// SERVICE
// ─────────────────────────────────────────────────────────────

export class SettlementService {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private contract: ethers.Contract;
  private config: SettlementConfig;
  private isRunning: boolean = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: SettlementConfig) {
    this.config = { ...DEFAULT_SETTLEMENT_CONFIG, ...config };
    this.provider = new ethers.JsonRpcProvider(this.config.rpcUrl);
    this.wallet = new ethers.Wallet(this.config.operatorPrivateKey, this.provider);
    this.contract = new ethers.Contract(
      this.config.contractAddress,
      SETTLEMENT_ABI,
      this.wallet
    );
  }

  // ─── Lifecycle ───

  /**
   * Start the settlement loop. Polls the database for pending
   * transactions and submits batches on-chain.
   *
   * @param fetchPending  Function that returns pending transactions grouped by buyer.
   * @param onBatchResult Callback invoked after each batch attempt.
   */
  start(
    fetchPending: () => Promise<Map<string, PendingTransaction[]>>,
    onBatchResult: (result: BatchResult) => Promise<void>
  ): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.pollTimer = setInterval(async () => {
      try {
        await this.processSettlements(fetchPending, onBatchResult);
      } catch (err) {
        console.error("[Settlement] Poll cycle error:", err);
      }
    }, this.config.pollIntervalMs);

    console.log(
      `[Settlement] Started. Polling every ${this.config.pollIntervalMs}ms. ` +
      `Max batch: ${this.config.maxBatchSize}. Min value: $${this.config.minBatchValueUsdc}.`
    );
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.isRunning = false;
    console.log("[Settlement] Stopped.");
  }

  // ─── Core Processing ───

  /**
   * Process all pending settlements for all buyers.
   */
  async processSettlements(
    fetchPending: () => Promise<Map<string, PendingTransaction[]>>,
    onBatchResult: (result: BatchResult) => Promise<void>
  ): Promise<void> {
    // Pre-flight: check contract state.
    const isPaused = await this.contract.paused();
    if (isPaused) {
      console.warn("[Settlement] Contract is paused. Skipping cycle.");
      return;
    }

    // Check gas price.
    const feeData = await this.provider.getFeeData();
    const gasPriceGwei = Number(feeData.gasPrice ?? 0n) / 1e9;
    if (gasPriceGwei > this.config.maxGasPriceGwei) {
      console.warn(
        `[Settlement] Gas price ${gasPriceGwei.toFixed(2)} gwei exceeds max ` +
        `${this.config.maxGasPriceGwei} gwei. Skipping cycle.`
      );
      return;
    }

    // Fetch pending transactions grouped by buyer address.
    const pendingByBuyer = await fetchPending();

    for (const [buyerAddress, transactions] of pendingByBuyer) {
      // Split into batches respecting maxBatchSize.
      const batches = this.chunkArray(transactions, this.config.maxBatchSize);

      for (const batch of batches) {
        const totalValue = batch.reduce(
          (sum, tx) => sum + parseFloat(tx.priceUsdc),
          0
        );

        if (totalValue < this.config.minBatchValueUsdc) {
          console.log(
            `[Settlement] Batch for ${buyerAddress} ($${totalValue.toFixed(6)}) ` +
            `below minimum $${this.config.minBatchValueUsdc}. Deferring.`
          );
          continue;
        }

        const result = await this.submitBatch(buyerAddress, batch);
        await onBatchResult(result);
      }
    }
  }

  /**
   * Submit a single batch of transactions for one buyer.
   */
  async submitBatch(
    buyerAddress: string,
    transactions: PendingTransaction[]
  ): Promise<BatchResult> {
    const settlementDbId = this.generateSettlementId();

    try {
      // Verify buyer escrow is sufficient.
      const escrow: bigint = await this.contract.escrowOf(buyerAddress);
      const totalAmount = transactions.reduce(
        (sum, tx) => sum + this.usdcToUnits(tx.priceUsdc),
        0n
      );

      if (escrow < totalAmount) {
        return {
          settlementDbId,
          batchNonce: -1,
          txHash: "",
          blockNumber: 0,
          gasUsed: 0n,
          itemCount: transactions.length,
          totalUsdc: this.unitsToUsdc(totalAmount),
          totalPlatformFees: "0",
          status: "FAILED",
          failureReason: `Insufficient escrow. Have: ${this.unitsToUsdc(escrow)}, Need: ${this.unitsToUsdc(totalAmount)}`,
        };
      }

      // Build on-chain settlement items.
      const items: OnChainSettlementItem[] = transactions.map((tx) => ({
        provider: tx.providerAddress,
        amount: this.usdcToUnits(tx.priceUsdc),
        settlementId: ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ["string", "string"],
            [settlementDbId, tx.id]
          )
        ),
      }));

      // Submit to chain.
      console.log(
        `[Settlement] Submitting batch: ${transactions.length} items, ` +
        `${this.unitsToUsdc(totalAmount)} USDC, buyer: ${buyerAddress}`
      );

      const tx = await this.contract.settleBatch(
        buyerAddress,
        items.map((i) => [i.provider, i.amount, i.settlementId])
      );

      // Wait for confirmations.
      const receipt = await tx.wait(this.config.confirmations);

      // Parse BatchSettled event for the nonce.
      const batchEvent = receipt.logs
        .map((log: ethers.Log) => {
          try {
            return this.contract.interface.parseLog({
              topics: [...log.topics],
              data: log.data,
            });
          } catch {
            return null;
          }
        })
        .find((e: ethers.LogDescription | null) => e?.name === "BatchSettled");

      const batchNonce = batchEvent
        ? Number(batchEvent.args[0])
        : -1;

      const totalPlatformFees = batchEvent
        ? this.unitsToUsdc(batchEvent.args[3])
        : "0";

      console.log(
        `[Settlement] ✅ Batch confirmed. Nonce: ${batchNonce}, ` +
        `Tx: ${receipt.hash}, Block: ${receipt.blockNumber}`
      );

      return {
        settlementDbId,
        batchNonce,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
        itemCount: transactions.length,
        totalUsdc: this.unitsToUsdc(totalAmount),
        totalPlatformFees,
        status: "CONFIRMED",
      };
    } catch (err: unknown) {
      const reason =
        err instanceof Error ? err.message : "Unknown error";

      console.error(`[Settlement] ❌ Batch failed:`, reason);

      return {
        settlementDbId,
        batchNonce: -1,
        txHash: "",
        blockNumber: 0,
        gasUsed: 0n,
        itemCount: transactions.length,
        totalUsdc: "0",
        totalPlatformFees: "0",
        status: "FAILED",
        failureReason: reason,
      };
    }
  }

  // ─── View Helpers ───

  /** Get the buyer's current on-chain escrow balance. */
  async getEscrow(buyerAddress: string): Promise<string> {
    const balance: bigint = await this.contract.escrowOf(buyerAddress);
    return this.unitsToUsdc(balance);
  }

  /** Get the current batch nonce from the contract. */
  async getBatchNonce(): Promise<number> {
    const nonce: bigint = await this.contract.batchNonce();
    return Number(nonce);
  }

  /** Get the current on-chain fee rate in basis points. */
  async getFeeRateBps(): Promise<number> {
    const rate: bigint = await this.contract.feeRateBps();
    return Number(rate);
  }

  /** Get total accumulated platform fees on-chain. */
  async getAccumulatedFees(): Promise<string> {
    const fees: bigint = await this.contract.accumulatedFees();
    return this.unitsToUsdc(fees);
  }

  // ─── Conversion Utilities ───

  /**
   * Convert a USDC decimal string (e.g. "0.005000") to on-chain
   * uint256 units (6 decimals). Uses integer math to avoid
   * floating-point precision loss.
   */
  usdcToUnits(usdcString: string): bigint {
    // Parse as fixed-point: multiply by 1e6.
    const parts = usdcString.split(".");
    const whole = BigInt(parts[0] || "0");
    const fracStr = (parts[1] || "").padEnd(6, "0").slice(0, 6);
    const frac = BigInt(fracStr);
    return whole * 1_000_000n + frac;
  }

  /**
   * Convert on-chain uint256 units back to USDC decimal string.
   */
  unitsToUsdc(units: bigint): string {
    const whole = units / 1_000_000n;
    const frac = units % 1_000_000n;
    return `${whole}.${frac.toString().padStart(6, "0")}`;
  }

  // ─── Internal Helpers ───

  private generateSettlementId(): string {
    return `stl_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  private chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}
