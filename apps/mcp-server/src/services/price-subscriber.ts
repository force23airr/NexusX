// ═══════════════════════════════════════════════════════════════
// NexusX — MCP Price Subscriber
// apps/mcp-server/src/services/price-subscriber.ts
//
// Subscribes to Redis pub/sub channel "nexusx:prices" and
// maintains an in-memory price cache + ring buffer history
// per listing (~1 hour of ticks for trajectory analysis).
//
// Gracefully degrades if Redis is unavailable — tools still
// work, just no live price updates.
// ═══════════════════════════════════════════════════════════════

import Redis from "ioredis";
import type { PriceTick, PriceHistoryPoint } from "../types";

const REDIS_CHANNEL = "nexusx:prices";

/** Max history points per listing (~1 hour at 10s intervals). */
const MAX_HISTORY = 360;

export class PriceSubscriber {
  private redisSub: Redis | null = null;
  private cache: Map<string, PriceTick> = new Map();
  private slugToListingId: Map<string, string> = new Map();
  private history: Map<string, PriceHistoryPoint[]> = new Map();
  private redisUrl: string;
  private gatewayUrl: string;
  private connected = false;
  private onSignificantChange?: (tick: PriceTick) => void;

  constructor(redisUrl: string, gatewayUrl: string = "") {
    this.redisUrl = redisUrl;
    this.gatewayUrl = gatewayUrl.replace(/\/+$/, "");
  }

  /**
   * Set a callback for significant price changes (>5%).
   * Used by the MCP server to emit notifications to agents.
   */
  setChangeCallback(cb: (tick: PriceTick) => void): void {
    this.onSignificantChange = cb;
  }

  /**
   * Start subscribing to Redis price updates.
   */
  async start(): Promise<void> {
    try {
      this.redisSub = new Redis(this.redisUrl, {
        lazyConnect: true,
        retryStrategy: (times) => {
          if (times > 3) return null; // Stop retrying after 3 attempts
          return Math.min(times * 1000, 5000);
        },
      });

      await this.redisSub.connect();
      await this.redisSub.subscribe(REDIS_CHANNEL);

      this.redisSub.on("message", (_channel: string, message: string) => {
        this.handleMessage(message);
      });

      this.redisSub.on("error", (err) => {
        console.error("[MCP PriceSubscriber] Redis error:", err.message);
      });

      this.connected = true;
      console.error("[MCP PriceSubscriber] Subscribed to Redis price feed.");
    } catch (err) {
      console.error(
        "[MCP PriceSubscriber] Failed to connect to Redis (prices will be stale):",
        err instanceof Error ? err.message : err,
      );
      this.connected = false;
    }
  }

  /**
   * Stop subscribing and disconnect.
   */
  async stop(): Promise<void> {
    if (this.redisSub) {
      try {
        await this.redisSub.unsubscribe(REDIS_CHANNEL);
        await this.redisSub.quit();
      } catch {
        // Redis may already be disconnected
      }
      this.redisSub = null;
    }
    this.connected = false;
  }

  /**
   * Get all current price ticks.
   */
  getAllPrices(): PriceTick[] {
    return Array.from(this.cache.values());
  }

  /**
   * Get price for a specific listing by ID.
   */
  getPrice(listingId: string): PriceTick | undefined {
    return this.cache.get(listingId);
  }

  /**
   * Get in-memory price history for a listing by ID.
   * Returns up to ~1 hour of 10-second ticks.
   */
  getHistory(listingId: string): PriceHistoryPoint[] {
    return this.history.get(listingId) ?? [];
  }

  /**
   * Get in-memory price history for a listing by slug.
   * Returns up to ~1 hour of 10-second ticks.
   */
  getHistoryBySlug(slug: string): PriceHistoryPoint[] {
    const listingId = this.slugToListingId.get(slug);
    if (!listingId) return [];
    return this.getHistory(listingId);
  }

  /**
   * Fetch extended price history from the gateway endpoint.
   * Used when in-memory history isn't sufficient (e.g., >1h periods).
   */
  async getExtendedHistory(slug: string, period: string = "1h"): Promise<PriceHistoryPoint[]> {
    if (!this.gatewayUrl) return [];

    try {
      const response = await fetch(
        `${this.gatewayUrl}/prices/${slug}/history?period=${period}&resolution=1m`,
        { signal: AbortSignal.timeout(5_000) },
      );
      if (!response.ok) return [];
      const data = await response.json() as { points?: Array<{ timestamp: number; price: number; multipliers?: Record<string, number>; demandScore?: number; demandVelocity?: number }> };
      return (data.points ?? []).map((p) => ({
        price: p.price,
        timestamp: p.timestamp,
        multipliers: p.multipliers as PriceHistoryPoint["multipliers"],
        demandScore: p.demandScore,
        demandVelocity: p.demandVelocity,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Whether the subscriber is connected to Redis.
   */
  isConnected(): boolean {
    return this.connected;
  }

  // ─── Internal ───

  private handleMessage(message: string): void {
    try {
      const tick: PriceTick = JSON.parse(message);
      this.cache.set(tick.listingId, tick);
      this.slugToListingId.set(tick.slug, tick.listingId);

      // Append to history ring buffer
      const points = this.history.get(tick.listingId) ?? [];
      points.push({
        price: tick.currentPrice,
        timestamp: tick.timestamp ?? Date.now(),
        multipliers: tick.multipliers,
        demandScore: tick.demandScore,
        demandVelocity: tick.demandVelocity,
      });

      // Trim to max history size
      if (points.length > MAX_HISTORY) {
        points.splice(0, points.length - MAX_HISTORY);
      }
      this.history.set(tick.listingId, points);

      // Notify on significant changes (>5%)
      if (
        this.onSignificantChange &&
        Math.abs(tick.changePercent) > 5
      ) {
        this.onSignificantChange(tick);
      }
    } catch {
      // Malformed message — ignore
    }
  }
}
