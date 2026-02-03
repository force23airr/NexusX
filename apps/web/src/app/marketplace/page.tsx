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
import { marketplace } from "@/lib/api";
import { SearchBar } from "@/components/marketplace/SearchBar";
import { PriceTicker } from "@/components/marketplace/PriceTicker";
import { ListingCard } from "@/components/marketplace/ListingCard";
import { CategoryFilter } from "@/components/marketplace/CategoryFilter";
import type { Listing, PriceTick, RouteResult, PaginatedResponse } from "@/types";

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

export default function MarketplacePage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [priceTicks, setPriceTicks] = useState<PriceTick[]>([]);
  const [searchResults, setSearchResults] = useState<RouteResult | null>(null);
  const [activeCategory, setActiveCategory] = useState("all");
  const [sortBy, setSortBy] = useState("popular");
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);

  // ─── Load Listings ───
  const loadListings = useCallback(async () => {
    setIsLoading(true);
    try {
      const res: PaginatedResponse<Listing> = await marketplace.browse({
        category: activeCategory === "all" ? undefined : activeCategory,
        sort: sortBy,
        pageSize: 20,
      });
      setListings(res.items);
    } catch (err) {
      console.error("Failed to load listings:", err);
    } finally {
      setIsLoading(false);
    }
  }, [activeCategory, sortBy]);

  // ─── Load Price Ticker ───
  const loadPriceTicker = useCallback(async () => {
    try {
      const ticks = await marketplace.getPriceTicker();
      setPriceTicks(ticks);
    } catch (err) {
      console.error("Failed to load price ticker:", err);
    }
  }, []);

  useEffect(() => {
    loadListings();
    loadPriceTicker();
    const tickerInterval = setInterval(loadPriceTicker, 15_000);
    return () => clearInterval(tickerInterval);
  }, [loadListings, loadPriceTicker]);

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
