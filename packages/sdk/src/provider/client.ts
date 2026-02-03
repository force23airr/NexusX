// ═══════════════════════════════════════════════════════════════
// NexusX — Provider Client
// packages/sdk/src/provider/client.ts
//
// Main SDK class for providers. Methods:
//   Profile:   getProfile, updateProfile
//   Listings:  createListing, updateListing, getListing,
//              getListings, publishListing, pauseListing,
//              deprecateListing
//   Health:    reportMetrics, startAutoReporter, stopAutoReporter
//   Webhooks:  registerWebhook, listWebhooks, deleteWebhook,
//              testWebhook, createHandler
//   Payouts:   requestPayout, getPayouts, getPayoutById
//   Analytics: getListingAnalytics
// ═══════════════════════════════════════════════════════════════

import { HttpClient } from "../common/httpClient";
import { WebhookHandler } from "../common/webhooks";
import type {
  NexusXProviderConfig,
  ProviderProfile,
  UpdateProfileInput,
  CreateListingInput,
  UpdateListingInput,
  Listing,
  HealthMetricReport,
  HealthReporterConfig,
  RegisterWebhookInput,
  Webhook,
  RequestPayoutInput,
  Payout,
  ListingAnalytics,
  PaginatedResponse,
} from "./types";

// ─────────────────────────────────────────────────────────────
// SERVICE
// ─────────────────────────────────────────────────────────────

export class NexusXProvider {
  private http: HttpClient;
  private autoReporters: Map<string, ReturnType<typeof setInterval>> = new Map();

  constructor(config: NexusXProviderConfig) {
    if (!config.apiKey || !config.baseUrl) {
      throw new Error("NexusXProvider requires both apiKey and baseUrl.");
    }
    this.http = new HttpClient(config);
  }

  // ─────────────────────────────────────────────────────────
  // PROFILE
  // ─────────────────────────────────────────────────────────

  /** Get the authenticated provider's profile. */
  async getProfile(): Promise<ProviderProfile> {
    const res = await this.http.get<ProviderProfile>("/provider/profile");
    return res.data;
  }

  /** Update the authenticated provider's profile. */
  async updateProfile(input: UpdateProfileInput): Promise<ProviderProfile> {
    const res = await this.http.patch<ProviderProfile>("/provider/profile", input);
    return res.data;
  }

  // ─────────────────────────────────────────────────────────
  // LISTINGS
  // ─────────────────────────────────────────────────────────

  /** Create a new listing (starts in DRAFT status). */
  async createListing(input: CreateListingInput): Promise<Listing> {
    this.validateListingInput(input);
    const res = await this.http.post<Listing>("/provider/listings", input);
    return res.data;
  }

  /** Update an existing listing. */
  async updateListing(listingId: string, input: UpdateListingInput): Promise<Listing> {
    const res = await this.http.patch<Listing>(`/provider/listings/${listingId}`, input);
    return res.data;
  }

  /** Get a single listing by ID. */
  async getListing(listingId: string): Promise<Listing> {
    const res = await this.http.get<Listing>(`/provider/listings/${listingId}`);
    return res.data;
  }

