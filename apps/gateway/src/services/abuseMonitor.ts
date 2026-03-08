import type Redis from "ioredis";
import {
  ABUSE_BLOCK_STATE_HASH_KEY,
  serializeAbuseBlockState,
  type AbuseBlockReason,
  type AbuseBlockScope,
} from "@nexusx/database";

type AbuseRedis = Pick<Redis, "get" | "set" | "pttl" | "incr" | "pexpire" | "hset">;

interface LocalCounterState {
  count: number;
  expiresAt: number;
}

interface LocalBlockState {
  expiresAt: number;
}

export interface AbuseThresholdConfig {
  threshold: number;
  windowMs: number;
  blockMs: number;
}

export interface AbuseMonitorConfig {
  auth: AbuseThresholdConfig;
  payment: AbuseThresholdConfig;
}

export interface AbuseBlockCheck {
  blocked: boolean;
  retryAfterMs: number;
}

const DEFAULT_CONFIG: AbuseMonitorConfig = {
  auth: {
    threshold: 12,
    windowMs: 5 * 60 * 1000,
    blockMs: 15 * 60 * 1000,
  },
  payment: {
    threshold: 4,
    windowMs: 10 * 60 * 1000,
    blockMs: 30 * 60 * 1000,
  },
};

export class AbuseMonitor {
  private readonly redis?: AbuseRedis;
  private readonly config: AbuseMonitorConfig;
  private readonly localCounters = new Map<string, LocalCounterState>();
  private readonly localBlocks = new Map<string, LocalBlockState>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<AbuseMonitorConfig>, redis?: AbuseRedis) {
    this.redis = redis;
    this.config = {
      auth: { ...DEFAULT_CONFIG.auth, ...(config?.auth ?? {}) },
      payment: { ...DEFAULT_CONFIG.payment, ...(config?.payment ?? {}) },
    };
    this.cleanupTimer = setInterval(() => this.cleanupLocalState(), 60_000);
  }

  async checkBlock(scope: AbuseBlockScope, subjectKey: string): Promise<AbuseBlockCheck> {
    if (this.redis) {
      try {
        const blockKey = this.getBlockKey(scope, subjectKey);
        const blocked = await this.redis.get(blockKey);
        if (!blocked) {
          return { blocked: false, retryAfterMs: 0 };
        }

        const ttl = await this.redis.pttl(blockKey);
        return {
          blocked: true,
          retryAfterMs: ttl > 0 ? ttl : 0,
        };
      } catch (err) {
        console.warn("[AbuseMonitor] Shared block check failed, falling back to local state:", err);
      }
    }

    const state = this.localBlocks.get(this.getLocalBlockKey(scope, subjectKey));
    if (!state || state.expiresAt <= Date.now()) {
      this.localBlocks.delete(this.getLocalBlockKey(scope, subjectKey));
      return { blocked: false, retryAfterMs: 0 };
    }

    return {
      blocked: true,
      retryAfterMs: Math.max(0, state.expiresAt - Date.now()),
    };
  }

  async recordAuthFailure(subjectKey: string, reason: Extract<AbuseBlockReason, "invalid_api_key" | "ip_restricted">): Promise<void> {
    await this.recordEvent("auth", reason, subjectKey, null);
  }

  async recordPaymentAbuse(
    subjectKey: string,
    reason: Extract<AbuseBlockReason, "payment_replay" | "payment_invalid">,
    listingSlug: string | null,
  ): Promise<void> {
    await this.recordEvent("payment", reason, subjectKey, listingSlug);
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.localCounters.clear();
    this.localBlocks.clear();
  }

  private async recordEvent(
    scope: AbuseBlockScope,
    reason: AbuseBlockReason,
    subjectKey: string,
    listingSlug: string | null,
  ): Promise<void> {
    const policy = this.config[scope];
    const now = Date.now();

    if (this.redis) {
      try {
        const counterKey = this.getCounterKey(scope, subjectKey);
        const nextCount = await this.redis.incr(counterKey);
        if (nextCount === 1) {
          await this.redis.pexpire(counterKey, policy.windowMs);
        }

        if (nextCount >= policy.threshold) {
          const blockKey = this.getBlockKey(scope, subjectKey);
          await this.redis.set(blockKey, String(now), "PX", policy.blockMs);
          await this.redis.hset(
            ABUSE_BLOCK_STATE_HASH_KEY,
            `${scope}:${subjectKey}`,
            serializeAbuseBlockState({
              scope,
              subjectKey,
              reason,
              listingSlug,
              triggerCount: nextCount,
              blockedUntil: now + policy.blockMs,
              expiresAt: now + Math.max(policy.blockMs * 2, policy.windowMs),
              updatedAt: now,
            }),
          );
        }
        return;
      } catch (err) {
        console.warn("[AbuseMonitor] Shared abuse counter failed, falling back to local state:", err);
      }
    }

    const counterKey = this.getLocalCounterKey(scope, subjectKey);
    const current = this.localCounters.get(counterKey);
    const activeCount = current && current.expiresAt > now ? current.count : 0;
    const nextCount = activeCount + 1;
    this.localCounters.set(counterKey, {
      count: nextCount,
      expiresAt: now + policy.windowMs,
    });

    if (nextCount >= policy.threshold) {
      this.localBlocks.set(this.getLocalBlockKey(scope, subjectKey), {
        expiresAt: now + policy.blockMs,
      });
    }
  }

  private cleanupLocalState(): void {
    const now = Date.now();
    for (const [key, value] of this.localCounters) {
      if (value.expiresAt <= now) {
        this.localCounters.delete(key);
      }
    }
    for (const [key, value] of this.localBlocks) {
      if (value.expiresAt <= now) {
        this.localBlocks.delete(key);
      }
    }
  }

  private getCounterKey(scope: AbuseBlockScope, subjectKey: string): string {
    return `nexusx:abuse:counter:${scope}:${subjectKey}`;
  }

  private getBlockKey(scope: AbuseBlockScope, subjectKey: string): string {
    return `nexusx:abuse:block:${scope}:${subjectKey}`;
  }

  private getLocalCounterKey(scope: AbuseBlockScope, subjectKey: string): string {
    return `${scope}:${subjectKey}`;
  }

  private getLocalBlockKey(scope: AbuseBlockScope, subjectKey: string): string {
    return `${scope}:${subjectKey}`;
  }
}
