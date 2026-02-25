// ═══════════════════════════════════════════════════════════════
// NexusX — MCP Discovery Prompt
// apps/mcp-server/src/prompts/discovery.ts
//
// Prompt: nexusx_find_api — search listings by natural language
// ═══════════════════════════════════════════════════════════════

import type { DiscoveryService } from "../services/discovery";

export function createFindApiHandler(discovery: DiscoveryService) {
  return async (args: {
    query: string;
    budget_max_usdc?: string;
  }): Promise<{ messages: Array<{ role: string; content: { type: string; text: string } }> }> => {
    const query = args.query;
    const budgetMax = args.budget_max_usdc ? parseFloat(args.budget_max_usdc) : null;

    // Use semantic search with instrumented fallback
    const matchedListings = await discovery.semanticSearch(query, {
      limit: 10,
      budgetMaxUsdc: budgetMax ?? undefined,
    });

    const scored = matchedListings.map((l) => ({ listing: l, score: 0 }));

    if (scored.length === 0) {
      return {
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `No APIs found matching "${args.query}"` +
              (budgetMax ? ` within $${budgetMax} USDC budget` : "") +
              `. Try broader search terms or check available categories with the nexusx://categories resource.`,
          },
        }],
      };
    }

    const results = scored.map((s, i) => {
      const l = s.listing;
      return [
        `${i + 1}. ${l.name} (${l.slug})`,
        `   ${l.description.slice(0, 150)}`,
        `   Price: $${l.currentPriceUsdc.toFixed(6)} USDC | Quality: ${Math.round(l.qualityScore * 100)}% | Latency: ${l.avgLatencyMs}ms`,
        `   Tags: ${l.tags.join(", ") || "none"}`,
        `   Tool name: nexusx_${l.slug.replace(/-/g, "_")}`,
      ].join("\n");
    });

    const header = `=== API Search Results for "${args.query}" ===` +
      (budgetMax ? ` (max $${budgetMax} USDC)` : "");

    return {
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: header + "\n\n" + results.join("\n\n") +
            "\n\nUse the tool name to call an API directly, or read nexusx://listings/{slug} for full details.",
        },
      }],
    };
  };
}
