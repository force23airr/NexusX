// ═══════════════════════════════════════════════════════════════
// NexusX — Route Resolver Service
// apps/gateway/src/services/routeResolver.ts
//
// Resolves listing slugs to upstream routes. Caches routes in
// memory with configurable TTL. In production, back with Redis
// for cross-instance consistency.
// ═══════════════════════════════════════════════════════════════

import type { ListingRoute } from "../types";
import type Redis from "ioredis";

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

interface CacheEntry {
  route: ListingRoute;
  expiresAt: number;
}

interface SharedCacheEntry {
  route: ListingRoute;
  expiresAt: number;
  cachedAt: number;
}

type RouteVersionToken = string | number | null;

/** Database query function to resolve a listing by slug. */
export type ListingLookupFn = (slug: string) => Promise<ListingRoute | null>;

/** Database query function to resolve a listing by ID. */
export type ListingByIdFn = (id: string) => Promise<ListingRoute | null>;

/** Shared control-plane version loader for cross-instance cache invalidation. */
export type RouteVersionLoaderFn = () => Promise<RouteVersionToken>;

type SharedRouteCacheRedis = Pick<Redis, "get" | "set" | "del">;

const DEFAULT_SHARED_ROUTE_CACHE_PREFIX = "nexusx:route-cache";

// ─────────────────────────────────────────────────────────────
// SERVICE
// ─────────────────────────────────────────────────────────────

