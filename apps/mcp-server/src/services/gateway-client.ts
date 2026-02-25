// ═══════════════════════════════════════════════════════════════
// NexusX — MCP Gateway Client
// apps/mcp-server/src/services/gateway-client.ts
//
// HTTP client for executing tool calls through the NexusX gateway.
// Follows the pattern from packages/sdk/src/common/httpClient.ts.
// ═══════════════════════════════════════════════════════════════

import type { ToolExecutionResult, X402PaymentRequirements } from "../types";

export interface BundleSessionRegistrationResult {
  bundleSessionId: string;
  status: string;
  bundleSlug: string;
  bundleName: string | null;
  toolSlugs: string[];
  registeredGrossPriceUsdc: number;
  targetBundlePriceUsdc: number;
  bundlePlatformFeeRate: number;
  expiresAt: string | null;
  createdAt: string;
}

export interface BundleSessionFinalizeResult {
  bundleSessionId: string;
  status: "FINALIZED";
  billedPriceUsdc: number;
  executedGrossPriceUsdc: number;
  discountUsdc: number;
  platformFeeUsdc: number;
  providerPoolUsdc: number;
  settlementCount: number;
  allocations: Array<{
    transactionId: string;
    listingId: string;
    listingSlug: string;
    providerId: string;
    bundleStepIndex: number;
    quotedPriceUsdc: number;
    weight: number;
    allocatedPriceUsdc: number;
    platformFeeUsdc: number;
    providerAmountUsdc: number;
  }>;
}

export class GatewayClient {
  private baseUrl: string;
  private apiKey: string;
  private sandbox: boolean;
  /** When true, proxy calls use x402 payment headers instead of Bearer auth. */
  private x402Mode: boolean;

  constructor(
    gatewayUrl: string,
    apiKey: string,
    sandbox: boolean = false,
    x402Mode: boolean = false,
  ) {
    this.baseUrl = gatewayUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.sandbox = sandbox;
    this.x402Mode = x402Mode;
  }

