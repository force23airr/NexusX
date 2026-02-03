// ═══════════════════════════════════════════════════════════════
// NexusX — Buyer Wallet Page
// apps/web/src/app/buyer/wallet/page.tsx
//
// Buyer's wallet view:
//   - USDC balance + escrow display
//   - Base L2 address
//   - Transaction history table
//   - Deposit / Withdraw actions
// ═══════════════════════════════════════════════════════════════

"use client";

import { useState, useEffect } from "react";
import { buyer } from "@/lib/api";
import {
  cn,
  formatUsdc,
  formatPricePerCall,
  formatLatency,
  transactionStatusColor,
  relativeTime,
} from "@/lib/utils";
import type { Wallet, Transaction, PaginatedResponse } from "@/types";

export default function BuyerWalletPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    Promise.all([
      buyer.getWallet(),
      buyer.getTransactions({ page, pageSize: 20 }),
    ])
      .then(([w, t]) => {
        setWallet(w);
        setTransactions(t.items);
        setHasMore(t.hasMore);
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [page]);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Wallet</h1>
        <p className="mt-1 text-zinc-400">Your USDC balance on Base L2.</p>
      </div>

      {/* Balance Cards */}
      {wallet && (
        <div className="grid grid-cols-3 gap-4">
          {/* Available */}
          <div className="stat-card">
            <div className="absolute inset-0 bg-gradient-to-br from-brand-500/10 to-transparent pointer-events-none" />
            <p className="text-2xs text-zinc-500 uppercase tracking-wider font-semibold relative">
              Available Balance
            </p>
            <p className="text-2xl font-bold font-mono text-zinc-100 mt-1 relative">
              {formatUsdc(wallet.balanceUsdc)}
            </p>
            <p className="text-2xs text-zinc-500 mt-1 relative">USDC</p>
          </div>

          {/* Escrow */}
          <div className="stat-card">
            <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 to-transparent pointer-events-none" />
            <p className="text-2xs text-zinc-500 uppercase tracking-wider font-semibold relative">
              In Escrow
            </p>
            <p className="text-2xl font-bold font-mono text-amber-300 mt-1 relative">
              {formatUsdc(wallet.escrowUsdc)}
            </p>
            <p className="text-2xs text-zinc-500 mt-1 relative">Locked for pending calls</p>
          </div>

          {/* Address */}
          <div className="stat-card">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent pointer-events-none" />
            <p className="text-2xs text-zinc-500 uppercase tracking-wider font-semibold relative">
              Wallet Address
            </p>
            <p className="text-sm font-mono text-zinc-300 mt-2 relative break-all">
              {wallet.address}
            </p>
            <p className="text-2xs text-zinc-500 mt-1 relative">
              Base L2 (Chain {wallet.chainId})
            </p>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center gap-3">
        <button className="btn-primary">Deposit USDC</button>
        <button className="btn-secondary">Withdraw</button>
        {wallet?.lastSyncedAt && (
          <span className="text-2xs text-zinc-500 ml-auto">
            Last synced {relativeTime(wallet.lastSyncedAt)}
          </span>
        )}
      </div>

      {/* Transaction History */}
      <div>
        <h2 className="text-lg font-semibold text-zinc-200 mb-4">Transaction History</h2>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="card h-14 animate-pulse bg-surface-3/50" />
            ))}
          </div>
        ) : transactions.length > 0 ? (
          <>
            <div className="card overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-surface-4 text-left">
                    <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider">Listing</th>
                    <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider text-right">Price</th>
                    <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider text-right">Fee</th>
                    <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider text-right">Latency</th>
                    <th className="px-4 py-3 text-2xs font-semibold text-zinc-500 uppercase tracking-wider text-right">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => (
                    <tr
                      key={tx.id}
                      className="border-b border-surface-4/50 hover:bg-surface-3/30 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <span className="text-sm text-zinc-200">{tx.listingName}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("badge", transactionStatusColor(tx.status))}>
                          {tx.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-mono text-zinc-200">
                          {formatPricePerCall(tx.priceUsdc)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-mono text-zinc-500">
                          {formatPricePerCall(tx.platformFeeUsdc)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-mono text-zinc-400">
                          {formatLatency(tx.responseTimeMs)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-xs text-zinc-500">
                          {relativeTime(tx.createdAt)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-4">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="btn-ghost disabled:opacity-30"
              >
                ← Previous
              </button>
              <span className="text-xs text-zinc-500">Page {page}</span>
              <button
                onClick={() => setPage(page + 1)}
                disabled={!hasMore}
                className="btn-ghost disabled:opacity-30"
              >
                Next →
              </button>
            </div>
          </>
        ) : (
          <div className="card py-12 text-center">
            <p className="text-zinc-400">No transactions yet.</p>
            <p className="text-zinc-500 text-sm mt-2">
              Transactions will appear here after you start using APIs.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
