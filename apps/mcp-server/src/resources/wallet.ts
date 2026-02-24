// ═══════════════════════════════════════════════════════════════
// NexusX — MCP Wallet Resource
// apps/mcp-server/src/resources/wallet.ts
//
// Resource: nexusx://wallet — agent's USDC balance + session budget
// ═══════════════════════════════════════════════════════════════

import type { DiscoveryService } from "../services/discovery";
import type { BudgetTracker } from "../services/budget-tracker";

export function createWalletResourceHandler(
  discovery: DiscoveryService,
  budget: BudgetTracker,
  apiKey: string,
) {
  return async (): Promise<string> => {
    // Extract prefix from API key (first 8 chars after "nxs_")
    const prefix = apiKey.startsWith("nxs_") ? apiKey.slice(4, 12) : apiKey.slice(0, 8);
    const wallet = await discovery.getUserWallet(prefix);
    const budgetState = budget.getState();

    const result: Record<string, unknown> = {};

    if (wallet) {
      result.wallet = {
        address: wallet.address,
        balance: `$${wallet.balanceUsdc.toFixed(6)} USDC`,
        escrow: `$${wallet.escrowUsdc.toFixed(6)} USDC`,
      };
    } else {
      result.wallet = { message: "No wallet found for this API key." };
    }

    result.sessionBudget = {
      limit: budgetState.limitUsdc === 0 ? "unlimited" : `$${budgetState.limitUsdc.toFixed(6)} USDC`,
      spent: `$${budgetState.spentUsdc.toFixed(6)} USDC`,
      remaining:
        budgetState.limitUsdc === 0
          ? "unlimited"
          : `$${budgetState.remainingUsdc.toFixed(6)} USDC`,
      callCount: budgetState.callCount,
    };

    if (budgetState.callLog.length > 0) {
      result.recentCalls = budgetState.callLog.slice(-10).map((c) => ({
        tool: c.tool,
        cost: `$${c.priceUsdc.toFixed(6)} USDC`,
        time: new Date(c.timestamp).toISOString(),
      }));
    }

    return JSON.stringify(result, null, 2);
  };
}
