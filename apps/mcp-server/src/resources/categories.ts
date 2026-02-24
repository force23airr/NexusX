// ═══════════════════════════════════════════════════════════════
// NexusX — MCP Category Resource
// apps/mcp-server/src/resources/categories.ts
//
// Resource: nexusx://categories — hierarchical category tree
// ═══════════════════════════════════════════════════════════════

import type { DiscoveryService } from "../services/discovery";

export function createCategoriesResourceHandler(discovery: DiscoveryService) {
  return async (): Promise<string> => {
    const categories = await discovery.getCategories();
    return JSON.stringify(categories, null, 2);
  };
}
