export const ABUSE_BLOCK_STATE_HASH_KEY = "nexusx:abuse:block-state";

export type AbuseBlockScope = "auth" | "payment";
export type AbuseBlockReason =
  | "invalid_api_key"
  | "ip_restricted"
  | "payment_replay"
  | "payment_invalid";

export interface AbuseBlockState {
  scope: AbuseBlockScope;
  subjectKey: string;
  reason: AbuseBlockReason;
  listingSlug: string | null;
  triggerCount: number;
  blockedUntil: number;
  expiresAt: number;
  updatedAt: number;
}

export interface AbuseBlockSnapshot {
  scope: AbuseBlockScope;
  subjectKey: string;
  reason: AbuseBlockReason;
  listingSlug: string | null;
  triggerCount: number;
  retryAfterMs: number;
  blockedUntil: string;
  updatedAt: string;
}

export interface AbuseBlockSummary {
  totalTracked: number;
  totalAuthBlocks: number;
  totalPaymentBlocks: number;
  items: AbuseBlockSnapshot[];
}

export function getAbuseHashField(scope: AbuseBlockScope, subjectKey: string): string {
  return `${scope}:${subjectKey}`;
}

export function getAbuseBlockRedisKey(scope: AbuseBlockScope, subjectKey: string): string {
  return `nexusx:abuse:block:${scope}:${subjectKey}`;
}

export function getAbuseCounterRedisKey(scope: AbuseBlockScope, subjectKey: string): string {
  return `nexusx:abuse:counter:${scope}:${subjectKey}`;
}

export function serializeAbuseBlockState(state: AbuseBlockState): string {
  return JSON.stringify(state);
}

export function parseAbuseBlockState(raw: string | null | undefined): AbuseBlockState | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const scope = parsed.scope;
    const subjectKey = parsed.subjectKey;
    const reason = parsed.reason;
    const listingSlug = parsed.listingSlug;
    const triggerCount = Number(parsed.triggerCount ?? 0);
    const blockedUntil = Number(parsed.blockedUntil ?? 0);
    const expiresAt = Number(parsed.expiresAt ?? 0);
    const updatedAt = Number(parsed.updatedAt ?? 0);

    if (
      (scope !== "auth" && scope !== "payment") ||
      typeof subjectKey !== "string" ||
      (reason !== "invalid_api_key" &&
        reason !== "ip_restricted" &&
        reason !== "payment_replay" &&
        reason !== "payment_invalid") ||
      (listingSlug !== null && listingSlug !== undefined && typeof listingSlug !== "string") ||
      !Number.isFinite(triggerCount) ||
      !Number.isFinite(blockedUntil) ||
      !Number.isFinite(expiresAt) ||
      !Number.isFinite(updatedAt)
    ) {
      return null;
    }

    return {
      scope,
      subjectKey,
      reason,
      listingSlug: typeof listingSlug === "string" ? listingSlug : null,
      triggerCount: Math.max(0, Math.trunc(triggerCount)),
      blockedUntil,
      expiresAt,
      updatedAt,
    };
  } catch {
    return null;
  }
}

export function isAbuseBlockExpired(
  state: AbuseBlockState,
  now: number = Date.now(),
): boolean {
  return state.expiresAt <= now || state.blockedUntil <= now;
}

export function summarizeAbuseBlockStates(
  states: Record<string, AbuseBlockState>,
  options: { limit?: number; now?: number } = {},
): AbuseBlockSummary {
  const now = options.now ?? Date.now();
  const limit = options.limit ?? 50;
  const items: AbuseBlockSnapshot[] = [];
  let totalTracked = 0;
  let totalAuthBlocks = 0;
  let totalPaymentBlocks = 0;

  for (const state of Object.values(states)) {
    if (isAbuseBlockExpired(state, now)) {
      continue;
    }

    totalTracked += 1;
    if (state.scope === "auth") totalAuthBlocks += 1;
    if (state.scope === "payment") totalPaymentBlocks += 1;

    items.push({
      scope: state.scope,
      subjectKey: state.subjectKey,
      reason: state.reason,
      listingSlug: state.listingSlug,
      triggerCount: state.triggerCount,
      retryAfterMs: Math.max(0, state.blockedUntil - now),
      blockedUntil: new Date(state.blockedUntil).toISOString(),
      updatedAt: new Date(state.updatedAt).toISOString(),
    });
  }

  items.sort((a, b) => b.retryAfterMs - a.retryAfterMs);

  return {
    totalTracked,
    totalAuthBlocks,
    totalPaymentBlocks,
    items: items.slice(0, limit),
  };
}
