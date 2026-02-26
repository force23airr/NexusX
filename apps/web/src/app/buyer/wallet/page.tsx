// ═══════════════════════════════════════════════════════════════
// NexusX — Agent Wallet Page
// apps/web/src/app/buyer/wallet/page.tsx
//
// Agent wallet view:
//   - USDC balance on Base L2
//   - Auto-deposit configuration (keep agent running forever)
//   - Manual deposit
//   - Transaction history table
// ═══════════════════════════════════════════════════════════════

"use client";

import { useState, useEffect, useCallback } from "react";
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

  // Auto-deposit form state
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoAmount, setAutoAmount] = useState("50");
  const [autoThreshold, setAutoThreshold] = useState("5");
  const [fundingSource, setFundingSource] = useState("");
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  // Deposit modal state
  const [showDeposit, setShowDeposit] = useState(false);
  const [depositAmount, setDepositAmount] = useState("100");
  const [isDepositing, setIsDepositing] = useState(false);

  const loadData = useCallback(() => {
    setIsLoading(true);
    Promise.all([
      buyer.getWallet(),
      buyer.getTransactions({ page, pageSize: 20 }),
    ])
      .then(([w, t]) => {
        setWallet(w);
        setAutoEnabled(w.autoDepositEnabled);
        setAutoAmount(String(w.autoDepositAmountUsdc));
        setAutoThreshold(String(w.autoDepositThreshold));
        setFundingSource(w.fundingSource || "");
        setTransactions(t.items);
        setHasMore(t.hasMore);
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [page]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleSaveSettings() {
    setIsSavingSettings(true);
    setSettingsSaved(false);
    try {
      await buyer.updateWalletSettings({
        autoDepositEnabled: autoEnabled,
        autoDepositAmountUsdc: Number(autoAmount),
        autoDepositThreshold: Number(autoThreshold),
        fundingSource: fundingSource || undefined,
      });
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handleDeposit() {
    const amount = Number(depositAmount);
    if (!amount || amount <= 0) return;
    setIsDepositing(true);
    try {
      const result = await buyer.deposit(amount);
      setWallet((prev) =>
        prev ? { ...prev, balanceUsdc: result.balanceUsdc } : prev
      );
      setShowDeposit(false);
      setDepositAmount("100");
    } catch (err) {
      console.error(err);
    } finally {
      setIsDepositing(false);
    }
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Agent Wallet</h1>
        <p className="mt-1 text-zinc-400">
          Fund your agent with USDC on Base L2. Enable auto-deposit to keep it running forever.
        </p>
      </div>

      {/* Balance Cards */}
      {wallet && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Available Balance */}
          <div className="stat-card">
            <div className="absolute inset-0 bg-gradient-to-br from-brand-500/10 to-transparent pointer-events-none" />
            <p className="text-2xs text-zinc-500 uppercase tracking-wider font-semibold relative">
              Available Balance
            </p>
            <p className="text-2xl font-bold font-mono text-zinc-100 mt-1 relative">
              {formatUsdc(wallet.balanceUsdc)}
            </p>
            <p className="text-2xs text-zinc-500 mt-1 relative">USDC on Base L2</p>
          </div>

          {/* Escrow */}
          <div className="stat-card">
            <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 to-transparent pointer-events-none" />
            <p className="text-2xs text-zinc-500 uppercase tracking-wider font-semibold relative">
              In Escrow
            </p>
            <p className="text-2xl font-bold font-mono text-zinc-100 mt-1 relative">
              {formatUsdc(wallet.escrowUsdc)}
            </p>
            <p className="text-2xs text-zinc-500 mt-1 relative">Locked for pending calls</p>
          </div>

          {/* Auto-Deposit Status */}
          <div className="stat-card">
            <div className={cn(
              "absolute inset-0 bg-gradient-to-br to-transparent pointer-events-none",
              autoEnabled ? "from-emerald-500/10" : "from-zinc-500/10"
            )} />
            <p className="text-2xs text-zinc-500 uppercase tracking-wider font-semibold relative">
              Auto-Deposit
            </p>
            <p className={cn(
              "text-lg font-bold mt-1 relative",
              autoEnabled ? "text-emerald-400" : "text-zinc-500"
            )}>
              {autoEnabled ? "Active" : "Disabled"}
            </p>
            <p className="text-2xs text-zinc-500 mt-1 relative">
              {autoEnabled
                ? `Refills ${formatUsdc(Number(autoAmount))} when below ${formatUsdc(Number(autoThreshold))}`
                : "Enable to keep your agent funded"}
            </p>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center gap-3">
        <button onClick={() => setShowDeposit(true)} className="btn-primary">
          Deposit USDC
        </button>
        <a href="/buyer/fund" className="btn-secondary">
          Fund via Coinbase
        </a>
        {wallet?.lastSyncedAt && (
          <span className="text-2xs text-zinc-500 ml-auto">
            Last synced {relativeTime(wallet.lastSyncedAt)}
          </span>
        )}
      </div>

      {/* Deposit Modal */}
      {showDeposit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="card p-6 w-full max-w-md space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-zinc-100">Deposit USDC</h3>
              <button
                onClick={() => setShowDeposit(false)}
                className="text-zinc-500 hover:text-zinc-300 text-lg"
              >
                x
              </button>
            </div>

            <p className="text-sm text-zinc-400">
              Add USDC to your agent&apos;s wallet so it can pay for API calls.
            </p>

            {/* Quick Amount Buttons */}
            <div className="flex gap-2">
              {[25, 50, 100, 500].map((amt) => (
                <button
                  key={amt}
                  onClick={() => setDepositAmount(String(amt))}
                  className={cn(
                    "flex-1 py-2 rounded-lg text-sm font-medium transition-colors",
                    depositAmount === String(amt)
                      ? "bg-brand-600/20 text-brand-300 border border-brand-500/30"
                      : "bg-surface-3 text-zinc-400 hover:bg-surface-4 border border-transparent"
                  )}
                >
                  ${amt}
                </button>
              ))}
            </div>

            {/* Custom Amount */}
            <div>
              <label className="block text-2xs text-zinc-500 uppercase tracking-wider font-semibold mb-1.5">
                Amount (USDC)
              </label>
              <input
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                min="1"
                step="1"
                className="input-base w-full"
                placeholder="Enter amount"
              />
            </div>

            {wallet && (
              <p className="text-xs text-zinc-500">
                Current balance: <span className="font-mono text-zinc-300">{formatUsdc(wallet.balanceUsdc)}</span>
                {" → "}
                <span className="font-mono text-brand-300">
                  {formatUsdc(wallet.balanceUsdc + Number(depositAmount || 0))}
                </span>
              </p>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowDeposit(false)}
                className="btn-ghost flex-1"
              >
                Cancel
              </button>
              <button
                onClick={handleDeposit}
                disabled={isDepositing || !Number(depositAmount)}
                className="btn-primary flex-1 disabled:opacity-50"
              >
                {isDepositing ? "Depositing..." : `Deposit $${depositAmount}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auto-Deposit Configuration */}
      <div className="card p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-zinc-100">Auto-Deposit</h3>
            <p className="text-sm text-zinc-400 mt-1">
              Automatically refill your agent&apos;s wallet when the balance drops below a threshold.
              Your agent will never run out of funds.
            </p>
          </div>

          {/* Toggle */}
          <button
            onClick={() => setAutoEnabled(!autoEnabled)}
            className={cn(
              "relative w-12 h-6 rounded-full transition-colors shrink-0",
              autoEnabled ? "bg-brand-500" : "bg-surface-4"
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform",
                autoEnabled ? "translate-x-6" : "translate-x-0.5"
              )}
            />
          </button>
        </div>

        {autoEnabled && (
          <div className="space-y-4 pt-2 border-t border-surface-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
              {/* Threshold */}
              <div>
                <label className="block text-2xs text-zinc-500 uppercase tracking-wider font-semibold mb-1.5">
                  Refill when balance drops below
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">$</span>
                  <input
                    type="number"
                    value={autoThreshold}
                    onChange={(e) => setAutoThreshold(e.target.value)}
                    min="1"
                    step="1"
                    className="input-base w-full pl-7"
                    placeholder="5"
                  />
                </div>
                <p className="text-2xs text-zinc-600 mt-1">
                  When balance goes below this, auto-deposit triggers
                </p>
              </div>

              {/* Deposit Amount */}
              <div>
                <label className="block text-2xs text-zinc-500 uppercase tracking-wider font-semibold mb-1.5">
                  Deposit amount each time
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">$</span>
                  <input
                    type="number"
                    value={autoAmount}
                    onChange={(e) => setAutoAmount(e.target.value)}
                    min="1"
                    step="1"
                    className="input-base w-full pl-7"
                    placeholder="50"
                  />
                </div>
                <p className="text-2xs text-zinc-600 mt-1">
                  USDC added to wallet per refill
                </p>
              </div>
            </div>

            {/* Funding Source */}
            <div>
              <label className="block text-2xs text-zinc-500 uppercase tracking-wider font-semibold mb-1.5">
                Funding Source
              </label>
              <select
                value={fundingSource}
                onChange={(e) => setFundingSource(e.target.value)}
                className="input-base w-full"
              >
                <option value="">Select funding source</option>
                <option value="coinbase">Coinbase Account</option>
                <option value="stripe">Credit/Debit Card (Stripe)</option>
                <option value="external_wallet">External Wallet (Bridge)</option>
              </select>
              <p className="text-2xs text-zinc-600 mt-1">
                Where funds are pulled from when auto-deposit triggers
              </p>
            </div>

            {/* Summary */}
            <div className="rounded-lg bg-surface-2 border border-surface-4 p-4">
              <div className="flex items-start gap-3">
                <span className="text-brand-400 text-lg">↻</span>
                <div className="text-sm text-zinc-300">
                  When your agent&apos;s balance drops below{" "}
                  <span className="font-mono font-medium text-brand-300">{formatUsdc(Number(autoThreshold))}</span>,
                  we&apos;ll automatically deposit{" "}
                  <span className="font-mono font-medium text-brand-300">{formatUsdc(Number(autoAmount))}</span>
                  {" "}USDC{fundingSource ? ` from your ${fundingSource === "coinbase" ? "Coinbase account" : fundingSource === "stripe" ? "card" : "external wallet"}` : ""}.
                  Your agent will never stop running due to insufficient funds.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Save */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSaveSettings}
            disabled={isSavingSettings}
            className="btn-primary disabled:opacity-50"
          >
            {isSavingSettings ? "Saving..." : "Save Settings"}
          </button>
          {settingsSaved && (
            <span className="text-sm text-emerald-400">Settings saved</span>
          )}
        </div>
      </div>

      {/* How x402 Works */}
      <div className="card p-5 border border-brand-500/20">
        <h3 className="text-sm font-semibold text-zinc-200 mb-2">How agent payments work</h3>
        <p className="text-sm text-zinc-400 leading-relaxed">
          Your agent pays per API call using the x402 protocol — no escrow or prepayment needed.
          Each request is signed by your wallet and payment settles instantly on Base L2 in USDC.
          With auto-deposit enabled, your agent can run autonomously without ever running out of funds.
        </p>
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
              Transactions will appear here after your agent starts using APIs.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
