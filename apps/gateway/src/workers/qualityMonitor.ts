// ═══════════════════════════════════════════════════════════════
// NexusX — Quality Monitor Worker
// apps/gateway/src/workers/qualityMonitor.ts
//
// Background worker that bridges Redis reliability metrics into
// the database (QualitySnapshot + ProviderMetricRaw), runs
// synthetic health probes for idle listings, and auto-pauses
// degraded services.
// ═══════════════════════════════════════════════════════════════

import type { PrismaClient } from "@prisma/client";
import { buildExecutableListingWhere } from "@nexusx/database";
import type { ReliabilityAggregator, ReliabilityScore } from "../services/reliability-aggregator";
import { assertSafeHttpUrl, safeFetch } from "../utils/ssrf";

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────

export interface QualityMonitorConfig {
  enabled: boolean;
  tickIntervalMs: number;
  probeIntervalMs: number;
  probeTimeoutMs: number;
  probeConcurrency: number;
  gateThreshold: number;
  gateConsecutive: number;
}

export function loadQualityMonitorConfig(): QualityMonitorConfig {
  return {
    enabled: process.env.QUALITY_MONITOR_ENABLED !== "false",
    tickIntervalMs: parseInt(process.env.QUALITY_MONITOR_TICK_MS || "60000", 10),
    probeIntervalMs: parseInt(process.env.QUALITY_MONITOR_PROBE_INTERVAL_MS || "300000", 10),
    probeTimeoutMs: parseInt(process.env.QUALITY_MONITOR_PROBE_TIMEOUT_MS || "5000", 10),
    probeConcurrency: parseInt(process.env.QUALITY_MONITOR_PROBE_CONCURRENCY || "5", 10),
    gateThreshold: parseInt(process.env.QUALITY_MONITOR_GATE_THRESHOLD || "30", 10),
    gateConsecutive: parseInt(process.env.QUALITY_MONITOR_GATE_CONSECUTIVE || "5", 10),
  };
}

// ─────────────────────────────────────────────────────────────
// WORKER
// ─────────────────────────────────────────────────────────────

