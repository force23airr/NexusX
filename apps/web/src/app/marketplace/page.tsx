// ═══════════════════════════════════════════════════════════════
// NexusX — Marketplace Explore Page
// apps/web/src/app/marketplace/page.tsx
//
// Main marketplace view:
//   - AI-powered natural language search bar
//   - Live price ticker strip
//   - Category filters
//   - Listing grid with quality/price/demand cards
// ═══════════════════════════════════════════════════════════════

"use client";

import { useState, useEffect, useCallback } from "react";
import { marketplace, buyer } from "@/lib/api";
import { cn } from "@/lib/utils";
import { SearchBar } from "@/components/marketplace/SearchBar";
import { PriceTicker } from "@/components/marketplace/PriceTicker";
import { ListingCard } from "@/components/marketplace/ListingCard";
import { CategoryFilter } from "@/components/marketplace/CategoryFilter";
import { usePriceTicker } from "@/hooks/usePriceTicker";
import type { Listing, RouteResult, PaginatedResponse } from "@/types";

const CATEGORIES = [
  { slug: "all", name: "All" },
  { slug: "language-models", name: "Language Models" },
  { slug: "translation", name: "Translation" },
  { slug: "sentiment-analysis", name: "Sentiment" },
  { slug: "embeddings", name: "Embeddings" },
  { slug: "object-detection", name: "Vision" },
  { slug: "datasets", name: "Datasets" },
];

const SORT_OPTIONS = [
  { value: "popular", label: "Most Popular" },
  { value: "price_low", label: "Price: Low → High" },
  { value: "price_high", label: "Price: High → Low" },
  { value: "quality", label: "Highest Quality" },
  { value: "newest", label: "Newest" },
];

const SECTORS = [
  { value: "consumer-products", label: "Consumer Products" },
  { value: "hardware", label: "Hardware" },
  { value: "military-defense", label: "Military & Defense" },
  { value: "logistics", label: "Logistics" },
  { value: "shopping-commerce", label: "Shopping & Commerce" },
  { value: "healthcare", label: "Healthcare" },
  { value: "fintech", label: "Fintech & Banking" },
  { value: "education", label: "Education" },
  { value: "real-estate", label: "Real Estate" },
  { value: "automotive", label: "Automotive" },
  { value: "energy", label: "Energy & Utilities" },
  { value: "media-entertainment", label: "Media & Entertainment" },
  { value: "agriculture", label: "Agriculture" },
  { value: "telecommunications", label: "Telecommunications" },
  { value: "travel-hospitality", label: "Travel & Hospitality" },
  { value: "general-purpose", label: "General Purpose / Cross-Industry" },
];

