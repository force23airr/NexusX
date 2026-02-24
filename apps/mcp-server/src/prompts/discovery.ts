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
    const query = args.query.toLowerCase();
    const budgetMax = args.budget_max_usdc ? parseFloat(args.budget_max_usdc) : null;

    const listings = await discovery.loadListings();

    // Score each listing against the query
    const scored = listings
      .map((l) => {
        let score = 0;
        const searchText = `${l.name} ${l.description} ${l.tags.join(" ")} ${l.categorySlug}`.toLowerCase();

        // Simple keyword matching
        const queryWords = query.split(/\s+/);
        for (const word of queryWords) {
          if (searchText.includes(word)) score += 10;
          if (l.name.toLowerCase().includes(word)) score += 20;
          if (l.tags.some((t) => t.toLowerCase().includes(word))) score += 15;
        }

        // Boost for quality
        score += l.qualityScore * 5;

        // Budget filter
        if (budgetMax !== null && l.currentPriceUsdc > budgetMax) {
          score = -1;
        }

        return { listing: l, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

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
