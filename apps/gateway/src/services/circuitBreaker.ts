import {
  CIRCUIT_BREAKER_STATE_HASH_KEY,
  getCircuitProbeKey,
  isSharedCircuitStateExpired,
  inspectSharedCircuitState,
  parseSharedCircuitState,
  serializeSharedCircuitState,
  summarizeSharedCircuitStates,
  type CircuitInspectionSnapshot,
  type SharedCircuitState,
} from "@nexusx/database";

export interface CircuitBreakerConfig {
  enabled: boolean;
  failureThreshold: number;
  cooldownMs: number;
  probeTtlMs: number;
  stateTtlMs?: number;
}

export interface CircuitStateSnapshot {
  state: "closed" | "open" | "half_open";
  consecutiveFailures: number;
  retryAfterMs: number;
}

interface CircuitBreakerStore {
  getState(slug: string): Promise<SharedCircuitState | null>;
  setState(slug: string, state: SharedCircuitState): Promise<void>;
  deleteState(slug: string): Promise<void>;
  tryAcquireProbe(slug: string, ttlMs: number): Promise<boolean>;
  releaseProbe(slug: string): Promise<void>;
  listStates(): Promise<Record<string, SharedCircuitState>>;
}

interface CircuitBreakerRedisClient {
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, field: string, value: string): Promise<number>;
  hdel(key: string, field: string): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
  set(key: string, value: string, pxMode: "PX", ttlMs: number, nxMode: "NX"): Promise<"OK" | null>;
  del(...keys: string[]): Promise<number>;
}

class InMemoryCircuitBreakerStore implements CircuitBreakerStore {
  private states = new Map<string, SharedCircuitState>();
  private probes = new Map<string, number>();

  async getState(slug: string): Promise<SharedCircuitState | null> {
    this.cleanupProbe(slug);
    return this.states.get(slug) ?? null;
  }

  async setState(slug: string, state: SharedCircuitState): Promise<void> {
    this.states.set(slug, state);
  }

  async deleteState(slug: string): Promise<void> {
    this.states.delete(slug);
    this.probes.delete(slug);
  }

  async tryAcquireProbe(slug: string, ttlMs: number): Promise<boolean> {
    this.cleanupProbe(slug);
    if ((this.probes.get(slug) ?? 0) > Date.now()) {
      return false;
    }

    this.probes.set(slug, Date.now() + ttlMs);
    return true;
  }

  async releaseProbe(slug: string): Promise<void> {
    this.probes.delete(slug);
  }

  async listStates(): Promise<Record<string, SharedCircuitState>> {
    const result: Record<string, SharedCircuitState> = {};
    for (const [slug, state] of this.states.entries()) {
      result[slug] = state;
    }
    return result;
  }

  private cleanupProbe(slug: string): void {
    const probeUntil = this.probes.get(slug);
    if (probeUntil !== undefined && probeUntil <= Date.now()) {
      this.probes.delete(slug);
    }
  }
}

class RedisCircuitBreakerStore implements CircuitBreakerStore {
  constructor(private readonly redis: CircuitBreakerRedisClient) {}

  async getState(slug: string): Promise<SharedCircuitState | null> {
    return parseSharedCircuitState(
      await this.redis.hget(CIRCUIT_BREAKER_STATE_HASH_KEY, slug),
    );
  }

  async setState(slug: string, state: SharedCircuitState): Promise<void> {
    await this.redis.hset(
      CIRCUIT_BREAKER_STATE_HASH_KEY,
      slug,
      serializeSharedCircuitState(state),
    );
  }

  async deleteState(slug: string): Promise<void> {
    await this.redis.hdel(CIRCUIT_BREAKER_STATE_HASH_KEY, slug);
    await this.redis.del(getCircuitProbeKey(slug));
  }

  async tryAcquireProbe(slug: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.set(getCircuitProbeKey(slug), "1", "PX", ttlMs, "NX");
    return result === "OK";
  }

  async releaseProbe(slug: string): Promise<void> {
    await this.redis.del(getCircuitProbeKey(slug));
  }

  async listStates(): Promise<Record<string, SharedCircuitState>> {
    const raw = await this.redis.hgetall(CIRCUIT_BREAKER_STATE_HASH_KEY);
    const result: Record<string, SharedCircuitState> = {};

    for (const [slug, value] of Object.entries(raw)) {
      const parsed = parseSharedCircuitState(value);
      if (parsed) {
        result[slug] = parsed;
      }
    }

    return result;
  }
}

export class CircuitBreakerService {
  private readonly stateTtlMs: number;
  private readonly store: CircuitBreakerStore;

  constructor(
    private readonly config: CircuitBreakerConfig,
    redis?: CircuitBreakerRedisClient,
    private readonly onStateChange?: (event: {
      slug: string;
      previousState: "closed" | "open" | "half_open";
      nextState: "closed" | "open" | "half_open";
    }) => Promise<void> | void,
  ) {
    this.stateTtlMs = config.stateTtlMs ?? Math.max(config.cooldownMs * 2, 10 * 60 * 1000);
    this.store = redis
      ? new RedisCircuitBreakerStore(redis)
      : new InMemoryCircuitBreakerStore();
  }

