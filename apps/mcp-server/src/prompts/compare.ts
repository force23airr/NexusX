// ═══════════════════════════════════════════════════════════════
// NexusX — MCP Compare Tools Prompt
// apps/mcp-server/src/prompts/compare.ts
//
// Prompt: nexusx_compare_tools — finds all tools matching a query,
// fetches reliability scores, and returns a ranked comparison table
// combining price × reliability for agent decision-making.
// ═══════════════════════════════════════════════════════════════

import type { DiscoveryService } from "../services/discovery";
import type { GatewayClient } from "../services/gateway-client";

export function createCompareToolsHandler(
  discovery: DiscoveryService,
  gateway: GatewayClient,
) {
  return async (args: {
    category_or_query: string;
    budget_max_usdc?: string;
    priority_mode?: string;
  }): Promise<{ messages: Array<{ role: string; content: { type: string; text: string } }> }> => {
    const query = args.category_or_query;
    const budgetMax = args.budget_max_usdc ? parseFloat(args.budget_max_usdc) : null;
    const priorityMode = (args.priority_mode as "frugal" | "balanced" | "mission_critical") ?? "balanced";

    // Use semantic search with instrumented fallback
    const searchResult = await discovery.semanticSearch(query, {
      limit: 15,
      budgetMaxUsdc: budgetMax ?? undefined,
      priorityMode,
    });
    const matchedListings = searchResult.listings;

    const matched = matchedListings.map((l) => ({ listing: l, score: 0 }));

    if (matched.length === 0) {
      return {
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `No tools found matching "${args.category_or_query}"` +
              (budgetMax ? ` within $${budgetMax} USDC budget` : "") +
              (searchResult.fallbackReason ? ` (fallback: ${searchResult.fallbackReason})` : "") +
              `. Try broader search terms or check nexusx://categories for available categories.`,
          },
        }],
      };
    }

    // Fetch reliability scores in parallel
    const withReliability = await Promise.all(
      matched.map(async (m) => {
        const reliability = await gateway.getReliability(m.listing.slug);
        return { ...m, reliability };
      }),
    );

    // Compute composite score: quality * (1 / normalized_price) * reliability_weight
    const prices = withReliability.map((m) => m.listing.currentPriceUsdc);
    const maxPrice = Math.max(...prices, 0.000001);

    const ranked = withReliability
      .map((m) => {
        const qualityScore = m.reliability?.qualityScore ?? Math.round(m.listing.qualityScore * 100);
        const normalizedPrice = m.listing.currentPriceUsdc / maxPrice;
        const priceScore = normalizedPrice > 0 ? 1 / normalizedPrice : 1;
        const compositeScore = (qualityScore / 100) * priceScore * 50;

        return {
          listing: m.listing,
          reliability: m.reliability,
          qualityScore,
          compositeScore: Math.round(compositeScore * 10) / 10,
        };
      })
      .sort((a, b) => b.compositeScore - a.compositeScore);

    // Build table
    const lines: string[] = [];
    lines.push(`=== Tool Comparison: "${args.category_or_query}" ===`);
    if (budgetMax) lines.push(`Budget: max $${budgetMax} USDC/call`);
    lines.push("");

    // Header
    lines.push(
      padRight("Rank", 5) + " | " +
      padRight("Tool", 26) + " | " +
      padRight("Price", 12) + " | " +
      padRight("Quality", 8) + " | " +
      padRight("p95 Latency", 12) + " | " +
      padRight("Error Rate", 11) + " | " +
      padRight("Score", 6),
    );
    lines.push("─".repeat(90));

    for (let i = 0; i < ranked.length; i++) {
      const r = ranked[i];
      const rel = r.reliability;

      lines.push(
        padRight(String(i + 1), 5) + " | " +
        padRight(r.listing.slug, 26) + " | " +
        padRight(`$${r.listing.currentPriceUsdc.toFixed(6)}`, 12) + " | " +
        padRight(`${r.qualityScore}/100`, 8) + " | " +
        padRight(rel ? `${rel.p95LatencyMs}ms` : `${r.listing.avgLatencyMs}ms*`, 12) + " | " +
        padRight(rel ? `${(rel.errorRate * 100).toFixed(1)}%` : "n/a", 11) + " | " +
        padRight(String(r.compositeScore), 6),
      );
    }

    lines.push("");
    lines.push("Composite score = quality x (1 / normalized_price) x weight");
    if (withReliability.some((m) => !m.reliability)) {
      lines.push("* = estimated from historical data (no live calls recorded yet)");
    }

    // Recommendation
    lines.push("");
    if (ranked.length >= 2) {
      const best = ranked[0];
      const cheapest = [...ranked].sort((a, b) => a.listing.currentPriceUsdc - b.listing.currentPriceUsdc)[0];

      lines.push(`Recommendation: ${best.listing.slug} offers the best price-quality tradeoff.`);
      if (cheapest.listing.slug !== best.listing.slug) {
        lines.push(`${cheapest.listing.slug} is cheapest${cheapest.reliability ? ` but ${cheapest.reliability.uptimePct < 0.98 ? "less reliable" : "slightly lower quality"}` : ""}.`);
      }
    } else {
      lines.push(`Only one match found: ${ranked[0].listing.slug}.`);
    }

    lines.push("");
    lines.push("Read nexusx://reliability/{slug} for full breakdown, or use the tool directly.");

    return {
      messages: [{
        role: "user",
        content: { type: "text", text: lines.join("\n") },
      }],
    };
  };
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}
