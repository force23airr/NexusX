// ═══════════════════════════════════════════════════════════════
// NexusX — MCP Wallet Resource
// apps/mcp-server/src/resources/wallet.ts
//
// Resource: nexusx://wallet — agent's USDC balance + session spend
//
// When a CDP wallet is configured, shows the live on-chain USDC
// balance from the Coinbase CDP API.
// Falls back to the internal DB wallet for API key auth mode.
// ═══════════════════════════════════════════════════════════════

import type { DiscoveryService } from "../services/discovery";
import type { BudgetTracker } from "../services/budget-tracker";
import type { CdpWalletService } from "../services/cdp-wallet";

export function createWalletResourceHandler(
  discovery: DiscoveryService,
  budget: BudgetTracker,
  apiKey: string,
  cdpWallet?: CdpWalletService,
) {
  return async (): Promise<string> => {
    const budgetState = budget.getState();
    const result: Record<string, unknown> = {};

    if (cdpWallet?.isAvailable) {
      // x402 mode — read live on-chain balance from CDP API
      const [address, balanceUsdc] = await Promise.all([
        cdpWallet.getAddress(),
        cdpWallet.getUsdcBalance(),
      ]);
      result.wallet = {
        address,
        balance: `$${balanceUsdc.toFixed(6)} USDC`,
        source: "cdp_on_chain",
        network: "Base",
        note: "Fund this address with USDC on Base to pay for API calls.",
      };
    } else if (apiKey) {
      // API key mode — fall back to internal DB wallet
      const prefix = apiKey.startsWith("nxs_") ? apiKey.slice(4, 12) : apiKey.slice(0, 8);
      const wallet = await discovery.getUserWallet(prefix);
      if (wallet) {
        result.wallet = {
          address: wallet.address,
          balance: `$${wallet.balanceUsdc.toFixed(6)} USDC`,
          escrow: `$${wallet.escrowUsdc.toFixed(6)} USDC`,
          source: "db_internal",
        };
      } else {
        result.wallet = { message: "No wallet found for this API key." };
      }
    } else {
      result.wallet = { message: "No wallet configured. Set CDP_API_KEY_NAME to enable on-chain payments." };
    }

    // Session spend tracking — shown in both modes
    result.sessionSpend = {
      spent: `$${budgetState.spentUsdc.toFixed(6)} USDC`,
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