  async beforeRequest(slug: string): Promise<CircuitStateSnapshot> {
    if (!this.config.enabled) {
      return {
        state: "closed",
        consecutiveFailures: 0,
        retryAfterMs: 0,
      };
    }

    const now = Date.now();
    const state = await this.store.getState(slug);
    if (!state) {
      return { state: "closed", consecutiveFailures: 0, retryAfterMs: 0 };
    }

    if (isSharedCircuitStateExpired(state, now)) {
      await this.store.deleteState(slug);
      return { state: "closed", consecutiveFailures: 0, retryAfterMs: 0 };
    }

    const inspection = inspectSharedCircuitState(slug, state, now);

    if (inspection.state === "open") {
      return {
        state: "open",
        consecutiveFailures: inspection.consecutiveFailures,
        retryAfterMs: inspection.retryAfterMs,
      };
    }

    if (inspection.state === "half_open") {
      return {
        state: "open",
        consecutiveFailures: inspection.consecutiveFailures,
        retryAfterMs: 1_000,
      };
    }

    if (state.openUntil !== null) {
      const acquired = await this.store.tryAcquireProbe(slug, this.config.probeTtlMs);
      if (!acquired) {
        return {
          state: "open",
          consecutiveFailures: state.consecutiveFailures,
          retryAfterMs: 1_000,
        };
      }

      const nextState: SharedCircuitState = {
        ...state,
        probeInFlightUntil: now + this.config.probeTtlMs,
        expiresAt: now + this.stateTtlMs,
        updatedAt: now,
      };
      await this.store.setState(slug, nextState);
      await this.notifyStateChange(slug, "open", "half_open");
      return {
        state: "half_open",
        consecutiveFailures: nextState.consecutiveFailures,
        retryAfterMs: 0,
      };
    }

    return {
      state: "closed",
      consecutiveFailures: state.consecutiveFailures,
      retryAfterMs: 0,
    };
  }

  async recordResult(slug: string, statusCode: number): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    if (statusCode >= 500) {
      await this.recordFailure(slug);
      return;
    }

    if (statusCode === 429) {
      const state = await this.store.getState(slug);
      if (!state) {
        return;
      }

      await this.store.releaseProbe(slug);
      const nextState: SharedCircuitState = {
        ...state,
        probeInFlightUntil: null,
        expiresAt: Date.now() + this.stateTtlMs,
        updatedAt: Date.now(),
      };
      await this.store.setState(slug, nextState);
      return;
    }

    await this.recordSuccess(slug);
  }

  async listTrackedStates(limit: number = 50): Promise<{
    totalTracked: number;
    totalOpen: number;
    totalHalfOpen: number;
    items: CircuitInspectionSnapshot[];
  }> {
    const now = Date.now();
    const states = await this.store.listStates();

    for (const [slug, state] of Object.entries(states)) {
      if (isSharedCircuitStateExpired(state, now)) {
        await this.store.deleteState(slug);
      }
    }

    return summarizeSharedCircuitStates(states, { limit, now });
  }

  private async recordFailure(slug: string): Promise<void> {
    const now = Date.now();
    const current = await this.store.getState(slug);
    const previousState = current ? inspectSharedCircuitState(slug, current, now).state : "closed";
    const nextFailures = (current?.consecutiveFailures ?? 0) + 1;
    const shouldOpen = nextFailures >= this.config.failureThreshold;

    const nextState: SharedCircuitState = {
      consecutiveFailures: nextFailures,
      openUntil: shouldOpen ? now + this.config.cooldownMs : current?.openUntil ?? null,
      probeInFlightUntil: null,
      expiresAt: now + this.stateTtlMs,
      updatedAt: now,
    };

    await this.store.releaseProbe(slug);
    await this.store.setState(slug, nextState);

    const nextInspectionState = inspectSharedCircuitState(slug, nextState, now).state;
    if (previousState !== nextInspectionState) {
      await this.notifyStateChange(slug, previousState, nextInspectionState);
    }
  }

  private async recordSuccess(slug: string): Promise<void> {
    const current = await this.store.getState(slug);
    const previousState = current
      ? inspectSharedCircuitState(slug, current, Date.now()).state
      : "closed";

    await this.store.deleteState(slug);

    if (previousState !== "closed") {
      await this.notifyStateChange(slug, previousState, "closed");
    }
  }

  private async notifyStateChange(
    slug: string,
    previousState: "closed" | "open" | "half_open",
    nextState: "closed" | "open" | "half_open",
  ): Promise<void> {
    if (!this.onStateChange || previousState === nextState) {
      return;
    }

    await this.onStateChange({ slug, previousState, nextState });
  }
}
