// ═══════════════════════════════════════════════════════════════
// NexusX — Orchestrator Service
// apps/mcp-server/src/services/orchestrator.ts
//
// Single-tool AI API orchestrator. Interprets natural language
// tasks, selects the optimal API(s) from the marketplace,
// chains them if needed, and returns unified results.
//
// Intent resolution: semantic-first via pgvector (listing intents
// + embeddings), with KNOWN_CATEGORIES for endpoint/body inference
// on matched listings.
//
// This is the brain behind the `nexusx` MCP tool — the single
// entry point for any agent to access the entire marketplace.
// ═══════════════════════════════════════════════════════════════

import type { ToolExecutor, ToolCallResult } from "../tools/executor";
import type { DiscoveryService } from "./discovery";
import type { ToolRegistry } from "../tools/registry";
import type { DiscoveredListing } from "../types";

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export type PriorityMode = "frugal" | "balanced" | "mission_critical";

export interface OrchestrationArgs {
  task: string;
  input?: Record<string, unknown>;
  budget_max_usdc?: number;
  priority_mode?: PriorityMode;
}

interface ResolvedApi {
  listing: DiscoveredListing;
  endpoint: { method: string; path: string };
  body: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────
// KNOWN CATEGORIES — endpoint + body builders for known types
// ─────────────────────────────────────────────────────────────

const KNOWN_CATEGORIES: Record<string, {
  endpoint: { method: string; path: string };
  buildBody: (input: Record<string, unknown>, prev?: unknown) => Record<string, unknown>;
}> = {
  "translation": {
    endpoint: { method: "POST", path: "/translate" },
    buildBody: (input, prev) => {
      const text = (input.text as string) ?? (prev as any)?.text ?? (typeof prev === "string" ? prev : "");
      const targetLang = (input.target_lang as string) ?? (input.language as string) ?? "EN";
      return { text, target_lang: targetLang, source_lang: input.source_lang };
    },
  },
  "sentiment-analysis": {
    endpoint: { method: "POST", path: "/sentiment" },
    buildBody: (input, prev) => {
      const text = (input.text as string) ?? extractText(prev);
      return { text };
    },
  },
  "embeddings": {
    endpoint: { method: "POST", path: "/embed" },
    buildBody: (input, prev) => {
      const text = (input.text as string) ?? extractText(prev);
      return { text, model: input.model };
    },
  },
  "language-models": {
    endpoint: { method: "POST", path: "/chat/completions" },
    buildBody: (input, prev) => {
      if (input.messages) return { messages: input.messages, model: input.model };
      const content = (input.text as string) ?? (input.prompt as string) ?? extractText(prev) ?? "";
      return {
        messages: [{ role: "user", content }],
        model: input.model,
      };
    },
  },
  "object-detection": {
    endpoint: { method: "POST", path: "/detect" },
    buildBody: (input) => ({
      image_url: input.image_url,
      image_base64: input.image_base64,
    }),
  },
  "datasets": {
    endpoint: { method: "GET", path: "/reviews" },
    buildBody: () => ({}),
  },
};

// Chaining conjunctions that split a task into multiple steps
const CHAIN_SPLIT = /\b(?:then|and then|after that|followed by|next|afterwards)\b/i;

// ─────────────────────────────────────────────────────────────
// SERVICE
// ─────────────────────────────────────────────────────────────

export class OrchestratorService {
  constructor(
    private executor: ToolExecutor,
    private discovery: DiscoveryService,
    private registry: ToolRegistry,
  ) {}

