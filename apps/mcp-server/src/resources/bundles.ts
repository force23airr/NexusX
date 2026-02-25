// ═══════════════════════════════════════════════════════════════
// NexusX — MCP Bundle Resource
// apps/mcp-server/src/resources/bundles.ts
//
// Resource: nexusx://bundles
// Returns generated composition bundles discovered from
// sequential usage patterns + semantic + economics scoring.
// ═══════════════════════════════════════════════════════════════

import type { ToolRegistry } from "../tools/registry";
import type { BudgetTracker } from "../services/budget-tracker";

export function createBundlesResourceHandler(
  registry: ToolRegistry,
  budget: BudgetTracker,
) {
  return async (): Promise<string> => {
    const budgetState = budget.getState();
    const activityScope = buildSessionScope(budgetState.callLog.map((c) => c.tool));

    const bundles = registry
      .getBundles()
      .filter((bundle) => {
        if (activityScope.bundleSlugs.has(bundle.slug)) return true;
        if (activityScope.listingSlugs.size === 0) return false;
        return bundle.steps.some((step) => activityScope.listingSlugs.has(step.slug));
      })
      .map((bundle) => ({
        slug: bundle.slug,
        toolName: bundle.toolName,
        name: bundle.name,
        steps: bundle.steps.map((s) => ({ slug: s.slug, name: s.name })),
        economics: {
          bundlePriceUsdc: bundle.bundlePriceUsdc,
          projectedSavingsUsdc: Math.max(0, bundle.grossPriceUsdc - bundle.bundlePriceUsdc),
        },
        quality: {
          semanticCohesion: bundle.semanticCohesion,
        },
        description: bundle.description,
      }));

    return JSON.stringify(
      {
        scope: {
          mode: "session_activity",
          callCount: budgetState.callCount,
          scopedListings: Array.from(activityScope.listingSlugs),
          scopedBundles: Array.from(activityScope.bundleSlugs),
        },
        count: bundles.length,
        bundles,
        note:
          bundles.length === 0
            ? "No session-scoped bundles yet. Make at least one listing call to unlock personalized bundle suggestions."
            : undefined,
      },
      null,
      2,
    );
  };
}

function buildSessionScope(tools: string[]): {
  listingSlugs: Set<string>;
  bundleSlugs: Set<string>;
} {
  const listingSlugs = new Set<string>();
  const bundleSlugs = new Set<string>();

  for (const toolName of tools) {
    if (!toolName.startsWith("nexusx_")) continue;

    if (toolName.startsWith("nexusx_bundle_")) {
      bundleSlugs.add(toolName.replace(/^nexusx_/, "").replace(/_/g, "-"));
      continue;
    }

    listingSlugs.add(toolName.replace(/^nexusx_/, "").replace(/_/g, "-"));
  }

  return { listingSlugs, bundleSlugs };
}
