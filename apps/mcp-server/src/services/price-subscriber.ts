// ═══════════════════════════════════════════════════════════════
// NexusX — MCP Price Subscriber
// apps/mcp-server/src/services/price-subscriber.ts
//
// Subscribes to Redis pub/sub channel "nexusx:prices" and
// maintains an in-memory price cache. Same pattern as
// apps/gateway/src/services/priceWebSocket.ts.
//
// Gracefully degrades if Redis is unavailable — tools still
// work, just no live price updates.
// ═══════════════════════════════════════════════════════════════

import Redis from "ioredis";
import type { PriceTick } from "../types";

const REDIS_CHANNEL = "nexusx:prices";

export class PriceSubscriber {
  private redisSub: Redis | null = null;
  private cache: Map<string, PriceTick> = new Map();
  private redisUrl: string;
  private connected = false;
  private onSignificantChange?: (tick: PriceTick) => void;

  constructor(redisUrl: string) {
    this.redisUrl = redisUrl;
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
   * Get price for a specific listing.
   */
  getPrice(listingId: string): PriceTick | undefined {
    return this.cache.get(listingId);
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
      const prev = this.cache.get(tick.listingId);
      this.cache.set(tick.listingId, tick);

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
