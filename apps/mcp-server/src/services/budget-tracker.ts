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

export class BudgetTracker {
  private limitUsdc: number;
  private spentUsdc: number = 0;
  private callCount: number = 0;
  private callLog: Array<{ tool: string; priceUsdc: number; timestamp: number }> = [];

  constructor(initialLimitUsdc: number = 0) {
    this.limitUsdc = initialLimitUsdc;
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
      spentUsdc: Math.round(this.spentUsdc * 1_000_000) / 1_000_000,
      remainingUsdc:
        this.limitUsdc === 0
          ? Infinity
          : Math.round((this.limitUsdc - this.spentUsdc) * 1_000_000) / 1_000_000,
      callCount: this.callCount,
      callLog: [...this.callLog],
    };
  }
}
