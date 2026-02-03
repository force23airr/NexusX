// ═══════════════════════════════════════════════════════════════
// NexusX — Route Resolver Service
// apps/gateway/src/services/routeResolver.ts
//
// Resolves listing slugs to upstream routes. Caches routes in
// memory with configurable TTL. In production, back with Redis
// for cross-instance consistency.
// ═══════════════════════════════════════════════════════════════

import type { ListingRoute } from "../types";

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

interface CacheEntry {
  route: ListingRoute;
  expiresAt: number;
}

/** Database query function to resolve a listing by slug. */
export type ListingLookupFn = (slug: string) => Promise<ListingRoute | null>;

/** Database query function to resolve a listing by ID. */
export type ListingByIdFn = (id: string) => Promise<ListingRoute | null>;

// ─────────────────────────────────────────────────────────────
// SERVICE
// ─────────────────────────────────────────────────────────────

export class RouteResolver {
  private cache: Map<string, CacheEntry> = new Map();
  private idToSlug: Map<string, string> = new Map();
  private cacheTtlMs: number;
  private lookupBySlug: ListingLookupFn;
  private lookupById: ListingByIdFn;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    lookupBySlug: ListingLookupFn,
    lookupById: ListingByIdFn,
    cacheTtlMs: number = 60_000
  ) {
    this.lookupBySlug = lookupBySlug;
    this.lookupById = lookupById;
    this.cacheTtlMs = cacheTtlMs;

    // Periodic cache cleanup.
    this.cleanupTimer = setInterval(() => this.evictExpired(), this.cacheTtlMs * 2);
  }

  /**
   * Resolve a listing slug to its upstream route.
   * Returns null if the listing doesn't exist or isn't active.
   */
  async resolveBySlug(slug: string): Promise<ListingRoute | null> {
    // Check cache.
    const cached = this.cache.get(slug);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.route;
    }

    // Cache miss — query database.
    const route = await this.lookupBySlug(slug);
    if (!route) return null;

    // Only cache ACTIVE listings.
    if (route.status === "ACTIVE" || route.status === "PAUSED") {
      this.cache.set(slug, {
        route,
        expiresAt: Date.now() + this.cacheTtlMs,
      });
      this.idToSlug.set(route.listingId, slug);
    }

    return route;
  }

  /**
   * Resolve a listing by ID. Used for demand signal routing.
   */
  async resolveById(id: string): Promise<ListingRoute | null> {
    // Check if we have the slug cached via ID mapping.
    const slug = this.idToSlug.get(id);
    if (slug) {
      const cached = this.cache.get(slug);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.route;
      }
    }

    // Fallback to direct ID lookup.
    const route = await this.lookupById(id);
    if (!route) return null;

    return route;
  }

  /**
   * Invalidate cache for a specific slug.
   * Called when listing config changes (price update, pause, etc).
   */
  invalidate(slug: string): void {
    const entry = this.cache.get(slug);
    if (entry) {
      this.idToSlug.delete(entry.route.listingId);
    }
    this.cache.delete(slug);
  }

  /**
   * Invalidate all cached routes. Used on config reload.
   */
  invalidateAll(): void {
    this.cache.clear();
    this.idToSlug.clear();
  }

  /**
   * Get cache stats for monitoring.
   */
  stats(): { size: number; ttlMs: number } {
    return { size: this.cache.size, ttlMs: this.cacheTtlMs };
  }

  /** Remove expired entries. */
  private evictExpired(): void {
    const now = Date.now();
    for (const [slug, entry] of this.cache) {
      if (entry.expiresAt <= now) {
        this.idToSlug.delete(entry.route.listingId);
        this.cache.delete(slug);
      }
    }
  }

  /** Shutdown cleanup timer. */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.cache.clear();
    this.idToSlug.clear();
  }
}
