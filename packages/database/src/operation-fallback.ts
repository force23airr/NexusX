import type { OperationSearchMatch } from "./operation-discovery";

export interface OperationFallbackPlanningInput {
  listingId: string;
  slug: string;
  name: string;
  rankingScore?: number;
  trustScore?: number;
  regionAffinityScore?: number;
  operationMatchScore?: number;
  operationExecutionScore?: number;
  currentPriceUsdc: number;
  matchedOperations: OperationSearchMatch[];
}

export interface OperationFallbackCandidate {
  listingId: string;
  slug: string;
  name: string;
  operationId: string;
  operationName: string;
  method: string;
  path: string;
  mode: string;
  score: number;
  compatibilityScore: number;
  trustScore?: number;
  currentPriceUsdc: number;
  operationExecutionScore?: number;
  idempotent: boolean;
  sideEffect: boolean;
  autoExecutable: boolean;
  reason: string;
}

export interface OperationFallbackPlan {
  primaryOperationId?: string;
  primaryOperationName?: string;
  autoFallbackSafe: boolean;
  blockedReason?: string;
  candidates: OperationFallbackCandidate[];
}

const STOP_WORDS = new Set([
  "api",
  "service",
  "data",
  "request",
  "response",
  "call",
]);

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_/.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function normalizeOperationName(value: string): string {
  return normalizeText(value).replace(/\s+/g, " ");
}

function operationTokens(operation: OperationSearchMatch): Set<string> {
  return new Set(
    tokenize(
      [
        operation.operationId,
        operation.name,
        operation.method,
        operation.path,
        operation.mode,
      ]
        .filter(Boolean)
        .join(" "),
    ),
  );
}

function lastPathToken(path: string): string {
  const normalized = normalizeText(path);
  const segments = normalized.split(/\s+/).filter(Boolean);
  return segments[segments.length - 1] ?? "";
}

function intersectionSize(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const token of left) {
    if (right.has(token)) count += 1;
  }
  return count;
}

function computeCompatibilityScore(
  primary: OperationSearchMatch,
  candidate: OperationSearchMatch,
): number {
  const primaryTokens = operationTokens(primary);
  const candidateTokens = operationTokens(candidate);
  const denominator = Math.max(primaryTokens.size, candidateTokens.size, 1);
  const overlap = intersectionSize(primaryTokens, candidateTokens) / denominator;
  const exactId =
    normalizeOperationName(primary.operationId) === normalizeOperationName(candidate.operationId)
      ? 1
      : 0;
  const exactName =
    normalizeOperationName(primary.name) === normalizeOperationName(candidate.name) ? 1 : 0;
  const sameMethod = primary.method === candidate.method ? 1 : 0;
  const samePathTail =
    lastPathToken(primary.path) !== "" &&
    lastPathToken(primary.path) === lastPathToken(candidate.path)
      ? 1
      : 0;

  return clamp01(
    overlap * 0.5 +
      exactId * 0.2 +
      exactName * 0.15 +
      sameMethod * 0.1 +
      samePathTail * 0.05,
  );
}

function buildBlockedReason(
  primaryOperation: OperationSearchMatch | undefined,
  candidates: OperationFallbackCandidate[],
): string | undefined {
  if (!primaryOperation) {
    return "No matched operation was identified for this listing.";
  }
  if (primaryOperation.sideEffect) {
    return "Matched operation has side effects; automatic fallback is disabled.";
  }
  if (!primaryOperation.idempotent) {
    return "Matched operation is not idempotent; automatic fallback is disabled.";
  }
  if (candidates.length === 0) {
    return "No compatible fallback operations were found.";
  }
  if (!candidates.some((candidate) => candidate.autoExecutable)) {
    return "Available fallback operations are not safe for automatic retry.";
  }
  return undefined;
}

export function planOperationFallbacks(
  inputs: OperationFallbackPlanningInput[],
  options?: { maxCandidates?: number },
): Map<string, OperationFallbackPlan> {
  const maxCandidates = options?.maxCandidates ?? 3;
  const plans = new Map<string, OperationFallbackPlan>();

  for (const primaryInput of inputs) {
    const primaryOperation = primaryInput.matchedOperations[0];
    if (!primaryOperation) {
      plans.set(primaryInput.listingId, {
        autoFallbackSafe: false,
        blockedReason: "No matched operation was identified for this listing.",
        candidates: [],
      });
      continue;
    }

    const primaryIsSafe = primaryOperation.idempotent && !primaryOperation.sideEffect;
    const candidates = inputs
      .filter((candidateInput) => candidateInput.listingId !== primaryInput.listingId)
      .map((candidateInput): OperationFallbackCandidate | null => {
        const candidateOperation = candidateInput.matchedOperations[0];
        if (!candidateOperation) return null;

        const compatibilityScore = computeCompatibilityScore(
          primaryOperation,
          candidateOperation,
        );
        if (compatibilityScore < 0.35) return null;

        const score = clamp01(
          compatibilityScore * 0.45 +
            (candidateInput.operationExecutionScore ?? 0) * 0.2 +
            (candidateInput.operationMatchScore ?? 0) * 0.15 +
            (candidateInput.trustScore ?? 0.82) * 0.15 +
            (candidateInput.regionAffinityScore ?? 0) * 0.03 +
            (candidateInput.rankingScore ?? 0) * 0.02,
        );
        const candidateIsSafe =
          primaryIsSafe &&
          candidateOperation.idempotent &&
          !candidateOperation.sideEffect;

        return {
          listingId: candidateInput.listingId,
          slug: candidateInput.slug,
          name: candidateInput.name,
          operationId: candidateOperation.operationId,
          operationName: candidateOperation.name,
          method: candidateOperation.method,
          path: candidateOperation.path,
          mode: candidateOperation.mode,
          score,
          compatibilityScore,
          trustScore: candidateInput.trustScore,
          currentPriceUsdc: candidateInput.currentPriceUsdc,
          operationExecutionScore: candidateInput.operationExecutionScore,
          idempotent: candidateOperation.idempotent,
          sideEffect: candidateOperation.sideEffect,
          autoExecutable: candidateIsSafe,
          reason:
            compatibilityScore >= 0.65
              ? "Strong action overlap with the primary operation."
              : "Compatible action fallback based on operation semantics.",
        } satisfies OperationFallbackCandidate;
      })
      .filter((candidate): candidate is OperationFallbackCandidate => candidate !== null)
      .sort((left, right) => right.score - left.score)
      .slice(0, maxCandidates);

    plans.set(primaryInput.listingId, {
      primaryOperationId: primaryOperation.operationId,
      primaryOperationName: primaryOperation.name,
      autoFallbackSafe: candidates.some((candidate) => candidate.autoExecutable),
      blockedReason: buildBlockedReason(primaryOperation, candidates),
      candidates,
    });
  }

  return plans;
}
