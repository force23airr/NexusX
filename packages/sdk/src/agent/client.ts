// ═══════════════════════════════════════════════════════════════
// NexusX — Agent Client
// packages/sdk/src/agent/client.ts
//
// Lightweight client for AI agents to discover, call, and pay
// for APIs on NexusX. Two auth modes: API key or x402 wallet.
// Zero framework dependencies — works everywhere fetch exists.
// ═══════════════════════════════════════════════════════════════

import type {
  NexusXAgentConfig,
  WalletSigner,
  X402PaymentRequirements,
  CallParams,
  CallResult,
  ExecutionReceiptSummary,
  ChainStep,
  ChainResult,
  SearchMatch,
  SearchOptions,
  SearchResult,
  PricingInfo,
  ReliabilityInfo,
  BudgetState,
} from "./types";

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseNumberHeader(value: string | null, fallback = 0): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseIntegerHeader(value: string | null, fallback = 0): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBooleanHeader(value: string | null): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

// ─────────────────────────────────────────────────────────────
// CLIENT
// ─────────────────────────────────────────────────────────────

export class NexusXAgent {
  private readonly gatewayUrl: string;
  private readonly webUrl: string | null;
  private readonly apiKey: string | null;
  private readonly wallet: WalletSigner | null;
  private readonly budgetLimit: number;
  private readonly timeoutMs: number;
  private readonly sandbox: boolean;
  private readonly _debug: boolean;

  private _spent = 0;
  private _callCount = 0;

  constructor(config: NexusXAgentConfig) {
    if (!config.gatewayUrl) {
      throw new Error("NexusXAgent requires gatewayUrl.");
    }
    if (!config.apiKey && !config.wallet) {
      throw new Error("NexusXAgent requires either apiKey or wallet.");
    }

    this.gatewayUrl = config.gatewayUrl.replace(/\/+$/, "");
    this.webUrl = config.webUrl?.replace(/\/+$/, "") ?? null;
    this.apiKey = config.apiKey ?? null;
    this.wallet = config.wallet ?? null;
    this.budgetLimit = config.budgetUsdc ?? 0;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.sandbox = config.sandbox ?? false;
    this._debug = config.debug ?? false;
  }

  // ─── Budget ───

  get spent(): number {
    return this._spent;
  }

  get remaining(): number {
    if (this.budgetLimit <= 0) return Infinity;
    return Math.max(0, this.budgetLimit - this._spent);
  }

  get budget(): BudgetState {
    return {
      limitUsdc: this.budgetLimit,
      spentUsdc: this._spent,
      remainingUsdc: this.remaining,
      callCount: this._callCount,
    };
  }

  // ─── Core: Call API ───

  async call(slug: string, path: string, params?: CallParams): Promise<CallResult> {
    this.checkBudget();

    const result = this.wallet
      ? await this.callWithX402(slug, path, params ?? {})
      : await this.rawCall(slug, path, params ?? {});

    this.recordSpend(result.priceUsdc);
    return result;
  }

  // ─── Multi-step Chain ───

  async chain(steps: ChainStep[]): Promise<ChainResult> {
    if (steps.length === 0) {
      return { success: true, steps: [], totalPriceUsdc: 0, totalLatencyMs: 0 };
    }

    const results: Array<CallResult & { slug: string; stepIndex: number }> = [];
    let totalPrice = 0;
    let totalLatency = 0;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const path = step.path ?? "/";

      // Auto-thread: if step has no body and there's a previous result, use it
      let body = step.body;
      if (body === undefined && i > 0 && results[i - 1].success) {
        body = results[i - 1].data;
      }

      const result = await this.call(slug(step), path, {
        method: step.method,
        body,
        query: step.query,
        headers: step.headers,
      });

      const stepResult = { ...result, slug: step.slug, stepIndex: i };
      results.push(stepResult);
      totalPrice += result.priceUsdc;
      totalLatency += result.latencyMs;

      if (!result.success) {
        return { success: false, steps: results, totalPriceUsdc: totalPrice, totalLatencyMs: totalLatency };
      }
    }