  /**
   * Execute an API call to a listing through the NexusX gateway.
   * Routes through: auth → rate limit → proxy → billing → response.
   */
  async callListing(params: {
    slug: string;
    method: string;
    path: string;
    body?: unknown;
    query?: Record<string, string>;
    headers?: Record<string, string>;
    bundleSessionId?: string;
    bundleStepIndex?: number;
    /** x402 payment header (base64-encoded payment proof). */
    xPayment?: string;
  }): Promise<ToolExecutionResult> {
    const {
      slug,
      method,
      path,
      body,
      query,
      headers: extraHeaders,
      bundleSessionId,
      bundleStepIndex,
      xPayment,
    } = params;

    // Build URL: /v1/{slug}/{path}
    const subPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}/v1/${slug}${subPath}`);

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }

    // Build headers.
    // In x402 mode, omit Authorization and include X-Payment instead.
    // In API key mode (or when no payment header is present yet), send Bearer auth.
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-SDK-Client": "nexusx-mcp-server",
      ...extraHeaders,
    };

    if (xPayment) {
      headers["X-Payment"] = xPayment;
    } else if (!this.x402Mode && this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    if (this.sandbox) {
      headers["X-NexusX-Sandbox"] = "true";
    }
    if (bundleSessionId) {
      headers["X-NexusX-Bundle-Session-Id"] = bundleSessionId;
      headers["X-NexusX-Bundle-Step-Index"] = String(bundleStepIndex ?? 0);
    }

    // Build request
    const init: RequestInit = {
      method: method.toUpperCase(),
      headers,
      signal: AbortSignal.timeout(30_000),
    };

    if (body && method.toUpperCase() !== "GET" && method.toUpperCase() !== "HEAD") {
      init.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url.toString(), init);

      // ─── Handle 402 Payment Required ───
      // Return early with parsed payment requirements so the executor
      // can sign and retry without reading the body twice.
      if (response.status === 402) {
        const body402 = await response.text();
        return {
          success: false,
          statusCode: 402,
          body: body402,
          paymentRequired: tryParsePaymentRequirements(body402),
          priceUsdc: 0,
          platformFeeUsdc: 0,
          latencyMs: 0,
          requestId: "",
          isSandbox: this.sandbox,
          billingMode: "individual",
          quotedPriceUsdc: 0,
        };
      }

      // Extract NexusX metadata headers
      const priceUsdc = parseFloat(response.headers.get("x-nexusx-price-usdc") || "0");
      const platformFeeUsdc = parseFloat(response.headers.get("x-nexusx-fee-usdc") || "0");
      const latencyMs = parseInt(response.headers.get("x-nexusx-latency-ms") || "0", 10);
      const requestId = response.headers.get("x-nexusx-request-id") || "";
      const billingMode = response.headers.get("x-nexusx-billing-mode") || "individual";
      const quotedPriceUsdc = parseFloat(
        response.headers.get("x-nexusx-bundle-quoted-price-usdc") || "0",
      );
      const responseBundleSessionId =
        response.headers.get("x-nexusx-bundle-session-id") || undefined;
      const responseBundleStepIndexRaw =
        response.headers.get("x-nexusx-bundle-step-index");
      const responseBundleStepIndex =
        responseBundleStepIndexRaw !== null
          ? Number.parseInt(responseBundleStepIndexRaw, 10)
          : undefined;

      const responseBody = await response.text();

      return {
        success: response.status >= 200 && response.status < 400,
        statusCode: response.status,
        body: responseBody,
        priceUsdc,
        platformFeeUsdc,
        latencyMs,
        requestId,
        isSandbox: this.sandbox,
        billingMode: billingMode === "bundle_step" ? "bundle_step" : "individual",
        quotedPriceUsdc: Number.isFinite(quotedPriceUsdc) ? quotedPriceUsdc : 0,
        bundleSessionId: responseBundleSessionId,
        bundleStepIndex:
          typeof responseBundleStepIndex === "number" && Number.isFinite(responseBundleStepIndex)
            ? responseBundleStepIndex
            : undefined,
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        return {
          success: false,
          statusCode: 504,
          body: JSON.stringify({ error: "GATEWAY_TIMEOUT", message: "Request timed out after 30s" }),
          priceUsdc: 0,
          platformFeeUsdc: 0,
          latencyMs: 30_000,
          requestId: "",
          isSandbox: this.sandbox,
          billingMode: "individual",
          quotedPriceUsdc: 0,
        };
      }

      return {
        success: false,
        statusCode: 502,
        body: JSON.stringify({
          error: "CONNECTION_ERROR",
          message: err instanceof Error ? err.message : "Failed to connect to gateway",
        }),
        priceUsdc: 0,
        platformFeeUsdc: 0,
        latencyMs: 0,
        requestId: "",
        isSandbox: this.sandbox,
        billingMode: "individual",
        quotedPriceUsdc: 0,
      };
    }
  }

  async registerBundleSession(params: {
    bundleSlug: string;
    bundleName?: string;
    toolSlugs: string[];
    bundlePriceUsdc: number;
    bundlePlatformFeeRate?: number;
    metadata?: Record<string, unknown>;
  }): Promise<BundleSessionRegistrationResult> {
    const response = await fetch(`${this.baseUrl}/bundle-sessions/register`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "X-SDK-Client": "nexusx-mcp-server",
      },
      body: JSON.stringify({
        bundle_slug: params.bundleSlug,
        bundle_name: params.bundleName,
        tool_slugs: params.toolSlugs,
        bundle_price_usdc: params.bundlePriceUsdc,
        bundle_platform_fee_rate: params.bundlePlatformFeeRate,
        metadata: params.metadata ?? {},
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const data = await safeJson(response);
    if (!response.ok) {
      throw new Error(data?.message || `Bundle registration failed with HTTP ${response.status}`);
    }
    return {
      bundleSessionId: data.bundleSessionId,
      status: data.status,
      bundleSlug: data.bundleSlug,
      bundleName: data.bundleName ?? null,
      toolSlugs: Array.isArray(data.toolSlugs) ? data.toolSlugs : [],
      registeredGrossPriceUsdc: Number(data.registeredGrossPriceUsdc ?? 0),
      targetBundlePriceUsdc: Number(data.targetBundlePriceUsdc ?? 0),
      bundlePlatformFeeRate: Number(data.bundlePlatformFeeRate ?? 0),
      expiresAt: data.expiresAt ?? null,
      createdAt: data.createdAt ?? new Date().toISOString(),
    };
  }

  async finalizeBundleSession(bundleSessionId: string): Promise<BundleSessionFinalizeResult> {
    const response = await fetch(`${this.baseUrl}/bundle-sessions/${bundleSessionId}/finalize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "X-SDK-Client": "nexusx-mcp-server",
      },
      body: "{}",
      signal: AbortSignal.timeout(20_000),
    });

    const data = await safeJson(response);
    if (!response.ok) {
      throw new Error(data?.message || `Bundle finalization failed with HTTP ${response.status}`);
    }
    return {
      bundleSessionId: data.bundleSessionId,
      status: "FINALIZED",
      billedPriceUsdc: Number(data.billedPriceUsdc ?? 0),
      executedGrossPriceUsdc: Number(data.executedGrossPriceUsdc ?? 0),
      discountUsdc: Number(data.discountUsdc ?? 0),
      platformFeeUsdc: Number(data.platformFeeUsdc ?? 0),
      providerPoolUsdc: Number(data.providerPoolUsdc ?? 0),
      settlementCount: Number(data.settlementCount ?? 0),
      allocations: Array.isArray(data.allocations)
        ? data.allocations.map((row: any) => ({
            transactionId: String(row.transactionId ?? ""),
            listingId: String(row.listingId ?? ""),
            listingSlug: String(row.listingSlug ?? ""),
            providerId: String(row.providerId ?? ""),
            bundleStepIndex: Number(row.bundleStepIndex ?? 0),
            quotedPriceUsdc: Number(row.quotedPriceUsdc ?? 0),
            weight: Number(row.weight ?? 0),
            allocatedPriceUsdc: Number(row.allocatedPriceUsdc ?? 0),
            platformFeeUsdc: Number(row.platformFeeUsdc ?? 0),
            providerAmountUsdc: Number(row.providerAmountUsdc ?? 0),
          }))
        : [],
    };
  }

  /**
   * Fetch live reliability score for a listing (no auth required).
   */
  async getReliability(slug: string): Promise<{
    errorRate: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
    uptimePct: number;
    callCount: number;
    qualityScore: number;
    computedAt: number;
  } | null> {
    try {
      const response = await fetch(`${this.baseUrl}/reliability/${slug}`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as Record<string, unknown>;
      return (data.reliability as any) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Fetch public pricing info for a listing (no auth required).
   */
  async getPricing(slug: string): Promise<{
    currentPriceUsdc: number;
    floorPriceUsdc: number;
    platformFee: number;
    providerAmount: number;
    feeRate: number;
  } | null> {
    try {
      const response = await fetch(`${this.baseUrl}/pricing/${slug}`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as Record<string, any>;
      return {
        currentPriceUsdc: data.currentPriceUsdc,
        floorPriceUsdc: data.floorPriceUsdc,
        platformFee: data.feeSplit?.platformFeeUsdc ?? 0,
        providerAmount: data.feeSplit?.providerAmountUsdc ?? 0,
        feeRate: data.feeSplit?.feeRate ?? 0.12,
      };
    } catch {
      return null;
    }
  }
}

async function safeJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

/**
 * Parse x402 payment requirements from a 402 response body.
 * The spec puts requirements in the `accepts` array.
 */
function tryParsePaymentRequirements(body: string): X402PaymentRequirements[] | undefined {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    // The x402 spec uses "accepts", but our gateway uses "paymentRequirements"
    const arr = parsed.paymentRequirements ?? parsed.accepts;
    if (!Array.isArray(arr)) return undefined;
    return (arr as unknown[]).filter(isPaymentRequirement);
  } catch {
    return undefined;
  }
}

function isPaymentRequirement(v: unknown): v is X402PaymentRequirements {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Record<string, unknown>).payTo === "string" &&
    typeof (v as Record<string, unknown>).maxAmountRequired === "string"
  );
}
