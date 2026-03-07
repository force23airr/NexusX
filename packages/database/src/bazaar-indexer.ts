// ═══════════════════════════════════════════════════════════════
// NexusX — Bazaar Indexer
// packages/database/src/bazaar-indexer.ts
//
// Pulls x402 Bazaar services from Coinbase's discovery endpoint
// into the NexusX database for semantic search and routing.
//
// Usage:
//   npx tsx packages/database/scripts/bazaar-index.ts [--dry-run] [--limit N] [--skip-embed]
// ═══════════════════════════════════════════════════════════════

import type { PrismaClient } from "@prisma/client";
import { bumpControlPlaneVersion } from "./control-plane";
import { embedAllListings, type EmbeddingConfig } from "./embeddings";

// ─── Constants ───────────────────────────────────────────────

const BAZAAR_ENDPOINT =
  "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources";

const PAGE_SIZE = 100;
const FETCH_TIMEOUT_MS = 30_000;

/** Deterministic IDs matching seed.ts */
export const BAZAAR_PROVIDER_ID = "00000000-0000-4000-a000-000000000099";
export const BAZAAR_PROFILE_ID = "00000000-0000-4000-d000-000000000099";
export const GENERAL_CATEGORY_ID = "00000000-0000-4000-b000-000000000099";

/** USDC contract addresses on Base networks */
const USDC_ADDRESSES = [
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // Base Mainnet
  "0x036cbd53842c5426634e7929541ec2318f3dcf7e", // Base Sepolia
];

function isUsdcAsset(asset: string): boolean {
  return USDC_ADDRESSES.includes(asset.toLowerCase());
}

// ─── Types ───────────────────────────────────────────────────

export interface BazaarAccept {
  network: string;
  asset: string;
  maxAmountRequired: string;
  resource: string;
  scheme: string;
  description?: string;
  discoverable?: boolean;
  payTo?: string;
  mimeType?: string;
  maxTimeoutSeconds?: number;
  extra?: { name?: string; version?: string };
  outputSchema?: Record<string, unknown>;
}

export interface BazaarResource {
  resource: string;
  type: string;
  x402Version: number;
  lastUpdated?: string;
  metadata?: Record<string, unknown>;
  accepts: BazaarAccept[];
}

interface BazaarApiResponse {
  items: BazaarResource[];
  pagination: { limit: number; offset: number; total: number };
  x402Version: number;
}

export interface IndexBazaarOptions {
  dryRun?: boolean;
  limit?: number;
  skipEmbed?: boolean;
}

export interface IndexBazaarResult {
  fetched: number;
  filtered: number;
  created: number;
  updated: number;
  deactivated: number;
  skipped: number;
}

// ─── Category Inference ──────────────────────────────────────

const CATEGORY_KEYWORDS: Array<{ slugs: string[]; category: string }> = [
  { slugs: ["llm", "chat", "completion", "gpt", "claude", "language model", "language-model"], category: "language-models" },
  { slugs: ["translat"], category: "translation" },
  { slugs: ["sentiment", "emotion", "opinion"], category: "sentiment-analysis" },
  { slugs: ["embed", "vector", "embedding"], category: "embeddings" },
  { slugs: ["object", "detect", "image", "vision", "yolo"], category: "object-detection" },
  { slugs: ["dataset", "csv", "parquet"], category: "datasets" },
];

export function inferCategorySlug(description: string, url: string): string {
  const text = `${description} ${url}`.toLowerCase();
  for (const { slugs, category } of CATEGORY_KEYWORDS) {
    if (slugs.some((kw) => text.includes(kw))) {
      return category;
    }
  }
  return "general";
}

// ─── Slug Generator ──────────────────────────────────────────

export function generateBazaarSlug(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `bazaar-${Date.now()}`;
  }

  const host = parsed.hostname.replace(/^www\./, "");
  const pathParts = parsed.pathname
    .split("/")
    .filter(Boolean)
    .slice(0, 3); // first 3 path segments

  const raw = `bazaar-${host}-${pathParts.join("-")}`;
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