export class QualityMonitorWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTickTime: Date = new Date();
  private degradedCounts = new Map<string, number>();
  private lastProbeTime = new Map<string, number>();

  constructor(
    private prisma: PrismaClient,
    private reliabilityAggregator: ReliabilityAggregator,
    private config: QualityMonitorConfig,
  ) {}

  start(): void {
    if (!this.config.enabled) {
      console.log("[QualityMonitor] Disabled via config.");
      return;
    }
    console.log(
      `[QualityMonitor] Started (tick=${this.config.tickIntervalMs}ms, probe=${this.config.probeIntervalMs}ms, gate=${this.config.gateThreshold}/${this.config.gateConsecutive})`,
    );
    this.timer = setInterval(() => this.tick(), this.config.tickIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log("[QualityMonitor] Stopped.");
    }
  }

  private async tick(): Promise<void> {
    const now = new Date();
    const tickStart = this.lastTickTime;
    this.lastTickTime = now;

    try {
      const listings = await this.prisma.listing.findMany({
        where: buildExecutableListingWhere(),
        select: {
          id: true,
          slug: true,
          healthCheckUrl: true,
          baseUrl: true,
          sourceType: true,
        },
      });

      for (const listing of listings) {
        try {
          let score = await this.reliabilityAggregator.getScore(listing.slug);

          // No traffic — try synthetic probe (skip bazaar listings)
          if (!score && listing.sourceType !== "bazaar") {
            score = await this.maybeProbe(listing);
          }

          if (!score) continue;

          // Write QualitySnapshot
          await this.prisma.qualitySnapshot.create({
            data: {
              listingId: listing.id,
              uptimePercent: score.uptimePct * 100,
              medianLatencyMs: score.p50LatencyMs,
              p99LatencyMs: score.p99LatencyMs,
              errorRatePercent: score.errorRate * 100,
              averageRating: 0,
              ratingCount: 0,
              compositeScore: score.qualityScore,
              computedAt: new Date(score.computedAt),
            },
          });

          // Write ProviderMetricRaw
          const tickMinutes = Math.max(
            1,
            Math.round((now.getTime() - tickStart.getTime()) / 60000),
          );
          await this.prisma.providerMetricRaw.create({
            data: {
              listingId: listing.id,
              successCount: Math.round(score.callCount * (1 - score.errorRate)),
              failureCount: Math.round(score.callCount * score.errorRate),
              medianLatencyMs: score.p50LatencyMs,
              p99LatencyMs: score.p99LatencyMs,
              uptimeMinutes: Math.round(score.uptimePct * tickMinutes),
              totalMinutes: tickMinutes,
              periodStart: tickStart,
              periodEnd: now,
            },
          });

          // Quality gate check
          this.checkQualityGate(listing.id, listing.slug, score.qualityScore);
        } catch (err) {
          console.error(`[QualityMonitor] Error processing listing ${listing.slug}:`, err);
        }
      }
    } catch (err) {
      console.error("[QualityMonitor] Tick failed:", err);
    }
  }

  private async maybeProbe(listing: {
    slug: string;
    healthCheckUrl: string | null;
    baseUrl: string;
  }): Promise<ReliabilityScore | null> {
    const lastProbe = this.lastProbeTime.get(listing.slug) || 0;
    if (Date.now() - lastProbe < this.config.probeIntervalMs) {
      return null;
    }

    const url = listing.healthCheckUrl || `${listing.baseUrl}/health`;

    try {
      await assertSafeHttpUrl(url);
    } catch {
      return null;
    }

    this.lastProbeTime.set(listing.slug, Date.now());

    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.probeTimeoutMs);

      const res = await safeFetch(url, {
        method: "GET",
        signal: controller.signal,
      }, { maxRedirects: 2 });
      clearTimeout(timeout);

      const latencyMs = Date.now() - start;
      const ok = res.status >= 200 && res.status < 300;

      // Compute quality score same way as ReliabilityAggregator:
      // 60% uptime + 40% latency score
      const uptimePct = ok ? 1 : 0;
      const latencyScore = latencyMs <= 100 ? 100 : latencyMs >= 5000 ? 0
        : Math.round(100 * (1 - (latencyMs - 100) / (5000 - 100)));
      const qualityScore = Math.round(uptimePct * 100 * 0.6 + latencyScore * 0.4);

      return {
        errorRate: ok ? 0 : 1,
        p50LatencyMs: latencyMs,
        p95LatencyMs: latencyMs,
        p99LatencyMs: latencyMs,
        uptimePct,
        callCount: 1,
        qualityScore,
        computedAt: Date.now(),
      };
    } catch {
      const latencyMs = Date.now() - start;
      return {
        errorRate: 1,
        p50LatencyMs: latencyMs,
        p95LatencyMs: latencyMs,
        p99LatencyMs: latencyMs,
        uptimePct: 0,
        callCount: 1,
        qualityScore: 0,
        computedAt: Date.now(),
      };
    }
  }

  private checkQualityGate(listingId: string, slug: string, compositeScore: number): void {
    const prev = this.degradedCounts.get(listingId) || 0;

    if (compositeScore < this.config.gateThreshold) {
      const count = prev + 1;
      this.degradedCounts.set(listingId, count);

      if (count >= this.config.gateConsecutive) {
        console.warn(
          `[QualityMonitor] Auto-pausing listing "${slug}" (compositeScore=${compositeScore}, degraded ${count} consecutive ticks)`,
        );
        this.prisma.listing
          .update({ where: { id: listingId }, data: { status: "PAUSED" } })
          .catch((err) =>
            console.error(`[QualityMonitor] Failed to pause listing ${slug}:`, err),
          );
        this.degradedCounts.delete(listingId);
      }
    } else {
      if (prev > 0) this.degradedCounts.delete(listingId);
    }
  }
}
