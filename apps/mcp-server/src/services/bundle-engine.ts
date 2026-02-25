// ═══════════════════════════════════════════════════════════════
// NexusX — Composition Bundle Engine
// apps/mcp-server/src/services/bundle-engine.ts
//
// Builds composite bundle tools from three signals:
//   1) Sequential call patterns (transactions over recent sessions)
//   2) Semantic cohesion (embedding cosine similarity / lexical fallback)
//   3) Price + quality economics (bundle discount and score)
//
// Output bundles are virtual marketplace offerings registered as
// MCP tools (nexusx_bundle_*), enabling one-call server-side chains.
// ═══════════════════════════════════════════════════════════════

import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { BundleDefinition, BundleStep, DiscoveredListing } from "../types";

interface SequenceTx {
  buyerId: string;
  listingId: string;
  createdAt: Date;
}

interface Pattern {
  listingIds: string[];
  support: number;
}

const LOOKBACK_DAYS = 14;
const MAX_TRANSACTIONS_SCAN = 20_000;
const SESSION_GAP_MS = 15 * 60 * 1000;
const MIN_PAIR_SUPPORT = 3;
const MIN_TRIPLE_SUPPORT = 2;
const MAX_BUNDLES = 8;

export class BundleEngine {
  private readonly minRefreshMs = 120_000;
  private lastComputedAtMs = 0;
  private cachedBundles: BundleDefinition[] = [];

  constructor(private prisma: PrismaClient) {}

  async generateBundles(listings: DiscoveredListing[]): Promise<BundleDefinition[]> {
    const now = Date.now();
    if (
      this.cachedBundles.length > 0 &&
      now - this.lastComputedAtMs < this.minRefreshMs
    ) {
      return this.cachedBundles;
    }

    if (listings.length < 2) return [];

    const byId = new Map<string, DiscoveredListing>();
    for (const listing of listings) byId.set(listing.id, listing);

    const patterns = await this.extractPatterns(new Set(byId.keys()));
    if (patterns.length === 0) return [];

    const bundles: BundleDefinition[] = [];

    for (const pattern of patterns) {
      const steps = this.patternToSteps(pattern, byId);
      if (steps.length < 2) continue;

      const semanticCohesion = await this.computeSemanticCohesion(steps);
      const qualityScore = this.computeBundleQuality(steps);
      const grossPriceUsdc = round6(
        steps.reduce((sum, step) => sum + step.currentPriceUsdc, 0),
      );
      const discountPct = this.computeDiscountPct(
        pattern.support,
        semanticCohesion,
        qualityScore,
        steps.length,
      );
      const bundlePriceUsdc = round6(grossPriceUsdc * (1 - discountPct));
      const score = this.computeBundleScore(
        pattern.support,
        semanticCohesion,
        qualityScore,
        grossPriceUsdc,
      );

      const slug = this.buildBundleSlug(steps);
      const toolName = bundleSlugToToolName(slug);
      const name = `Bundle: ${steps.map((s) => s.name).join(" -> ")}`;

      bundles.push({
        id: `bundle_${createStableSuffix(pattern.listingIds.join("|"))}`,
        slug,
        toolName,
        name,
        description: this.buildDescription({
          steps,
          support: pattern.support,
          grossPriceUsdc,
          bundlePriceUsdc,
          discountPct,
          qualityScore,
          semanticCohesion,
        }),
        steps,
        grossPriceUsdc,
        discountPct,
        bundlePriceUsdc,
        qualityScore,
        semanticCohesion,
        patternSupport: pattern.support,
        score,
      });
    }

    const deduped = dedupeBundles(bundles);
    deduped.sort((a, b) => b.score - a.score);
    this.cachedBundles = deduped.slice(0, MAX_BUNDLES);
    this.lastComputedAtMs = now;
    return this.cachedBundles;
  }

