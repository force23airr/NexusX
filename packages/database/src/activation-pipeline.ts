// ═══════════════════════════════════════════════════════════════
// NexusX — Activation Pipeline
// packages/database/src/activation-pipeline.ts
//
// Durable activation indexing for listings. When a listing is
// activated, it gets enqueued here. The IndexingWorker processes
// each event: generates synthetic queries, embeds into pgvector,
// and increments the listing's index version.
// ═══════════════════════════════════════════════════════════════

import type { Prisma, PrismaClient } from "@prisma/client";
import { generateSyntheticQueries } from "./synthetic-queries";
import { embedListing, type EmbeddingConfig } from "./embeddings";

// ─── Types ───────────────────────────────────────────────────

export interface ActivationEvent {
  type: "LISTING_ACTIVATED";
  listingId: string;
  timestamp: Date;
}

export interface ActivationPipelineResult {
  success: boolean;
  retryable: boolean;
  syntheticQueriesGenerated: number;
  embedded: boolean;
  indexedVersion: number | null;
  errors: string[];
  failureReason?: string;
}

type ActivationDbClient = PrismaClient | Prisma.TransactionClient;

function isJsonObject(value: Prisma.JsonValue | null | undefined): value is Prisma.JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeDiscoveryMetadata(
  existing: Prisma.JsonValue | null,
  gapId: string,
  boostExpiry: Date,
): Prisma.InputJsonValue {
  const root = isJsonObject(existing) ? { ...existing } : {};
  const existingDiscovery = isJsonObject(root.nexusxDiscovery as Prisma.JsonValue | undefined)
    ? { ...(root.nexusxDiscovery as Prisma.JsonObject) }
    : {};

  return {
    ...root,
    nexusxDiscovery: {
      ...existingDiscovery,
      demandGapBoost: true,
      boostExpiresAt: boostExpiry.toISOString(),
      resolvedGapId: gapId,
    },
  };
}

// ─── Enqueue ─────────────────────────────────────────────────

/**
 * Enqueue a listing activation event for the IndexingWorker.
 * Called from the activation route after setting status = ACTIVE.
 */
export async function enqueueActivationEvent(
  prisma: ActivationDbClient,
  event: ActivationEvent,
): Promise<void> {
  await prisma.pendingActivation.create({
    data: {
      listingId: event.listingId,
      eventType: event.type,
    },
  });
}

// ─── Process ─────────────────────────────────────────────────

/**
 * Process a single activation event: generate synthetic queries,
 * embed listing, increment index version.
 *
 * Called by the IndexingWorker, not by the route.
 */
export async function processActivation(
  prisma: PrismaClient,
  listingId: string,
): Promise<ActivationPipelineResult> {
  const errors: string[] = [];
  let syntheticQueriesGenerated = 0;
  let embedded = false;
  let failureReason: string | undefined;

  // 1. Generate synthetic queries
  try {
    const queries = await generateSyntheticQueries(prisma, listingId, { force: true });
    syntheticQueriesGenerated = queries.length;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`synthetic-queries: ${msg}`);
    console.error(`[ActivationPipeline] Synthetic query generation failed for ${listingId}:`, msg);
  }

  // 2. Embed listing into pgvector
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (openaiApiKey) {
    const config: EmbeddingConfig = { openaiApiKey };
    try {
      embedded = await embedListing(prisma, listingId, config, { force: true });
      if (!embedded) {
        failureReason = "Listing could not be embedded.";
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`embedding: ${msg}`);
      console.error(`[ActivationPipeline] Embedding failed for ${listingId}:`, msg);
      failureReason = `Embedding failed: ${msg}`;
    }
  } else {
    failureReason = "OPENAI_API_KEY not set";
    console.warn(`[ActivationPipeline] OPENAI_API_KEY not set — cannot index ${listingId}`);
  }

  if (!embedded) {
    return {
      success: false,
      retryable: failureReason !== "Listing could not be embedded.",
      syntheticQueriesGenerated,
      embedded,
      indexedVersion: null,
      errors,
      failureReason,
    };
  }

  // 3. Check for demand gap match (gives listing a temporary boost)
  try {
    const { checkDemandGapMatch } = await import("./demand-gap-tracker");
    const gap = await checkDemandGapMatch(prisma, listingId);
    if (gap) {
      const boostExpiry = new Date();
      boostExpiry.setDate(boostExpiry.getDate() + 7);
      const listing = await prisma.listing.findUnique({
        where: { id: listingId },
        select: { domainMetadata: true },
      });
      await prisma.listing.update({
        where: { id: listingId },
        data: {
          domainMetadata: mergeDiscoveryMetadata(listing?.domainMetadata ?? null, gap.id, boostExpiry),
        },
      });
      console.log(`[ActivationPipeline] Listing ${listingId} resolves demand gap "${gap.intentCluster}" (${gap.queryCount} queries)`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`demand-gap-check: ${msg}`);
  }

  // 4. Increment listing index version
  const updated = await prisma.listing.update({
    where: { id: listingId },
    data: { listingIndexVersion: { increment: 1 } },
    select: { listingIndexVersion: true },
  });

  return {
    success: true,
    retryable: false,
    syntheticQueriesGenerated,
    embedded,
    indexedVersion: updated.listingIndexVersion,
    errors,
    failureReason,
  };
}
