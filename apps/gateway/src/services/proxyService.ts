// ═══════════════════════════════════════════════════════════════
// NexusX — Proxy Service
// apps/gateway/src/services/proxyService.ts
//
// Forwards authenticated buyer requests to upstream provider
// endpoints. Captures response metadata (latency, status,
// bytes) for quality scoring and transaction recording.
// ═══════════════════════════════════════════════════════════════

import type { IncomingHttpHeaders } from "http";
import type { ListingRoute, ProxyResult } from "../types";

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export interface ProxyRequest {
  /** HTTP method. */
  method: string;
  /** Path after the listing slug (e.g. "/v1/chat/completions"). */
  path: string;
  /** Query string (without leading ?). */
  queryString: string;
  /** Request headers to forward. */
  headers: IncomingHttpHeaders;
  /** Request body (Buffer or undefined for GET/HEAD). */
  body: Buffer | undefined;
}

export interface ProxyConfig {
  /** Upstream request timeout in ms. */
  timeoutMs: number;
  /** Maximum response body size in bytes. */
  maxResponseBytes: number;
  /** Headers to strip before forwarding upstream. */
  stripRequestHeaders: string[];
  /** Headers to strip from upstream response. */
  stripResponseHeaders: string[];
  /** Headers to inject into every upstream request. */
  injectHeaders: Record<string, string>;
}

export const DEFAULT_PROXY_CONFIG: ProxyConfig = {
  timeoutMs: 30_000,
  maxResponseBytes: 50 * 1024 * 1024, // 50 MB
  stripRequestHeaders: [
    "host",
    "authorization",
    "x-nexusx-key",
    "x-forwarded-for",
    "x-forwarded-proto",
    "x-forwarded-host",
    "connection",
    "keep-alive",
    "transfer-encoding",
  ],
  stripResponseHeaders: [
    "transfer-encoding",
    "connection",
    "keep-alive",
  ],
  injectHeaders: {
    "X-Forwarded-By": "NexusX-Gateway/1.0",
  },
};

// ─────────────────────────────────────────────────────────────
// SERVICE
// ─────────────────────────────────────────────────────────────

export class ProxyService {
  private config: ProxyConfig;

  constructor(config?: Partial<ProxyConfig>) {
    this.config = { ...DEFAULT_PROXY_CONFIG, ...config };
  }

  /**
   * Forward a request to the upstream provider and return the response.
   *
   * @param route   Resolved listing route (baseUrl, authType, etc).
   * @param request Incoming request details.
   * @param requestId  Unique request ID for tracing.
   * @returns ProxyResult with status, headers, body, latency, and bytes.
   */
  async forward(
    route: ListingRoute,
    request: ProxyRequest,
    requestId: string
  ): Promise<ProxyResult> {
    const startTime = performance.now();

    // Build upstream URL.
    const upstreamUrl = this.buildUpstreamUrl(route.baseUrl, request.path, request.queryString);

    // Build forwarded headers.
    const headers = this.buildHeaders(request.headers, requestId);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

      const response = await fetch(upstreamUrl, {
        method: request.method,
        headers,
        body: request.method !== "GET" && request.method !== "HEAD"
          ? request.body
          : undefined,
        signal: controller.signal,
        // @ts-expect-error — Node.js fetch supports duplex
        duplex: "half",
      });

      clearTimeout(timeout);

      // Read response body with size limit.
      const body = await this.readResponseBody(response);

      const latencyMs = Math.round(performance.now() - startTime);

      // Build clean response headers.
      const responseHeaders = this.cleanResponseHeaders(response.headers);

      // Inject NexusX tracing headers.
      responseHeaders["x-nexusx-request-id"] = requestId;
      responseHeaders["x-nexusx-latency-ms"] = latencyMs.toString();

      return {
        statusCode: response.status,
        headers: responseHeaders,
        body,
        latencyMs,
        bytesTransferred: body.length,
      };
    } catch (err: unknown) {
      const latencyMs = Math.round(performance.now() - startTime);

      if (err instanceof DOMException && err.name === "AbortError") {
        return {
          statusCode: 504,
          headers: {
            "content-type": "application/json",
            "x-nexusx-request-id": requestId,
          },
          body: Buffer.from(
            JSON.stringify({
              error: "GATEWAY_TIMEOUT",
              message: `Upstream provider did not respond within ${this.config.timeoutMs}ms.`,
              requestId,
            })
          ),
          latencyMs,
          bytesTransferred: 0,
        };
      }

      const message = err instanceof Error ? err.message : "Unknown proxy error";

      return {
        statusCode: 502,
        headers: {
          "content-type": "application/json",
          "x-nexusx-request-id": requestId,
        },
        body: Buffer.from(
          JSON.stringify({
            error: "BAD_GATEWAY",
            message: `Upstream provider error: ${message}`,
            requestId,
          })
        ),
        latencyMs,
        bytesTransferred: 0,
      };
    }
  }

  // ─── Internal Helpers ───

  private buildUpstreamUrl(baseUrl: string, path: string, queryString: string): string {
    // Normalize: strip trailing slash from baseUrl, ensure leading slash on path.
    const base = baseUrl.replace(/\/+$/, "");
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    const qs = queryString ? `?${queryString}` : "";
    return `${base}${cleanPath}${qs}`;
  }

  private buildHeaders(
    incomingHeaders: IncomingHttpHeaders,
    requestId: string
  ): Record<string, string> {
    const headers: Record<string, string> = {};

    // Copy incoming headers, stripping those on the blocklist.
    const stripped = new Set(this.config.stripRequestHeaders.map((h) => h.toLowerCase()));

    for (const [key, value] of Object.entries(incomingHeaders)) {
      if (stripped.has(key.toLowerCase())) continue;
      if (value === undefined) continue;
      headers[key] = Array.isArray(value) ? value.join(", ") : value;
    }

    // Inject NexusX headers.
    for (const [key, value] of Object.entries(this.config.injectHeaders)) {
      headers[key] = value;
    }

    headers["x-nexusx-request-id"] = requestId;

    return headers;
  }

  private async readResponseBody(response: Response): Promise<Buffer> {
    if (!response.body) return Buffer.alloc(0);

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    const reader = response.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.length;
      if (totalBytes > this.config.maxResponseBytes) {
        reader.cancel();
        throw new Error(
          `Response body exceeded maximum size of ${this.config.maxResponseBytes} bytes.`
        );
      }

      chunks.push(value);
    }

    return Buffer.concat(chunks);
  }

  private cleanResponseHeaders(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    const stripped = new Set(this.config.stripResponseHeaders.map((h) => h.toLowerCase()));

    headers.forEach((value, key) => {
      if (!stripped.has(key.toLowerCase())) {
        result[key] = value;
      }
    });

    return result;
  }
}
