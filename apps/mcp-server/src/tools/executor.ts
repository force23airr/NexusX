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
import type { BundleDefinition, DiscoveredListing } from "../types";
import type { ToolRegistry } from "./registry";

interface ExecuteToolArgs {
  path?: string;
  method?: string;
  body?: Record<string, unknown>;
  query?: Record<string, string>;
  headers?: Record<string, string>;
}

interface BundleExecuteArgs extends ExecuteToolArgs {
  fail_fast?: boolean;
  return_intermediate?: boolean;
}

const MAX_CHAINED_STEP_PAYLOAD_BYTES = 10 * 1024 * 1024; // 10MB

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

    if (tool.kind === "bundle" && tool.bundle) {
      return this.executeBundleTool(toolName, tool.bundle, args as BundleExecuteArgs);
    }

    if (tool.kind !== "listing" || !tool.listing) {
      return this.errorResult(`Tool ${toolName} is malformed (missing listing metadata).`);
    }

    return this.executeListingTool(toolName, tool.listing, args as ExecuteToolArgs);
  }

  private async executeListingTool(
    toolName: string,
    listing: DiscoveredListing,
    args: ExecuteToolArgs,
  ): Promise<ToolCallResult> {
    const { path, method, body, query, headers } = args;

    // 1. Pre-call budget check
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
      slug: listing.slug,
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
      const reliability = await this.gateway.getReliability(listing.slug);
      if (reliability) {
        if (reliability.errorRate > 0.05) {
          metadataLines.push(`\nWarning: This API has elevated error rate (${(reliability.errorRate * 100).toFixed(1)}%) over the last ${reliability.callCount} calls`);
        }
        if (reliability.uptimePct < 0.95) {
          metadataLines.push(`\nWarning: Uptime is ${(reliability.uptimePct * 100).toFixed(1)}% — below 95% threshold`);
        }

        // Suggest alternative if reliability is degraded
        if ((reliability.errorRate > 0.05 || reliability.uptimePct < 0.95) && this.discovery) {
          const alternative = await this.findBetterAlternative(
            listing.slug,
            listing.categorySlug,
            reliability.qualityScore,
          );
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

  private async executeBundleTool(
    toolName: string,
    bundle: BundleDefinition,
    args: BundleExecuteArgs,
  ): Promise<ToolCallResult> {
    const method = (args.method || "POST").toUpperCase();
    const path = args.path || "/";
    const failFast = args.fail_fast !== false;
    const returnIntermediate = args.return_intermediate === true;

    // Pre-call budget check uses bundle price target (actual settlement).
    if (!this.budget.canAfford(bundle.bundlePriceUsdc)) {
      const state = this.budget.getState();
      return this.errorResult(
        `Budget exceeded for bundle ${bundle.slug}. This bundle settles at approximately ` +
        `$${bundle.bundlePriceUsdc.toFixed(6)} USDC (gross list $${bundle.grossPriceUsdc.toFixed(6)}), ` +
        `but only $${state.remainingUsdc.toFixed(6)} remains.`,
      );
    }

    let registration;
    try {
      registration = await this.gateway.registerBundleSession({
        bundleSlug: bundle.slug,
        bundleName: bundle.name,
        toolSlugs: bundle.steps.map((s) => s.slug),
        bundlePriceUsdc: bundle.bundlePriceUsdc,
        metadata: {
          toolName,
          discountPct: bundle.discountPct,
          generatedScore: bundle.score,
          generatedAt: Date.now(),
        },
      });
    } catch (err) {
      return this.errorResult(
        `Failed to register bundle session for ${bundle.slug}: ${err instanceof Error ? err.message : "unknown gateway error"}`,
      );
    }

    let currentBody: Record<string, unknown> | undefined = args.body;
    let finalOutput: unknown = null;
    let totalQuotedPrice = 0;
    let totalLatency = 0;
    let abortedMessage: string | null = null;
    const stepSummaries: Array<{
      step: number;
      slug: string;
      statusCode: number;
      success: boolean;
      latencyMs: number;
      quotedPriceUsdc: number;
      billedPriceUsdc: number;
      requestId: string;
    }> = [];
    const intermediate: Array<{ step: number; slug: string; output: unknown }> = [];

    for (let i = 0; i < bundle.steps.length; i++) {
      const step = bundle.steps[i];

      const result = await this.gateway.callListing({
        slug: step.slug,
        method,
        path,
        body: currentBody,
        query: args.query,
        headers: args.headers,
        bundleSessionId: registration.bundleSessionId,
        bundleStepIndex: i,
      });

      const quotedPriceUsdc =
        result.billingMode === "bundle_step"
          ? round6(result.quotedPriceUsdc ?? 0)
          : round6(result.priceUsdc);
      totalQuotedPrice += quotedPriceUsdc;
      totalLatency += result.latencyMs;

      stepSummaries.push({
        step: i + 1,
        slug: step.slug,
        statusCode: result.statusCode,
        success: result.success,
        latencyMs: result.latencyMs,
        quotedPriceUsdc,
        billedPriceUsdc: round6(result.priceUsdc),
        requestId: result.requestId,
      });

      if (!result.success) {
        if (failFast) {
          abortedMessage =
            `Bundle step ${i + 1}/${bundle.steps.length} failed at ${step.slug} ` +
            `(HTTP ${result.statusCode}).\n${result.body}`;
          break;
        }
        continue;
      }

      const parsed = parseMaybeJson(result.body);
      finalOutput = parsed;
      if (returnIntermediate) {
        intermediate.push({ step: i + 1, slug: step.slug, output: parsed });
      }

      // Chain output into the next step.
      const chainedBody: Record<string, unknown> = { input: parsed };
      const chainedPayloadBytes = estimatePayloadBytes(chainedBody);
      if (chainedPayloadBytes > MAX_CHAINED_STEP_PAYLOAD_BYTES) {
        abortedMessage =
          `Bundle step ${i + 1}/${bundle.steps.length} at ${step.slug} produced an output too large ` +
          `to chain safely (${formatBytes(chainedPayloadBytes)} > ${formatBytes(MAX_CHAINED_STEP_PAYLOAD_BYTES)}).`;
        break;
      }
      currentBody = chainedBody;
    }

    let settlement;
    try {
      settlement = await this.gateway.finalizeBundleSession(registration.bundleSessionId);
    } catch (err) {
      return this.errorResult(
        `Bundle finalization failed for session ${registration.bundleSessionId}: ${err instanceof Error ? err.message : "unknown gateway error"}`,
      );
    }

    if (settlement.billedPriceUsdc > 0) {
      this.budget.recordSpend(toolName, settlement.billedPriceUsdc);
    }

    const metadata = this.formatBundleMetadata(
      bundle,
      registration.bundleSessionId,
      stepSummaries,
      totalQuotedPrice,
      totalLatency,
      settlement.billedPriceUsdc,
      settlement.discountUsdc,
      settlement.platformFeeUsdc,
      settlement.providerPoolUsdc,
    );

    if (abortedMessage) {
      return this.errorResult(`${abortedMessage}\n\n${metadata}`);
    }

    const contents: Array<{ type: "text"; text: string }> = [
      {
        type: "text",
        text: typeof finalOutput === "string"
          ? finalOutput
          : JSON.stringify(finalOutput ?? { message: "Bundle completed with no output." }, null, 2),
      },
      {
        type: "text",
        text: metadata,
      },
    ];

    if (returnIntermediate) {
      contents.push({
        type: "text",
        text: JSON.stringify({ intermediate }, null, 2),
      });
    }

    return { content: contents };
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

  private formatBundleMetadata(
    bundle: BundleDefinition,
    bundleSessionId: string,
    steps: Array<{
      step: number;
      slug: string;
      statusCode: number;
      success: boolean;
      latencyMs: number;
      quotedPriceUsdc: number;
      billedPriceUsdc: number;
      requestId: string;
    }>,
    totalQuotedPrice: number,
    totalLatency: number,
    billedPriceUsdc: number,
    discountUsdc: number,
    platformFeeUsdc: number,
    providerPoolUsdc: number,
  ): string {
    const savings = round6(totalQuotedPrice - billedPriceUsdc);
    const successCount = steps.filter((s) => s.success).length;

    const lines: string[] = [
      "--- NexusX Bundle Metadata ---",
      `Bundle: ${bundle.slug}`,
      `Bundle Session: ${bundleSessionId}`,
      `Steps: ${bundle.steps.map((s) => s.slug).join(" -> ")}`,
      `Executed: ${successCount}/${bundle.steps.length} steps`,
      `Gross Quoted Cost: $${round6(totalQuotedPrice).toFixed(6)} USDC`,
      `Settled Bundle Price: $${round6(billedPriceUsdc).toFixed(6)} USDC`,
      `Realized Savings: $${savings.toFixed(6)} USDC (${bundle.discountPct > 0 ? (savings / Math.max(totalQuotedPrice, 0.000001) * 100).toFixed(1) : "0.0"}%)`,
      `Bundle Discount Applied: $${round6(discountUsdc).toFixed(6)} USDC`,
      `Platform Fee: $${round6(platformFeeUsdc).toFixed(6)} USDC`,
      `Provider Pool: $${round6(providerPoolUsdc).toFixed(6)} USDC`,
      `Total Latency: ${Math.round(totalLatency)}ms`,
      `Pattern Support: ${bundle.patternSupport}`,
      `Semantic Cohesion: ${(bundle.semanticCohesion * 100).toFixed(1)}%`,
      "",
      "Step Trace:",
    ];

    for (const step of steps) {
      lines.push(
        `  ${step.step}. ${step.slug} | HTTP ${step.statusCode} | ${step.latencyMs}ms | ` +
        `quoted=$${step.quotedPriceUsdc.toFixed(6)} billed=$${step.billedPriceUsdc.toFixed(6)} | req=${step.requestId || "n/a"}`,
      );
    }

    return lines.join("\n");
  }
}

function parseMaybeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function estimatePayloadBytes(payload: unknown): number {
  if (payload === undefined) return 0;
  if (typeof payload === "string") {
    return Buffer.byteLength(payload, "utf8");
  }
  try {
    return Buffer.byteLength(JSON.stringify(payload), "utf8");
  } catch {
    // Treat unserializable payloads as unsafe for chaining.
    return Number.MAX_SAFE_INTEGER;
  }
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)}MB`;
}
