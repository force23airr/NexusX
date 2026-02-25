// ═══════════════════════════════════════════════════════════════
// NexusX — MCP Price Trajectory Prompt
// apps/mcp-server/src/prompts/trajectory.ts
//
// Prompt: nexusx_price_trajectory — gives agents a structured
// analysis of price direction, multiplier breakdown, and an
// actionable recommendation (execute now vs. wait).
//
// This is the core moat feature: agents can make economically
// rational timing decisions that no human could act on fast enough.
// ═══════════════════════════════════════════════════════════════

import type { PriceSubscriber } from "../services/price-subscriber";
import type { BudgetTracker } from "../services/budget-tracker";
import { computeTrajectory } from "../resources/prices";

export function createPriceTrajectoryHandler(
  priceSubscriber: PriceSubscriber,
  budget: BudgetTracker,
) {
  return async (args: {
    slug: string;
    budget_max_usdc?: string;
  }): Promise<{ messages: Array<{ role: string; content: { type: string; text: string } }> }> => {
    const { slug } = args;
    const budgetMax = args.budget_max_usdc ? parseFloat(args.budget_max_usdc) : null;

    // Get in-memory history (fast path)
    let points = priceSubscriber.getHistoryBySlug(slug);

    // Fall back to gateway for extended history
    if (points.length === 0) {
      points = await priceSubscriber.getExtendedHistory(slug, "1h");
    }

    if (points.length === 0) {
      return {
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `No price history available for "${slug}". ` +
              `The auction engine may not have published data for this listing yet. ` +
              `Try checking nexusx://prices to see which listings have live data.`,
          },
        }],
      };
    }

    const trajectory = computeTrajectory(points);
    const latest = points[points.length - 1];
    const earliest = points[0];
    const spanMinutes = Math.round((latest.timestamp - earliest.timestamp) / 60_000);

    const budgetState = budget.getState();

    // Build the structured analysis
    const lines: string[] = [];

    lines.push(`=== Price Trajectory: ${slug} ===`);
    lines.push(`Current: $${latest.price.toFixed(6)} USDC/call`);
    lines.push(`Direction: ${formatDirection(trajectory.direction)} (${formatChange(trajectory.priceChange1h)} in last hour)`);
    lines.push("");

    // Multiplier breakdown (if available)
    if (latest.multipliers) {
      lines.push("Multiplier Breakdown:");
      lines.push(`  Demand:   ${latest.multipliers.demand.toFixed(2)}x${latest.demandScore !== undefined ? ` (score: ${Math.round(latest.demandScore)}/100, ${trajectory.demandTrend})` : ""}`);
      lines.push(`  Scarcity: ${latest.multipliers.scarcity.toFixed(2)}x`);
      lines.push(`  Quality:  ${latest.multipliers.quality.toFixed(2)}x`);
      lines.push(`  Momentum: ${latest.multipliers.momentum.toFixed(2)}x${latest.demandVelocity !== undefined ? ` (velocity: ${latest.demandVelocity > 0 ? "+" : ""}${latest.demandVelocity.toFixed(1)})` : ""}`);
      lines.push(`  Temporal: ${latest.multipliers.temporal.toFixed(2)}x`);
      lines.push(`  Combined: ${latest.multipliers.combined.toFixed(2)}x`);
      lines.push("");
    }

    // Trend over windows
    lines.push(`Trend (last ${spanMinutes}min of data):`);
    lines.push(`  5min:  ${formatChange(trajectory.priceChange5m)}`);
    lines.push(`  15min: ${formatChange(trajectory.priceChange15m)}`);
    lines.push(`  1h:    ${formatChange(trajectory.priceChange1h)}`);
    lines.push("");

    lines.push(`Support: $${trajectory.support.toFixed(6)} | Resistance: $${trajectory.resistance.toFixed(6)}`);
    lines.push("");

    // Recommendation
    lines.push(`Recommendation: ${trajectory.recommendation}`);
    lines.push("");

    // Budget context
    if (budgetState.limitUsdc > 0) {
      const callsAffordable = latest.price > 0
        ? Math.floor(budgetState.remainingUsdc / latest.price)
        : 0;
      lines.push(`Your Budget: $${budgetState.remainingUsdc.toFixed(6)} remaining (~${callsAffordable} calls at current price)`);
    }

    // Budget max filter
    if (budgetMax !== null && latest.price > budgetMax) {
      lines.push("");
      lines.push(`WARNING: Current price ($${latest.price.toFixed(6)}) exceeds your max budget ($${budgetMax.toFixed(6)}).`);
      if (trajectory.direction === "falling" || trajectory.direction === "falling_fast") {
        lines.push(`Price is trending down — it may reach your budget threshold soon.`);
      } else {
        lines.push(`Consider a cheaper alternative or increase your budget.`);
      }
    }

    return {
      messages: [{
        role: "user",
        content: { type: "text", text: lines.join("\n") },
      }],
    };
  };
}

// ─── Formatting Helpers ───

function formatDirection(dir: string): string {
  switch (dir) {
    case "rising_fast": return "RISING FAST";
    case "rising": return "RISING";
    case "stable": return "STABLE";
    case "falling": return "FALLING";
    case "falling_fast": return "FALLING FAST";
    default: return dir.toUpperCase();
  }
}

function formatChange(pct: number): string {
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}
