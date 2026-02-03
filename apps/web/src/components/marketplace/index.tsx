// ═══════════════════════════════════════════════════════════════
// NexusX — Marketplace Components
// apps/web/src/components/marketplace/
//
// All marketplace-facing components in a single file for
// delivery. In production, split into individual files.
// ═══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────
// SearchBar.tsx
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, type FormEvent, type CSSProperties } from "react";
import Link from "next/link";
import { cn, formatPricePerCall, formatNumber, formatLatency, formatPercent, listingTypeLabel, listingTypeIcon, listingStatusColor } from "@/lib/utils";
import type { Listing, PriceTick } from "@/types";

export function SearchBar({
  onSearch,
  isSearching,
  onClear,
  hasResults,
}: {
  onSearch: (query: string) => void;
  isSearching: boolean;
  onClear: () => void;
  hasResults: boolean;
}) {
  const [query, setQuery] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSearch(query);
  };

  return (
    <form onSubmit={handleSubmit} className="relative">
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-400 text-lg">
          ⌕
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='Try: "I need a translation API under $0.005 per call with batch support"'
          className="w-full pl-12 pr-28 py-3.5 bg-surface-1 border border-surface-4 rounded-xl
                     text-sm text-zinc-100 placeholder-zinc-500
                     focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-600
                     transition-all duration-200"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
          {hasResults && (
            <button
              type="button"
              onClick={() => { setQuery(""); onClear(); }}
              className="btn-ghost text-xs"
            >
              Clear
            </button>
          )}
          <button
            type="submit"
            disabled={isSearching || !query.trim()}
            className="btn-primary text-xs px-3 py-1.5 disabled:opacity-40"
          >
            {isSearching ? (
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Routing…
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
  );
}

// ─────────────────────────────────────────────────────────────
// PriceTicker.tsx
// ─────────────────────────────────────────────────────────────

export function PriceTicker({ ticks }: { ticks: PriceTick[] }) {
  if (!ticks.length) return null;

  return (
    <div className="relative overflow-hidden rounded-lg bg-surface-1 border border-surface-4">
      <div className="flex items-center gap-6 px-4 py-2.5 animate-[scroll_30s_linear_infinite] whitespace-nowrap">
        {[...ticks, ...ticks].map((tick, i) => (
          <div key={`${tick.listingId}-${i}`} className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-zinc-400 font-medium">
              {tick.name}
            </span>
            <span className="text-xs font-mono text-zinc-200">
              {formatPricePerCall(tick.currentPrice)}
            </span>
            <span
              className={cn(
                "text-2xs font-mono",
                tick.direction === "up" && "text-accent-green",
                tick.direction === "down" && "text-accent-red",
                tick.direction === "flat" && "text-zinc-500"
              )}
            >
              {tick.direction === "up" && "▲"}
              {tick.direction === "down" && "▼"}
              {tick.direction === "flat" && "─"}
              {Math.abs(tick.changePercent).toFixed(1)}%
            </span>
            <span className="text-surface-5 mx-1">│</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ListingCard.tsx
// ─────────────────────────────────────────────────────────────

export function ListingCard({
  listing,
  matchScore,
  matchReasons,
  style,
}: {
  listing: Listing;
  matchScore?: number;
  matchReasons?: string[];
  style?: CSSProperties;
}) {
  return (
    <Link href={`/marketplace/${listing.slug}`}>
      <div
        className="card p-5 hover:border-brand-600/40 hover:bg-surface-3/50 transition-all duration-200 animate-slide-in cursor-pointer group"
        style={style}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">{listingTypeIcon(listing.listingType)}</span>
            <div>
              <h3 className="text-sm font-semibold text-zinc-100 group-hover:text-brand-300 transition-colors">
                {listing.name}
              </h3>
              <p className="text-2xs text-zinc-500">{listing.providerName}</p>
            </div>
          </div>
          {matchScore !== undefined && (
            <span className="badge bg-brand-500/15 text-brand-300">
              {Math.round(matchScore * 100)}%
            </span>
          )}
        </div>

        {/* Description */}
        <p className="text-xs text-zinc-400 line-clamp-2 mb-4">
          {listing.description}
        </p>

        {/* Tags */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          <span className="badge bg-surface-4 text-zinc-300">
            {listingTypeLabel(listing.listingType)}
          </span>
          {listing.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="badge bg-surface-4 text-zinc-400">
              {tag}
            </span>
          ))}
          {listing.tags.length > 3 && (
            <span className="badge bg-surface-4 text-zinc-500">
              +{listing.tags.length - 3}
            </span>
          )}
        </div>

        {/* Metrics Row */}
        <div className="grid grid-cols-4 gap-2 pt-3 border-t border-surface-4">
          <MetricCell label="Price" value={formatPricePerCall(listing.currentPriceUsdc)} highlight />
          <MetricCell label="Quality" value={formatPercent(listing.qualityScore * 100, 0)} />
          <MetricCell label="Latency" value={formatLatency(listing.avgLatencyMs)} />
          <MetricCell label="Calls" value={formatNumber(listing.totalCalls)} />
        </div>

        {/* Match Reasons */}
        {matchReasons && matchReasons.length > 0 && (
          <div className="mt-3 pt-3 border-t border-surface-4 space-y-1">
            {matchReasons.slice(0, 2).map((reason, i) => (
              <p key={i} className="text-2xs text-brand-300/80 flex items-center gap-1">
                <span>✓</span> {reason}
              </p>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

function MetricCell({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="text-center">
      <p
        className={cn(
          "text-xs font-mono font-medium",
          highlight ? "text-brand-300" : "text-zinc-200"
        )}
      >
        {value}
      </p>
      <p className="text-2xs text-zinc-500 mt-0.5">{label}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// CategoryFilter.tsx
// ─────────────────────────────────────────────────────────────

export function CategoryFilter({
  categories,
  active,
  onChange,
}: {
  categories: { slug: string; name: string }[];
  active: string;
  onChange: (slug: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
      {categories.map((cat) => (
        <button
          key={cat.slug}
          onClick={() => onChange(cat.slug)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 whitespace-nowrap",
            active === cat.slug
              ? "bg-brand-600/20 text-brand-300 border border-brand-600/30"
              : "bg-surface-3 text-zinc-400 border border-transparent hover:text-zinc-200"
          )}
        >
          {cat.name}
        </button>
      ))}
    </div>
  );
}
