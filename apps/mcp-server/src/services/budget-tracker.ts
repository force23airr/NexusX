// ═══════════════════════════════════════════════════════════════
// NexusX — MCP Session Budget Tracker
// apps/mcp-server/src/services/budget-tracker.ts
//
// In-memory, per-session budget enforcement. Lightweight
// guardrail to prevent agents from overspending within a
// single session. Persistent budgets are handled by the
// gateway via subscriptions and wallet balances.
// ═══════════════════════════════════════════════════════════════

import type { BudgetState } from "../types";

export interface BudgetTrackerOptions {
  maxPricePerCallUsdc?: number;
  maxSlippagePct?: number;
}

export interface QuotePolicyInput {
  quotePriceUsdc: number;
  expectedPriceUsdc?: number;
  maxQuoteUsdc?: number;
}

export interface QuotePolicyResult {
  allowed: boolean;
  reason?: string;
}

export class BudgetTracker {
  private limitUsdc: number;
  private maxPricePerCallUsdc: number;
  private maxSlippagePct: number;
  private spentUsdc: number = 0;
  private callCount: number = 0;
  private callLog: Array<{ tool: string; priceUsdc: number; timestamp: number }> = [];

  constructor(initialLimitUsdc: number = 0, options: BudgetTrackerOptions = {}) {
    this.limitUsdc = initialLimitUsdc;
    this.maxPricePerCallUsdc = options.maxPricePerCallUsdc ?? 0;
    this.maxSlippagePct = options.maxSlippagePct ?? 25;
  }

  /** Set or update the session spending limit. 0 = unlimited. */
  setLimit(limitUsdc: number): void {
    this.limitUsdc = Math.max(0, limitUsdc);
  }

  /** Check if the estimated cost fits within the remaining budget. */
  canAfford(estimatedCostUsdc: number): boolean {
    if (this.limitUsdc === 0) return true; // unlimited
    return this.spentUsdc + estimatedCostUsdc <= this.limitUsdc;
  }

  /** Check a live x402 quote before allowing the wallet to sign it. */
  checkQuote(input: QuotePolicyInput): QuotePolicyResult {
    const quote = input.quotePriceUsdc;
    if (!Number.isFinite(quote) || quote < 0) {
      return { allowed: false, reason: "Live x402 quote is malformed." };
    }

    const maxQuote = input.maxQuoteUsdc ?? 0;
    if (maxQuote > 0 && quote > maxQuote + 0.0000005) {
      return {
        allowed: false,
        reason: `Live quote $${quote.toFixed(6)} USDC exceeds task/call limit $${maxQuote.toFixed(6)} USDC.`,
      };
    }

    if (this.maxPricePerCallUsdc > 0 && quote > this.maxPricePerCallUsdc + 0.0000005) {
      return {
        allowed: false,
        reason: `Live quote $${quote.toFixed(6)} USDC exceeds max per-call limit $${this.maxPricePerCallUsdc.toFixed(6)} USDC.`,
      };
    }

    if (this.limitUsdc > 0 && this.spentUsdc + quote > this.limitUsdc + 0.0000005) {
      return {
        allowed: false,
        reason: `Live quote $${quote.toFixed(6)} USDC would exceed remaining session budget $${this.getRemainingUsdc().toFixed(6)} USDC.`,
      };
    }

    const expected = input.expectedPriceUsdc;
    if (typeof expected === "number" && expected > 0 && this.maxSlippagePct >= 0) {
      const maxWithSlippage = expected * (1 + this.maxSlippagePct / 100);
      if (quote > maxWithSlippage + 0.0000005) {
        return {
          allowed: false,
          reason:
            `Live quote $${quote.toFixed(6)} USDC exceeds expected ` +
            `$${expected.toFixed(6)} USDC by more than ${this.maxSlippagePct}%.`,
        };
      }
    }

    return { allowed: true };
  }

  /** Record a completed spend. */
  recordSpend(toolName: string, priceUsdc: number): void {
    this.spentUsdc += priceUsdc;
    this.callCount++;
    this.callLog.push({
      tool: toolName,
      priceUsdc,
      timestamp: Date.now(),
    });

    // Keep only the last 100 entries in the log
    if (this.callLog.length > 100) {
      this.callLog = this.callLog.slice(-100);
    }
  }

  /** Get the full budget state. */
  getState(): BudgetState {
    return {
      limitUsdc: this.limitUsdc,
      maxPricePerCallUsdc: this.maxPricePerCallUsdc,
      maxSlippagePct: this.maxSlippagePct,
      spentUsdc: Math.round(this.spentUsdc * 1_000_000) / 1_000_000,
      remainingUsdc: this.getRemainingUsdc(),
      callCount: this.callCount,
      callLog: [...this.callLog],
    };
  }

  private getRemainingUsdc(): number {
    return this.limitUsdc === 0
      ? Infinity
      : Math.round((this.limitUsdc - this.spentUsdc) * 1_000_000) / 1_000_000;
  }
}
