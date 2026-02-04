// ═══════════════════════════════════════════════════════════════
// NexusX — Rate Limiter Middleware
// apps/gateway/src/middleware/rateLimiter.ts
//
// Sliding window rate limiter per API key. When a buyer exceeds
// their RPM, the gateway returns 429 AND emits a RATE_LIMITED
// demand signal — because rate limiting indicates excess demand,
// which should push the auction price up.
// ═══════════════════════════════════════════════════════════════

import type { Request, Response, NextFunction } from "express";
import type { RequestContext, DemandSignalEvent } from "../types";

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

interface SlidingWindow {
  /** Timestamps of requests in the current window. */
  timestamps: number[];
  /** Window start time. */
  windowStart: number;
}

/** Emit function for demand signals. */
export type SignalEmitter = (signal: DemandSignalEvent) => void;

// ─────────────────────────────────────────────────────────────
// IN-MEMORY RATE LIMITER
// ─────────────────────────────────────────────────────────────

/**
 * In-memory sliding window rate limiter.
 *
 * For production, replace with Redis-backed implementation
 * using sorted sets (ZRANGEBYSCORE + ZADD + ZREMRANGEBYSCORE).
 * The interface stays the same.
 */
export class RateLimiter {
  private windows: Map<string, SlidingWindow> = new Map();
  private readonly windowMs: number = 60_000; // 1 minute
  private readonly cleanupIntervalMs: number = 300_000; // 5 min
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Periodic cleanup of expired windows.
    this.cleanupTimer = setInterval(() => this.cleanup(), this.cleanupIntervalMs);
  }

  /**
   * Check if the request is within rate limits.
   *
   * @param key      Rate limit key (API key ID).
   * @param limitRpm Allowed requests per minute.
   * @returns Object with allowed flag and current/remaining counts.
   */
  check(key: string, limitRpm: number): {
    allowed: boolean;
    current: number;
    remaining: number;
    resetMs: number;
  } {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let window = this.windows.get(key);
    if (!window) {
      window = { timestamps: [], windowStart: now };
      this.windows.set(key, window);
    }

    // Prune timestamps outside the sliding window.
    window.timestamps = window.timestamps.filter((t) => t > windowStart);

    const current = window.timestamps.length;
    const remaining = Math.max(0, limitRpm - current);

    if (current >= limitRpm) {
      // Find when the oldest request in the window expires.
      const oldestInWindow = window.timestamps[0] || now;
      const resetMs = oldestInWindow + this.windowMs - now;

      return { allowed: false, current, remaining: 0, resetMs: Math.max(0, resetMs) };
    }

    // Record this request.
    window.timestamps.push(now);

    return {
      allowed: true,
      current: current + 1,
      remaining: remaining - 1,
      resetMs: this.windowMs,
    };
  }

  /** Remove expired windows to prevent memory growth. */
  private cleanup(): void {
    const cutoff = Date.now() - this.windowMs * 2;
    for (const [key, window] of this.windows) {
      if (window.timestamps.length === 0 || window.timestamps[window.timestamps.length - 1] < cutoff) {
        this.windows.delete(key);
      }
    }
  }

  /** Shutdown cleanup timer. */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.windows.clear();
  }
}

// ─────────────────────────────────────────────────────────────
// MIDDLEWARE FACTORY
// ─────────────────────────────────────────────────────────────

/**
 * Creates rate limiter middleware.
 *
 * @param limiter       RateLimiter instance (shared across routes).
 * @param emitSignal    Function to emit demand signals to the auction engine.
 * @param extractListingId  Function to extract the listing ID from the request path.
 */
export function createRateLimitMiddleware(
  limiter: RateLimiter,
  emitSignal: SignalEmitter,
  extractListingId: (req: Request) => string | null
) {
  return function rateLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    const ctx = (req as any).ctx as RequestContext | undefined;
    if (!ctx) {
      res.status(500).json({ error: "INTERNAL_ERROR", message: "Missing request context." });
      return;
    }

    // Rate limit key: wallet address for x402, API key ID for traditional auth.
    const rateLimitKey = ctx.authMode === "x402"
      ? ctx.buyerAddress
      : ctx.apiKeyId;

    const result = limiter.check(rateLimitKey, ctx.rateLimitRpm);

    // Always set rate limit headers.
    res.setHeader("X-RateLimit-Limit", ctx.rateLimitRpm.toString());
    res.setHeader("X-RateLimit-Remaining", result.remaining.toString());
    res.setHeader("X-RateLimit-Reset", Math.ceil(result.resetMs / 1000).toString());

    if (!result.allowed) {
      // Emit RATE_LIMITED signal — this is a demand indicator.
      const listingId = extractListingId(req);
      if (listingId) {
        emitSignal({
          listingId,
          buyerId: ctx.buyerId,
          type: "RATE_LIMITED",
          weight: 1.5,
          metadata: {
            rateLimitKey,
            authMode: ctx.authMode || "api_key",
            currentCount: result.current,
            limit: ctx.rateLimitRpm,
          },
        });
      }

      res.setHeader("Retry-After", Math.ceil(result.resetMs / 1000).toString());
      res.status(429).json({
        error: "RATE_LIMITED",
        message: `Rate limit exceeded. ${ctx.rateLimitRpm} requests per minute allowed.`,
        requestId: ctx.requestId,
        retryAfterMs: result.resetMs,
      });
      return;
    }

    next();
  };
}
