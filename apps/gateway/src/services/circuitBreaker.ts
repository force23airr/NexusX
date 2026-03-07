export interface CircuitBreakerConfig {
  enabled: boolean;
  failureThreshold: number;
  cooldownMs: number;
}

export interface CircuitStateSnapshot {
  state: "closed" | "open" | "half_open";
  consecutiveFailures: number;
  retryAfterMs: number;
}

interface CircuitState {
  consecutiveFailures: number;
  openUntil: number | null;
  probeInFlight: boolean;
}

export class CircuitBreakerService {
  private circuits = new Map<string, CircuitState>();

  constructor(private readonly config: CircuitBreakerConfig) {}

  beforeRequest(slug: string): CircuitStateSnapshot {
    if (!this.config.enabled) {
      return {
        state: "closed",
        consecutiveFailures: 0,
        retryAfterMs: 0,
      };
    }

    const state = this.circuits.get(slug);
    if (!state || state.openUntil === null) {
      return {
        state: "closed",
        consecutiveFailures: state?.consecutiveFailures ?? 0,
        retryAfterMs: 0,
      };
    }

    const now = Date.now();
    if (state.openUntil > now) {
      return {
        state: "open",
        consecutiveFailures: state.consecutiveFailures,
        retryAfterMs: state.openUntil - now,
      };
    }

    if (state.probeInFlight) {
      return {
        state: "open",
        consecutiveFailures: state.consecutiveFailures,
        retryAfterMs: 1_000,
      };
    }

    state.probeInFlight = true;
    return {
      state: "half_open",
      consecutiveFailures: state.consecutiveFailures,
      retryAfterMs: 0,
    };
  }

  recordResult(slug: string, statusCode: number): void {
    if (!this.config.enabled) {
      return;
    }

    if (statusCode >= 500) {
      this.recordFailure(slug);
      return;
    }

    if (statusCode === 429) {
      const state = this.circuits.get(slug);
      if (state) {
        state.probeInFlight = false;
      }
      return;
    }

    this.recordSuccess(slug);
  }

  private recordFailure(slug: string): void {
    const state = this.circuits.get(slug) ?? {
      consecutiveFailures: 0,
      openUntil: null,
      probeInFlight: false,
    };

    state.consecutiveFailures += 1;
    state.probeInFlight = false;

    if (state.consecutiveFailures >= this.config.failureThreshold) {
      state.openUntil = Date.now() + this.config.cooldownMs;
    }

    this.circuits.set(slug, state);
  }

  private recordSuccess(slug: string): void {
    this.circuits.delete(slug);
  }
}
