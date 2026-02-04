// ═══════════════════════════════════════════════════════════════
// NexusX — Buyer Subscriptions Page
// apps/web/src/app/buyer/subscriptions/page.tsx
//
// Manage API subscriptions:
//   - View active/paused/cancelled subscriptions
//   - Monitor budget usage
//   - Track call volume
// ═══════════════════════════════════════════════════════════════

"use client";

import { useState, useEffect, useCallback } from "react";
import { buyer } from "@/lib/api";
import { cn, formatUsdc, formatNumber, relativeTime } from "@/lib/utils";

type Subscription = {
  id: string;
  listingId: string;
  listingName: string;
  status: string;
  monthlyBudget: number | null;
  spentThisMonth: number;
  totalCalls: number;
  startedAt: string;
  pausedAt: string | null;
  cancelledAt: string | null;
};

const STATUS_TABS = ["all", "ACTIVE", "PAUSED", "CANCELLED"];

export default function BuyerSubscriptionsPage() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await buyer.getSubscriptions();
      setSubscriptions(data as Subscription[]);
    } catch (err) {
      console.error("Failed to load subscriptions:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered =
    statusFilter === "all"
      ? subscriptions
      : subscriptions.filter((s) => s.status === statusFilter);

  const activeSubs = subscriptions.filter((s) => s.status === "ACTIVE");
  const totalSpendThisMonth = subscriptions.reduce((sum, s) => sum + s.spentThisMonth, 0);
  const totalCalls = subscriptions.reduce((sum, s) => sum + s.totalCalls, 0);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Subscriptions</h1>
        <p className="mt-1 text-zinc-400">Monitor your API subscriptions and usage.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Active Subscriptions" value={String(activeSubs.length)} accent="green" />
        <StatCard label="Spend This Month" value={formatUsdc(totalSpendThisMonth)} accent="amber" />
        <StatCard label="Total API Calls" value={formatNumber(totalCalls)} accent="cyan" />
      </div>

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
            {tab === "all" ? "All" : tab}
          </button>
        ))}
      </div>

      {/* Subscriptions Table */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card h-16 animate-pulse bg-surface-3/50" />
          ))}
        </div>
      ) : filtered.length > 0 ? (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-surface-4 text-left">
                <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider">Listing</th>
                <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider text-right">Monthly Budget</th>
                <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider">Spent This Month</th>
                <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider text-right">Total Calls</th>
                <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider text-right">Started</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((sub) => {
                const budgetPercent =
                  sub.monthlyBudget && sub.monthlyBudget > 0
                    ? Math.min((sub.spentThisMonth / sub.monthlyBudget) * 100, 100)
                    : 0;

                return (
                  <tr
                    key={sub.id}
                    className="border-b border-surface-4/50 hover:bg-surface-3/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium text-zinc-100">{sub.listingName}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("badge", subscriptionStatusColor(sub.status))}>
                        {sub.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-sm font-mono text-zinc-300">
                        {sub.monthlyBudget ? formatUsdc(sub.monthlyBudget) : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-1.5 bg-surface-4 rounded-full overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              budgetPercent >= 90
                                ? "bg-red-500"
                                : budgetPercent >= 70
                                  ? "bg-amber-500"
                                  : "bg-emerald-500"
                            )}
                            style={{ width: `${budgetPercent}%` }}
                          />
                        </div>
                        <span className="text-sm font-mono text-zinc-300 min-w-[60px] text-right">
                          {formatUsdc(sub.spentThisMonth)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-sm font-mono text-zinc-300">
                        {formatNumber(sub.totalCalls)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-xs text-zinc-500">
                        {relativeTime(sub.startedAt)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card py-16 text-center">
          <p className="text-zinc-400 text-lg">No subscriptions found.</p>
          <p className="text-zinc-500 text-sm mt-2">
            {statusFilter === "all"
              ? "Subscribe to APIs on the marketplace to get started."
              : `No ${statusFilter.toLowerCase()} subscriptions.`}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ───

function subscriptionStatusColor(status: string): string {
  const map: Record<string, string> = {
    ACTIVE: "bg-emerald-500/15 text-emerald-400",
    PAUSED: "bg-blue-500/15 text-blue-400",
    CANCELLED: "bg-red-500/15 text-red-400",
    EXPIRED: "bg-zinc-500/15 text-zinc-400",
  };
  return map[status] || "bg-zinc-500/15 text-zinc-400";
}

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