  /** List all of the provider's listings. */
  async getListings(params?: {
    status?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedResponse<Listing>> {
    const res = await this.http.get<PaginatedResponse<Listing>>("/provider/listings", params);
    return res.data;
  }

  /** Submit a DRAFT listing for review → PENDING_REVIEW. */
  async publishListing(listingId: string): Promise<Listing> {
    const res = await this.http.post<Listing>(`/provider/listings/${listingId}/publish`);
    return res.data;
  }

  /** Pause an ACTIVE listing → PAUSED. */
  async pauseListing(listingId: string): Promise<Listing> {
    const res = await this.http.post<Listing>(`/provider/listings/${listingId}/pause`);
    return res.data;
  }

  /** Resume a PAUSED listing → ACTIVE. */
  async resumeListing(listingId: string): Promise<Listing> {
    const res = await this.http.post<Listing>(`/provider/listings/${listingId}/resume`);
    return res.data;
  }

  /** Deprecate a listing → DEPRECATED. */
  async deprecateListing(listingId: string): Promise<Listing> {
    const res = await this.http.post<Listing>(`/provider/listings/${listingId}/deprecate`);
    return res.data;
  }

  // ─────────────────────────────────────────────────────────
  // HEALTH METRICS
  // ─────────────────────────────────────────────────────────

  /** Report health metrics for a listing. */
  async reportMetrics(report: HealthMetricReport): Promise<void> {
    this.validateMetricReport(report);
    await this.http.post("/provider/metrics", report);
  }

  /**
   * Start an automatic health reporter that probes your endpoint
   * and reports metrics at a fixed interval.
   *
   * @returns A cleanup function to stop the reporter.
   */
  startAutoReporter(config: HealthReporterConfig): () => void {
    const key = config.listingIdOrSlug;
    const intervalMs = config.intervalMs ?? 300_000;
    const probeTimeoutMs = config.probeTimeoutMs ?? 5_000;

    // Tracking state for the current period.
    let successCount = 0;
    let failureCount = 0;
    let latencies: number[] = [];
    let uptimeMinutes = 0;
    let periodStart = new Date().toISOString();

    const probe = async () => {
      const healthUrl = config.healthCheckUrl;
      if (!healthUrl) return;

      const start = performance.now();
      try {
        const response = await fetch(healthUrl, {
          signal: AbortSignal.timeout(probeTimeoutMs),
        });
        const latency = Math.round(performance.now() - start);

        if (response.ok) {
          successCount++;
          latencies.push(latency);
          uptimeMinutes += Math.round(intervalMs / 60_000);
        } else {
          failureCount++;
        }
      } catch {
        failureCount++;
      }
    };

    const report = async () => {
      const periodEnd = new Date().toISOString();
      const totalMinutes = Math.round(intervalMs / 60_000);

      if (successCount + failureCount === 0) return;

      const sorted = [...latencies].sort((a, b) => a - b);
      const medianLatencyMs = sorted.length > 0
        ? sorted[Math.floor(sorted.length / 2)]
        : 0;
      const p99LatencyMs = sorted.length > 0
        ? sorted[Math.floor(sorted.length * 0.99)]
        : 0;

      try {
        await this.reportMetrics({
          listingIdOrSlug: key,
          successCount,
          failureCount,
          medianLatencyMs,
          p99LatencyMs,
          uptimeMinutes,
          totalMinutes,
          periodStart,
          periodEnd,
        });
      } catch (err) {
        console.error(`[NexusX SDK] Auto-reporter error for ${key}:`, err);
      }

      // Reset counters.
      successCount = 0;
      failureCount = 0;
      latencies = [];
      uptimeMinutes = 0;
      periodStart = periodEnd;
    };

    // Probe frequently, report at interval.
    const probeInterval = setInterval(probe, Math.min(intervalMs / 5, 60_000));
    const reportInterval = setInterval(report, intervalMs);

    // Store for cleanup.
    this.autoReporters.set(`${key}_probe`, probeInterval);
    this.autoReporters.set(`${key}_report`, reportInterval);

    // Initial probe.
    probe();

    return () => this.stopAutoReporter(key);
  }

  /** Stop an auto-reporter for a listing. */
  stopAutoReporter(listingIdOrSlug: string): void {
    const probeTimer = this.autoReporters.get(`${listingIdOrSlug}_probe`);
    const reportTimer = this.autoReporters.get(`${listingIdOrSlug}_report`);
    if (probeTimer) clearInterval(probeTimer);
    if (reportTimer) clearInterval(reportTimer);
    this.autoReporters.delete(`${listingIdOrSlug}_probe`);
    this.autoReporters.delete(`${listingIdOrSlug}_report`);
  }

  // ─────────────────────────────────────────────────────────
  // WEBHOOKS
  // ─────────────────────────────────────────────────────────

  /** Register a new webhook endpoint. */
  async registerWebhook(input: RegisterWebhookInput): Promise<Webhook> {
    if (!input.url.startsWith("https://")) {
      throw new Error("Webhook URL must use HTTPS.");
    }
    if (!input.events.length) {
      throw new Error("At least one event type is required.");
    }
    if (input.secret.length < 32) {
      throw new Error("Webhook secret must be at least 32 characters.");
    }

    const res = await this.http.post<Webhook>("/provider/webhooks", input);
    return res.data;
  }

  /** List all registered webhooks. */
  async listWebhooks(): Promise<Webhook[]> {
    const res = await this.http.get<Webhook[]>("/provider/webhooks");
    return res.data;
  }

  /** Delete a webhook by ID. */
  async deleteWebhook(webhookId: string): Promise<void> {
    await this.http.delete(`/provider/webhooks/${webhookId}`);
  }

  /** Send a test event to a webhook endpoint. */
  async testWebhook(webhookId: string): Promise<{ delivered: boolean; statusCode: number }> {
    const res = await this.http.post<{ delivered: boolean; statusCode: number }>(
      `/provider/webhooks/${webhookId}/test`
    );
    return res.data;
  }

  /**
   * Create a WebhookHandler for processing incoming events.
   * Use this in your Express/Fastify route to verify and dispatch events.
   */
  createHandler(secret: string): WebhookHandler {
    return new WebhookHandler(secret);
  }

  // ─────────────────────────────────────────────────────────
  // PAYOUTS
  // ─────────────────────────────────────────────────────────

  /** Request a manual payout. */
  async requestPayout(input: RequestPayoutInput): Promise<Payout> {
    if (input.amountUsdc <= 0) {
      throw new Error("Payout amount must be greater than zero.");
    }
    const res = await this.http.post<Payout>("/provider/payouts", input);
    return res.data;
  }

  /** List payout history. */
  async getPayouts(params?: {
    status?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedResponse<Payout>> {
    const res = await this.http.get<PaginatedResponse<Payout>>("/provider/payouts", params);
    return res.data;
  }

  /** Get a single payout by ID. */
  async getPayoutById(payoutId: string): Promise<Payout> {
    const res = await this.http.get<Payout>(`/provider/payouts/${payoutId}`);
    return res.data;
  }

  // ─────────────────────────────────────────────────────────
  // ANALYTICS
  // ─────────────────────────────────────────────────────────

  /** Get analytics for a listing over a time period. */
  async getListingAnalytics(
    listingId: string,
    params?: { period?: "1h" | "24h" | "7d" | "30d" | "all" }
  ): Promise<ListingAnalytics> {
    const res = await this.http.get<ListingAnalytics>(
      `/provider/listings/${listingId}/analytics`,
      params
    );
    return res.data;
  }

  // ─────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────

  /** Stop all auto-reporters and clean up. */
  destroy(): void {
    for (const [key, timer] of this.autoReporters) {
      clearInterval(timer);
    }
    this.autoReporters.clear();
  }

  // ─────────────────────────────────────────────────────────
  // VALIDATION
  // ─────────────────────────────────────────────────────────

  private validateListingInput(input: CreateListingInput): void {
    if (!input.slug || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(input.slug)) {
      throw new Error("Listing slug must be lowercase alphanumeric with hyphens (e.g. 'my-api-v2').");
    }
    if (input.slug.length < 3 || input.slug.length > 64) {
      throw new Error("Listing slug must be 3-64 characters.");
    }
    if (!input.name || input.name.length < 3) {
      throw new Error("Listing name must be at least 3 characters.");
    }
    if (!input.description || input.description.length < 20) {
      throw new Error("Listing description must be at least 20 characters.");
    }
    if (!input.baseUrl || !input.baseUrl.startsWith("https://")) {
      throw new Error("Base URL must use HTTPS.");
    }
    if (input.floorPriceUsdc <= 0) {
      throw new Error("Floor price must be greater than zero.");
    }
    if (input.ceilingPriceUsdc !== undefined && input.ceilingPriceUsdc <= input.floorPriceUsdc) {
      throw new Error("Ceiling price must be greater than floor price.");
    }
    if (input.capacityPerMinute !== undefined && input.capacityPerMinute < 1) {
      throw new Error("Capacity must be at least 1 request per minute.");
    }
  }

  private validateMetricReport(report: HealthMetricReport): void {
    if (report.successCount < 0 || report.failureCount < 0) {
      throw new Error("Success and failure counts cannot be negative.");
    }
    if (report.medianLatencyMs < 0 || report.p99LatencyMs < 0) {
      throw new Error("Latency values cannot be negative.");
    }
    if (report.uptimeMinutes > report.totalMinutes) {
      throw new Error("Uptime minutes cannot exceed total minutes.");
    }
  }
}
