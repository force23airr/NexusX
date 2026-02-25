// ═══════════════════════════════════════════════════════════════
// NexusX — Reliability Aggregator
// apps/gateway/src/services/reliability-aggregator.ts
//
// Records every proxied call result to a Redis sorted set and
// computes live reliability scores (p50/p95/p99 latency, error
// rate excluding 429s, uptime). Agents get real-time quality
// transparency — a signal no other marketplace provides.
//
// Redis keys:
//   nexusx:reliability:{slug}       — sorted set of call records (last 1000)
//   nexusx:reliability_score:{slug} — cached computed score (60s TTL)
// ═══════════════════════════════════════════════════════════════

/** Minimal Redis interface — matches ioredis subset. */
export interface ReliabilityRedisClient {
  zadd(key: string, score: number, member: string): Promise<number | null>;
  zremrangebyrank(key: string, start: number, stop: number): Promise<number>;
  zrange(key: string, start: number, stop: number): Promise<string[]>;
  zcard(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, exMode: string, ttl: number): Promise<string | null>;
}

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export interface CallRecord {
  latencyMs: number;
  statusCode: number;
  timestamp: number;
}

export interface ReliabilityScore {
  /** Error rate (0-1), excludes 429s. 4xx (non-429) + 5xx / total (non-429). */
  errorRate: number;
  /** Median latency in ms. */
  p50LatencyMs: number;
  /** 95th percentile latency in ms. */
  p95LatencyMs: number;
  /** 99th percentile latency in ms. */
  p99LatencyMs: number;
  /** Uptime: non-5xx / total, excludes 429s. */
  uptimePct: number;
  /** Number of call records used for computation. */
  callCount: number;
  /** Composite quality score 0-100 (60% uptime, 40% latency). */
  qualityScore: number;
  /** Timestamp when this score was computed. */
  computedAt: number;
}

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

const MAX_ENTRIES = 1000;
const SCORE_CACHE_TTL_S = 60;
const REDIS_KEY_PREFIX = "nexusx:reliability:";
const SCORE_KEY_PREFIX = "nexusx:reliability_score:";

// ─────────────────────────────────────────────────────────────
// AGGREGATOR
// ─────────────────────────────────────────────────────────────

export class ReliabilityAggregator {
  constructor(private redis: ReliabilityRedisClient) {}

  /**
   * Record a call result. Called after every proxied response (fire-and-forget).
   */
  async record(slug: string, record: CallRecord): Promise<void> {
    const key = `${REDIS_KEY_PREFIX}${slug}`;
    const member = JSON.stringify(record);

    // ZADD with timestamp as score for chronological ordering
    await this.redis.zadd(key, record.timestamp, member);

    // Trim to keep only last MAX_ENTRIES (remove oldest)
    // ZREMRANGEBYRANK key 0 -(MAX_ENTRIES+1) removes everything before the last MAX_ENTRIES
    const count = await this.redis.zcard(key);
    if (count > MAX_ENTRIES) {
      await this.redis.zremrangebyrank(key, 0, count - MAX_ENTRIES - 1);
    }
  }

  /**
   * Compute reliability score from last 1000 entries.
   * Results are cached in Redis for 60 seconds.
   */
  async getScore(slug: string): Promise<ReliabilityScore | null> {
    const scoreKey = `${SCORE_KEY_PREFIX}${slug}`;

    // Check cache first
    const cached = await this.redis.get(scoreKey);
    if (cached) {
      return JSON.parse(cached) as ReliabilityScore;
    }

    // Fetch all entries from sorted set
    const key = `${REDIS_KEY_PREFIX}${slug}`;
    const raw = await this.redis.zrange(key, 0, -1);

    if (raw.length === 0) return null;

    const records: CallRecord[] = raw.map((entry) => JSON.parse(entry));

    // Compute score
    const score = computeScore(records);

    // Cache with TTL
    await this.redis.set(scoreKey, JSON.stringify(score), "EX", SCORE_CACHE_TTL_S);

    return score;
  }
}

// ─────────────────────────────────────────────────────────────
// SCORING
// ─────────────────────────────────────────────────────────────

function computeScore(records: CallRecord[]): ReliabilityScore {
  // Filter out 429s for error/uptime calculations
  const non429 = records.filter((r) => r.statusCode !== 429);

  const total = non429.length;
  if (total === 0) {
    return {
      errorRate: 0,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
      p99LatencyMs: 0,
      uptimePct: 1,
      callCount: records.length,
      qualityScore: 100,
      computedAt: Date.now(),
    };
  }

  // Error rate: (4xx non-429 + 5xx) / total non-429
  const errors = non429.filter(
    (r) => r.statusCode >= 400,
  ).length;
  const errorRate = errors / total;

  // Uptime: non-5xx / total non-429
  const serverErrors = non429.filter((r) => r.statusCode >= 500).length;
  const uptimePct = (total - serverErrors) / total;

  // Latency percentiles (use ALL records including 429s for latency)
  const latencies = records.map((r) => r.latencyMs).sort((a, b) => a - b);
  const p50LatencyMs = percentile(latencies, 0.5);
  const p95LatencyMs = percentile(latencies, 0.95);
  const p99LatencyMs = percentile(latencies, 0.99);

  // Composite quality score: 60% uptime + 40% latency score
  const latencyScore = computeLatencyScore(p95LatencyMs);
  const qualityScore = Math.round(uptimePct * 100 * 0.6 + latencyScore * 0.4);

  return {
    errorRate: round4(errorRate),
    p50LatencyMs: Math.round(p50LatencyMs),
    p95LatencyMs: Math.round(p95LatencyMs),
    p99LatencyMs: Math.round(p99LatencyMs),
    uptimePct: round4(uptimePct),
    callCount: records.length,
    qualityScore,
    computedAt: Date.now(),
  };
}

/** Compute percentile from a sorted array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

/**
 * Latency score: 100 if p95 < 100ms, linear decay to 0 at 5000ms.
 */
function computeLatencyScore(p95Ms: number): number {
  if (p95Ms <= 100) return 100;
  if (p95Ms >= 5000) return 0;
  return Math.round(100 * (1 - (p95Ms - 100) / (5000 - 100)));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
