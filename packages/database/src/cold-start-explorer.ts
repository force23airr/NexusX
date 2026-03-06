// ═══════════════════════════════════════════════════════════════
// NexusX — Cold-Start Explorer
// packages/database/src/cold-start-explorer.ts
//
// UCB1 (Upper Confidence Bound) exploration bonus for new
// listings with few observations. Applied WITHIN capability
// tiers only — a cold-start listing can rise within its tier
// but never jump to a higher tier.
// ═══════════════════════════════════════════════════════════════

/**
 * Compute a UCB1 exploration bonus for a listing.
 *
 * UCB1: bonus = c * sqrt(ln(totalImpressions) / max(listingImpressions, 1))
 *
 * Decays to negligible after ~100 impressions.
 *
 * @param listing - The listing's observation data
 * @param totalImpressions - Total impressions across ALL listings
 * @param explorationParam - Exploration parameter c (default: 0.1)
 * @returns UCB1 bonus value (0 to ~0.3)
 */
export function computeExplorationBonus(
  listing: {
    discoveryImpressions: number;
    publishedAt: Date | null;
    qualityScore: number;
  },
  totalImpressions: number,
  explorationParam: number = 0.1,
): number {
  // No exploration bonus if we have sufficient data
  if (listing.discoveryImpressions >= 100) return 0;

  // No exploration bonus if there are no impressions system-wide yet
  if (totalImpressions <= 0) return explorationParam;

  const impressions = Math.max(listing.discoveryImpressions, 1);
  const bonus = explorationParam * Math.sqrt(
    Math.log(totalImpressions) / impressions,
  );

  // Cap the bonus to prevent extreme values
  return Math.min(bonus, 0.3);
}