export class RouteResolver {
  private cache: Map<string, CacheEntry> = new Map();
  private idToSlug: Map<string, string> = new Map();
  private cacheTtlMs: number;
  private lookupBySlug: ListingLookupFn;
  private lookupById: ListingByIdFn;
  private versionLoader?: RouteVersionLoaderFn;
  private versionCheckIntervalMs: number;
  private sharedCache?: SharedRouteCacheRedis;
  private sharedCachePrefix: string;
  private lastVersionCheckAt = 0;
  private lastSeenVersionToken: string = "0";
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    lookupBySlug: ListingLookupFn,
    lookupById: ListingByIdFn,
    cacheTtlMs: number = 60_000,
    versionLoader?: RouteVersionLoaderFn,
    versionCheckIntervalMs: number = 5_000,
    sharedCache?: SharedRouteCacheRedis,
    sharedCachePrefix: string = DEFAULT_SHARED_ROUTE_CACHE_PREFIX,
  ) {
    this.lookupBySlug = lookupBySlug;
    this.lookupById = lookupById;
    this.cacheTtlMs = cacheTtlMs;
    this.versionLoader = versionLoader;
    this.versionCheckIntervalMs = versionCheckIntervalMs;
    this.sharedCache = sharedCache;
    this.sharedCachePrefix = sharedCachePrefix;

    // Periodic cache cleanup.
    this.cleanupTimer = setInterval(() => this.evictExpired(), this.cacheTtlMs * 2);
  }

  /**
   * Resolve a listing slug to its upstream route.
   * Returns null if the listing doesn't exist or isn't active.
   */
  async resolveBySlug(slug: string): Promise<ListingRoute | null> {
    await this.syncVersionIfNeeded();

    // Check cache.
    const cached = this.cache.get(slug);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.route;
    }

    const sharedRoute = await this.loadSharedRoute("slug", slug);
    if (sharedRoute) {
      this.cacheRoute(slug, sharedRoute);
      return sharedRoute;
    }

    // Cache miss — query database.
    const route = await this.lookupBySlug(slug);
    if (!route) return null;

    // Only cache ACTIVE listings.
    if (this.isCacheable(route)) {
      this.cacheRoute(slug, route);
      await this.storeSharedRoute(slug, route);
    }

    return route;
  }

  /**
   * Resolve a listing by ID. Used for demand signal routing.
   */
  async resolveById(id: string): Promise<ListingRoute | null> {
    await this.syncVersionIfNeeded();

    // Check if we have the slug cached via ID mapping.
    const slug = this.idToSlug.get(id);
    if (slug) {
      const cached = this.cache.get(slug);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.route;
      }
    }

    const sharedRoute = await this.loadSharedRoute("id", id);
    if (sharedRoute) {
      this.cacheRoute(this.resolveSlugForRoute(sharedRoute), sharedRoute);
      return sharedRoute;
    }

    // Fallback to direct ID lookup.
    const route = await this.lookupById(id);
    if (!route) return null;

    if (this.isCacheable(route)) {
      this.cacheRoute(this.resolveSlugForRoute(route), route);
      await this.storeSharedRoute(this.resolveSlugForRoute(route), route);
    }

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

    if (this.sharedCache) {
      const keys = [this.getSharedCacheKey("slug", slug)];
      if (entry) {
        keys.push(this.getSharedCacheKey("id", entry.route.listingId));
      }
      void this.sharedCache.del(...keys).catch((err) => {
        console.warn("[RouteResolver] Failed to invalidate shared route cache:", err);
      });
    }
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

  private async syncVersionIfNeeded(): Promise<void> {
    if (!this.versionLoader) {
      return;
    }

    const now = Date.now();
    if (now - this.lastVersionCheckAt < this.versionCheckIntervalMs) {
      return;
    }
    this.lastVersionCheckAt = now;

    try {
      const version = await this.versionLoader();
      const normalizedToken = normalizeVersionToken(version);

      if (normalizedToken !== this.lastSeenVersionToken) {
        this.invalidateAll();
      }

      this.lastSeenVersionToken = normalizedToken;
    } catch (err) {
      console.warn("[RouteResolver] Failed to load shared route version:", err);
    }
  }

  private isCacheable(route: ListingRoute): boolean {
    return route.status === "ACTIVE" || route.status === "PAUSED";
  }

  private resolveSlugForRoute(route: ListingRoute): string {
    return route.slug || this.idToSlug.get(route.listingId) || route.listingId;
  }

  private cacheRoute(slug: string, route: ListingRoute): void {
    this.cache.set(slug, {
      route,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
    this.idToSlug.set(route.listingId, slug);
  }

  private async loadSharedRoute(
    kind: "slug" | "id",
    value: string,
  ): Promise<ListingRoute | null> {
    if (!this.sharedCache) {
      return null;
    }

    try {
      const raw = await this.sharedCache.get(this.getSharedCacheKey(kind, value));
      const entry = parseSharedCacheEntry(raw);
      if (!entry || entry.expiresAt <= Date.now()) {
        return null;
      }
      return entry.route;
    } catch (err) {
      console.warn("[RouteResolver] Failed to read shared route cache:", err);
      return null;
    }
  }

  private async storeSharedRoute(slug: string, route: ListingRoute): Promise<void> {
    if (!this.sharedCache) {
      return;
    }

    const payload = serializeSharedCacheEntry({
      route,
      cachedAt: Date.now(),
      expiresAt: Date.now() + this.cacheTtlMs,
    });

    try {
      await Promise.all([
        this.sharedCache.set(
          this.getSharedCacheKey("slug", slug),
          payload,
          "PX",
          this.cacheTtlMs,
        ),
        this.sharedCache.set(
          this.getSharedCacheKey("id", route.listingId),
          payload,
          "PX",
          this.cacheTtlMs,
        ),
      ]);
    } catch (err) {
      console.warn("[RouteResolver] Failed to populate shared route cache:", err);
    }
  }

  private getSharedCacheKey(kind: "slug" | "id", value: string): string {
    return `${this.sharedCachePrefix}:${this.lastSeenVersionToken}:${kind}:${value}`;
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

function normalizeVersionToken(value: RouteVersionToken): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.max(0, Math.trunc(value)));
  }

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return "0";
}

function serializeSharedCacheEntry(entry: SharedCacheEntry): string {
  return JSON.stringify(entry);
}

function parseSharedCacheEntry(raw: string | null): SharedCacheEntry | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const route = parsed.route;
    const cachedAt = Number(parsed.cachedAt ?? 0);
    const expiresAt = Number(parsed.expiresAt ?? 0);
    if (
      !route ||
      typeof route !== "object" ||
      !Number.isFinite(cachedAt) ||
      !Number.isFinite(expiresAt)
    ) {
      return null;
    }

    return {
      route: route as ListingRoute,
      cachedAt,
      expiresAt,
    };
  } catch {
    return null;
  }
}