    return { success: true, steps: results, totalPriceUsdc: totalPrice, totalLatencyMs: totalLatency };
  }

  // ─── Discovery ───

  /** Semantic search for APIs. Requires webUrl to be configured. */
  async search(query: string, options?: SearchOptions): Promise<SearchResult> {
    if (!this.webUrl) {
      throw new Error("NexusXAgent.search() requires webUrl in config.");
    }

    const response = await fetch(`${this.webUrl}/api/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        query,
        limit: options?.limit,
        priorityMode: options?.priorityMode,
        metadataFilters: options?.metadataFilters,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const data = await response.json() as Record<string, unknown>;
    const rawMatches = Array.isArray(data.matches) ? data.matches : [];
    const queryId = readOptionalString(data.queryId);

    const matches: SearchMatch[] = rawMatches.map((m: Record<string, unknown>) => ({
      slug: String((m.listing as Record<string, unknown>)?.slug ?? ""),
      name: String((m.listing as Record<string, unknown>)?.name ?? ""),
      description: String((m.listing as Record<string, unknown>)?.description ?? ""),
      categorySlug: String((m.listing as Record<string, unknown>)?.categorySlug ?? ""),
      queryId,
      currentPriceUsdc: Number((m.listing as Record<string, unknown>)?.currentPriceUsdc ?? 0),
      qualityScore: Number((m.listing as Record<string, unknown>)?.qualityScore ?? 0),
      trustScore: Number((m.listing as Record<string, unknown>)?.trustScore ?? 0),
      trustState: readOptionalString((m.listing as Record<string, unknown>)?.trustState) as
        "trusted" | "degraded" | "high_risk" | "unproven" | undefined,
      regionAffinityScore: Number((m.scoreBreakdown as Record<string, unknown> | undefined)?.regionAffinityScore ?? 0),
      operationMatchScore: Number((m.scoreBreakdown as Record<string, unknown> | undefined)?.operationMatch ?? 0),
      score: Number(m.score ?? 0),
      matchReasons: Array.isArray(m.matchReasons) ? m.matchReasons.map(String) : [],
      matchedOperations: Array.isArray(m.matchedOperations)
        ? m.matchedOperations.map((op) => ({
            operationId: String((op as Record<string, unknown>)?.operationId ?? ""),
            name: String((op as Record<string, unknown>)?.name ?? ""),
            method: String((op as Record<string, unknown>)?.method ?? ""),
            path: String((op as Record<string, unknown>)?.path ?? ""),
            score: Number((op as Record<string, unknown>)?.score ?? 0),
            reasons: Array.isArray((op as Record<string, unknown>)?.reasons)
              ? ((op as Record<string, unknown>).reasons as unknown[]).map(String)
              : [],
          }))
        : [],
    }));

    return {
      queryId,
      matches,
      totalEvaluated: Number(data.totalEvaluated ?? 0),
      routeTimeMs: Number(data.routeTimeMs ?? 0),
      suggestions: Array.isArray(data.suggestions) ? data.suggestions.map(String) : [],
    };
  }

  /** Get pricing info for a listing (no auth required). */
  async pricing(slug: string): Promise<PricingInfo | null> {
    try {
      const response = await fetch(`${this.gatewayUrl}/pricing/${slug}`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return null;
      const data = await response.json() as Record<string, unknown>;
      const pricing = data.pricing as Record<string, unknown> | undefined;
      const feeSplit = pricing?.feeSplit as Record<string, unknown> | undefined;
      return {
        currentPriceUsdc: Number(pricing?.currentPriceUsdc ?? 0),
        floorPriceUsdc: Number(pricing?.floorPriceUsdc ?? 0),
        platformFee: Number(feeSplit?.platformFee ?? 0),
        providerAmount: Number(feeSplit?.providerReceives ?? 0),
        feeRate: Number(feeSplit?.feeRate ?? 0),
      };
    } catch {
      return null;
    }
  }

  /** Get reliability score for a listing (no auth required). */
  async reliability(slug: string): Promise<ReliabilityInfo | null> {
    try {
      const response = await fetch(`${this.gatewayUrl}/reliability/${slug}`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return null;
      const data = await response.json() as Record<string, unknown>;
      const r = data.reliability as Record<string, unknown> | undefined;
      if (!r) return null;
      return {
        errorRate: Number(r.errorRate ?? 0),
        p50LatencyMs: Number(r.p50LatencyMs ?? 0),
        p95LatencyMs: Number(r.p95LatencyMs ?? 0),
        p99LatencyMs: Number(r.p99LatencyMs ?? 0),
        uptimePct: Number(r.uptimePct ?? 0),
        callCount: Number(r.callCount ?? 0),
        qualityScore: Number(r.qualityScore ?? 0),
        computedAt: Number(r.computedAt ?? 0),
      };
    } catch {
      return null;
    }
  }

  // ─── Private: x402 Payment Flow ───

  private async callWithX402(slug: string, path: string, params: CallParams): Promise<CallResult> {
    // First attempt without payment header
    const first = await this.rawCall(slug, path, params);

    if (first.statusCode !== 402 || !this.wallet) {
      return first;
    }

    // Parse payment requirements from 402 body
    const requirements = this.parsePaymentRequirements(first.raw);
    if (!requirements || requirements.length === 0) {
      this.log("402 received but no valid payment requirements found");
      return first;
    }

    // Sign and retry
    this.log(`Signing x402 payment: ${requirements[0].maxAmountRequired} to ${requirements[0].payTo}`);
    const xPayment = await this.wallet.buildPaymentHeader(requirements[0]);
    return this.rawCall(slug, path, params, xPayment);
  }

  // ─── Private: Raw HTTP Call ───

  private async rawCall(
    slug: string,
    path: string,
    params: CallParams,
    xPayment?: string,
  ): Promise<CallResult> {
    const subPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${this.gatewayUrl}/v1/${slug}${subPath}`);

    if (params.query) {
      for (const [key, value] of Object.entries(params.query)) {
        url.searchParams.set(key, value);
      }
    }

    const method = (params.method ?? "POST").toUpperCase();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-SDK-Client": "nexusx-agent-sdk",
      ...params.headers,
    };

    if (xPayment) {
      headers["X-Payment"] = xPayment;
    } else if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    if (this.sandbox) {
      headers["X-NexusX-Sandbox"] = "true";
    }
    if (params.queryId) {
      headers["X-NexusX-Query-Id"] = params.queryId;
    }

    const init: RequestInit = { method, headers, signal: AbortSignal.timeout(this.timeoutMs) };
    if (params.body && method !== "GET" && method !== "HEAD") {
      init.body = JSON.stringify(params.body);
    }

    try {
      const response = await fetch(url.toString(), init);

      const priceUsdc = parseNumberHeader(response.headers.get("x-nexusx-price-usdc"));
      const quotedPriceUsdc = parseNumberHeader(
        response.headers.get("x-nexusx-quoted-price-usdc"),
        priceUsdc,
      );
      const platformFeeUsdc = parseNumberHeader(response.headers.get("x-nexusx-fee-usdc"));
      const providerAmountUsdc = parseNumberHeader(
        response.headers.get("x-nexusx-provider-amount-usdc"),
      );
      const latencyMs = parseIntegerHeader(response.headers.get("x-nexusx-latency-ms"));
      const requestId = response.headers.get("x-nexusx-request-id") || "";
      const receiptId = response.headers.get("x-nexusx-receipt-id") || "";
      const responseQueryId = response.headers.get("x-nexusx-query-id") || params.queryId;
      const listingFromHeader = response.headers.get("x-nexusx-listing") || slug;
      const authMode = response.headers.get("x-nexusx-auth-mode") === "x402" ? "x402" : "api_key";
      const billingMode =
        response.headers.get("x-nexusx-billing-mode") === "bundle_step" ? "bundle_step" : "individual";
      const outcomeHeader = response.headers.get("x-nexusx-receipt-outcome");
      const outcome =
        outcomeHeader === "rejected"
          ? "rejected"
          : outcomeHeader === "failed"
            ? "failed"
            : "success";
      const settlementHeader = response.headers.get("x-nexusx-settlement-status");
      const settlementStatus =
        settlementHeader === "settled" ||
        settlementHeader === "pending_reconciliation" ||
        settlementHeader === "upstream_failed" ||
        settlementHeader === "deferred_bundle" ||
        settlementHeader === "abandoned"
          ? settlementHeader
          : "none";
      const failureClass = readOptionalString(response.headers.get("x-nexusx-failure-class"));
      const retryable = parseBooleanHeader(response.headers.get("x-nexusx-retryable"));
      const billingDecisionHeader = response.headers.get("x-nexusx-billing-decision");
      const billingDecision =
        billingDecisionHeader === "charged" ||
        billingDecisionHeader === "charged_pending_settlement" ||
        billingDecisionHeader === "deferred_bundle" ||
        billingDecisionHeader === "not_charged"
          ? billingDecisionHeader
          : undefined;
      const txHash = response.headers.get("x-nexusx-txhash") || undefined;
      const bundleSessionId = response.headers.get("x-nexusx-bundle-session-id") || undefined;
      const bundleStepIndexRaw = response.headers.get("x-nexusx-bundle-step-index");
      const bundleStepIndex =
        bundleStepIndexRaw !== null ? parseIntegerHeader(bundleStepIndexRaw, -1) : undefined;
      const circuitState = response.headers.get("x-nexusx-circuit-state") || undefined;
      const receipt: ExecutionReceiptSummary | null = receiptId
        ? {
            id: receiptId,
            requestId,
            queryId: responseQueryId,
            listingSlug: listingFromHeader,
            authMode,
            billingMode,
            outcome,
            settlementStatus,
            failureClass,
            retryable,
            billingDecision,
            priceUsdc,
            quotedPriceUsdc,
            platformFeeUsdc,
            providerAmountUsdc,
            latencyMs,
            statusCode: response.status,
            sandbox: this.sandbox,
            txHash,
            bundleSessionId,
            bundleStepIndex:
              typeof bundleStepIndex === "number" && bundleStepIndex >= 0
                ? bundleStepIndex
                : undefined,
            circuitState,
          }
        : null;

      const raw = await response.text();
      let data: unknown = raw;
      try {
        data = JSON.parse(raw);
      } catch {
        // Keep as raw string
      }

      return {
        success: response.status >= 200 && response.status < 400,
        statusCode: response.status,
        data,
        raw,
        priceUsdc,
        quotedPriceUsdc,
        platformFeeUsdc,
        providerAmountUsdc,
        latencyMs,
        requestId,
        billingMode,
        settlementStatus,
        failureClass,
        retryable,
        billingDecision,
        isSandbox: this.sandbox,
        receipt,
      };
    } catch (err) {
      const isTimeout = err instanceof DOMException && err.name === "TimeoutError";
      return {
        success: false,
        statusCode: isTimeout ? 504 : 502,
        data: { error: isTimeout ? "TIMEOUT" : "CONNECTION_ERROR", message: String(err) },
        raw: "",
        priceUsdc: 0,
        quotedPriceUsdc: 0,
        platformFeeUsdc: 0,
        providerAmountUsdc: 0,
        latencyMs: isTimeout ? this.timeoutMs : 0,
        requestId: "",
        billingMode: "individual",
        settlementStatus: "none",
        failureClass: isTimeout ? "upstream_timeout" : "connection_error",
        retryable: true,
        billingDecision: "not_charged",
        isSandbox: this.sandbox,
        receipt: null,
      };
    }
  }

  // ─── Private: Helpers ───

  private parsePaymentRequirements(body: string): X402PaymentRequirements[] | undefined {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      const arr = parsed.paymentRequirements ?? parsed.accepts;
      if (!Array.isArray(arr)) return undefined;
      return arr.filter(
        (v): v is X402PaymentRequirements =>
          typeof v === "object" && v !== null &&
          typeof (v as Record<string, unknown>).payTo === "string" &&
          typeof (v as Record<string, unknown>).maxAmountRequired === "string",
      );
    } catch {
      return undefined;
    }
  }

  private checkBudget(): void {
    if (this.budgetLimit > 0 && this._spent >= this.budgetLimit) {
      throw new Error(
        `NexusX budget exceeded: spent $${this._spent.toFixed(6)} of $${this.budgetLimit.toFixed(6)} USDC`,
      );
    }
  }

  private recordSpend(amount: number): void {
    if (amount > 0) {
      this._spent += amount;
      this._callCount++;
    }
  }

  private log(...args: unknown[]): void {
    if (this._debug) {
      console.error("[NexusX Agent]", ...args);
    }
  }
}

// Helper to extract slug from ChainStep (avoids shadowing the parameter name)
function slug(step: ChainStep): string {
  return step.slug;
}
