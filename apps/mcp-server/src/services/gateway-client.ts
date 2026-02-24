// ═══════════════════════════════════════════════════════════════
// NexusX — MCP Gateway Client
// apps/mcp-server/src/services/gateway-client.ts
//
// HTTP client for executing tool calls through the NexusX gateway.
// Follows the pattern from packages/sdk/src/common/httpClient.ts.
// ═══════════════════════════════════════════════════════════════

import type { ToolExecutionResult } from "../types";

export class GatewayClient {
  private baseUrl: string;
  private apiKey: string;
  private sandbox: boolean;

  constructor(gatewayUrl: string, apiKey: string, sandbox: boolean = false) {
    this.baseUrl = gatewayUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.sandbox = sandbox;
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
  }): Promise<ToolExecutionResult> {
    const { slug, method, path, body, query, headers: extraHeaders } = params;

    // Build URL: /v1/{slug}/{path}
    const subPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}/v1/${slug}${subPath}`);

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }

    // Build headers
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "X-SDK-Client": "nexusx-mcp-server",
      ...extraHeaders,
    };

    if (this.sandbox) {
      headers["X-NexusX-Sandbox"] = "true";
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

      // Extract NexusX metadata headers
      const priceUsdc = parseFloat(response.headers.get("x-nexusx-price-usdc") || "0");
      const platformFeeUsdc = parseFloat(response.headers.get("x-nexusx-fee-usdc") || "0");
      const latencyMs = parseInt(response.headers.get("x-nexusx-latency-ms") || "0", 10);
      const requestId = response.headers.get("x-nexusx-request-id") || "";

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
      };
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
      const data = await response.json();
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
