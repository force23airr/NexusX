import type { PrismaClient } from "@prisma/client";
import { X402Adapter, type PaymentRequirement } from "../services/x402Adapter";
import { persistX402ExecutionRecord } from "../services/x402ExecutionLedger";
import type { GatewayConfig, X402ExecutionRecord } from "../types";

const CLAIM_STALE_MS = 5 * 60 * 1000;
const MAX_RETRY_DELAY_MS = 30 * 60 * 1000;

export interface X402SettlementWorkerConfig {
  enabled: boolean;
  tickIntervalMs: number;
  batchSize: number;
}

export function loadX402SettlementWorkerConfig(): X402SettlementWorkerConfig {
  return {
    enabled: process.env.X402_SETTLEMENT_WORKER_ENABLED !== "false",
    tickIntervalMs: parseInt(process.env.X402_SETTLEMENT_WORKER_TICK_MS || "15000", 10),
    batchSize: parseInt(process.env.X402_SETTLEMENT_WORKER_BATCH_SIZE || "10", 10),
  };
}

export class X402SettlementWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private processing = false;
  private adapter: X402Adapter;

  constructor(
    private prisma: PrismaClient,
    gatewayConfig: GatewayConfig,
    private config: X402SettlementWorkerConfig,
  ) {
    this.adapter = new X402Adapter({
      facilitatorUrl: gatewayConfig.x402FacilitatorUrl,
      network: gatewayConfig.x402Network,
      platformAddress: gatewayConfig.x402PlatformAddress,
      platformFeeRate: gatewayConfig.platformFeeRate,
    });
  }

  start(): void {
    if (!this.config.enabled) {
      console.log("[X402SettlementWorker] Disabled via config.");
      return;
    }
    console.log(
      `[X402SettlementWorker] Started (tick=${this.config.tickIntervalMs}ms, batch=${this.config.batchSize})`,
    );
    this.timer = setInterval(() => this.tick(), this.config.tickIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log("[X402SettlementWorker] Stopped.");
    }
  }

  private async tick(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      const x402SettlementRecord = (this.prisma as any).x402SettlementRecord;
      const now = new Date();
      const staleClaimCutoff = new Date(now.getTime() - CLAIM_STALE_MS);
      const pending = await x402SettlementRecord.findMany({
        where: {
          status: "SETTLEMENT_PENDING",
          availableAt: { lte: now },
          OR: [
            { claimedAt: null },
            { claimedAt: { lt: staleClaimCutoff } },
          ],
        },
        orderBy: { createdAt: "asc" },
        take: this.config.batchSize,
      });

      for (const record of pending) {
        const claimTime = new Date();
        const claimResult = await x402SettlementRecord.updateMany({
          where: {
            id: record.id,
            status: "SETTLEMENT_PENDING",
            availableAt: { lte: claimTime },
            OR: [
              { claimedAt: null },
              { claimedAt: { lt: staleClaimCutoff } },
            ],
          },
          data: {
            claimedAt: claimTime,
            attemptCount: { increment: 1 },
            lastError: null,
          },
        });

        if (claimResult.count === 0) {
          continue;
        }

        const claimed = await x402SettlementRecord.findUnique({
          where: { id: record.id },
        });

        if (!claimed) {
          continue;
        }

        if (!claimed.paymentHeader) {
          await x402SettlementRecord.update({
            where: { id: claimed.id },
            data: {
              status: "ABANDONED",
              claimedAt: null,
              lastError: "Missing payment header for retry",
            },
          });
          continue;
        }

        try {
          const result = await this.adapter.settlePayment(
            claimed.paymentHeader,
            claimed.paymentRequirement as PaymentRequirement,
          );

          if (result.success) {
            const settledRecord: X402ExecutionRecord = {
              requestId: claimed.requestId,
              listingId: claimed.listingId,
              listingSlug: claimed.listingSlug,
              payerAddress: claimed.payerAddress,
              paymentHeaderHash: claimed.paymentHeaderHash,
              paymentHeader: null,
              paymentRequirement: claimed.paymentRequirement,
              status: "SETTLED",
              quotedPriceUsdc: Number(claimed.quotedPriceUsdc),
              platformFeeUsdc: Number(claimed.platformFeeUsdc),
              providerAmountUsdc: Number(claimed.providerAmountUsdc),
              upstreamStatus: claimed.upstreamStatus,
              responseTimeMs: claimed.responseTimeMs,
              bytesTransferred: claimed.bytesTransferred,
              txHash: result.txHash || null,
            };

            await persistX402ExecutionRecord(this.prisma, settledRecord);
            console.log(
              `[X402SettlementWorker] Settled ${claimed.requestId} (${claimed.listingSlug}) -> ${result.txHash}`,
            );
            continue;
          }

          const retryDelayMs = Math.min(
            MAX_RETRY_DELAY_MS,
            Math.max(30_000, 15_000 * 2 ** Math.min(claimed.attemptCount, 6)),
          );
          await x402SettlementRecord.update({
            where: { id: claimed.id },
            data: {
              claimedAt: null,
              availableAt: new Date(Date.now() + retryDelayMs),
              lastError: (result.error || "Settlement failed").slice(0, 1000),
            },
          });
          console.warn(
            `[X402SettlementWorker] Retry scheduled for ${claimed.requestId} in ${retryDelayMs}ms: ${result.error}`,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await x402SettlementRecord.update({
            where: { id: claimed.id },
            data: {
              claimedAt: null,
              availableAt: new Date(Date.now() + 60_000),
              lastError: message.slice(0, 1000),
            },
          }).catch(() => {});
          console.error(`[X402SettlementWorker] Failed to settle ${claimed.requestId}:`, err);
        }
      }
    } catch (err) {
      console.error("[X402SettlementWorker] Tick failed:", err);
    } finally {
      this.processing = false;
    }
  }
}