  /**
   * Execute an orchestrated task.
   *
   * 1. Parse task into chain steps (split on "then"/"and then" etc.)
   * 2. For each step: semantic search → infer endpoint → build body → execute
   * 3. Return combined result with execution plan
   */
  async execute(args: OrchestrationArgs): Promise<ToolCallResult> {
    const { task, input = {}, budget_max_usdc, priority_mode = "balanced" } = args;

    // 1. Parse chain steps
    const rawSteps = this.parseChainSteps(task);
    if (rawSteps.length === 0) {
      return {
        content: [{ type: "text", text: "I couldn't understand the task. Try describing what API capability you need (e.g., \"translate this text to French\", \"analyze the sentiment\", \"generate embeddings\")." }],
        isError: true,
      };
    }

    // 2. Execute step(s)
    const plan: string[] = [];
    const stepResults: Array<{ step: number; slug: string; success: boolean; output: unknown }> = [];
    let previousOutput: unknown = undefined;
    let totalCost = 0;
    let totalLatency = 0;

    for (let i = 0; i < rawSteps.length; i++) {
      const stepText = rawSteps[i];

      // Resolve API via semantic search
      const resolved = await this.resolveApi(stepText, input, priority_mode, budget_max_usdc, previousOutput);
      if (!resolved) {
        plan.push(`Step ${i + 1}: "${stepText}" — No API found`);
        return {
          content: [{
            type: "text",
            text: `No API available for "${stepText}". The marketplace may not have a listing matching this capability yet.`,
          }],
          isError: true,
        };
      }

      const { listing, endpoint, body } = resolved;
      plan.push(`Step ${i + 1}: ${listing.categorySlug} → ${listing.slug} ($${listing.currentPriceUsdc.toFixed(6)})`);

      // Find the tool name for this listing
      const toolName = this.findToolName(listing.slug);
      if (!toolName) {
        return {
          content: [{ type: "text", text: `API "${listing.slug}" is not registered as a tool. Try refreshing.` }],
          isError: true,
        };
      }

      // Execute via the existing executor (handles x402 payment automatically)
      const result = await this.executor.execute(toolName, {
        path: endpoint.path,
        method: endpoint.method,
        body: Object.keys(body).length > 0 ? body : undefined,
      });

      // Parse cost from metadata
      const costMatch = result.content.find(c => c.text.includes("Price:"))?.text.match(/Price: \$([0-9.]+)/);
      const latencyMatch = result.content.find(c => c.text.includes("Latency:"))?.text.match(/Latency: (\d+)/);
      const stepCost = costMatch ? parseFloat(costMatch[1]) : 0;
      const stepLatency = latencyMatch ? parseInt(latencyMatch[1]) : 0;
      totalCost += stepCost;
      totalLatency += stepLatency;

      // Extract the response body (first content block, before metadata)
      const responseBody = result.content[0]?.text || "";
      const parsed = parseMaybeJson(responseBody);

      stepResults.push({
        step: i + 1,
        slug: listing.slug,
        success: !result.isError,
        output: parsed,
      });

      if (result.isError) {
        // If this step failed, try a fallback in the same category
        const fallback = await this.findFallback(listing, listing.categorySlug, priority_mode, budget_max_usdc);
        if (fallback) {
          plan.push(`Step ${i + 1} (fallback): ${listing.categorySlug} → ${fallback.slug}`);
          const fallbackToolName = this.findToolName(fallback.slug);
          if (fallbackToolName) {
            const fallbackResult = await this.executor.execute(fallbackToolName, {
              path: endpoint.path,
              method: endpoint.method,
              body: Object.keys(body).length > 0 ? body : undefined,
            });

            if (!fallbackResult.isError) {
              const fbBody = fallbackResult.content[0]?.text || "";
              previousOutput = parseMaybeJson(fbBody);
              stepResults[stepResults.length - 1] = {
                step: i + 1,
                slug: fallback.slug,
                success: true,
                output: previousOutput,
              };
              continue;
            }
          }
        }

        // Both primary and fallback failed
        return this.buildErrorResult(plan, stepResults, totalCost, totalLatency, responseBody);
      }

      previousOutput = parsed;
    }

    // 3. Build final response
    return this.buildSuccessResult(plan, stepResults, previousOutput, totalCost, totalLatency);
  }

  // ─── Chain Parsing ───

  private parseChainSteps(task: string): string[] {
    return task.split(CHAIN_SPLIT).map(s => s.trim()).filter(Boolean);
  }

  // ─── Semantic-First API Resolution ───

  /**
   * Resolve the best API for a task step using semantic search.
   *
   * 1. Semantic search with raw task text against listing embeddings
   *    (which now include provider-declared intents)
   * 2. Infer endpoint from matched listing's category or schemaSpec
   * 3. Build request body using known category builders or generic pass-through
   */
  private async resolveApi(
    taskText: string,
    input: Record<string, unknown>,
    priorityMode: PriorityMode,
    budgetMax?: number,
    previousOutput?: unknown,
  ): Promise<ResolvedApi | null> {
    // 1. Semantic search — task text directly against listing embeddings
    const result = await this.discovery.semanticSearch(taskText, {
      limit: 5,
      budgetMaxUsdc: budgetMax,
      priorityMode,
    });

    let listing: DiscoveredListing | null = result.listings.length > 0
      ? this.rankByPriority(result.listings, priorityMode)[0]
      : null;

    // Fallback: search the tool registry if semantic search returned nothing
    if (!listing) {
      listing = this.registryFallback(taskText, priorityMode, budgetMax);
    }

    if (!listing) return null;

    // 2. Infer endpoint
    const endpoint = this.inferEndpoint(listing);

    // 3. Build body
    const body = this.buildBody(listing.categorySlug, input, previousOutput, taskText);

    return { listing, endpoint, body };
  }

  /**
   * Infer the HTTP endpoint for a listing.
   * Known category → schemaSpec → default POST /
   */
  private inferEndpoint(listing: DiscoveredListing): { method: string; path: string } {
    const known = KNOWN_CATEGORIES[listing.categorySlug];
    if (known) return known.endpoint;

    if (listing.schemaSpec?.endpoint) {
      const ep = listing.schemaSpec.endpoint as { method?: string; path?: string };
      return { method: ep.method || "POST", path: ep.path || "/" };
    }

    return { method: "POST", path: "/" };
  }

  /**
   * Build the request body for a listing.
   * Known category → specialized builder, unknown → generic pass-through.
   */
  private buildBody(
    categorySlug: string,
    input: Record<string, unknown>,
    previousOutput: unknown,
    taskText: string,
  ): Record<string, unknown> {
    const known = KNOWN_CATEGORIES[categorySlug];
    if (known) return known.buildBody(input, previousOutput);

    // Generic: pass input directly, add task text if no structured input
    if (Object.keys(input).length > 0) return input;

    const text = extractText(previousOutput) || taskText;
    return { input: text };
  }

