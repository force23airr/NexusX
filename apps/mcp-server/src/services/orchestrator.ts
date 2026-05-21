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
import type { CdpWalletService } from "./cdp-wallet";
import type { DiscoveredListing, X402PaymentRequirements } from "../types";

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
  private cdpWallet?: CdpWalletService;

  constructor(
    private executor: ToolExecutor,
    private discovery: DiscoveryService,
    private registry: ToolRegistry,
  ) {}

  /** Inject CDP wallet for direct external Bazaar calls. */
  setCdpWallet(wallet: CdpWalletService): void {
    this.cdpWallet = wallet;
  }

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
      const remainingTaskBudget =
        typeof budget_max_usdc === "number"
          ? Math.max(0, budget_max_usdc - totalCost)
          : undefined;

      // Resolve API via semantic search
      const resolved = await this.resolveApi(stepText, input, priority_mode, remainingTaskBudget, previousOutput);
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
      if (remainingTaskBudget !== undefined && listing.currentPriceUsdc > remainingTaskBudget) {
        return {
          content: [{
            type: "text",
            text:
              `Budget limit reached before step ${i + 1}. ` +
              `Next API "${listing.slug}" is currently $${listing.currentPriceUsdc.toFixed(6)} USDC, ` +
              `but only $${remainingTaskBudget.toFixed(6)} USDC remains for this task.`,
          }],
          isError: true,
        };
      }
      plan.push(`Step ${i + 1}: ${listing.categorySlug} → ${listing.slug} ($${listing.currentPriceUsdc.toFixed(6)})`);

      let result: ToolCallResult;

      if (listing.sourceType === "bazaar") {
        // Bazaar listing — call external URL directly with x402 payment
        result = await this.executeExternal(listing, endpoint, body, {
          expectedPriceUsdc: listing.currentPriceUsdc,
          maxQuoteUsdc: remainingTaskBudget,
        });
      } else {
        // Native listing — go through gateway via executor
        const toolName = this.findToolName(listing.slug);
        if (!toolName) {
          return {
            content: [{ type: "text", text: `API "${listing.slug}" is not registered as a tool. Try refreshing.` }],
            isError: true,
          };
        }

        result = await this.executor.execute(toolName, {
          path: endpoint.path,
          method: endpoint.method,
          body: Object.keys(body).length > 0 ? body : undefined,
          expectedPriceUsdc: listing.currentPriceUsdc,
          maxPriceUsdc: remainingTaskBudget,
        });
      }

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
        // If this step failed, try a safe operation fallback before falling back by category.
        const fallback = await this.findFallback(
          listing,
          listing.categorySlug,
          priority_mode,
          typeof budget_max_usdc === "number" ? Math.max(0, budget_max_usdc - totalCost) : undefined,
          result.metadata,
        );
        if (fallback) {
          plan.push(`Step ${i + 1} (fallback): ${listing.categorySlug} → ${fallback.listing.slug}`);
          const fallbackToolName = this.findToolName(fallback.listing.slug);
          if (fallbackToolName) {
            const fallbackResult = await this.executor.execute(fallbackToolName, {
              path: endpoint.path,
              method: endpoint.method,
              body: Object.keys(body).length > 0 ? body : undefined,
              operationId: fallback.operationId,
              fallbackSourceReceiptId: result.metadata?.receiptId,
              expectedPriceUsdc: fallback.listing.currentPriceUsdc,
              maxPriceUsdc: typeof budget_max_usdc === "number" ? Math.max(0, budget_max_usdc - totalCost) : undefined,
            });

            if (!fallbackResult.isError) {
              const fbBody = fallbackResult.content[0]?.text || "";
              previousOutput = parseMaybeJson(fbBody);
              stepResults[stepResults.length - 1] = {
                step: i + 1,
                slug: fallback.listing.slug,
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
      .filter(l => budgetMax == null || l.currentPriceUsdc <= budgetMax)
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
    executionMetadata?: ToolCallResult["metadata"],
  ): Promise<{ listing: DiscoveredListing; operationId?: string } | null> {
    if (
      executionMetadata?.retryable === true &&
      executionMetadata.billingDecision === "not_charged" &&
      primary.operationFallback?.autoFallbackSafe
    ) {
      const operationFallback = primary.operationFallback.candidates.find(
        (candidate) =>
          candidate.autoExecutable &&
          (budgetMax == null || candidate.currentPriceUsdc <= budgetMax),
      );
      if (operationFallback) {
        const fallbackListing = this.registry
          .getAllTools()
          .filter((tool) => tool.kind === "listing" && tool.listing)
          .map((tool) => tool.listing!)
          .find((listing) => listing.slug === operationFallback.slug);

        if (fallbackListing) {
          return {
            listing: fallbackListing,
            operationId: operationFallback.operationId,
          };
        }
      }
    }

    const allTools = this.registry.getAllTools();
    const alternatives = allTools
      .filter(t => t.kind === "listing" && t.listing)
      .map(t => t.listing!)
      .filter(l => l.categorySlug === categorySlug && l.slug !== primary.slug)
      .filter(l => budgetMax == null || l.currentPriceUsdc <= budgetMax);

    if (alternatives.length === 0) return null;
    return { listing: this.rankByPriority(alternatives, priorityMode)[0] };
  }

  // ─── External Bazaar Execution ───

  /**
   * Call an external Bazaar service directly with x402 payment.
   * Bypasses the NexusX gateway — the upstream handles its own x402 verification.
   */
  private async executeExternal(
    listing: DiscoveredListing,
    endpoint: { method: string; path: string },
    body: Record<string, unknown>,
    policy: { expectedPriceUsdc?: number; maxQuoteUsdc?: number } = {},
  ): Promise<ToolCallResult> {
    const baseUrl = listing.baseUrl.replace(/\/+$/, "");
    const path = endpoint.path.startsWith("/") ? endpoint.path : `/${endpoint.path}`;
    const url = `${baseUrl}${path}`;
    const startMs = Date.now();

    try {
      // First attempt — no payment
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const fetchOptions: RequestInit = {
        method: endpoint.method,
        headers,
        signal: AbortSignal.timeout(30_000),
      };

      if (endpoint.method !== "GET" && Object.keys(body).length > 0) {
        fetchOptions.body = JSON.stringify(body);
      }

      let response = await fetch(url, fetchOptions);

      // Handle x402 payment flow
      if (response.status === 402 && this.cdpWallet?.isAvailable) {
        const requirementsBody = await response.json().catch(() => null) as Record<string, unknown> | null;
        const rawReqs = requirementsBody?.accepts ?? requirementsBody?.paymentRequirements;
        const requirements = Array.isArray(rawReqs) ? rawReqs as X402PaymentRequirements[] : undefined;

        if (requirements && Array.isArray(requirements) && requirements.length > 0) {
          try {
            const quotePriceUsdc = x402AtomicToUsdc(requirements[0].maxAmountRequired);
            const policyRejection = getExternalPaymentPolicyRejection(quotePriceUsdc, policy);
            if (policyRejection) {
              return {
                content: [{
                  type: "text",
                  text: `Payment policy rejected Bazaar service ${listing.slug}: ${policyRejection}`,
                }],
                isError: true,
              };
            }

            const xPayment = await this.cdpWallet.buildPaymentHeader(requirements[0]);
            const retryHeaders: Record<string, string> = {
              "Content-Type": "application/json",
              "X-Payment": xPayment,
            };

            const retryOptions: RequestInit = {
              method: endpoint.method,
              headers: retryHeaders,
              signal: AbortSignal.timeout(30_000),
            };

            if (endpoint.method !== "GET" && Object.keys(body).length > 0) {
              retryOptions.body = JSON.stringify(body);
            }

            response = await fetch(url, retryOptions);
          } catch (payErr) {
            return {
              content: [{
                type: "text",
                text: `x402 payment failed for Bazaar service ${listing.slug}: ${payErr instanceof Error ? payErr.message : "unknown error"}`,
              }],
              isError: true,
            };
          }
        }
      }

      const latencyMs = Date.now() - startMs;
      const responseBody = await response.text();

      if (!response.ok) {
        return {
          content: [{
            type: "text",
            text: `External Bazaar API call failed (HTTP ${response.status}):\n${responseBody}`,
          }],
          isError: true,
        };
      }

      const metadata = [
        "--- NexusX Metadata (Bazaar External) ---",
        `Service: ${listing.slug}`,
        `URL: ${url}`,
        `Price: $${listing.currentPriceUsdc.toFixed(6)} USDC`,
        `Latency: ${latencyMs}ms`,
        `Source: x402 Bazaar`,
      ].join("\n");

      return {
        content: [
          { type: "text", text: responseBody },
          { type: "text", text: metadata },
        ],
      };
    } catch (err) {
      return {
        content: [{
          type: "text",
          text: `External Bazaar call failed for ${listing.slug}: ${err instanceof Error ? err.message : "unknown error"}`,
        }],
        isError: true,
      };
    }
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

function x402AtomicToUsdc(maxAmountRequired: string): number {
  try {
    return Number(BigInt(maxAmountRequired)) / 1_000_000;
  } catch {
    return Number.NaN;
  }
}

function getExternalPaymentPolicyRejection(
  quotePriceUsdc: number,
  policy: { expectedPriceUsdc?: number; maxQuoteUsdc?: number },
): string | null {
  if (!Number.isFinite(quotePriceUsdc) || quotePriceUsdc < 0) {
    return "live x402 quote is malformed.";
  }

  if (
    typeof policy.maxQuoteUsdc === "number" &&
    policy.maxQuoteUsdc > 0 &&
    quotePriceUsdc > policy.maxQuoteUsdc + 0.0000005
  ) {
    return (
      `live quote $${quotePriceUsdc.toFixed(6)} USDC exceeds remaining task budget ` +
      `$${policy.maxQuoteUsdc.toFixed(6)} USDC.`
    );
  }

  if (
    typeof policy.expectedPriceUsdc === "number" &&
    policy.expectedPriceUsdc > 0 &&
    quotePriceUsdc > policy.expectedPriceUsdc * 1.25 + 0.0000005
  ) {
    return (
      `live quote $${quotePriceUsdc.toFixed(6)} USDC exceeds expected ` +
      `$${policy.expectedPriceUsdc.toFixed(6)} USDC by more than 25%.`
    );
  }

  return null;
}
