// ═══════════════════════════════════════════════════════════════
// NexusX — MCP Server
// apps/mcp-server/src/server.ts
//
// Constructs the McpServer and registers all tools, resources,
// and prompts. This is the central wiring point.
// ═══════════════════════════════════════════════════════════════

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpServerConfig } from "./types";
import { ToolRegistry } from "./tools/registry";
import { ToolExecutor } from "./tools/executor";
import { DiscoveryService } from "./services/discovery";
import { GatewayClient } from "./services/gateway-client";
import { BudgetTracker } from "./services/budget-tracker";
import { PriceSubscriber } from "./services/price-subscriber";
import { createListingsResourceHandler, createListingDetailResourceHandler } from "./resources/listings";
import { createCategoriesResourceHandler } from "./resources/categories";
import { createPricesResourceHandler, createPriceHistoryResourceHandler } from "./resources/prices";
import { createWalletResourceHandler } from "./resources/wallet";
import { createSetBudgetHandler, createBudgetStatusHandler, createPriceCheckHandler } from "./prompts/budget";
import { createFindApiHandler } from "./prompts/discovery";
import { createPriceTrajectoryHandler } from "./prompts/trajectory";
import type { PrismaClient } from "@prisma/client";

export interface McpServerContext {
  server: McpServer;
  registry: ToolRegistry;
  priceSubscriber: PriceSubscriber;
  cleanup: () => Promise<void>;
}

/**
 * Create and configure the MCP server with all tools, resources, and prompts.
 */
