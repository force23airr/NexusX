// ═══════════════════════════════════════════════════════════════
// NexusX — MCP Tool Executor
// apps/mcp-server/src/tools/executor.ts
//
// Executes tool calls by routing through the NexusX gateway.
// Handles budget checks, gateway calls, and response formatting.
// ═══════════════════════════════════════════════════════════════

import type { GatewayClient } from "../services/gateway-client";
import type { BudgetTracker } from "../services/budget-tracker";
import type { DiscoveryService } from "../services/discovery";
import type { ToolRegistry } from "./registry";

interface ExecuteToolArgs {
  path?: string;
  method?: string;
  body?: Record<string, unknown>;
  query?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface ToolCallResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export class ToolExecutor {
  private discovery?: DiscoveryService;

  constructor(
    private registry: ToolRegistry,
    private gateway: GatewayClient,
    private budget: BudgetTracker,
  ) {}

  /** Inject discovery service for alternative suggestions. */
  setDiscoveryService(discovery: DiscoveryService): void {
    this.discovery = discovery;
  }

  /**
   * Execute a tool call. This is the handler wired into McpServer.tool().
   */
  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    // 1. Resolve tool → listing
    const tool = this.registry.getTool(toolName);
    if (!tool) {
      return this.errorResult(`Unknown tool: ${toolName}`);
    }

    const { slug, listing } = tool;
    const { path, method, body, query, headers } = args as ExecuteToolArgs;

    // 2. Pre-call budget check
    if (!this.budget.canAfford(listing.currentPriceUsdc)) {
      const state = this.budget.getState();
      return this.errorResult(
        `Budget exceeded. This call costs $${listing.currentPriceUsdc.toFixed(6)} USDC, ` +
        `but you only have $${state.remainingUsdc.toFixed(6)} remaining ` +
        `(spent $${state.spentUsdc.toFixed(6)} of $${state.limitUsdc.toFixed(6)} limit). ` +
        `Use the nexusx_set_budget prompt to increase your limit, or choose a cheaper API.`,
      );
    }

    // 3. Execute through gateway
    const result = await this.gateway.callListing({
      slug,
      method: (method || "POST").toUpperCase(),
      path: path || "/",
      body,
      query,
      headers,
    });

    // 4. Post-call budget update
    if (result.priceUsdc > 0) {
      this.budget.recordSpend(toolName, result.priceUsdc);
    }

    // 5. Format response
    if (!result.success) {
      return this.errorResult(
        `API call failed (HTTP ${result.statusCode}):\n${result.body}\n\n` +
        `Request ID: ${result.requestId}` +
        (result.priceUsdc > 0 ? `\nCharged: $${result.priceUsdc.toFixed(6)} USDC` : ""),
      );
    }

    // Build response with metadata
    const metadataLines = [
      `--- NexusX Metadata ---`,
      `Request ID: ${result.requestId}`,
      `Price: $${result.priceUsdc.toFixed(6)} USDC`,
      `Latency: ${result.latencyMs}ms`,
      result.isSandbox ? `Mode: Sandbox (no billing)` : `Fee: $${result.platformFeeUsdc.toFixed(6)} USDC`,
    ];

    // Fetch reliability score and add warnings (non-blocking)
    try {
      const reliability = await this.gateway.getReliability(slug);
      if (reliability) {
        if (reliability.errorRate > 0.05) {
          metadataLines.push(`\nWarning: This API has elevated error rate (${(reliability.errorRate * 100).toFixed(1)}%) over the last ${reliability.callCount} calls`);
        }
        if (reliability.uptimePct < 0.95) {
          metadataLines.push(`\nWarning: Uptime is ${(reliability.uptimePct * 100).toFixed(1)}% — below 95% threshold`);
        }

        // Suggest alternative if reliability is degraded
        if ((reliability.errorRate > 0.05 || reliability.uptimePct < 0.95) && this.discovery) {
          const alternative = await this.findBetterAlternative(slug, listing.categorySlug, reliability.qualityScore);
          if (alternative) {
            metadataLines.push(`\nAlternative: ${alternative.slug} has better reliability (${alternative.qualityScore}/100) at $${alternative.price.toFixed(6)} USDC`);
          }
        }
      }
    } catch {
      // Non-critical — don't fail the response
    }

    return {
      content: [
        { type: "text", text: result.body },
        { type: "text", text: metadataLines.join("\n") },
      ],
    };
  }

  /**
   * Find a same-category listing with better reliability than the current one.
   */
  private async findBetterAlternative(
    currentSlug: string,
    categorySlug: string,
    currentQualityScore: number,
  ): Promise<{ slug: string; qualityScore: number; price: number } | null> {
    if (!this.discovery) return null;

    try {
      const listings = await this.discovery.loadListings();
      const sameCategory = listings.filter(
        (l) => l.categorySlug === categorySlug && l.slug !== currentSlug,
      );

      // Check reliability for same-category listings
      const candidates = await Promise.all(
        sameCategory.slice(0, 5).map(async (l) => {
          const rel = await this.gateway.getReliability(l.slug);
          return { listing: l, reliability: rel };
        }),
      );

      const better = candidates
        .filter((c) => c.reliability && c.reliability.qualityScore > currentQualityScore)
        .sort((a, b) => (b.reliability?.qualityScore ?? 0) - (a.reliability?.qualityScore ?? 0));

      if (better.length === 0) return null;

      const best = better[0];
      return {
        slug: best.listing.slug,
        qualityScore: best.reliability!.qualityScore,
        price: best.listing.currentPriceUsdc,
      };
    } catch {
      return null;
    }
  }

  private errorResult(message: string): ToolCallResult {
    return {
      content: [{ type: "text", text: message }],
      isError: true,
    };
  }
}
