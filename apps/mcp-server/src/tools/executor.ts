// ═══════════════════════════════════════════════════════════════
// NexusX — MCP Tool Executor
// apps/mcp-server/src/tools/executor.ts
//
// Executes tool calls by routing through the NexusX gateway.
// Handles budget checks, gateway calls, and response formatting.
// ═══════════════════════════════════════════════════════════════

import type { GatewayClient } from "../services/gateway-client";
import type { BudgetTracker } from "../services/budget-tracker";
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
  constructor(
    private registry: ToolRegistry,
    private gateway: GatewayClient,
    private budget: BudgetTracker,
  ) {}

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
    const metadata = [
      `--- NexusX Metadata ---`,
      `Request ID: ${result.requestId}`,
      `Price: $${result.priceUsdc.toFixed(6)} USDC`,
      `Latency: ${result.latencyMs}ms`,
      result.isSandbox ? `Mode: Sandbox (no billing)` : `Fee: $${result.platformFeeUsdc.toFixed(6)} USDC`,
    ].join("\n");

    return {
      content: [
        { type: "text", text: result.body },
        { type: "text", text: metadata },
      ],
    };
  }

  private errorResult(message: string): ToolCallResult {
    return {
      content: [{ type: "text", text: message }],
      isError: true,
    };
  }
}
