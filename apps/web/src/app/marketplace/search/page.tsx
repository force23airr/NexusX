// ═══════════════════════════════════════════════════════════════
// NexusX — Marketplace AI Search Page
// apps/web/src/app/marketplace/search/page.tsx
//
// Dedicated AI-powered search experience:
//   - Prominent natural language search bar
//   - AI Router result metadata (confidence, timing, intent)
//   - Ranked listing results with match scores
//   - Recent/suggested searches
// ═══════════════════════════════════════════════════════════════

"use client";

import { useState } from "react";
import { marketplace } from "@/lib/api";
import { ListingCard } from "@/components/marketplace/ListingCard";
import { cn, formatNumber } from "@/lib/utils";
import type { RouteResult } from "@/types";

const EXAMPLE_QUERIES = [
  "Translation API under $0.005 per call with batch support",
  "High-quality embeddings model with low latency",
  "Sentiment analysis for social media posts",
  "GPT-4 level language model with streaming",
  "Object detection API for real-time video",
  "Large dataset for training NLP models",
];

export default function MarketplaceSearchPage() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<RouteResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = async (searchQuery: string) => {
    const q = searchQuery.trim();
    if (!q) return;
    setQuery(q);
    setIsSearching(true);
    setHasSearched(true);
    try {
      const res = await marketplace.search(q);
      setResult(res);
    } catch (err) {
      console.error("Search failed:", err);
      setResult(null);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSearch(query);
  };

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="text-center pt-4">
        <h1 className="text-3xl font-bold tracking-tight">
          AI-Powered Search
        </h1>
        <p className="mt-2 text-zinc-400 max-w-lg mx-auto">
          Describe what you need in natural language. The NexusX AI Router understands intent,
          budget constraints, and capability requirements.
        </p>
      </div>

      {/* Search Input */}
      <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-400 text-lg">
            ⌕
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Describe what you need...'
            className="w-full pl-12 pr-28 py-4 bg-surface-1 border border-surface-4 rounded-xl
                       text-sm text-zinc-100 placeholder-zinc-500
                       focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-600
                       transition-all duration-200"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
            {result && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setResult(null);
                  setHasSearched(false);
                }}
                className="btn-ghost text-xs"
              >
                Clear
              </button>
            )}
            <button
              type="submit"
              disabled={isSearching || !query.trim()}
              className="btn-primary text-xs px-4 py-2 disabled:opacity-40"
            >
              {isSearching ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Routing...
                </span>
              ) : (
                "Search"
              )}
            </button>
          </div>
        </div>
        <p className="mt-1.5 text-2xs text-zinc-600 pl-4">
          Powered by NexusX AI Router — understands intent, budget, and capability requirements.
        </p>
      </form>

      {/* Example Queries (before search) */}
      {!hasSearched && (
        <div className="max-w-3xl mx-auto">
          <p className="text-xs text-zinc-500 uppercase tracking-wider font-semibold mb-3">
            Try these queries
          </p>
          <div className="grid grid-cols-2 gap-2">
            {EXAMPLE_QUERIES.map((eq) => (
              <button
                key={eq}
                onClick={() => {
                  setQuery(eq);
                  handleSearch(eq);
                }}
                className="text-left px-4 py-3 rounded-lg bg-surface-2 border border-surface-4
                           text-sm text-zinc-400 hover:text-zinc-200 hover:border-brand-600/30
                           transition-all duration-150"
              >
                &quot;{eq}&quot;
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading */}
      {isSearching && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card h-52 animate-pulse bg-surface-3/50" />
          ))}
        </div>
      )}

      {/* Results */}
      {result && !isSearching && (
        <>
          {/* Result Metadata */}
          <div className="card px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-brand-400 text-sm font-medium">
                AI Router
              </span>
              <span className="text-zinc-400 text-sm">
                {result.matches.length} matches from{" "}
                {result.totalEvaluated} listings in{" "}
                {result.routeTimeMs}ms
              </span>
              <span className="badge bg-brand-500/15 text-brand-300">
                {result.intent.category}
              </span>
              <span className="text-zinc-500 text-xs">
                {Math.round(result.intent.confidence * 100)}% confidence
              </span>
            </div>
          </div>

          {/* Matched Listings */}
          {result.matches.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {result.matches.map((match, i) => (
                <ListingCard
                  key={match.listing.id}
                  listing={match.listing}
                  matchScore={match.score}
                  matchReasons={match.matchReasons}
                  style={{ animationDelay: `${i * 50}ms` }}
                />
              ))}
            </div>
          ) : (
            <div className="card py-16 text-center">
              <p className="text-zinc-400 text-lg">No matches found.</p>
              {result.suggestions.map((s, i) => (
                <p key={i} className="text-zinc-500 text-sm mt-2">
                  Try: &quot;{s}&quot;
                </p>
              ))}
            </div>
          )}

          {/* Score Breakdown (for top result) */}
          {result.matches.length > 0 && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-zinc-300 mb-4">
                Top Match Score Breakdown
              </h3>
              <div className="grid grid-cols-7 gap-4">
                {Object.entries(result.matches[0].scoreBreakdown).map(([key, value]) => (
                  <div key={key} className="text-center">
                    <div className="h-20 flex items-end justify-center mb-2">
                      <div
                        className="w-8 bg-brand-500/30 rounded-t border-t border-brand-400/50"
                        style={{ height: `${Math.max(Number(value) * 100, 4)}%` }}
                      />
                    </div>
                    <p className="text-xs font-mono text-zinc-200">
                      {(Number(value) * 100).toFixed(0)}%
                    </p>
                    <p className="text-2xs text-zinc-500 mt-0.5">
                      {key.replace(/([A-Z])/g, " $1").trim()}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* No results after search */}
      {hasSearched && !isSearching && !result && (
        <div className="card py-16 text-center">
          <p className="text-zinc-400 text-lg">Search failed.</p>
          <p className="text-zinc-500 text-sm mt-2">
            Please try again with a different query.
          </p>
        </div>
      )}
    </div>
  );
}