export default function MarketplacePage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const priceTicks = usePriceTicker();
  const [searchResults, setSearchResults] = useState<RouteResult | null>(null);
  const [activeCategory, setActiveCategory] = useState("all");
  const [sortBy, setSortBy] = useState("popular");
  const [sectors, setSectors] = useState<string[]>([]);
  const [sectorOpen, setSectorOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [watchedIds, setWatchedIds] = useState<Set<string>>(new Set());

  // ─── Load Watchlist IDs ───
  useEffect(() => {
    buyer
      .getWatchlist()
      .then((items) => setWatchedIds(new Set(items.map((w) => w.listingId))))
      .catch(() => {});
  }, []);

  const handleWatchlistToggle = useCallback((listingId: string, watched: boolean) => {
    setWatchedIds((prev) => {
      const next = new Set(prev);
      if (watched) next.add(listingId);
      else next.delete(listingId);
      return next;
    });
  }, []);

  // ─── Load Listings ───
  const loadListings = useCallback(async () => {
    setIsLoading(true);
    try {
      const res: PaginatedResponse<Listing> = await marketplace.browse({
        category: activeCategory === "all" ? undefined : activeCategory,
        sectors: sectors.length > 0 ? sectors : undefined,
        sort: sortBy,
        pageSize: 20,
      });
      setListings(res.items);
    } catch (err) {
      console.error("Failed to load listings:", err);
    } finally {
      setIsLoading(false);
    }
  }, [activeCategory, sectors, sortBy]);

  useEffect(() => {
    loadListings();
  }, [loadListings]);

  // ─── AI Search ───
  const handleSearch = async (query: string) => {
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }
    setIsSearching(true);
    try {
      const result = await marketplace.search(query);
      setSearchResults(result);
    } catch (err) {
      console.error("Search failed:", err);
    } finally {
      setIsSearching(false);
    }
  };

  const clearSearch = () => setSearchResults(null);

  // ─── Determine Display Data ───
  const displayListings = searchResults
    ? searchResults.matches.map((m) => m.listing)
    : listings;

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Explore the Marketplace
        </h1>
        <p className="mt-2 text-zinc-400">
          Discover AI APIs and datasets with dynamic, auction-based pricing.
        </p>
      </div>

      {/* Price Ticker */}
      <PriceTicker ticks={priceTicks} />

      {/* Search */}
      <SearchBar
        onSearch={handleSearch}
        isSearching={isSearching}
        onClear={clearSearch}
        hasResults={!!searchResults}
      />

      {/* Search Result Context */}
      {searchResults && (
        <div className="card px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-brand-400 text-sm font-medium">
              AI Router
            </span>
            <span className="text-zinc-400 text-sm">
              {searchResults.matches.length} matches from{" "}
              {searchResults.totalEvaluated} listings in{" "}
              {searchResults.routeTimeMs}ms
            </span>
            <span className="badge bg-brand-500/15 text-brand-300">
              {searchResults.intent.category}
            </span>
            <span className="text-zinc-500 text-xs">
              {Math.round(searchResults.intent.confidence * 100)}% confidence
            </span>
          </div>
          <button onClick={clearSearch} className="btn-ghost text-xs">
            Clear
          </button>
        </div>
      )}

      {/* Filters (hidden during search) */}
      {!searchResults && (
        <div className="flex items-center justify-between gap-4">
          <CategoryFilter
            categories={CATEGORIES}
            active={activeCategory}
            onChange={setActiveCategory}
          />
          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                type="button"
                onClick={() => setSectorOpen((v) => !v)}
                className={cn(
                  "input-base flex items-center gap-2 min-w-[200px] text-left",
                  sectors.length > 0 && "border-brand-600/40"
                )}
              >
                <span className="flex-1 truncate">
                  {sectors.length === 0
                    ? "Sector / Industry"
                    : sectors.length === 1
                      ? SECTORS.find((s) => s.value === sectors[0])?.label
                      : `${sectors.length} sectors`}
                </span>
                {sectors.length > 0 && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      setSectors([]);
                    }}
                    className="text-zinc-500 hover:text-zinc-300 text-xs"
                  >
                    &times;
                  </span>
                )}
                <span className="text-zinc-500 text-xs">{sectorOpen ? "\u25B2" : "\u25BC"}</span>
              </button>
              {sectorOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setSectorOpen(false)}
                  />
                  <div className="absolute right-0 top-full mt-1 w-72 max-h-80 overflow-y-auto rounded-lg bg-surface-2 border border-surface-4 shadow-xl z-20 py-1">
                    {SECTORS.map((s) => {
                      const selected = sectors.includes(s.value);
                      return (
                        <button
                          key={s.value}
                          type="button"
                          onClick={() => {
                            if (selected) {
                              setSectors(sectors.filter((v) => v !== s.value));
                            } else {
                              setSectors([...sectors, s.value]);
                            }
                          }}
                          className={cn(
                            "w-full px-3 py-2 text-left text-xs flex items-center gap-2 transition-colors",
                            selected
                              ? "bg-brand-600/10 text-brand-300"
                              : "text-zinc-400 hover:bg-surface-3 hover:text-zinc-200"
                          )}
                        >
                          <span className={cn(
                            "w-4 h-4 rounded border flex items-center justify-center text-[10px] shrink-0",
                            selected
                              ? "bg-brand-600 border-brand-500 text-white"
                              : "border-zinc-600"
                          )}>
                            {selected && "\u2713"}
                          </span>
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="input-base w-48"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Listing Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card h-52 animate-pulse bg-surface-3/50" />
          ))}
        </div>
      ) : displayListings.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayListings.map((listing, i) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              matchScore={searchResults?.matches[i]?.score}
              matchReasons={searchResults?.matches[i]?.matchReasons}
              style={{ animationDelay: `${i * 50}ms` }}
              isWatched={watchedIds.has(listing.id)}
              onWatchlistToggle={handleWatchlistToggle}
            />
          ))}
        </div>
      ) : (
        <div className="card py-16 text-center">
          <p className="text-zinc-400 text-lg">No listings found.</p>
          {searchResults?.suggestions.map((s, i) => (
            <p key={i} className="text-zinc-500 text-sm mt-2">
              💡 {s}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