  private async extractPatterns(activeListingIds: Set<string>): Promise<Pattern[]> {
    const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const txs = await this.prisma.transaction.findMany({
      where: {
        createdAt: { gte: cutoff },
        listingId: { in: Array.from(activeListingIds) },
      },
      select: {
        buyerId: true,
        listingId: true,
        createdAt: true,
      },
      orderBy: [{ buyerId: "asc" }, { createdAt: "asc" }],
      take: MAX_TRANSACTIONS_SCAN,
    }) as SequenceTx[];

    if (txs.length === 0) return [];

    const pairCounts = new Map<string, number>();
    const tripleCounts = new Map<string, number>();

    let currentBuyer = "";
    let lastTs = 0;
    let session: string[] = [];

    for (const tx of txs) {
      const ts = tx.createdAt.getTime();
      const sameSession =
        tx.buyerId === currentBuyer &&
        ts - lastTs <= SESSION_GAP_MS;

      if (!sameSession && session.length > 0) {
        this.tallySession(session, pairCounts, tripleCounts);
        session = [];
      }

      currentBuyer = tx.buyerId;
      lastTs = ts;
      session.push(tx.listingId);
    }

    if (session.length > 0) {
      this.tallySession(session, pairCounts, tripleCounts);
    }

    const patterns: Pattern[] = [];
    for (const [key, support] of tripleCounts) {
      if (support < MIN_TRIPLE_SUPPORT) continue;
      const ids = key.split("|");
      if (!ids.every((id) => activeListingIds.has(id))) continue;
      patterns.push({ listingIds: ids, support });
    }

    for (const [key, support] of pairCounts) {
      if (support < MIN_PAIR_SUPPORT) continue;
      const ids = key.split("|");
      if (!ids.every((id) => activeListingIds.has(id))) continue;
      patterns.push({ listingIds: ids, support });
    }

    patterns.sort((a, b) => b.support - a.support);
    return patterns.slice(0, 20);
  }

  private tallySession(
    rawSession: string[],
    pairCounts: Map<string, number>,
    tripleCounts: Map<string, number>,
  ): void {
    // Remove immediate repeats (A,A,B -> A,B) but keep overall order.
    const session: string[] = [];
    for (const listingId of rawSession) {
      if (session[session.length - 1] !== listingId) {
        session.push(listingId);
      }
    }
    if (session.length < 2) return;

    for (let i = 0; i < session.length - 1; i++) {
      const pair = [session[i], session[i + 1]];
      if (new Set(pair).size < 2) continue;
      const key = pair.join("|");
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
    }

    for (let i = 0; i < session.length - 2; i++) {
      const triple = [session[i], session[i + 1], session[i + 2]];
      if (new Set(triple).size < 2) continue;
      const key = triple.join("|");
      tripleCounts.set(key, (tripleCounts.get(key) ?? 0) + 1);
    }
  }

  private patternToSteps(
    pattern: Pattern,
    byId: Map<string, DiscoveredListing>,
  ): BundleStep[] {
    const steps: BundleStep[] = [];
    for (const listingId of pattern.listingIds) {
      const listing = byId.get(listingId);
      if (!listing) return [];
      steps.push({
        listingId: listing.id,
        slug: listing.slug,
        name: listing.name,
        categorySlug: listing.categorySlug,
        currentPriceUsdc: listing.currentPriceUsdc,
        qualityScore: listing.qualityScore,
      });
    }
    return steps;
  }

  private async computeSemanticCohesion(steps: BundleStep[]): Promise<number> {
    if (steps.length < 2) return 1;

    const similarities: number[] = [];

    for (let i = 0; i < steps.length - 1; i++) {
      const a = steps[i];
      const b = steps[i + 1];
      const row = await this.prisma.$queryRaw<Array<{ similarity: number | null }>>(Prisma.sql`
        SELECT
          CASE
            WHEN a.embedding IS NULL OR b.embedding IS NULL THEN NULL
            ELSE 1 - (a.embedding <=> b.embedding)
          END AS similarity
        FROM listings a
        CROSS JOIN listings b
        WHERE a.id = ${a.listingId}::uuid
          AND b.id = ${b.listingId}::uuid
      `);

      const sim = row[0]?.similarity;
      if (typeof sim === "number") {
        similarities.push(clamp01(sim));
      } else {
        similarities.push(this.lexicalSimilarity(a, b));
      }
    }

    return clamp01(
      similarities.reduce((sum, value) => sum + value, 0) / similarities.length,
    );
  }

  private lexicalSimilarity(a: BundleStep, b: BundleStep): number {
    const categoryScore = a.categorySlug === b.categorySlug ? 0.65 : 0.25;
    const tokensA = tokenize(`${a.name} ${a.slug} ${a.categorySlug}`);
    const tokensB = tokenize(`${b.name} ${b.slug} ${b.categorySlug}`);
    const overlap = jaccard(tokensA, tokensB);
    return clamp01(categoryScore * 0.7 + overlap * 0.3);
  }

  private computeBundleQuality(steps: BundleStep[]): number {
    const avg = steps.reduce((sum, s) => sum + s.qualityScore, 0) / steps.length;
    const min = Math.min(...steps.map((s) => s.qualityScore));
    return clamp01(avg * 0.6 + min * 0.4);
  }

