// ═══════════════════════════════════════════════════════════════
// NexusX — Provider Analytics Page
// apps/web/src/app/provider/analytics/page.tsx
//
// Analytics dashboard for providers:
//   - Period selector (1h / 24h / 7d / 30d)
//   - Revenue + calls + buyers KPIs
//   - Price history chart placeholder
//   - Call volume chart placeholder
//   - Quality breakdown
// ═══════════════════════════════════════════════════════════════

"use client";

import { useState, useEffect } from "react";
import { provider } from "@/lib/api";
import {
  cn,
  formatUsdc,
  formatNumber,
  formatLatency,
  formatPercent,
} from "@/lib/utils";
import type { Listing, ProviderAnalytics, PaginatedResponse } from "@/types";

const PERIODS = [
  { value: "1h", label: "1H" },
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "all", label: "All" },
];

export default function ProviderAnalyticsPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [selectedListing, setSelectedListing] = useState<string | null>(null);
  const [period, setPeriod] = useState("7d");
  const [analytics, setAnalytics] = useState<ProviderAnalytics | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load provider listings.
  useEffect(() => {
    provider.getListings({ status: "ACTIVE" }).then((res) => {
      setListings(res.items);
      if (res.items.length > 0) setSelectedListing(res.items[0].id);
    });
  }, []);

  // Load analytics for selected listing.
  useEffect(() => {
    if (!selectedListing) return;
    setIsLoading(true);
    provider
      .getListingAnalytics(selectedListing, period)
      .then(setAnalytics)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [selectedListing, period]);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
        <p className="mt-1 text-zinc-400">Monitor performance, revenue, and quality metrics.</p>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between gap-4">
        <select
          value={selectedListing || ""}
          onChange={(e) => setSelectedListing(e.target.value)}
          className="input-base w-72"
        >
          {listings.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1 bg-surface-2 border border-surface-4 rounded-lg p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                period === p.value
                  ? "bg-brand-600/20 text-brand-300"
                  : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="stat-card h-20 animate-pulse bg-surface-3/50" />
          ))}
        </div>
      ) : analytics ? (
        <>
          {/* KPI Row */}
          <div className="grid grid-cols-5 gap-4">
            <KpiCard label="Revenue" value={formatUsdc(analytics.totalRevenueUsdc)} sub={`-${formatUsdc(analytics.platformFeesUsdc)} fees`} accent="green" />
            <KpiCard label="Net Revenue" value={formatUsdc(analytics.netRevenueUsdc)} accent="green" />
            <KpiCard label="API Calls" value={formatNumber(analytics.totalCalls)} accent="cyan" />
            <KpiCard label="Unique Buyers" value={String(analytics.uniqueBuyers)} accent="blue" />
            <KpiCard label="Avg Rating" value={analytics.avgRating.toFixed(1)} sub={`★`} accent="amber" />
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-2 gap-4">
            {/* Price History */}
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-zinc-300 mb-4">Price History</h3>
              <div className="h-48 flex items-end gap-1">
                {analytics.priceHistory.slice(-30).map((point, i) => {
                  const max = Math.max(...analytics.priceHistory.map((p) => p.price));
                  const height = max > 0 ? (point.price / max) * 100 : 0;
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center justify-end">
                      <div
                        className="w-full bg-brand-500/30 rounded-t border-t border-brand-400/50 transition-all hover:bg-brand-500/50"
                        style={{ height: `${Math.max(height, 2)}%` }}
                        title={`${formatUsdc(point.price)} — ${new Date(point.timestamp).toLocaleDateString()}`}
                      />
                    </div>
                  );
                })}
              </div>
              <p className="text-2xs text-zinc-500 mt-2">Last 30 data points</p>
            </div>

            {/* Call Volume */}
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-zinc-300 mb-4">Call Volume</h3>
              <div className="h-48 flex items-end gap-1">
                {analytics.callVolume.slice(-30).map((point, i) => {
                  const max = Math.max(...analytics.callVolume.map((p) => p.calls));
                  const height = max > 0 ? (point.calls / max) * 100 : 0;
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center justify-end">
                      <div
                        className="w-full bg-emerald-500/30 rounded-t border-t border-emerald-400/50 transition-all hover:bg-emerald-500/50"
                        style={{ height: `${Math.max(height, 2)}%` }}
                        title={`${formatNumber(point.calls)} calls — ${new Date(point.timestamp).toLocaleDateString()}`}
                      />
                    </div>
                  );
                })}
              </div>
              <p className="text-2xs text-zinc-500 mt-2">Last 30 data points</p>
            </div>
          </div>

          {/* Quality Breakdown */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-zinc-300 mb-4">Quality Metrics</h3>
            <div className="grid grid-cols-4 gap-6">
              <QualityMetric label="Avg Latency" value={formatLatency(analytics.avgLatencyMs)} bar={Math.min(analytics.avgLatencyMs / 1000, 1)} color="brand" />
              <QualityMetric label="Error Rate" value={formatPercent(analytics.errorRate)} bar={analytics.errorRate / 5} color="red" />
              <QualityMetric label="Quality Score" value={formatPercent(analytics.qualityScore * 100, 0)} bar={analytics.qualityScore} color="green" />
              <QualityMetric label="Demand Score" value={formatPercent(analytics.demandScore * 100, 0)} bar={analytics.demandScore} color="amber" />
            </div>
          </div>
        </>
      ) : (
        <div className="card py-16 text-center">
          <p className="text-zinc-400">Select a listing to view analytics.</p>
        </div>
      )}
    </div>
  );
}

// ─── Sub-Components ───

function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: "green" | "cyan" | "blue" | "amber";
}) {
  return (
    <div className="stat-card">
      <p className="text-2xs text-zinc-500 uppercase tracking-wider font-semibold">{label}</p>
      <p className="text-lg font-bold font-mono text-zinc-100 mt-1">{value}</p>
      {sub && <p className="text-2xs text-zinc-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function QualityMetric({
  label,
  value,
  bar,
  color,
}: {
  label: string;
  value: string;
  bar: number;
  color: "brand" | "green" | "red" | "amber";
}) {
  const barColor = {
    brand: "bg-brand-500",
    green: "bg-emerald-500",
    red: "bg-red-500",
    amber: "bg-amber-500",
  }[color];

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-xs text-zinc-400">{label}</p>
        <p className="text-sm font-mono font-medium text-zinc-200">{value}</p>
      </div>
      <div className="h-1.5 bg-surface-4 rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", barColor)}
          style={{ width: `${Math.min(bar * 100, 100)}%` }}
        />
      </div>
    </div>
  );
}
