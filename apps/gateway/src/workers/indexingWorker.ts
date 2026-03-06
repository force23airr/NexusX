// ═══════════════════════════════════════════════════════════════
// NexusX — Indexing Worker
// apps/gateway/src/workers/indexingWorker.ts
//
// Dedicated background worker that processes the pending_activations
// queue. On each tick, picks up unprocessed activation events,
// runs the activation pipeline (synthetic queries + embedding),
// and increments the Redis search-version counter so consumers
// (MCP registry, web search) detect changes.
// ═══════════════════════════════════════════════════════════════

import type { PrismaClient } from "@prisma/client";
import type Redis from "ioredis";
import { processActivation } from "@nexusx/database";

const SEARCH_VERSION_KEY = "nexusx:search-version";
const CLAIM_STALE_MS = 5 * 60 * 1000;
const MAX_RETRY_DELAY_MS = 15 * 60 * 1000;

// ─── Config ──────────────────────────────────────────────────

export interface IndexingWorkerConfig {
  enabled: boolean;
  tickIntervalMs: number;
  batchSize: number;
}

export function loadIndexingWorkerConfig(): IndexingWorkerConfig {
  return {
    enabled: process.env.INDEXING_WORKER_ENABLED !== "false",
    tickIntervalMs: parseInt(process.env.INDEXING_WORKER_TICK_MS || "10000", 10),
    batchSize: parseInt(process.env.INDEXING_WORKER_BATCH_SIZE || "5", 10),
  };
}

// ─── Worker ──────────────────────────────────────────────────

export class IndexingWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private processing = false;

  constructor(
    private prisma: PrismaClient,
    private redis: Redis | undefined,
    private config: IndexingWorkerConfig,
  ) {}

  start(): void {
    if (!this.config.enabled) {
      console.log("[IndexingWorker] Disabled via config.");
      return;
    }
    console.log(
      `[IndexingWorker] Started (tick=${this.config.tickIntervalMs}ms, batch=${this.config.batchSize})`,
    );
    this.timer = setInterval(() => this.tick(), this.config.tickIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log("[IndexingWorker] Stopped.");
    }
  }

  private async tick(): Promise<void> {
    // Prevent overlapping ticks
    if (this.processing) return;
    this.processing = true;

    try {
      const now = new Date();
      const staleClaimCutoff = new Date(now.getTime() - CLAIM_STALE_MS);

      // Fetch pending activation events (oldest first)
      const pending = await this.prisma.pendingActivation.findMany({
        where: {
          availableAt: { lte: now },
          OR: [
            { claimedAt: null },
            { claimedAt: { lt: staleClaimCutoff } },
          ],
        },
        orderBy: { createdAt: "asc" },
        take: this.config.batchSize,
      });

      if (pending.length === 0) {
        this.processing = false;
        return;
      }

      let indexed = 0;

      for (const event of pending) {
        try {
          const claimTime = new Date();
          const claimResult = await this.prisma.pendingActivation.updateMany({
            where: {
              id: event.id,
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

          const claimedEvent = await this.prisma.pendingActivation.findUnique({
            where: { id: event.id },
            select: { id: true, listingId: true, attemptCount: true },
          });

          if (!claimedEvent) {
            continue;
          }

          // Verify listing still exists and is ACTIVE
          const listing = await this.prisma.listing.findUnique({
            where: { id: claimedEvent.listingId },
            select: { id: true, slug: true, status: true },
          });

          if (!listing) {
            console.warn(`[IndexingWorker] Listing ${claimedEvent.listingId} not found, dropping queue item.`);
            await this.prisma.pendingActivation.delete({
              where: { id: claimedEvent.id },
            });
          } else if (listing.status !== "ACTIVE") {
            console.log(`[IndexingWorker] Listing ${listing.slug} is ${listing.status}, skipping indexing.`);
            await this.prisma.pendingActivation.delete({
              where: { id: claimedEvent.id },
            });
          } else {
            const result = await processActivation(this.prisma, claimedEvent.listingId);
            if (result.success) {
              console.log(
                `[IndexingWorker] Indexed ${listing.slug}: ` +
                `syntheticQueries=${result.syntheticQueriesGenerated}, ` +
                `embedded=${result.embedded}, ` +
                `version=${result.indexedVersion}` +
                (result.errors.length > 0 ? `, warnings=[${result.errors.join("; ")}]` : ""),
              );
              indexed++;
              await this.prisma.pendingActivation.delete({
                where: { id: claimedEvent.id },
              });
            } else {
              if (!result.retryable) {
                console.warn(
                  `[IndexingWorker] Dropping non-retryable indexing failure for ${listing.slug}: ${result.failureReason ?? "unknown failure"}`,
                );
                await this.prisma.pendingActivation.delete({
                  where: { id: claimedEvent.id },
                });
                continue;
              }

              const retryDelayMs = Math.min(
                MAX_RETRY_DELAY_MS,
                Math.max(30_000, 10_000 * 2 ** Math.min(claimedEvent.attemptCount, 6)),
              );
              const nextAttemptAt = new Date(Date.now() + retryDelayMs);
              const failureSummary =
                result.failureReason ??
                (result.errors.join("; ") || "Indexing failed");

              await this.prisma.pendingActivation.update({
                where: { id: claimedEvent.id },
                data: {
                  claimedAt: null,
                  availableAt: nextAttemptAt,
                  lastError: failureSummary.slice(0, 1000),
                },
              });

              console.warn(
                `[IndexingWorker] Indexing for ${listing.slug} failed; retrying in ${retryDelayMs}ms: ${failureSummary}`,
              );
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[IndexingWorker] Failed to process event ${event.id}:`, err);
          await this.prisma.pendingActivation.update({
            where: { id: event.id },
            data: {
              claimedAt: null,
              availableAt: new Date(Date.now() + 60_000),
              lastError: message.slice(0, 1000),
            },
          }).catch(() => {});
        }
      }

      // Increment search version so consumers detect the change
      if (indexed > 0 && this.redis) {
        try {
          await this.redis.incr(SEARCH_VERSION_KEY);
        } catch (err) {
          console.error("[IndexingWorker] Failed to increment search version:", err);
        }
      }
    } catch (err) {
      console.error("[IndexingWorker] Tick failed:", err);
    } finally {
      this.processing = false;
    }
  }
}