  /**
   * Fallback: search the tool registry by keyword when semantic search returns nothing.
   */
  private registryFallback(
    taskText: string,
    priorityMode: PriorityMode,
    budgetMax?: number,
  ): DiscoveredListing | null {
    const allTools = this.registry.getAllTools();
    const lowerTask = taskText.toLowerCase();

    const candidates = allTools
      .filter(t => t.kind === "listing" && t.listing)
      .map(t => t.listing!)
      .filter(l => !budgetMax || l.currentPriceUsdc <= budgetMax)
      .filter(l => {
        const searchText = `${l.name} ${l.description} ${l.tags.join(" ")} ${l.categorySlug} ${l.intents.join(" ")}`.toLowerCase();
        return lowerTask.split(/\s+/).some(word => searchText.includes(word));
      });

    if (candidates.length === 0) return null;
    return this.rankByPriority(candidates, priorityMode)[0];
  }

  // ─── Priority Ranking ───

  private rankByPriority(listings: DiscoveredListing[], mode: PriorityMode): DiscoveredListing[] {
    return [...listings].sort((a, b) => {
      switch (mode) {
        case "frugal":
          return a.currentPriceUsdc - b.currentPriceUsdc;
        case "mission_critical":
          return b.qualityScore - a.qualityScore;
        case "balanced":
        default: {
          const maxPrice = Math.max(...listings.map(l => l.currentPriceUsdc), 0.000001);
          const scoreA = a.qualityScore * 0.6 + (1 - a.currentPriceUsdc / maxPrice) * 0.4;
          const scoreB = b.qualityScore * 0.6 + (1 - b.currentPriceUsdc / maxPrice) * 0.4;
          return scoreB - scoreA;
        }
      }
    });
  }

  // ─── Fallback ───

  private async findFallback(
    primary: DiscoveredListing,
    categorySlug: string,
    priorityMode: PriorityMode,
    budgetMax?: number,
  ): Promise<DiscoveredListing | null> {
    const allTools = this.registry.getAllTools();
    const alternatives = allTools
      .filter(t => t.kind === "listing" && t.listing)
      .map(t => t.listing!)
      .filter(l => l.categorySlug === categorySlug && l.slug !== primary.slug)
      .filter(l => !budgetMax || l.currentPriceUsdc <= budgetMax);

    if (alternatives.length === 0) return null;
    return this.rankByPriority(alternatives, priorityMode)[0];
  }

  // ─── Tool Name Resolution ───

  private findToolName(slug: string): string | null {
    const allTools = this.registry.getAllTools();
    const match = allTools.find(t => t.slug === slug);
    return match?.toolName || null;
  }

  // ─── Response Formatting ───

  private buildSuccessResult(
    plan: string[],
    stepResults: Array<{ step: number; slug: string; success: boolean; output: unknown }>,
    finalOutput: unknown,
    totalCost: number,
    totalLatency: number,
  ): ToolCallResult {
    const outputText = typeof finalOutput === "string"
      ? finalOutput
      : JSON.stringify(finalOutput, null, 2);

    const metadata = [
      "--- NexusX Orchestrator ---",
      `Plan: ${plan.join(" → ")}`,
      `Steps: ${stepResults.length}`,
      `Total Cost: $${totalCost.toFixed(6)} USDC`,
      `Total Latency: ${totalLatency}ms`,
      stepResults.length > 1 ? `Chain: ${stepResults.map(s => `${s.slug}(${s.success ? "ok" : "fail"})`).join(" → ")}` : "",
    ].filter(Boolean).join("\n");

    return {
      content: [
        { type: "text", text: outputText },
        { type: "text", text: metadata },
      ],
    };
  }

  private buildErrorResult(
    plan: string[],
    stepResults: Array<{ step: number; slug: string; success: boolean; output: unknown }>,
    totalCost: number,
    totalLatency: number,
    errorBody: string,
  ): ToolCallResult {
    const failedStep = stepResults[stepResults.length - 1];

    return {
      content: [{
        type: "text",
        text: [
          `Orchestration failed at step ${failedStep.step} (${failedStep.slug}).`,
          "",
          `Plan: ${plan.join(" → ")}`,
          `Error: ${errorBody}`,
          `Total Cost: $${totalCost.toFixed(6)} USDC`,
          `Total Latency: ${totalLatency}ms`,
        ].join("\n"),
      }],
      isError: true,
    };
  }
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function extractText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    // Common response shapes
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.content === "string") return obj.content;
    if (Array.isArray(obj.translations)) {
      return (obj.translations as Array<{ text?: string }>).map(t => t.text || "").join("\n");
    }
    if (Array.isArray(obj.choices)) {
      const choice = (obj.choices as Array<{ message?: { content?: string } }>)[0];
      return choice?.message?.content || "";
    }
    return JSON.stringify(value);
  }
  return String(value);
}

function parseMaybeJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}
