// ═══════════════════════════════════════════════════════════════
// NexusX — Provider Analytics + Activity Log
// apps/web/src/app/provider/analytics/page.tsx
//
// Two sections:
//   1. Live Activity Log — real-time feed of API calls
//   2. Per-Listing Analytics — charts, KPIs, quality metrics
// ═══════════════════════════════════════════════════════════════

"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { provider } from "@/lib/api";
import {
  cn,
  formatUsdc,
  formatNumber,
  formatLatency,
  formatPercent,
  formatPricePerCall,
  listingTypeIcon,
  relativeTime,
} from "@/lib/utils";
import type {
  Listing,
  ProviderAnalytics,
  ActivityEntry,
} from "@/types";

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
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [activityFilter, setActivityFilter] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [activityLoading, setActivityLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // Load provider listings
  useEffect(() => {
    provider.getListings({ status: "ACTIVE" }).then((res) => {
      setListings(res.items);
      if (res.items.length > 0) setSelectedListing(res.items[0].id);
    });
  }, []);

  // Load analytics for selected listing
  useEffect(() => {
    if (!selectedListing) return;
    setIsLoading(true);
    provider
      .getListingAnalytics(selectedListing, period)
      .then(setAnalytics)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [selectedListing, period]);

  // Load activity log + auto-refresh every 10s
  const loadActivity = useCallback(async () => {
    try {
      const res = await provider.getActivity({
        listingId: activityFilter === "all" ? undefined : activityFilter,
        limit: 50,
      });
      setActivity(res.items);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Failed to load activity:", err);
    } finally {
      setActivityLoading(false);
    }
  }, [activityFilter]);

  useEffect(() => {
    loadActivity();
    const interval = setInterval(loadActivity, 10_000);
    return () => clearInterval(interval);
  }, [loadActivity]);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* ─── Header ─── */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
        <p className="mt-1 text-zinc-400">
          Live activity feed and performance metrics for your APIs.
        </p>
      </div>

      {/* ════════════════════════════════════════════════════════════
          SECTION 1: LIVE ACTIVITY LOG
          ════════════════════════════════════════════════════════════ */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-zinc-200">
              Activity Log
            </h2>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            {lastRefresh && (
              <span className="text-2xs text-zinc-600">
                updated {lastRefresh.toLocaleTimeString()}
              </span>
            )}
          </div>
          {/* Filter by listing */}
          <select
            value={activityFilter}
            onChange={(e) => setActivityFilter(e.target.value)}
            className="input-base w-56 text-xs"
          >
            <option value="all">All Listings</option>
            {listings.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>

        {activityLoading ? (
          <div className="card p-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-10 bg-surface-3/50 rounded animate-pulse"
              />
            ))}
          </div>
        ) : activity.length > 0 ? (
          <div className="card overflow-hidden">
            <div className="max-h-[420px] overflow-y-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-surface-2 z-10">
                  <tr className="border-b border-surface-4 text-left">
                    <th className="px-4 py-2.5 text-2xs font-semibold text-zinc-500 uppercase tracking-wider">
                      Time
                    </th>
                    <th className="px-4 py-2.5 text-2xs font-semibold text-zinc-500 uppercase tracking-wider">
                      Agent
                    </th>
                    <th className="px-4 py-2.5 text-2xs font-semibold text-zinc-500 uppercase tracking-wider">
                      API
                    </th>
                    <th className="px-4 py-2.5 text-2xs font-semibold text-zinc-500 uppercase tracking-wider text-right">
                      Status
                    </th>
                    <th className="px-4 py-2.5 text-2xs font-semibold text-zinc-500 uppercase tracking-wider text-right">
                      Latency
                    </th>
                    <th className="px-4 py-2.5 text-2xs font-semibold text-zinc-500 uppercase tracking-wider text-right">
                      Earned
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {activity.map((entry) => (
                    <ActivityRow key={entry.id} entry={entry} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="card py-12 text-center">
            <p className="text-zinc-500">
              No activity yet. Calls to your APIs will appear here in real time.
            </p>
          </div>
        )}
      </section>

      {/* ════════════════════════════════════════════════════════════
          SECTION 2: PER-LISTING ANALYTICS
          ════════════════════════════════════════════════════════════ */}
      <section className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-zinc-200">
            Listing Analytics
          </h2>
          <div className="flex items-center gap-3">
            <select
              value={selectedListing || ""}
              onChange={(e) => setSelectedListing(e.target.value)}
              className="input-base w-56"
            >
              {listings.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-0.5 bg-surface-2 border border-surface-4 rounded-lg p-0.5">
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
        </div>

        {isLoading ? (
          <div className="grid grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="stat-card h-20 animate-pulse bg-surface-3/50"
              />
            ))}
          </div>
        ) : analytics ? (
          <>
            {/* KPI Row */}
            <div className="grid grid-cols-5 gap-4">
              <KpiCard
                label="Revenue"
                value={formatUsdc(analytics.totalRevenueUsdc)}
                sub={`-${formatUsdc(analytics.platformFeesUsdc)} fees`}
              />
              <KpiCard
                label="Net Revenue"
                value={formatUsdc(analytics.netRevenueUsdc)}
              />
              <KpiCard
                label="API Calls"
                value={formatNumber(analytics.totalCalls)}
              />
              <KpiCard
                label="Unique Buyers"
                value={String(analytics.uniqueBuyers)}
              />
              <KpiCard
                label="Avg Rating"
                value={analytics.avgRating.toFixed(1)}
                sub="★"
              />
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-2 gap-4">
              {/* Price History */}
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-zinc-300 mb-4">
                  Price History
                </h3>
                <div className="h-48 flex items-end gap-1">
                  {analytics.priceHistory.slice(-30).map((point, i) => {
                    const max = Math.max(
                      ...analytics.priceHistory.map((p) => p.price)
                    );
                    const height = max > 0 ? (point.price / max) * 100 : 0;
                    return (
                      <div
                        key={i}
                        className="flex-1 flex flex-col items-center justify-end"
                      >
                        <div
                          className="w-full bg-brand-500/30 rounded-t border-t border-brand-400/50 transition-all hover:bg-brand-500/50"
                          style={{
                            height: `${Math.max(height, 2)}%`,
                          }}
                          title={`${formatUsdc(point.price)} — ${new Date(point.timestamp).toLocaleDateString()}`}
                        />
                      </div>
                    );
                  })}
                </div>
                <p className="text-2xs text-zinc-500 mt-2">
                  Last 30 data points
                </p>
              </div>

              {/* Call Volume */}
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-zinc-300 mb-4">
                  Call Volume
                </h3>
                <div className="h-48 flex items-end gap-1">
                  {analytics.callVolume.slice(-30).map((point, i) => {
                    const max = Math.max(
                      ...analytics.callVolume.map((p) => p.calls)
                    );
                    const height = max > 0 ? (point.calls / max) * 100 : 0;
                    return (
                      <div
                        key={i}
                        className="flex-1 flex flex-col items-center justify-end"
                      >
                        <div
                          className="w-full bg-emerald-500/30 rounded-t border-t border-emerald-400/50 transition-all hover:bg-emerald-500/50"
                          style={{
                            height: `${Math.max(height, 2)}%`,
                          }}
                          title={`${formatNumber(point.calls)} calls — ${new Date(point.timestamp).toLocaleDateString()}`}
                        />
                      </div>
                    );
                  })}
                </div>
                <p className="text-2xs text-zinc-500 mt-2">
                  Last 30 data points
                </p>
              </div>
            </div>

            {/* Quality Breakdown */}
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-zinc-300 mb-4">
                Quality Metrics
              </h3>
              <div className="grid grid-cols-4 gap-6">
                <QualityMetric
                  label="Avg Latency"
                  value={formatLatency(analytics.avgLatencyMs)}
                  bar={Math.min(analytics.avgLatencyMs / 1000, 1)}
                  color="brand"
                />
                <QualityMetric
                  label="Error Rate"
                  value={formatPercent(analytics.errorRate)}
                  bar={analytics.errorRate / 5}
                  color="red"
                />
                <QualityMetric
                  label="Quality Score"
                  value={formatPercent(analytics.qualityScore * 100, 0)}
                  bar={analytics.qualityScore}
                  color="green"
                />
                <QualityMetric
                  label="Demand Score"
                  value={formatPercent(analytics.demandScore * 100, 0)}
                  bar={analytics.demandScore}
                  color="amber"
                />
              </div>
            </div>
          </>
        ) : (
          <div className="card py-16 text-center">
            <p className="text-zinc-400">
              Select a listing to view analytics.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-Components
// ─────────────────────────────────────────────────────────────

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const statusColor =
    entry.status === "CONFIRMED"
      ? "text-emerald-400"
      : entry.status === "FAILED"
        ? "text-red-400"
        : "text-amber-400";

  const httpColor =
    entry.httpStatus < 300
      ? "text-emerald-400"
      : entry.httpStatus < 500
        ? "text-amber-400"
        : "text-red-400";

  return (
    <tr className="border-b border-surface-4/50 hover:bg-surface-3/30 transition-colors text-sm">
      <td className="px-4 py-2.5">
        <span className="text-xs text-zinc-500" title={entry.createdAt}>
          {relativeTime(entry.createdAt)}
        </span>
      </td>
      <td className="px-4 py-2.5">
        <span className="text-xs text-zinc-300">{entry.buyerName}</span>
      </td>
      <td className="px-4 py-2.5">
        <Link
          href={`/provider/listings/${entry.listingId}`}
          className="flex items-center gap-1.5 group"
        >
          <span className="text-sm">
            {listingTypeIcon(entry.listingType)}
          </span>
          <span className="text-xs text-zinc-300 group-hover:text-brand-300 transition-colors">
            {entry.listingName}
          </span>
          {entry.billingMode === "BUNDLE_STEP" && (
            <span className="badge bg-brand-500/15 text-brand-300 text-2xs">
              bundle
            </span>
          )}
        </Link>
      </td>
      <td className="px-4 py-2.5 text-right">
        <span className={cn("text-xs font-mono", httpColor)}>
          {entry.httpStatus}
        </span>
        <span className={cn("text-2xs ml-1.5", statusColor)}>
          {entry.status === "CONFIRMED" ? "OK" : entry.status}
        </span>
      </td>
      <td className="px-4 py-2.5 text-right">
        <span className="text-xs font-mono text-zinc-300">
          {formatLatency(entry.latencyMs)}
        </span>
      </td>
      <td className="px-4 py-2.5 text-right">
        <span className="text-xs font-mono text-accent-green">
          {formatPricePerCall(entry.providerAmountUsdc)}
        </span>
      </td>
    </tr>
  );
}

function KpiCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="stat-card">
      <p className="text-2xs text-zinc-500 uppercase tracking-wider font-semibold">
        {label}
      </p>
      <p className="text-lg font-bold font-mono text-zinc-100 mt-1">
        {value}
      </p>
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
          className={cn(
            "h-full rounded-full transition-all duration-500",
            barColor
          )}
          style={{ width: `${Math.min(bar * 100, 100)}%` }}
        />
      </div>
    </div>
  );
}