// ─── Price Parser ────────────────────────────────────────────

export function parseUsdcPrice(maxAmountRequired: string): number {
  try {
    const atomic = BigInt(maxAmountRequired);
    const usdc = Number(atomic) / 1_000_000;
    if (usdc <= 0) return 0.001;
    if (usdc > 100) return 100;
    return Math.round(usdc * 1_000_000) / 1_000_000; // 6 decimal places
  } catch {
    return 0.001;
  }
}

// ─── Fetcher ─────────────────────────────────────────────────

export async function fetchBazaarResources(
  limit?: number
): Promise<BazaarResource[]> {
  const all: BazaarResource[] = [];
  let offset = 0;

  while (true) {
    const url = `${BAZAAR_ENDPOINT}?type=http&limit=${PAGE_SIZE}&offset=${offset}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        console.error(`[BazaarIndexer] API returned ${res.status} at offset ${offset}`);
        break;
      }

      const data = (await res.json()) as BazaarApiResponse;
      if (!data.items || data.items.length === 0) break;

      all.push(...data.items);
      console.log(
        `[BazaarIndexer] Fetched page offset=${offset}, got ${data.items.length} items (total so far: ${all.length}/${data.pagination.total})`
      );

      if (limit && all.length >= limit) {
        return all.slice(0, limit);
      }

      if (all.length >= data.pagination.total) break;
      offset += PAGE_SIZE;
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        console.error(`[BazaarIndexer] Timeout at offset ${offset}`);
      } else {
        console.error(`[BazaarIndexer] Fetch error at offset ${offset}:`, err);
      }
      break;
    } finally {
      clearTimeout(timeout);
    }
  }

  return limit ? all.slice(0, limit) : all;
}

// ─── Quality Filter ──────────────────────────────────────────

export function filterBazaarResources(
  resources: BazaarResource[]
): BazaarResource[] {
  return resources.filter((r) => {
    // Must have a valid HTTPS URL
    if (!r.resource || !r.resource.startsWith("https://")) return false;

    // Must have at least one accept entry on Base with USDC
    const hasBaseUsdc = r.accepts.some((a) => {
      const isBase =
        a.network.includes("base") || a.network.includes("8453") || a.network.includes("84532");
      const isUsdc = isUsdcAsset(a.asset ?? "");
      return isBase && isUsdc;
    });
    if (!hasBaseUsdc) return false;

    // Must have a meaningful description (from any accept entry)
    const description = getBestDescription(r);
    if (!description || description.length < 10) return false;

    return true;
  });
}

// ─── Helpers ─────────────────────────────────────────────────

function getBestDescription(resource: BazaarResource): string {
  // Find the first accept with a description
  for (const a of resource.accepts) {
    if (a.description && a.description.length >= 10) {
      return a.description;
    }
  }
  return "";
}

function getBestAccept(resource: BazaarResource): BazaarAccept | null {
  // Prefer Base mainnet USDC, fall back to Base Sepolia
  const mainnet = resource.accepts.find(
    (a) =>
      (a.network.includes("8453") || a.network === "base-mainnet" || a.network === "base") &&
      isUsdcAsset(a.asset ?? "")
  );
  if (mainnet) return mainnet;

  return (
    resource.accepts.find(
      (a) =>
        (a.network.includes("base") || a.network.includes("84532")) &&
        isUsdcAsset(a.asset ?? "")
    ) ?? null
  );
}

function extractName(resource: BazaarResource): string {
  // Try extra.name from any accept
  for (const a of resource.accepts) {
    if (a.extra?.name) return a.extra.name;
  }

  // Fall back to hostname + path
  try {
    const url = new URL(resource.resource);
    const host = url.hostname.replace(/^www\./, "");
    const path = url.pathname.split("/").filter(Boolean).slice(0, 2).join(" ");
    return path ? `${host} ${path}` : host;
  } catch {
    return resource.resource.slice(0, 60);
  }
}

function extractTags(description: string, url: string): string[] {
  const tags = ["bazaar", "x402"];

  const text = `${description} ${url}`.toLowerCase();
  const tagKeywords = [
    "defi", "nft", "token", "blockchain", "crypto", "wallet",
    "ai", "ml", "api", "data", "analytics", "search",
    "image", "video", "audio", "text", "chat",
  ];

  for (const kw of tagKeywords) {
    if (text.includes(kw)) tags.push(kw);
  }

  return tags.filter((tag, idx, arr) => arr.indexOf(tag) === idx);
}

// ─── Main Indexer ────────────────────────────────────────────

export async function indexBazaar(
  prisma: PrismaClient,
  options: IndexBazaarOptions = {}
): Promise<IndexBazaarResult> {
  const { dryRun = false, limit, skipEmbed = false } = options;

  const result: IndexBazaarResult = {
    fetched: 0,
    filtered: 0,
    created: 0,
    updated: 0,
    deactivated: 0,
    skipped: 0,
  };

  // 1. Fetch
  console.log("[BazaarIndexer] Fetching resources from Bazaar...");
  const raw = await fetchBazaarResources(limit);
  result.fetched = raw.length;
  console.log(`[BazaarIndexer] Fetched ${raw.length} total resources`);

  // 2. Filter
  const filtered = filterBazaarResources(raw);
  result.filtered = filtered.length;
  console.log(`[BazaarIndexer] ${filtered.length} passed quality filter (from ${raw.length})`);

  if (dryRun) {
    console.log("[BazaarIndexer] Dry run — not writing to database");
    for (const r of filtered.slice(0, 10)) {
      const slug = generateBazaarSlug(r.resource);
      const desc = getBestDescription(r);
      const cat = inferCategorySlug(desc, r.resource);
      const accept = getBestAccept(r);
      const price = accept ? parseUsdcPrice(accept.maxAmountRequired) : 0.001;
      console.log(`  ${slug} | ${cat} | $${price} | ${desc.slice(0, 60)}...`);
    }
    if (filtered.length > 10) {
      console.log(`  ... and ${filtered.length - 10} more`);
    }
    return result;
  }

  // 3. Look up category IDs
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    select: { id: true, slug: true },
  });
  const categoryMap = new Map(categories.map((c) => [c.slug, c.id]));

  // Ensure "general" category exists
  if (!categoryMap.has("general")) {
    const general = await prisma.category.upsert({
      where: { id: GENERAL_CATEGORY_ID },
      update: {},
      create: {
        id: GENERAL_CATEGORY_ID,
        slug: "general",
        name: "General Services",
        depth: 0,
        sortOrder: 99,
      },
    });
    categoryMap.set("general", general.id);
  }

  // 4. Ensure Bazaar provider exists
  const bazaarUser = await prisma.user.upsert({
    where: { id: BAZAAR_PROVIDER_ID },
    update: {},
    create: {
      id: BAZAAR_PROVIDER_ID,
      email: "bazaar@x402.org",
      displayName: "x402 Bazaar",
      roles: ["PROVIDER"],
    },
  });

  // Ensure wallet exists
  await prisma.wallet.upsert({
    where: { userId: BAZAAR_PROVIDER_ID },
    update: {},
    create: {
      userId: BAZAAR_PROVIDER_ID,
      address: "0x0000000000000000000000000000000000000099",
      chainId: 8453,
    },
  });

  // Ensure provider profile exists
  await prisma.providerProfile.upsert({
    where: { id: BAZAAR_PROFILE_ID },
    update: {},
    create: {
      id: BAZAAR_PROFILE_ID,
      userId: BAZAAR_PROVIDER_ID,
      companyName: "x402 Bazaar (Coinbase)",
      website: "https://x402.org",
      payoutAddress: "0x0000000000000000000000000000000000000000",
      description: "Auto-imported services from the x402 Bazaar discovery layer.",
    },
  });

  // 5. Track seen URLs for deactivation
  const seenUrls = new Set<string>();
  let changedPublicListings = false;

  // 6. Upsert each resource
  for (const resource of filtered) {
    const url = resource.resource;
    seenUrls.add(url);

    const description = getBestDescription(resource);
    const accept = getBestAccept(resource);
    const price = accept ? parseUsdcPrice(accept.maxAmountRequired) : 0.001;
    const catSlug = inferCategorySlug(description, url);
    const categoryId = categoryMap.get(catSlug) ?? categoryMap.get("general")!;
    const name = extractName(resource);
    const tags = extractTags(description, url);

    // Check if already exists
    const existing = await prisma.listing.findFirst({
      where: {
        sourceType: "bazaar",
        sourceResourceUrl: url,
      },
    });

    if (existing) {
      // Update
      await prisma.listing.update({
        where: { id: existing.id },
        data: {
          description,
          currentPriceUsdc: price,
          floorPriceUsdc: price,
          status: "ACTIVE",
          tags,
        },
      });
      changedPublicListings = true;
      result.updated++;
    } else {
      // Generate unique slug
      let slug = generateBazaarSlug(url);
      let attempt = 0;
      while (true) {
        const candidate = attempt === 0 ? slug : `${slug}-${attempt}`;
        const collision = await prisma.listing.findUnique({
          where: { slug: candidate },
        });
        if (!collision) {
          slug = candidate;
          break;
        }
        attempt++;
        if (attempt > 10) {
          console.warn(`[BazaarIndexer] Skipping ${url} — too many slug collisions`);
          result.skipped++;
          slug = "";
          break;
        }
      }

      if (!slug) continue;

      try {
        await prisma.listing.create({
          data: {
            providerId: BAZAAR_PROVIDER_ID,
            categoryId,
            slug,
            name,
            description,
            listingType: "REST_API",
            status: "ACTIVE",
            baseUrl: url,
            authType: "x402",
            floorPriceUsdc: price,
            currentPriceUsdc: price,
            capacityPerMinute: 60,
            tags,
            sourceType: "bazaar",
            sourceResourceUrl: url,
            publishedAt: new Date(),
          },
        });
        changedPublicListings = true;
        result.created++;
      } catch (err) {
        console.warn(`[BazaarIndexer] Failed to create listing for ${url}:`, err);
        result.skipped++;
      }
    }
  }

  // 7. Deactivate stale Bazaar listings not seen in this fetch
  if (!limit) {
    // Only deactivate when doing a full sync (no limit)
    const stale = await prisma.listing.updateMany({
      where: {
        sourceType: "bazaar",
        status: "ACTIVE",
        sourceResourceUrl: { notIn: Array.from(seenUrls) },
      },
      data: { status: "PAUSED" },
    });
    result.deactivated = stale.count;
    if (stale.count > 0) {
      changedPublicListings = true;
    }
  }

  console.log(
    `[BazaarIndexer] Done: ${result.created} created, ${result.updated} updated, ${result.deactivated} deactivated, ${result.skipped} skipped`
  );

  // 8. Embed new listings into pgvector
  if (!skipEmbed && (result.created > 0 || result.updated > 0)) {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      console.log("[BazaarIndexer] Embedding new listings into pgvector...");
      const embeddingConfig: EmbeddingConfig = { openaiApiKey: openaiKey };
      await embedAllListings(prisma, embeddingConfig);
      console.log("[BazaarIndexer] Embedding complete");
    } else {
      console.warn("[BazaarIndexer] OPENAI_API_KEY not set — skipping embeddings");
    }
  }

  if (changedPublicListings) {
    await bumpControlPlaneVersion(prisma);
  }

  return result;
}
