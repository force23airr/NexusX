// ═══════════════════════════════════════════════════════════════
// NexusX — MCP Tool Registry
// apps/mcp-server/src/tools/registry.ts
//
// Converts marketplace listings into MCP tools and manages
// periodic refresh. Each active listing becomes a callable tool.
// ═══════════════════════════════════════════════════════════════

import type { BundleDefinition, DiscoveredListing } from "../types";
import type { DiscoveryService } from "../services/discovery";
import type { BundleEngine } from "../services/bundle-engine";
import { bundleSlugToToolName } from "../services/bundle-engine";
import { generateInputSchema, generateBundleInputSchema } from "./schemas";

export interface RegisteredTool {
  toolName: string;
  slug: string;
  kind: "listing" | "bundle";
  listing?: DiscoveredListing;
  bundle?: BundleDefinition;
  description: string;
  inputSchema: Record<string, unknown>;
}

export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();
  private slugToToolName: Map<string, string> = new Map();
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private discovery: DiscoveryService;
  private bundleEngine?: BundleEngine;
  private onToolsChanged?: () => void;

  constructor(discovery: DiscoveryService, bundleEngine?: BundleEngine) {
    this.discovery = discovery;
    this.bundleEngine = bundleEngine;
  }

  /**
   * Set a callback to notify when tools change (for sendToolListChanged).
   */
  setChangeCallback(cb: () => void): void {
    this.onToolsChanged = cb;
  }

  /**
   * Initial load of all tools from the database.
   */
  async initialize(): Promise<void> {
    await this.refresh();
  }

  /**
   * Start periodic refresh of the tool registry.
   */
  startRefresh(intervalMs: number): void {
    if (this.refreshInterval) return;
    this.refreshInterval = setInterval(() => this.refresh(), intervalMs);
  }

  /**
   * Stop periodic refresh.
   */
  stopRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  /**
   * Refresh the tool registry from the database.
   * Detects added/removed listings and notifies if changed.
   */
  async refresh(): Promise<void> {
    try {
      const listings = await this.discovery.loadListings();
      const newToolMap = new Map<string, RegisteredTool>();
      const newSlugMap = new Map<string, string>();

      for (const listing of listings) {
        const name = slugToToolName(listing.slug);
        const description = buildToolDescription(listing);
        const inputSchema = generateInputSchema(listing);

        newToolMap.set(name, {
          toolName: name,
          slug: listing.slug,
          kind: "listing",
          listing,
          description,
          inputSchema,
        });
        newSlugMap.set(listing.slug, name);
      }

      if (this.bundleEngine) {
        try {
          const bundles = await this.bundleEngine.generateBundles(listings);
          for (const bundle of bundles) {
            const toolName = bundle.toolName || bundleSlugToToolName(bundle.slug);
            newToolMap.set(toolName, {
              toolName,
              slug: bundle.slug,
              kind: "bundle",
              bundle,
              description: buildBundleToolDescription(bundle),
              inputSchema: generateBundleInputSchema(bundle),
            });
            newSlugMap.set(bundle.slug, toolName);
          }
        } catch (err) {
          console.error("[MCP Registry] Bundle generation failed:", err);
        }
      }

      // Check if tools changed
      const changed = this.hasChanged(newToolMap);
      this.tools = newToolMap;
      this.slugToToolName = newSlugMap;

      if (changed && this.onToolsChanged) {
        this.onToolsChanged();
      }
    } catch (err) {
      console.error("[MCP Registry] Failed to refresh tools:", err);
    }
  }

  /**
   * Get all registered tools.
   */
  getAllTools(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Look up a tool by its MCP tool name.
   */
  getTool(toolName: string): RegisteredTool | undefined {
    return this.tools.get(toolName);
  }

  /**
   * Resolve a tool name back to its listing slug.
   */
  resolveSlug(toolName: string): string | undefined {
    return this.tools.get(toolName)?.slug;
  }

  /**
   * Get all registered composite bundles.
   */
  getBundles(): BundleDefinition[] {
    const bundles: BundleDefinition[] = [];
    for (const tool of this.tools.values()) {
      if (tool.kind === "bundle" && tool.bundle) {
        bundles.push(tool.bundle);
      }
    }
    return bundles;
  }

  /**
   * Get the number of registered tools.
   */
  get size(): number {
    return this.tools.size;
  }

  // ─── Internal ───

  private hasChanged(newTools: Map<string, RegisteredTool>): boolean {
    if (newTools.size !== this.tools.size) return true;

    for (const [name, tool] of newTools) {
      const existing = this.tools.get(name);
      if (!existing) return true;
      if (existing.kind !== tool.kind) return true;
      if (existing.description !== tool.description) return true;

      if (existing.kind === "listing" && tool.kind === "listing") {
        if (!existing.listing || !tool.listing) return true;
        if (existing.listing.currentPriceUsdc !== tool.listing.currentPriceUsdc) return true;
        if (existing.listing.name !== tool.listing.name) return true;
      }

      if (existing.kind === "bundle" && tool.kind === "bundle") {
        if (!existing.bundle || !tool.bundle) return true;
        if (existing.bundle.bundlePriceUsdc !== tool.bundle.bundlePriceUsdc) return true;
        if (existing.bundle.patternSupport !== tool.bundle.patternSupport) return true;
      }
    }

    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Convert a listing slug to a valid MCP tool name.
 * "openai-gpt4-turbo" → "nexusx_openai_gpt4_turbo"
 */
export function slugToToolName(slug: string): string {
  return `nexusx_${slug.replace(/-/g, "_")}`;
}

/**
 * Convert an MCP tool name back to a listing slug.
 * "nexusx_openai_gpt4_turbo" → "openai-gpt4-turbo"
 */
export function toolNameToSlug(toolName: string): string {
  return toolName.replace(/^nexusx_/, "").replace(/_/g, "-");
}

/**
 * Build a rich tool description from listing metadata.
 */
function buildToolDescription(listing: DiscoveredListing): string {
  const parts: string[] = [];

  parts.push(listing.description);
  parts.push("");
  parts.push(`Provider: ${listing.providerName}`);
  parts.push(`Category: ${listing.categorySlug}`);
  parts.push(`Price: $${listing.currentPriceUsdc.toFixed(6)} USDC/call`);
  parts.push(`Quality: ${Math.round(listing.qualityScore * 100)}%`);

  if (listing.avgLatencyMs > 0) {
    parts.push(`Avg Latency: ${listing.avgLatencyMs}ms`);
  }
  if (listing.uptimePercent > 0) {
    parts.push(`Uptime: ${listing.uptimePercent.toFixed(1)}%`);
  }
  if (listing.tags.length > 0) {
    parts.push(`Tags: ${listing.tags.join(", ")}`);
  }
  if (listing.docsUrl) {
    parts.push(`Docs: ${listing.docsUrl}`);
  }

  return parts.join("\n");
}

function buildBundleToolDescription(bundle: BundleDefinition): string {
  const steps = bundle.steps.map((s) => s.slug).join(" -> ");
  return [
    `Composite bundle generated from observed multi-step agent workflows.`,
    `Steps: ${steps}`,
    `Bundle price: $${bundle.bundlePriceUsdc.toFixed(6)} USDC ` +
      `(gross $${bundle.grossPriceUsdc.toFixed(6)}, discount ${(bundle.discountPct * 100).toFixed(1)}%)`,
    `Quality: ${(bundle.qualityScore * 100).toFixed(1)}%`,
    `Pattern support: ${bundle.patternSupport}`,
    `Semantic cohesion: ${(bundle.semanticCohesion * 100).toFixed(1)}%`,
  ].join("\n");
}
