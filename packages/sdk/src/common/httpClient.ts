// ═══════════════════════════════════════════════════════════════
// NexusX — SDK HTTP Client
// packages/sdk/src/common/httpClient.ts
//
// Shared HTTP client for the Provider SDK. Handles:
//   - Auth header injection (Bearer token)
//   - Configurable timeout
//   - Retry with exponential backoff on transient errors
//   - Debug logging
//   - Consistent error handling
// ═══════════════════════════════════════════════════════════════

import {
  type NexusXProviderConfig,
  type ApiResponse,
  DEFAULT_PROVIDER_CONFIG,
} from "../provider/types";

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export interface HttpRequestOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
}

export class NexusXApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public requestId?: string,
    public responseBody?: string
  ) {
    super(message);
    this.name = "NexusXApiError";
  }
}

// ─────────────────────────────────────────────────────────────
// CLIENT
// ─────────────────────────────────────────────────────────────

export class HttpClient {
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;
  private retries: number;
  private retryBackoffMs: number;
  private customHeaders: Record<string, string>;
  private debug: boolean;

  constructor(config: NexusXProviderConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_PROVIDER_CONFIG.timeoutMs;
    this.retries = config.retries ?? DEFAULT_PROVIDER_CONFIG.retries;
    this.retryBackoffMs = config.retryBackoffMs ?? DEFAULT_PROVIDER_CONFIG.retryBackoffMs;
    this.customHeaders = config.headers ?? {};
    this.debug = config.debug ?? DEFAULT_PROVIDER_CONFIG.debug;
  }

  /**
   * Execute an HTTP request with retry logic.
   */
  async request<T>(options: HttpRequestOptions): Promise<ApiResponse<T>> {
    const url = this.buildUrl(options.path, options.query);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      "X-SDK-Version": "1.0.0",
      "X-SDK-Client": "nexusx-provider-sdk",
      ...this.customHeaders,
      ...options.headers,
    };

    const requestInit: RequestInit = {
      method: options.method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        if (this.debug) {
          console.log(`[NexusX SDK] ${options.method} ${url} (attempt ${attempt + 1})`);
        }

        const response = await fetch(url, requestInit);
        const requestId = response.headers.get("x-nexusx-request-id") || undefined;

        // Non-retryable client errors (4xx except 429).
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          const body = await this.safeReadBody(response);
          throw new NexusXApiError(
            `API error: ${response.status} ${response.statusText}`,
            response.status,
            requestId,
            body
          );
        }

        // Retryable errors (5xx, 429).
        if (response.status >= 500 || response.status === 429) {
          const retryAfter = response.headers.get("retry-after");
          const waitMs = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : this.retryBackoffMs * Math.pow(2, attempt);

          if (attempt < this.retries) {
            if (this.debug) {
              console.log(`[NexusX SDK] Retrying in ${waitMs}ms (${response.status})`);
            }
            await this.sleep(waitMs);
            continue;
          }

          const body = await this.safeReadBody(response);
          throw new NexusXApiError(
            `API error after ${this.retries} retries: ${response.status}`,
            response.status,
            requestId,
            body
          );
        }

        // Success.
        const data = await response.json() as ApiResponse<T>;
        return data;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Don't retry non-retryable errors.
        if (err instanceof NexusXApiError && err.statusCode < 500 && err.statusCode !== 429) {
          throw err;
        }

        // Timeout or network error — retry.
        if (attempt < this.retries) {
          const waitMs = this.retryBackoffMs * Math.pow(2, attempt);
          if (this.debug) {
            console.log(`[NexusX SDK] Network error, retrying in ${waitMs}ms: ${lastError.message}`);
          }
          await this.sleep(waitMs);
          continue;
        }
      }
    }

    throw lastError || new Error("Request failed after all retries");
  }

  // ─── Convenience Methods ───

  async get<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<ApiResponse<T>> {
    return this.request<T>({ method: "GET", path, query });
  }

  async post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>({ method: "POST", path, body });
  }

  async put<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>({ method: "PUT", path, body });
  }

  async patch<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>({ method: "PATCH", path, body });
  }

  async delete<T>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>({ method: "DELETE", path });
  }

  // ─── Internal ───

  private buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async safeReadBody(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      return "";
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
