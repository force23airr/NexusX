export const CIRCUIT_BREAKER_STATE_HASH_KEY = "nexusx:circuit-breaker:state";
export const CIRCUIT_BREAKER_PROBE_PREFIX = "nexusx:circuit-breaker:probe:";
export const DEFAULT_MANUAL_BREAKER_COOLDOWN_MS = 5 * 60 * 1000;
export const MIN_MANUAL_BREAKER_COOLDOWN_MS = 15 * 1000;
export const MAX_MANUAL_BREAKER_COOLDOWN_MS = 30 * 60 * 1000;

export interface SharedCircuitState {
  consecutiveFailures: number;
  openUntil: number | null;
  probeInFlightUntil: number | null;
  expiresAt: number;
  updatedAt: number;
}

export interface CircuitInspectionSnapshot {
  slug: string;
  state: "open" | "half_open" | "closed";
  consecutiveFailures: number;
  retryAfterMs: number;
  updatedAt: string;
  openUntil: string | null;
}

export interface CircuitInspectionSummary {
  totalTracked: number;
  totalOpen: number;
  totalHalfOpen: number;
  items: CircuitInspectionSnapshot[];
}

export function getCircuitProbeKey(slug: string): string {
  return `${CIRCUIT_BREAKER_PROBE_PREFIX}${slug}`;
}

export function serializeSharedCircuitState(state: SharedCircuitState): string {
  return JSON.stringify(state);
}

export function parseSharedCircuitState(raw: string | null | undefined): SharedCircuitState | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const consecutiveFailures = Number(parsed.consecutiveFailures ?? 0);
    const openUntil = parsed.openUntil === null || parsed.openUntil === undefined
      ? null
      : Number(parsed.openUntil);
    const probeInFlightUntil = parsed.probeInFlightUntil === null || parsed.probeInFlightUntil === undefined
      ? null
      : Number(parsed.probeInFlightUntil);
    const expiresAt = Number(parsed.expiresAt ?? 0);
    const updatedAt = Number(parsed.updatedAt ?? 0);

    if (
      !Number.isFinite(consecutiveFailures) ||
      (openUntil !== null && !Number.isFinite(openUntil)) ||
      (probeInFlightUntil !== null && !Number.isFinite(probeInFlightUntil)) ||
      !Number.isFinite(expiresAt) ||
      !Number.isFinite(updatedAt)
    ) {
      return null;
    }

    return {
      consecutiveFailures: Math.max(0, Math.trunc(consecutiveFailures)),
      openUntil,
      probeInFlightUntil,
      expiresAt,
      updatedAt,
    };
  } catch {
    return null;
  }
}

export function isSharedCircuitStateExpired(
  state: SharedCircuitState,
  now: number = Date.now(),
): boolean {
  return state.expiresAt <= now;
}

export function inspectSharedCircuitState(
  slug: string,
  state: SharedCircuitState,
  now: number = Date.now(),
): CircuitInspectionSnapshot {
  const isOpen = state.openUntil !== null && state.openUntil > now;
  const isHalfOpen =
    !isOpen &&
    state.probeInFlightUntil !== null &&
    state.probeInFlightUntil > now;

  return {
    slug,
    state: isOpen ? "open" : isHalfOpen ? "half_open" : "closed",
    consecutiveFailures: state.consecutiveFailures,
    retryAfterMs: isOpen && state.openUntil ? Math.max(0, state.openUntil - now) : 0,
    updatedAt: new Date(state.updatedAt).toISOString(),
    openUntil: state.openUntil ? new Date(state.openUntil).toISOString() : null,
  };
}

export function summarizeSharedCircuitStates(
  states: Record<string, SharedCircuitState>,
  options: { limit?: number; now?: number } = {},
): CircuitInspectionSummary {
  const now = options.now ?? Date.now();
  const limit = options.limit ?? 50;
  const items: CircuitInspectionSnapshot[] = [];
  let totalTracked = 0;
  let totalOpen = 0;
  let totalHalfOpen = 0;

  for (const [slug, state] of Object.entries(states)) {
    if (isSharedCircuitStateExpired(state, now)) {
      continue;
    }

    totalTracked += 1;
    const inspection = inspectSharedCircuitState(slug, state, now);
    if (inspection.state === "open") totalOpen += 1;
    if (inspection.state === "half_open") totalHalfOpen += 1;
    if (inspection.state !== "closed") {
      items.push(inspection);
    }
  }

  items.sort((a, b) => b.retryAfterMs - a.retryAfterMs);

  return {
    totalTracked,
    totalOpen,
    totalHalfOpen,
    items: items.slice(0, limit),
  };
}

export function normalizeManualBreakerCooldownMs(value: number | null | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MANUAL_BREAKER_COOLDOWN_MS;
  }

  return Math.min(
    MAX_MANUAL_BREAKER_COOLDOWN_MS,
    Math.max(MIN_MANUAL_BREAKER_COOLDOWN_MS, Math.trunc(value as number)),
  );
}

export function createManualOpenCircuitState(input?: {
  cooldownMs?: number | null;
  now?: number;
  consecutiveFailures?: number;
  ttlMs?: number;
}): SharedCircuitState {
  const now = input?.now ?? Date.now();
  const cooldownMs = normalizeManualBreakerCooldownMs(input?.cooldownMs);
  const openUntil = now + cooldownMs;

  return {
    consecutiveFailures: Math.max(1, Math.trunc(input?.consecutiveFailures ?? 1)),
    openUntil,
    probeInFlightUntil: null,
    expiresAt: now + Math.max(input?.ttlMs ?? cooldownMs * 2, 10 * 60 * 1000),
    updatedAt: now,
  };
}
