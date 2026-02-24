// ═══════════════════════════════════════════════════════════════
// NexusX — MCP Price Resource
// apps/mcp-server/src/resources/prices.ts
//
// Resource: nexusx://prices — live price ticks from Redis cache
// ═══════════════════════════════════════════════════════════════

import type { PriceSubscriber } from "../services/price-subscriber";

export function createPricesResourceHandler(priceSubscriber: PriceSubscriber) {
  return async (): Promise<string> => {
    const prices = priceSubscriber.getAllPrices();

    if (prices.length === 0) {
      return JSON.stringify({
        message: "No live price data available. Prices update when the auction engine publishes changes.",
        connected: priceSubscriber.isConnected(),
      });
    }

    const formatted = prices.map((p) => ({
      slug: p.slug,
      name: p.name,
      price: `$${p.currentPrice.toFixed(6)} USDC`,
      previous: `$${p.previousPrice.toFixed(6)} USDC`,
      change: `${p.changePercent > 0 ? "+" : ""}${p.changePercent.toFixed(2)}%`,
      direction: p.direction,
    }));

    return JSON.stringify(formatted, null, 2);
  };
}
