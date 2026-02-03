// ═══════════════════════════════════════════════════════════════
// NexusX — Provider Listings Dashboard
// apps/web/src/app/provider/listings/page.tsx
//
// Provider's listing management view:
//   - Revenue + call stats
//   - Status filter tabs
//   - Listing table with actions
//   - Create listing CTA
// ═══════════════════════════════════════════════════════════════

"use client";

import { useState, useEffect, useCallback } from "react";
import { provider } from "@/lib/api";
import {
  cn,
  formatUsdc,
  formatNumber,
  formatPricePerCall,
  formatPercent,
  listingStatusColor,
  listingTypeLabel,
  relativeTime,
} from "@/lib/utils";
import type { Listing, ProviderProfile, PaginatedResponse } from "@/types";

const STATUS_TABS = ["all", "ACTIVE", "DRAFT", "PAUSED", "PENDING_REVIEW", "DEPRECATED"];

export default function ProviderListingsPage() {
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [p, l] = await Promise.all([
        provider.getProfile(),
        provider.getListings({
          status: statusFilter === "all" ? undefined : statusFilter,
        }),
      ]);
      setProfile(p);
      setListings(l.items);
    } catch (err) {
      console.error("Failed to load provider data:", err);
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Listings</h1>
          <p className="mt-1 text-zinc-400">Manage your APIs and datasets on the marketplace.</p>
        </div>
        <button className="btn-primary flex items-center gap-2">
          <span>+</span> New Listing
        </button>
      </div>

      {/* Stats */}
      {profile && (
        <div className="grid grid-cols-4 gap-4">
          <StatCard label="Total Revenue" value={formatUsdc(profile.totalRevenue)} accent="green" />
          <StatCard label="Pending Balance" value={formatUsdc(profile.pendingBalance)} accent="amber" />
          <StatCard label="Total Payouts" value={formatUsdc(profile.totalPayouts)} accent="blue" />
          <StatCard label="Active Listings" value={String(profile.listingCount)} accent="cyan" />
        </div>
      )}

      {/* Status Tabs */}
      <div className="flex items-center gap-1.5 border-b border-surface-4 pb-px">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setStatusFilter(tab)}
            className={cn(
              "px-3 py-2 text-xs font-medium transition-all duration-150 border-b-2",
              statusFilter === tab
                ? "border-brand-400 text-brand-300"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            )}
          >
            {tab === "all" ? "All" : tab.replace("_", " ")}
          </button>
        ))}
      </div>

      {/* Listing Table */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card h-16 animate-pulse bg-surface-3/50" />
          ))}
        </div>
      ) : listings.length > 0 ? (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-surface-4 text-left">
                <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider">Listing</th>
                <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider">Type</th>
                <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider text-right">Price</th>
                <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider text-right">Calls</th>
                <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider text-right">Revenue</th>
                <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider text-right">Quality</th>
                <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider text-right">Updated</th>
              </tr>
            </thead>
            <tbody>
              {listings.map((listing) => (
                <tr
                  key={listing.id}
                  className="border-b border-surface-4/50 hover:bg-surface-3/30 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-zinc-100">{listing.name}</p>
                      <p className="text-2xs text-zinc-500 font-mono">{listing.slug}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-zinc-400">{listingTypeLabel(listing.listingType)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("badge", listingStatusColor(listing.status))}>
                      {listing.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm font-mono text-brand-300">
                      {formatPricePerCall(listing.currentPriceUsdc)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm font-mono text-zinc-300">
                      {formatNumber(listing.totalCalls)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm font-mono text-accent-green">
                      {formatUsdc(listing.totalRevenue)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm font-mono text-zinc-300">
                      {formatPercent(listing.qualityScore * 100, 0)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-xs text-zinc-500">
                      {relativeTime(listing.createdAt)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card py-16 text-center">
          <p className="text-zinc-400 text-lg">No listings yet.</p>
          <p className="text-zinc-500 text-sm mt-2">Create your first listing to start earning USDC.</p>
        </div>
      )}
    </div>
  );
}

// ─── Stat Card ───

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: "green" | "amber" | "blue" | "cyan";
}) {
  const accentColor = {
    green: "from-emerald-500/10",
    amber: "from-amber-500/10",
    blue: "from-blue-500/10",
    cyan: "from-brand-500/10",
  }[accent];

  return (
    <div className="stat-card">
      <div className={cn("absolute inset-0 bg-gradient-to-br to-transparent pointer-events-none", accentColor)} />
      <p className="text-2xs text-zinc-500 uppercase tracking-wider font-semibold relative">{label}</p>
      <p className="text-xl font-bold font-mono text-zinc-100 mt-1 relative">{value}</p>
    </div>
  );
}
