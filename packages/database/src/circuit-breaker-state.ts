export const CIRCUIT_BREAKER_STATE_HASH_KEY = "nexusx:circuit-breaker:state";
export const CIRCUIT_BREAKER_PROBE_PREFIX = "nexusx:circuit-breaker:probe:";

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