export async function createMcpServer(
  config: McpServerConfig,
  prisma: PrismaClient,
): Promise<McpServerContext> {
  // ─── Services ───
  const gateway = new GatewayClient(config.gatewayUrl, config.apiKey, config.sandbox);
  const discovery = new DiscoveryService(prisma);
  const budget = new BudgetTracker(config.sessionBudgetUsdc);
  const priceSubscriber = new PriceSubscriber(config.redisUrl, config.gatewayUrl);
  const registry = new ToolRegistry(discovery);
  const executor = new ToolExecutor(registry, gateway, budget);

  // ─── MCP Server ───
  const server = new McpServer({
    name: "nexusx",
    version: "1.0.0",
  });

  // ─── Initialize ───
  await registry.initialize();
  console.error(`[MCP] Loaded ${registry.size} tools from marketplace listings.`);

  // Start background services
  registry.startRefresh(config.registryRefreshMs);
  await priceSubscriber.start();

  // Notify client when tools change
  registry.setChangeCallback(() => {
    try {
      server.server.sendToolListChanged();
    } catch {
      // Client may not support notifications
    }
  });

  // ─── Register Dynamic Tools ───
  // Register each discovered listing as an MCP tool
  for (const tool of registry.getAllTools()) {
    server.tool(
      tool.toolName,
      tool.description,
      {
        path: z.string().describe("Sub-path after the listing endpoint (e.g., '/chat/completions'). Use '/' for root."),
        method: z.enum(["GET", "POST", "PUT", "DELETE"]).default("POST").describe("HTTP method"),
        body: z.record(z.unknown()).optional().describe("JSON request body"),
        query: z.record(z.string()).optional().describe("URL query parameters"),
        headers: z.record(z.string()).optional().describe("Additional HTTP headers"),
      },
      async (args) => {
        return executor.execute(tool.toolName, args);
      },
    );
  }

  // ─── Register Resources ───

  // nexusx://listings — all active listings
  const listingsHandler = createListingsResourceHandler(discovery);
  server.resource(
    "listings",
    "nexusx://listings",
    { description: "Browse all active API listings on the NexusX marketplace with pricing and quality metrics." },
    async () => ({
      contents: [{ uri: "nexusx://listings", mimeType: "application/json", text: await listingsHandler() }],
    }),
  );

  // nexusx://listings/{slug} — single listing detail
  const listingDetailHandler = createListingDetailResourceHandler(discovery, gateway);
  server.resource(
    "listing-detail",
    new ResourceTemplate("nexusx://listings/{slug}", { list: undefined }),
    { description: "Detailed information about a specific API listing including pricing breakdown, quality metrics, and sample requests." },
    async (uri, { slug }) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: await listingDetailHandler(slug as string) }],
    }),
  );

  // nexusx://categories — category tree
  const categoriesHandler = createCategoriesResourceHandler(discovery);
  server.resource(
    "categories",
    "nexusx://categories",
    { description: "Hierarchical category tree of API types available on the marketplace." },
    async () => ({
      contents: [{ uri: "nexusx://categories", mimeType: "application/json", text: await categoriesHandler() }],
    }),
  );

  // nexusx://prices — live price ticks
  const pricesHandler = createPricesResourceHandler(priceSubscriber);
  server.resource(
    "prices",
    "nexusx://prices",
    { description: "Live price ticks showing recent price changes across the marketplace." },
    async () => ({
      contents: [{ uri: "nexusx://prices", mimeType: "application/json", text: await pricesHandler() }],
    }),
  );

  // nexusx://prices/history/{slug} — price history + trajectory analysis
  const priceHistoryHandler = createPriceHistoryResourceHandler(priceSubscriber);
  server.resource(
    "price-history",
    new ResourceTemplate("nexusx://prices/history/{slug}", { list: undefined }),
    { description: "Price history and trajectory analysis for a specific API listing. Shows price trends, multiplier breakdown, demand signals, and an actionable recommendation (execute now vs. wait)." },
    async (uri, { slug }) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: await priceHistoryHandler(slug as string) }],
    }),
  );

  // nexusx://wallet — agent's wallet balance + session budget
  const walletHandler = createWalletResourceHandler(discovery, budget, config.apiKey);
  server.resource(
    "wallet",
    "nexusx://wallet",
    { description: "Your USDC wallet balance and session spending budget." },
    async () => ({
      contents: [{ uri: "nexusx://wallet", mimeType: "application/json", text: await walletHandler() }],
    }),
  );

  // ─── Register Prompts ───

  const setBudgetHandler = createSetBudgetHandler(budget);
  server.prompt(
    "nexusx_set_budget",
    "Set a spending limit for this session in USDC. Use 0 for unlimited.",
    { limit_usdc: z.string().describe("Budget limit in USDC (e.g., '1.00'). Use '0' for unlimited.") },
    (args) => setBudgetHandler(args),
  );

  const budgetStatusHandler = createBudgetStatusHandler(budget);
  server.prompt(
    "nexusx_budget_status",
    "View your current session budget, spending, and recent API calls.",
    {},
    () => budgetStatusHandler(),
  );

  const priceCheckHandler = createPriceCheckHandler(gateway, budget);
  server.prompt(
    "nexusx_price_check",
    "Check the current price and fee breakdown for an API listing.",
    { listing: z.string().describe("Listing slug (e.g., 'openai-gpt4-turbo')") },
    async (args) => priceCheckHandler(args),
  );

  const findApiHandler = createFindApiHandler(discovery);
  server.prompt(
    "nexusx_find_api",
    "Search for APIs on the NexusX marketplace by describing what you need.",
    {
      query: z.string().describe("Natural language search query (e.g., 'translation API with low latency')"),
      budget_max_usdc: z.string().optional().describe("Maximum price per call in USDC (e.g., '0.01')"),
    },
    async (args) => findApiHandler(args),
  );

  const priceTrajectoryHandler = createPriceTrajectoryHandler(priceSubscriber, budget);
  server.prompt(
    "nexusx_price_trajectory",
    "Analyze the price trajectory for an API listing. Returns multiplier breakdown, demand trends, and a recommendation on whether to execute now or wait for a better price.",
    {
      slug: z.string().describe("Listing slug (e.g., 'openai-gpt4-turbo')"),
      budget_max_usdc: z.string().optional().describe("Your maximum acceptable price per call in USDC (e.g., '0.01')"),
    },
    async (args) => priceTrajectoryHandler(args),
  );

  // ─── Cleanup ───
  async function cleanup(): Promise<void> {
    registry.stopRefresh();
    await priceSubscriber.stop();
    console.error("[MCP] Server cleaned up.");
  }

  return { server, registry, priceSubscriber, cleanup };
}
