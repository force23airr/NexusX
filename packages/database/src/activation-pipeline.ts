// ═══════════════════════════════════════════════════════════════
// NexusX — Activation Pipeline
// packages/database/src/activation-pipeline.ts
//
// Durable activation indexing for listings. When a listing is
// activated, it gets enqueued here. The IndexingWorker processes
// each event: generates synthetic queries, embeds into pgvector,
// and increments the listing's index version.
// ═══════════════════════════════════════════════════════════════

import type { PrismaClient } from "@prisma/client";
import { generateSyntheticQueries } from "./synthetic-queries";
import { embedListing, type EmbeddingConfig } from "./embeddings";

// ─── Types ───────────────────────────────────────────────────

export interface ActivationEvent {
  type: "LISTING_ACTIVATED";
  listingId: string;
  timestamp: Date;
}

export interface ActivationPipelineResult {
  syntheticQueriesGenerated: number;
  embedded: boolean;
  indexedVersion: number;
  errors: string[];
}

// ─── Enqueue ─────────────────────────────────────────────────

/**
 * Enqueue a listing activation event for the IndexingWorker.
 * Called from the activation route after setting status = ACTIVE.
 */
export async function enqueueActivationEvent(
  prisma: PrismaClient,
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`embedding: ${msg}`);
      console.error(`[ActivationPipeline] Embedding failed for ${listingId}:`, msg);
    }
  } else {
    errors.push("embedding: OPENAI_API_KEY not set, skipping");
    console.warn(`[ActivationPipeline] OPENAI_API_KEY not set — skipping embedding for ${listingId}`);
  }

  // 3. Check for demand gap match (gives listing a temporary boost)
  try {
    const { checkDemandGapMatch } = await import("./demand-gap-tracker");
    const gap = await checkDemandGapMatch(prisma, listingId);
    if (gap) {
      const boostExpiry = new Date();
      boostExpiry.setDate(boostExpiry.getDate() + 7);
      await prisma.listing.update({
        where: { id: listingId },
        data: {
          // Store boost info in the listing's existing metadata-like field
          // Using domainMetadata which is a Json? field added in Phase 2
          domainMetadata: {
            demandGapBoost: true,
            boostExpiresAt: boostExpiry.toISOString(),
            resolvedGapId: gap.id,
          },
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
    syntheticQueriesGenerated,
    embedded,
    indexedVersion: updated.listingIndexVersion,
    errors,
  };
}
