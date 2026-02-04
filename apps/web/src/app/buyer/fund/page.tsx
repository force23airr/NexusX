// ═══════════════════════════════════════════════════════════════
// NexusX — Fiat Onramp Page
// apps/web/src/app/buyer/fund/page.tsx
//
// Fund your wallet with USDC via Coinbase Onramp.
// Buyers pay with card/bank and receive USDC on Base L2.
// ═══════════════════════════════════════════════════════════════

"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { buyer } from "@/lib/api";
import { formatUsdc } from "@/lib/utils";
import type { Wallet } from "@/types";

const ONRAMP_APP_ID = process.env.NEXT_PUBLIC_COINBASE_ONRAMP_APP_ID;

const PRESET_AMOUNTS = [10, 25, 50, 100];

export default function FundWalletPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedAmount, setSelectedAmount] = useState(25);
  const [customAmount, setCustomAmount] = useState("");
  const [showOnramp, setShowOnramp] = useState(false);

  useEffect(() => {
    buyer
      .getWallet()
      .then(setWallet)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  const fundAmount = customAmount ? parseFloat(customAmount) : selectedAmount;
  const isValidAmount = fundAmount > 0 && fundAmount <= 10_000;

  function handleStartOnramp() {
    if (!isValidAmount) return;
    setShowOnramp(true);
  }

  // Build Coinbase Onramp URL for iframe embed.
  const onrampUrl = wallet
    ? `https://pay.coinbase.com/buy/select-asset?appId=${ONRAMP_APP_ID || "default"}&destinationWallets=[{"address":"${wallet.address}","blockchains":["base"],"assets":["USDC"]}]&defaultAsset=USDC&defaultNetwork=base&presetFiatAmount=${fundAmount}`
    : null;

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <Link href="/buyer/wallet" className="hover:text-zinc-300 transition-colors">
          Wallet
        </Link>
        <span>/</span>
        <span className="text-zinc-300">Fund Wallet</span>
      </div>

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Fund Your Wallet</h1>
        <p className="mt-1 text-zinc-400">
          Purchase USDC with your card or bank account via Coinbase Onramp.
        </p>
      </div>

      {/* Current Balance */}
      {wallet && (
        <div className="stat-card">
          <div className="absolute inset-0 bg-gradient-to-br from-brand-500/10 to-transparent pointer-events-none" />
          <p className="text-2xs text-zinc-500 uppercase tracking-wider font-semibold relative">
            Current Balance
          </p>
          <p className="text-2xl font-bold font-mono text-zinc-100 mt-1 relative">
            {formatUsdc(wallet.balanceUsdc)}
          </p>
          <p className="text-2xs text-zinc-500 mt-1 relative">
            USDC on Base L2 — {wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
          </p>
        </div>
      )}

      {!showOnramp ? (
        <>
          {/* Amount Selection */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-zinc-200 mb-4">Select Amount (USD)</h3>

            <div className="grid grid-cols-4 gap-3 mb-4">
              {PRESET_AMOUNTS.map((amount) => (
                <button
                  key={amount}
                  onClick={() => {
                    setSelectedAmount(amount);
                    setCustomAmount("");
                  }}
                  className={`py-3 rounded-lg text-sm font-mono font-medium transition-all border ${
                    selectedAmount === amount && !customAmount
                      ? "bg-brand-600/20 text-brand-300 border-brand-500/40"
                      : "bg-surface-3 text-zinc-300 border-surface-4 hover:border-zinc-600"
                  }`}
                >
                  ${amount}
                </button>
              ))}
            </div>

            <div>
              <label className="text-2xs text-zinc-500 mb-1 block">Custom Amount</label>
              <div className="flex items-center gap-2">
                <span className="text-zinc-400 text-sm">$</span>
                <input
                  type="number"
                  min="1"
                  max="10000"
                  step="1"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  placeholder={selectedAmount.toString()}
                  className="input-base flex-1 font-mono"
                />
              </div>
            </div>
          </div>

          {/* Summary + CTA */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm text-zinc-400">You will receive approximately</p>
                <p className="text-xl font-bold font-mono text-zinc-100">
                  {isValidAmount ? `${fundAmount.toFixed(2)} USDC` : "—"}
                </p>
                <p className="text-2xs text-zinc-500 mt-1">
                  On Base L2. Funds settle in your wallet within minutes.
                </p>
              </div>
            </div>

            <button
              onClick={handleStartOnramp}
              disabled={!isValidAmount || isLoading}
              className="btn-primary w-full disabled:opacity-40"
            >
              Continue to Coinbase Onramp
            </button>

            <p className="text-2xs text-zinc-600 mt-3 text-center">
              Powered by Coinbase. Fees may apply. USDC is delivered on Base L2.
            </p>
          </div>

          {/* Info Section */}
          <div className="card p-5 border border-surface-4">
            <h3 className="text-sm font-semibold text-zinc-200 mb-3">How it works</h3>
            <ol className="space-y-2 text-sm text-zinc-400">
              <li className="flex gap-3">
                <span className="text-brand-400 font-mono font-bold shrink-0">1.</span>
                Choose an amount and continue to Coinbase Onramp.
              </li>
              <li className="flex gap-3">
                <span className="text-brand-400 font-mono font-bold shrink-0">2.</span>
                Pay with card, bank transfer, or Apple Pay.
              </li>
              <li className="flex gap-3">
                <span className="text-brand-400 font-mono font-bold shrink-0">3.</span>
                USDC arrives in your Base L2 wallet within minutes.
              </li>
              <li className="flex gap-3">
                <span className="text-brand-400 font-mono font-bold shrink-0">4.</span>
                Use your USDC to pay for API calls — no escrow or prepayment needed.
              </li>
            </ol>
          </div>
        </>
      ) : (
        <>
          {/* Onramp Iframe */}
          <div className="card overflow-hidden">
            {onrampUrl ? (
              <iframe
                src={onrampUrl}
                title="Coinbase Onramp"
                className="w-full h-[600px] border-0"
                allow="camera; microphone; payment"
              />
            ) : (
              <div className="h-[600px] flex items-center justify-center">
                <div className="text-center">
                  <p className="text-zinc-400 mb-2">Coinbase Onramp is not configured.</p>
                  <p className="text-2xs text-zinc-500">
                    Set NEXT_PUBLIC_COINBASE_ONRAMP_APP_ID in your environment.
                  </p>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => setShowOnramp(false)}
            className="btn-ghost"
          >
            Back to amount selection
          </button>
        </>
      )}
    </div>
  );
}
