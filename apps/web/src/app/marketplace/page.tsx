// ═══════════════════════════════════════════════════════════════
// NexusX — Market Dashboard
// apps/web/src/app/marketplace/page.tsx
//
// Live market view:
//   - Platform KPI cards (calls, revenue, agents, quality)
//   - Price ticker strip
//   - Top 5 APIs by volume (horizontal row)
//   - Top categories with listing grids
//   - 30-second auto-refresh
// ═══════════════════════════════════════════════════════════════

"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { marketplace } from "@/lib/api";
import {
  cn,
  formatUsdc,
  formatNumber,
  formatPricePerCall,
  formatLatency,
  formatPercent,
  listingTypeIcon,
} from "@/lib/utils";
import { PriceTicker } from "@/components/marketplace";
import { usePriceTicker } from "@/hooks/usePriceTicker";
import type { MarketActivity, MarketListing } from "@/types";

export default function MarketplacePage() {
  const [data, setData] = useState<MarketActivity | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const priceTicks = usePriceTicker();

  const loadData = useCallback(async () => {
    try {
      const stats = await marketplace.getStats();
      setData(stats);
      setLastUpdated(new Date());
    } catch (err) {
      console.error("Failed to load market data:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30_000);
    return () => clearInterval(interval);
  }, [loadData]);

  // ─── Loading skeleton ───
  if (isLoading) {
    return (
      <div className="space-y-8 animate-fade-in">
        <div className="h-8 w-48 bg-surface-3/50 rounded animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card h-24 animate-pulse bg-surface-3/50" />
          ))}
        </div>
        <div className="h-12 bg-surface-3/50 rounded animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card h-56 animate-pulse bg-surface-3/50" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-8 animate-fade-in">
      {/* ─── Header ─── */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Market</h1>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span>
            Live
            {lastUpdated && (
              <> &mdash; updated {lastUpdated.toLocaleTimeString()}</>
            )}
          </span>
        </div>
      </div>

      {/* ─── Platform KPIs ─── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Total API Calls"
          value={formatNumber(data.totalCalls)}
        />
        <KpiCard
          label="Revenue (USDC)"
          value={formatUsdc(data.totalRevenueUsdc)}
        />
        <KpiCard
          label="Active Agents"
          value={formatNumber(data.activeBuyers)}
        />
        <KpiCard
          label="Avg Quality Score"
          value={formatPercent(data.avgQualityScore, 1)}
        />
      </div>

      {/* ─── Price Ticker ─── */}
      <PriceTicker ticks={priceTicks} />

      {/* ─── Top 5 APIs ─── */}
      <section>
        <h2 className="text-lg font-semibold mb-4 text-zinc-200">
          Top APIs by Volume
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {data.topListings.map((listing, i) => (
            <TopListingCard key={listing.id} listing={listing} rank={i + 1} />
          ))}
        </div>
      </section>

      {/* ─── By Category ─── */}
      <section className="space-y-6">
        <h2 className="text-lg font-semibold text-zinc-200">By Category</h2>
        {data.topCategories.map((cat) => (
          <div key={cat.slug} className="card p-5">
            {/* Category header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-semibold text-zinc-100">
                  {cat.name}
                </h3>
                <span className="badge bg-surface-4 text-zinc-400">
                  {cat.listingCount} listing{cat.listingCount !== 1 && "s"}
                </span>
              </div>
              <div className="flex items-center gap-4 text-xs text-zinc-500">
                <span>{formatNumber(cat.totalCalls)} calls</span>
                <span>{formatUsdc(cat.totalRevenue)}</span>
              </div>
            </div>

            {/* Category listings grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {cat.listings.map((listing) => (
                <CompactListingCard key={listing.id} listing={listing} />
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card px-4 py-4">
      <p className="text-2xs text-zinc-500 uppercase tracking-wider mb-1">
        {label}
      </p>
      <p className="text-xl font-bold font-mono text-zinc-100">{value}</p>
    </div>
  );
}

function TopListingCard({
  listing,
  rank,
}: {
  listing: MarketListing;
  rank: number;
}) {
  return (
    <Link href={`/marketplace/${listing.slug}`}>
      <div className="card p-4 hover:border-brand-600/40 hover:bg-surface-3/50 transition-all duration-200 cursor-pointer group relative">
        {/* Rank badge */}
        <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-brand-600/20 text-brand-300 text-2xs font-bold flex items-center justify-center">
          #{rank}
        </span>

        {/* Header */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">
            {listingTypeIcon(listing.listingType)}
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-zinc-100 group-hover:text-brand-300 transition-colors truncate">
              {listing.name}
            </h3>
            <p className="text-2xs text-zinc-500 truncate">
              {listing.providerName}
            </p>
          </div>
        </div>

        {/* Metrics */}
        <div className="space-y-1.5 text-xs">
          <MetricRow
            label="Calls"
            value={formatNumber(listing.totalCalls)}
          />
          <MetricRow
            label="Revenue"
            value={formatUsdc(listing.totalRevenue)}
          />
          <MetricRow
            label="Latency"
            value={formatLatency(listing.avgLatencyMs)}
          />
          <MetricRow
            label="Quality"
            value={formatPercent(listing.qualityScore, 1)}
          />
          <MetricRow
            label="Price"
            value={formatPricePerCall(listing.currentPriceUsdc)}
            highlight
          />
        </div>
      </div>
    </Link>
  );
}

function CompactListingCard({ listing }: { listing: MarketListing }) {
  return (
    <Link href={`/marketplace/${listing.slug}`}>
      <div className="px-3 py-3 rounded-lg bg-surface-2 border border-surface-4 hover:border-brand-600/30 hover:bg-surface-3/50 transition-all duration-150 cursor-pointer group">
        {/* Name row */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm">
            {listingTypeIcon(listing.listingType)}
          </span>
          <div className="min-w-0 flex-1">
            <h4 className="text-xs font-semibold text-zinc-200 group-hover:text-brand-300 transition-colors truncate">
              {listing.name}
            </h4>
            <p className="text-2xs text-zinc-500 truncate">
              {listing.providerName}
            </p>
          </div>
        </div>

        {/* Mini metrics */}
        <div className="grid grid-cols-4 gap-1 text-center">
          <MiniMetric
            label="Calls"
            value={formatNumber(listing.totalCalls)}
          />
          <MiniMetric
            label="Latency"
            value={formatLatency(listing.avgLatencyMs)}
          />
          <MiniMetric
            label="Quality"
            value={formatPercent(listing.qualityScore, 0)}
          />
          <MiniMetric
            label="Price"
            value={formatPricePerCall(listing.currentPriceUsdc)}
            highlight
          />
        </div>
      </div>
    </Link>
  );
}

function MetricRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-zinc-500">{label}</span>
      <span
        className={cn(
          "font-mono font-medium",
          highlight ? "text-brand-300" : "text-zinc-200"
        )}
      >
        {value}
      </span>
    </div>
  );
}

function MiniMetric({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <p
        className={cn(
          "text-2xs font-mono font-medium",
          highlight ? "text-brand-300" : "text-zinc-200"
        )}
      >
        {value}
      </p>
      <p className="text-2xs text-zinc-600">{label}</p>
    </div>
  );
}
