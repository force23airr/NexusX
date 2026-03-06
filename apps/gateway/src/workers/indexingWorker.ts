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
      // Fetch pending activation events (oldest first)
      const pending = await this.prisma.pendingActivation.findMany({
        orderBy: { createdAt: "asc" },
        take: this.config.batchSize,
      });

      if (pending.length === 0) {
        this.processing = false;
        return;
      }

      let processed = 0;

      for (const event of pending) {
        try {
          // Verify listing still exists and is ACTIVE
          const listing = await this.prisma.listing.findUnique({
            where: { id: event.listingId },
            select: { id: true, slug: true, status: true },
          });

          if (!listing) {
            console.warn(`[IndexingWorker] Listing ${event.listingId} not found, skipping.`);
          } else if (listing.status !== "ACTIVE") {
            console.log(`[IndexingWorker] Listing ${listing.slug} is ${listing.status}, skipping indexing.`);
          } else {
            const result = await processActivation(this.prisma, event.listingId);
            console.log(
              `[IndexingWorker] Indexed ${listing.slug}: ` +
              `syntheticQueries=${result.syntheticQueriesGenerated}, ` +
              `embedded=${result.embedded}, ` +
              `version=${result.indexedVersion}` +
              (result.errors.length > 0 ? `, errors=[${result.errors.join("; ")}]` : ""),
            );
            processed++;
          }

          // Remove from queue regardless of outcome
          await this.prisma.pendingActivation.delete({
            where: { id: event.id },
          });
        } catch (err) {
          console.error(`[IndexingWorker] Failed to process event ${event.id}:`, err);
          // Remove failed event to avoid infinite retry loop
          // In production, could move to a dead-letter table instead
          await this.prisma.pendingActivation.delete({
            where: { id: event.id },
          }).catch(() => {});
        }
      }

      // Increment search version so consumers detect the change
      if (processed > 0 && this.redis) {
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