  private computeDiscountPct(
    support: number,
    semanticCohesion: number,
    qualityScore: number,
    stepCount: number,
  ): number {
    const base = 0.04;
    const supportBoost = Math.min(0.08, (Math.log(1 + support) / Math.log(12)) * 0.08);
    const semanticBoost = Math.max(0, semanticCohesion - 0.5) * 0.08;
    const qualityBoost = Math.max(0, qualityScore - 0.65) * 0.05;
    const chainBoost = stepCount >= 3 ? 0.03 : 0.01;
    return round4(clamp(base + supportBoost + semanticBoost + qualityBoost + chainBoost, 0.03, 0.2));
  }

  private computeBundleScore(
    support: number,
    semanticCohesion: number,
    qualityScore: number,
    grossPriceUsdc: number,
  ): number {
    const frequencyScore = clamp01(support / 10);
    const priceEfficiency = clamp01(1 / (1 + grossPriceUsdc * 20));
    return round4(
      frequencyScore * 0.45 +
      semanticCohesion * 0.25 +
      qualityScore * 0.2 +
      priceEfficiency * 0.1,
    );
  }

  private buildBundleSlug(steps: BundleStep[]): string {
    const inferred = inferActionTokens(steps).slice(0, 3);
    const fallback = steps
      .map((s) => s.slug.split("-")[0] || "api")
      .slice(0, 3);
    const tokens = inferred.length > 0 ? inferred : fallback;
    const base = `bundle-${tokens.join("-")}`;
    const suffix = createStableSuffix(steps.map((s) => s.listingId).join("|"));
    return `${base}-${suffix}`;
  }

  private buildDescription(input: {
    steps: BundleStep[];
    support: number;
    grossPriceUsdc: number;
    bundlePriceUsdc: number;
    discountPct: number;
    qualityScore: number;
    semanticCohesion: number;
  }): string {
    const chain = input.steps.map((s) => s.slug).join(" -> ");
    return [
      `Composite bundle generated from observed agent workflows.`,
      `Chain: ${chain}`,
      `Observed support: ${input.support} sequential sessions`,
      `Bundle price: $${input.bundlePriceUsdc.toFixed(6)} USDC ` +
        `(gross $${input.grossPriceUsdc.toFixed(6)}, discount ${(input.discountPct * 100).toFixed(1)}%)`,
      `Quality: ${(input.qualityScore * 100).toFixed(1)}%`,
      `Semantic cohesion: ${(input.semanticCohesion * 100).toFixed(1)}%`,
      `Executes all steps server-side in one MCP call.`,
    ].join("\n");
  }
}

export function bundleSlugToToolName(slug: string): string {
  return `nexusx_${slug.replace(/-/g, "_")}`;
}

function inferActionTokens(steps: BundleStep[]): string[] {
  const mapping: Array<{ re: RegExp; token: string }> = [
    { re: /(translate|translation|localiz)/, token: "translate" },
    { re: /(sentiment|classif|analy)/, token: "analyze" },
    { re: /(summary|summariz)/, token: "summarize" },
    { re: /(embed|vector)/, token: "embed" },
    { re: /(search|retriev)/, token: "search" },
    { re: /(vision|image|detect)/, token: "vision" },
    { re: /(speech|audio|transcrib)/, token: "speech" },
    { re: /(code|program)/, token: "code" },
  ];

  const tokens: string[] = [];
  for (const step of steps) {
    const text = `${step.name} ${step.slug} ${step.categorySlug}`.toLowerCase();
    const matched = mapping.find((m) => m.re.test(text));
    if (matched && !tokens.includes(matched.token)) {
      tokens.push(matched.token);
    }
  }
  return tokens;
}

function dedupeBundles(bundles: BundleDefinition[]): BundleDefinition[] {
  const bySequence = new Map<string, BundleDefinition>();
  for (const bundle of bundles) {
    const key = bundle.steps.map((s) => s.listingId).join("|");
    const current = bySequence.get(key);
    if (!current || bundle.score > current.score) {
      bySequence.set(key, bundle);
    }
  }
  return Array.from(bySequence.values());
}

function tokenize(text: string): Set<string> {
  const set = new Set<string>();
  for (const token of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (token.length > 2) set.add(token);
  }
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersect = 0;
  for (const token of a) {
    if (b.has(token)) intersect++;
  }
  const union = a.size + b.size - intersect;
  return union > 0 ? intersect / union : 0;
}

function createStableSuffix(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 6);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
