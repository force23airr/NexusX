// ═══════════════════════════════════════════════════════════════
// NexusX — MCP Budget Prompts
// apps/mcp-server/src/prompts/budget.ts
//
// Prompts:
//   nexusx_set_budget   — set session spending limit
//   nexusx_budget_status — view current budget state
//   nexusx_price_check  — check pricing for a listing
// ═══════════════════════════════════════════════════════════════

import type { BudgetTracker } from "../services/budget-tracker";
import type { GatewayClient } from "../services/gateway-client";

export function createSetBudgetHandler(budget: BudgetTracker) {
  return (args: { limit_usdc: string }): { messages: Array<{ role: string; content: { type: string; text: string } }> } => {
    const limit = parseFloat(args.limit_usdc);
    if (isNaN(limit) || limit < 0) {
      return {
        messages: [{
          role: "user",
          content: { type: "text", text: "Invalid budget amount. Please provide a positive number in USDC." },
        }],
      };
    }

    budget.setLimit(limit);
    const state = budget.getState();

    return {
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: limit === 0
            ? "Session budget removed (unlimited spending). Be careful with API calls."
            : `Session budget set to $${limit.toFixed(6)} USDC.\n` +
              `Already spent: $${state.spentUsdc.toFixed(6)} USDC\n` +
              `Remaining: $${state.remainingUsdc.toFixed(6)} USDC\n` +
              `Calls made: ${state.callCount}`,
        },
      }],
    };
  };
}

export function createBudgetStatusHandler(budget: BudgetTracker) {
  return (): { messages: Array<{ role: string; content: { type: string; text: string } }> } => {
    const state = budget.getState();

    const lines = [
      `=== NexusX Session Budget ===`,
      `Limit: ${state.limitUsdc === 0 ? "Unlimited" : `$${state.limitUsdc.toFixed(6)} USDC`}`,
      `Spent: $${state.spentUsdc.toFixed(6)} USDC`,
      `Remaining: ${state.limitUsdc === 0 ? "Unlimited" : `$${state.remainingUsdc.toFixed(6)} USDC`}`,
      `API Calls: ${state.callCount}`,
    ];

    if (state.callLog.length > 0) {
      lines.push("", "Recent calls:");
      for (const call of state.callLog.slice(-5)) {
        lines.push(`  ${call.tool}: $${call.priceUsdc.toFixed(6)} @ ${new Date(call.timestamp).toLocaleTimeString()}`);
      }
    }

    return {
      messages: [{
        role: "user",
        content: { type: "text", text: lines.join("\n") },
      }],
    };
  };
}

export function createPriceCheckHandler(gateway: GatewayClient, budget: BudgetTracker) {
  return async (args: { listing: string }): Promise<{ messages: Array<{ role: string; content: { type: string; text: string } }> }> => {
    const pricing = await gateway.getPricing(args.listing);

    if (!pricing) {
      return {
        messages: [{
          role: "user",
          content: { type: "text", text: `Could not find pricing for "${args.listing}". Check that the slug is correct and the listing is active.` },
        }],
      };
    }

    const state = budget.getState();
    const canAfford = budget.canAfford(pricing.currentPriceUsdc);

    const lines = [
      `=== Pricing: ${args.listing} ===`,
      `Current Price: $${pricing.currentPriceUsdc.toFixed(6)} USDC/call`,
      `Floor Price: $${pricing.floorPriceUsdc.toFixed(6)} USDC`,
      `Platform Fee: $${pricing.platformFee.toFixed(6)} USDC (${(pricing.feeRate * 100).toFixed(1)}%)`,
      `Provider Receives: $${pricing.providerAmount.toFixed(6)} USDC`,
      "",
      `Your Budget: ${state.limitUsdc === 0 ? "Unlimited" : `$${state.remainingUsdc.toFixed(6)} remaining`}`,
      canAfford
        ? `Status: You can afford this call.`
        : `Status: OVER BUDGET — this call costs more than your remaining budget.`,
    ];

    return {
      messages: [{
        role: "user",
        content: { type: "text", text: lines.join("\n") },
      }],
    };
  };
}
