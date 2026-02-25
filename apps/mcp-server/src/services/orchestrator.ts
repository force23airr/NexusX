// ═══════════════════════════════════════════════════════════════
// NexusX — Orchestrator Service
// apps/mcp-server/src/services/orchestrator.ts
//
// Single-tool AI API orchestrator. Interprets natural language
// tasks, selects the optimal API(s) from the marketplace,
// chains them if needed, and returns unified results.
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

interface ClassifiedIntent {
  intent: string;
  categorySlug: string;
  defaultSlug: string;
  /** HTTP method + path for the provider endpoint. */
  endpoint: { method: string; path: string };
  /** Maps input fields to the expected request body shape. */
  buildBody: (input: Record<string, unknown>, previousOutput?: unknown) => Record<string, unknown>;
}

interface ChainStep {
  intent: ClassifiedIntent;
  rawText: string;
}

// ─────────────────────────────────────────────────────────────
// INTENT PATTERNS
// ─────────────────────────────────────────────────────────────

const INTENT_PATTERNS: Array<{
  pattern: RegExp;
  intent: string;
  categorySlug: string;
  defaultSlug: string;
  endpoint: { method: string; path: string };
  buildBody: (input: Record<string, unknown>, prev?: unknown) => Record<string, unknown>;
}> = [
  {
    pattern: /translat/i,
    intent: "translate",
    categorySlug: "translation",
    defaultSlug: "deepl-translation-api",
    endpoint: { method: "POST", path: "/translate" },
    buildBody: (input, prev) => {
      const text = (input.text as string) ?? (prev as any)?.text ?? (typeof prev === "string" ? prev : "");
      const targetLang = (input.target_lang as string) ?? (input.language as string) ?? "EN";
      return { text, target_lang: targetLang, source_lang: input.source_lang };
    },
  },
  {
    pattern: /sentim|emotion|classif.*text|analyz.*(?:tone|mood|feel)/i,
    intent: "sentiment",
    categorySlug: "sentiment-analysis",
    defaultSlug: "sentiment-analysis-pro",
    endpoint: { method: "POST", path: "/sentiment" },
    buildBody: (input, prev) => {
      const text = (input.text as string) ?? extractText(prev);
      return { text };
    },
  },
  {
    pattern: /embed|vector|similar|encod.*text/i,
    intent: "embed",
    categorySlug: "embeddings",
    defaultSlug: "text-embeddings-v3",
    endpoint: { method: "POST", path: "/embed" },
    buildBody: (input, prev) => {
      const text = (input.text as string) ?? extractText(prev);
      return { text, model: input.model };
    },
  },
  {
    pattern: /generat|write|chat|complet|reason|answer|explain|summar/i,
    intent: "generate",
    categorySlug: "language-models",
    defaultSlug: "openai-gpt4-turbo",
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
  {
    pattern: /detect|recogni|vision|image.*object|identif.*image/i,
    intent: "detect",
    categorySlug: "object-detection",
    defaultSlug: "vision-object-detection",
    endpoint: { method: "POST", path: "/detect" },
    buildBody: (input) => ({
      image_url: input.image_url,
      image_base64: input.image_base64,
    }),
  },
  {
    pattern: /review|dataset|download|data.*set/i,
    intent: "dataset",
    categorySlug: "datasets",
    defaultSlug: "restaurant-reviews-dataset",
    endpoint: { method: "GET", path: "/reviews" },
    buildBody: () => ({}),
  },
];

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
   * 1. Parse task into chain steps
   * 2. For each step: classify intent → select API → execute → chain output
   * 3. Return combined result with execution plan
   */
  async execute(args: OrchestrationArgs): Promise<ToolCallResult> {
    const { task, input = {}, budget_max_usdc, priority_mode = "balanced" } = args;

    // 1. Parse chain steps
    const steps = this.parseChainSteps(task);
    if (steps.length === 0) {
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

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      // Select best API for this intent
      const listing = await this.selectApi(step.intent, priority_mode, budget_max_usdc);
      if (!listing) {
        plan.push(`Step ${i + 1}: ${step.intent.intent} — No API found`);
        return {
          content: [{
            type: "text",
            text: `No API available for "${step.rawText}" (intent: ${step.intent.intent}). Available categories may not include this capability yet.`,
          }],
          isError: true,
        };
      }

      plan.push(`Step ${i + 1}: ${step.intent.intent} → ${listing.slug} ($${listing.currentPriceUsdc.toFixed(6)})`);

      // Build request body (chain previous output if multi-step)
      const body = step.intent.buildBody(input, previousOutput);

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
        path: step.intent.endpoint.path,
        method: step.intent.endpoint.method,
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
        const fallback = await this.findFallback(listing, step.intent.categorySlug, priority_mode, budget_max_usdc);
        if (fallback) {
          plan.push(`Step ${i + 1} (fallback): ${step.intent.intent} → ${fallback.slug}`);
          const fallbackToolName = this.findToolName(fallback.slug);
          if (fallbackToolName) {
            const fallbackResult = await this.executor.execute(fallbackToolName, {
              path: step.intent.endpoint.path,
              method: step.intent.endpoint.method,
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

  // ─── Intent Classification ───

  private parseChainSteps(task: string): ChainStep[] {
    // Split by chaining conjunctions
    const segments = task.split(CHAIN_SPLIT).map(s => s.trim()).filter(Boolean);

    const steps: ChainStep[] = [];
    for (const segment of segments) {
      const intent = this.classifyIntent(segment);
      if (intent) {
        steps.push({ intent, rawText: segment });
      }
    }

    return steps;
  }

  private classifyIntent(text: string): ClassifiedIntent | null {
    for (const pattern of INTENT_PATTERNS) {
      if (pattern.pattern.test(text)) {
        return {
          intent: pattern.intent,
          categorySlug: pattern.categorySlug,
          defaultSlug: pattern.defaultSlug,
          endpoint: pattern.endpoint,
          buildBody: pattern.buildBody,
        };
      }
    }

    // Fallback: treat as a generic LLM generation task
    return {
      intent: "generate",
      categorySlug: "language-models",
      defaultSlug: "openai-gpt4-turbo",
      endpoint: { method: "POST", path: "/chat/completions" },
      buildBody: (input, prev) => {
        const content = (input.text as string) ?? (input.prompt as string) ?? extractText(prev) ?? text;
        return { messages: [{ role: "user", content }] };
      },
    };
  }

  // ─── API Selection ───

  private async selectApi(
    intent: ClassifiedIntent,
    priorityMode: PriorityMode,
    budgetMax?: number,
  ): Promise<DiscoveredListing | null> {
    // First try semantic search (pgvector)
    try {
      const searchResult = await this.discovery.semanticSearch(intent.intent, {
        limit: 5,
        budgetMaxUsdc: budgetMax,
        priorityMode,
      });

      if (searchResult.listings.length > 0) {
        // Filter to same category if possible
        const sameCat = searchResult.listings.filter(l => l.categorySlug === intent.categorySlug);
        if (sameCat.length > 0) return this.rankByPriority(sameCat, priorityMode)[0];
        return this.rankByPriority(searchResult.listings, priorityMode)[0];
      }
    } catch {
      // Fall through to registry lookup
    }

    // Fallback: filter registry by category
    const allTools = this.registry.getAllTools();
    const candidates = allTools
      .filter(t => t.kind === "listing" && t.listing)
      .map(t => t.listing!)
      .filter(l => l.categorySlug === intent.categorySlug)
      .filter(l => !budgetMax || l.currentPriceUsdc <= budgetMax);

    if (candidates.length > 0) {
      return this.rankByPriority(candidates, priorityMode)[0];
    }

    // Last resort: use the default slug
    const defaultTool = allTools.find(t => t.slug === intent.defaultSlug);
    return defaultTool?.listing || null;
  }

  private rankByPriority(listings: DiscoveredListing[], mode: PriorityMode): DiscoveredListing[] {
    return [...listings].sort((a, b) => {
      switch (mode) {
        case "frugal":
          return a.currentPriceUsdc - b.currentPriceUsdc;
        case "mission_critical":
          return b.qualityScore - a.qualityScore;
        case "balanced":
        default: {
          // Balanced: score = quality * 0.6 + (1 - normalized_price) * 0.4
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
