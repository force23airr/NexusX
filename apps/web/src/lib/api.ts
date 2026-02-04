// ═══════════════════════════════════════════════════════════════
// NexusX — Frontend API Client
// apps/web/src/lib/api.ts
//
// Typed API client for all frontend ↔ backend communication.
// Handles auth token injection, error normalization, and
// provides methods for every service endpoint.
// ═══════════════════════════════════════════════════════════════

import type {
  Listing,
  RouteResult,
  Transaction,
  Wallet,
  ProviderProfile,
  ProviderAnalytics,
  DashboardStats,
  PaginatedResponse,
  PriceTick,
} from "@/types";

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────

const API_BASE = typeof window !== "undefined" ? "" : "http://localhost:3000";

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ─────────────────────────────────────────────────────────────
// FETCH WRAPPER
// ─────────────────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };

  // Inject auth token from cookie/session if present.
  if (typeof window !== "undefined") {
    const token = document.cookie
      .split("; ")
      .find((c) => c.startsWith("nxs_token="))
      ?.split("=")[1];
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      body.error || `Request failed: ${res.status}`,
      res.status,
      body.code
    );
  }

  return res.json();
}

// ─────────────────────────────────────────────────────────────
// MARKETPLACE (Public)
// ─────────────────────────────────────────────────────────────

export const marketplace = {
  /** Search listings with natural language via AI router. */
  async search(query: string): Promise<RouteResult> {
    return apiFetch("/api/search", {
      method: "POST",
      body: JSON.stringify({ query }),
    });
  },

  /** Browse all active listings with pagination and filters. */
  async browse(params?: {
    category?: string;
    type?: string;
    sort?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedResponse<Listing>> {
    const qs = new URLSearchParams();
    if (params?.category) qs.set("category", params.category);
    if (params?.type) qs.set("type", params.type);
    if (params?.sort) qs.set("sort", params.sort);
    if (params?.page) qs.set("page", String(params.page));
    if (params?.pageSize) qs.set("pageSize", String(params.pageSize));
    return apiFetch(`/api/listings?${qs}`);
  },

  /** Get a single listing by slug. */
  async getListing(slug: string): Promise<Listing> {
    return apiFetch(`/api/listings/${slug}`);
  },

  /** Get live price ticks for all active listings. */
  async getPriceTicker(): Promise<PriceTick[]> {
    return apiFetch("/api/prices/ticker");
  },

  /** Get marketplace-wide stats. */
  async getStats(): Promise<DashboardStats> {
    return apiFetch("/api/stats");
  },
};

// ─────────────────────────────────────────────────────────────
// BUYER
// ─────────────────────────────────────────────────────────────

export const buyer = {
  /** Get buyer's wallet. */
  async getWallet(): Promise<Wallet> {
    return apiFetch("/api/buyer/wallet");
  },

  /** Get buyer's transaction history. */
  async getTransactions(params?: {
    listingId?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedResponse<Transaction>> {
    const qs = new URLSearchParams();
    if (params?.listingId) qs.set("listingId", params.listingId);
    if (params?.page) qs.set("page", String(params.page));
    if (params?.pageSize) qs.set("pageSize", String(params.pageSize));
    return apiFetch(`/api/buyer/transactions?${qs}`);
  },

  /** Get buyer's API keys. */
  async getApiKeys(): Promise<
    { id: string; name: string; keyPrefix: string; status: string; rateLimitRpm: number; lastUsedAt: string | null; createdAt: string }[]
  > {
    return apiFetch("/api/buyer/keys");
  },

  /** Create a new API key. */
  async createApiKey(name: string, rateLimitRpm?: number): Promise<{ id: string; rawKey: string }> {
    return apiFetch("/api/buyer/keys", {
      method: "POST",
      body: JSON.stringify({ name, rateLimitRpm }),
    });
  },

  /** Revoke an API key. */
  async revokeApiKey(keyId: string): Promise<void> {
    await apiFetch(`/api/buyer/keys/${keyId}`, { method: "DELETE" });
  },

  /** Get buyer's subscriptions. */
  async getSubscriptions(): Promise<
    { id: string; listingId: string; listingName: string; status: string; monthlyBudget: number; spentThisMonth: number; totalCalls: number }[]
  > {
    return apiFetch("/api/buyer/subscriptions");
  },
};

// ─────────────────────────────────────────────────────────────
// PROVIDER
// ─────────────────────────────────────────────────────────────

export const provider = {
  /** Get provider profile + stats. */
  async getProfile(): Promise<ProviderProfile> {
    return apiFetch("/api/provider/profile");
  },

  /** Get provider's listings. */
  async getListings(params?: {
    status?: string;
    page?: number;
  }): Promise<PaginatedResponse<Listing>> {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.page) qs.set("page", String(params.page));
    return apiFetch(`/api/provider/listings?${qs}`);
  },

  /** Get analytics for a specific listing. */
  async getListingAnalytics(
    listingId: string,
    period?: string
  ): Promise<ProviderAnalytics> {
    const qs = period ? `?period=${period}` : "";
    return apiFetch(`/api/provider/listings/${listingId}/analytics${qs}`);
  },

  /** Get provider payout history. */
  async getPayouts(params?: {
    status?: string;
    page?: number;
  }): Promise<
    PaginatedResponse<{
      id: string;
      amountUsdc: number;
      status: string;
      txHash: string | null;
      initiatedAt: string;
      completedAt: string | null;
    }>
  > {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.page) qs.set("page", String(params.page));
    return apiFetch(`/api/provider/payouts?${qs}`);
  },

  /** Request a manual payout. */
  async requestPayout(amountUsdc: number): Promise<{ id: string; status: string }> {
    return apiFetch("/api/provider/payouts", {
      method: "POST",
      body: JSON.stringify({ amountUsdc }),
    });
  },
};
