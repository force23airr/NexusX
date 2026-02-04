// ═══════════════════════════════════════════════════════════════
// NexusX — Provider Payouts Page
// apps/web/src/app/provider/payouts/page.tsx
//
// Provider payout management:
//   - View payout history
//   - Request new payouts
//   - Track on-chain transactions
// ═══════════════════════════════════════════════════════════════

"use client";

import { useState, useEffect, useCallback } from "react";
import { provider } from "@/lib/api";
import { cn, formatUsdc, relativeTime } from "@/lib/utils";
import type { ProviderProfile } from "@/types";

type Payout = {
  id: string;
  amountUsdc: number;
  status: string;
  destinationAddr: string;
  txHash: string | null;
  chainId: number;
  initiatedAt: string;
  completedAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
};

export default function ProviderPayoutsPage() {
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState("");
  const [isRequesting, setIsRequesting] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [p, payoutData] = await Promise.all([
        provider.getProfile(),
        provider.getPayouts(),
      ]);
      setProfile(p);
      setPayouts(payoutData.items as Payout[]);
    } catch (err) {
      console.error("Failed to load payout data:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRequestPayout = async () => {
    const amount = parseFloat(payoutAmount);
    if (isNaN(amount) || amount <= 0) return;
    setIsRequesting(true);
    try {
      await provider.requestPayout(amount);
      setShowPayoutModal(false);
      setPayoutAmount("");
      await load();
    } catch (err) {
      console.error("Failed to request payout:", err);
    } finally {
      setIsRequesting(false);
    }
  };

  const totalPaidOut = payouts
    .filter((p) => p.status === "COMPLETED")
    .reduce((sum, p) => sum + p.amountUsdc, 0);

  const lastPayout = payouts.find((p) => p.status === "COMPLETED");

  const truncateAddress = (addr: string) =>
    addr.length > 12 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;

  const basescanUrl = (txHash: string, chainId: number) =>
    chainId === 8453
      ? `https://basescan.org/tx/${txHash}`
      : `https://goerli.basescan.org/tx/${txHash}`;

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Payouts</h1>
          <p className="mt-1 text-zinc-400">Manage your earnings and withdrawal history.</p>
        </div>
        <button
          className="btn-primary flex items-center gap-2"
          onClick={() => setShowPayoutModal(true)}
        >
          <span>↗</span> Request Payout
        </button>
      </div>

      {/* Stats */}
      {profile && (
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Pending Balance" value={formatUsdc(profile.pendingBalance)} accent="amber" />
          <StatCard label="Total Paid Out" value={formatUsdc(totalPaidOut)} accent="green" />
          <StatCard
            label="Last Payout"
            value={lastPayout ? relativeTime(lastPayout.completedAt!) : "—"}
            accent="blue"
          />
        </div>
      )}

      {/* Payouts Table */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card h-16 animate-pulse bg-surface-3/50" />
          ))}
        </div>
      ) : payouts.length > 0 ? (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-surface-4 text-left">
                <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider text-right">Amount</th>
                <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider">Destination</th>
                <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider">Tx Hash</th>
                <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider text-right">Initiated</th>
                <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider text-right">Completed</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((payout) => (
                <tr
                  key={payout.id}
                  className="border-b border-surface-4/50 hover:bg-surface-3/30 transition-colors"
                >
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm font-mono text-accent-green">
                      {formatUsdc(payout.amountUsdc)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("badge", payoutStatusColor(payout.status))}>
                      {payout.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm font-mono text-zinc-400">
                      {truncateAddress(payout.destinationAddr)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {payout.txHash ? (
                      <a
                        href={basescanUrl(payout.txHash, payout.chainId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-mono text-brand-400 hover:text-brand-300 transition-colors"
                      >
                        {payout.txHash.slice(0, 10)}...
                      </a>
                    ) : (
                      <span className="text-sm text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-xs text-zinc-500">
                      {relativeTime(payout.initiatedAt)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-xs text-zinc-500">
                      {payout.completedAt ? relativeTime(payout.completedAt) : "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card py-16 text-center">
          <p className="text-zinc-400 text-lg">No payouts yet.</p>
          <p className="text-zinc-500 text-sm mt-2">Request a payout when you have earnings to withdraw.</p>
        </div>
      )}

      {/* Request Payout Modal */}
      {showPayoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowPayoutModal(false)} />
          <div className="relative bg-surface-2 border border-surface-4 rounded-xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-semibold text-zinc-100 mb-4">Request Payout</h3>
            <div className="space-y-4">
              <div className="bg-surface-3 border border-surface-4 rounded-lg p-3">
                <p className="text-2xs text-zinc-500 uppercase tracking-wider font-semibold">
                  Available Balance
                </p>
                <p className="text-xl font-bold font-mono text-zinc-100 mt-1">
                  {profile ? formatUsdc(profile.pendingBalance) : "—"}
                </p>
              </div>
              <div>
                <label className="text-2xs text-zinc-500 uppercase tracking-wider font-semibold block mb-1.5">
                  Amount (USDC)
                </label>
                <input
                  type="number"
                  value={payoutAmount}
                  onChange={(e) => setPayoutAmount(e.target.value)}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  max={profile?.pendingBalance ?? 0}
                  className="w-full bg-surface-3 border border-surface-4 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-brand-400"
                />
              </div>
              {profile?.payoutAddress && (
                <div>
                  <p className="text-2xs text-zinc-500 uppercase tracking-wider font-semibold mb-1">
                    Destination
                  </p>
                  <p className="text-sm font-mono text-zinc-400">{truncateAddress(profile.payoutAddress)}</p>
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={handleRequestPayout}
                disabled={isRequesting || !payoutAmount || parseFloat(payoutAmount) <= 0}
                className="btn-primary flex-1 disabled:opacity-50"
              >
                {isRequesting ? "Requesting..." : "Request Payout"}
              </button>
              <button onClick={() => setShowPayoutModal(false)} className="btn-secondary flex-1">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ───

function payoutStatusColor(status: string): string {
  const map: Record<string, string> = {
    PENDING: "bg-amber-500/15 text-amber-400",
    PROCESSING: "bg-blue-500/15 text-blue-400",
    COMPLETED: "bg-emerald-500/15 text-emerald-400",
    FAILED: "bg-red-500/15 text-red-400",
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
