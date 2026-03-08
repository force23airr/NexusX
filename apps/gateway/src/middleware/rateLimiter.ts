// ═══════════════════════════════════════════════════════════════
// NexusX — Rate Limiter Middleware
// apps/gateway/src/middleware/rateLimiter.ts
//
// Shared sliding-window rate limiter per buyer identity. Uses Redis
// for cross-instance consistency when available, and falls back to a
// local in-memory window if Redis is unavailable.
// ═══════════════════════════════════════════════════════════════

import type { Request, Response, NextFunction } from "express";
import type Redis from "ioredis";
import type { RequestContext, DemandSignalEvent } from "../types";

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

interface SlidingWindow {
  timestamps: number[];
  windowStart: number;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  current: number;
  remaining: number;
  resetMs: number;
}

/** Emit function for demand signals. */
export type SignalEmitter = (signal: DemandSignalEvent) => void;

type SharedRateLimitRedis = Pick<Redis, "eval">;

const WINDOW_MS = 60_000;
const CLEANUP_INTERVAL_MS = 300_000;
const RATE_LIMIT_REDIS_PREFIX = "nexusx:rate-limit:window";

const REDIS_SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
local ttlMs = tonumber(ARGV[5])
local windowStart = now - windowMs

redis.call("ZREMRANGEBYSCORE", key, "-inf", windowStart)

local current = redis.call("ZCARD", key)
if current >= limit then
  local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
  local oldestScore = now
  if oldest[2] ~= nil then
    oldestScore = tonumber(oldest[2])
  end
  local resetMs = math.max(0, oldestScore + windowMs - now)
  return {0, current, 0, resetMs}
end

redis.call("ZADD", key, now, member)
redis.call("PEXPIRE", key, ttlMs)

local nextCurrent = current + 1
local remaining = math.max(0, limit - nextCurrent)
return {1, nextCurrent, remaining, windowMs}
`;

// ─────────────────────────────────────────────────────────────
// RATE LIMITER
// ─────────────────────────────────────────────────────────────

export class RateLimiter {
  private windows: Map<string, SlidingWindow> = new Map();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private redis?: SharedRateLimitRedis;
  private readonly windowMs: number;

  constructor(redis?: SharedRateLimitRedis, windowMs: number = WINDOW_MS) {
    this.redis = redis;
    this.windowMs = windowMs;
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
  }

  async check(
    key: string,
    limitRpm: number,
    requestToken?: string,
  ): Promise<RateLimitCheckResult> {
    if (this.redis) {
      try {
        return await this.checkRedis(key, limitRpm, requestToken);
      } catch (err) {
        console.warn("[RateLimiter] Shared Redis check failed, falling back to local window:", err);
      }
    }

    return this.checkLocal(key, limitRpm);
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.windows.clear();
  }

  private async checkRedis(
    key: string,
    limitRpm: number,
    requestToken?: string,
  ): Promise<RateLimitCheckResult> {
    const now = Date.now();
    const redisKey = `${RATE_LIMIT_REDIS_PREFIX}:${key}`;
    const member = `${now}:${requestToken || cryptoRandomToken()}`;
    const raw = await this.redis!.eval(
      REDIS_SLIDING_WINDOW_SCRIPT,
      1,
      redisKey,
      String(now),
      String(this.windowMs),
      String(Math.max(0, Math.trunc(limitRpm))),
      member,
      String(this.windowMs * 2),
    );

    return normalizeRedisRateLimitResult(raw, this.windowMs);
  }

  private checkLocal(key: string, limitRpm: number): RateLimitCheckResult {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let window = this.windows.get(key);
    if (!window) {
      window = { timestamps: [], windowStart: now };
      this.windows.set(key, window);
    }

    window.timestamps = window.timestamps.filter((t) => t > windowStart);
    window.windowStart = now;

    const current = window.timestamps.length;
    const remaining = Math.max(0, limitRpm - current);

    if (current >= limitRpm) {
      const oldestInWindow = window.timestamps[0] || now;
      const resetMs = oldestInWindow + this.windowMs - now;

      return {
        allowed: false,
        current,
        remaining: 0,
        resetMs: Math.max(0, resetMs),
      };
    }

    window.timestamps.push(now);

    return {
      allowed: true,
      current: current + 1,
      remaining: Math.max(0, remaining - 1),
      resetMs: this.windowMs,
    };
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.windowMs * 2;
    for (const [key, window] of this.windows) {
      if (
        window.timestamps.length === 0 ||
        window.timestamps[window.timestamps.length - 1] < cutoff
      ) {
        this.windows.delete(key);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// MIDDLEWARE FACTORY
// ─────────────────────────────────────────────────────────────

export function createRateLimitMiddleware(
  limiter: RateLimiter,
  emitSignal: SignalEmitter,
  extractListingId: (req: Request) => string | null,
) {
  return async function rateLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const ctx = (req as any).ctx as RequestContext | undefined;
    if (!ctx) {
      res.status(500).json({ error: "INTERNAL_ERROR", message: "Missing request context." });
      return;
    }

    const listingScope = extractListingId(req);
    const rateLimitKey = ctx.authMode === "x402"
      ? `x402:${ctx.buyerAddress}:${listingScope || "unknown"}`
      : `api:${ctx.apiKeyId}`;

    const result = await limiter.check(rateLimitKey, ctx.rateLimitRpm, ctx.requestId);

    res.setHeader("X-RateLimit-Limit", ctx.rateLimitRpm.toString());
    res.setHeader("X-RateLimit-Remaining", result.remaining.toString());
    res.setHeader("X-RateLimit-Reset", Math.ceil(result.resetMs / 1000).toString());

    if (!result.allowed) {
      if (listingScope) {
        emitSignal({
          listingId: listingScope,
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

function normalizeRedisRateLimitResult(
  raw: unknown,
  fallbackWindowMs: number,
): RateLimitCheckResult {
  if (!Array.isArray(raw) || raw.length < 4) {
    throw new Error("Invalid Redis sliding-window response.");
  }

  const allowed = Number(raw[0]) === 1;
  const current = Number(raw[1] ?? 0);
  const remaining = Number(raw[2] ?? 0);
  const resetMs = Number(raw[3] ?? fallbackWindowMs);

  if (
    !Number.isFinite(current) ||
    !Number.isFinite(remaining) ||
    !Number.isFinite(resetMs)
  ) {
    throw new Error("Invalid Redis sliding-window counters.");
  }

  return {
    allowed,
    current: Math.max(0, Math.trunc(current)),
    remaining: Math.max(0, Math.trunc(remaining)),
    resetMs: Math.max(0, Math.trunc(resetMs)),
  };
}

function cryptoRandomToken(): string {
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}
