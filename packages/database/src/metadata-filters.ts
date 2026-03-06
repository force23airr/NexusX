// ═══════════════════════════════════════════════════════════════
// NexusX — Metadata Filters
// packages/database/src/metadata-filters.ts
//
// Hard metadata filters applied BEFORE semantic search.
// Eliminates irrelevant results deterministically: if an API
// doesn't serve Asia, it never appears for an Asian agent.
// ═══════════════════════════════════════════════════════════════

import { Prisma } from "@prisma/client";

export interface MetadataFilters {
  /** Caller's country code (ISO 3166-1 alpha-2). Filters by availabilityRegions/restrictedRegions. */
  availabilityRegion?: string;
  /** Required compliance certifications — listing must have ALL of these. */
  complianceRequired?: string[];
  /** Required capabilities — listing must have ANY of these. */
  capabilityRequired?: string[];
  /** Required input modalities — listing must support ANY of these. */
  inputModality?: string[];
  /** Required output modalities — listing must support ANY of these. */
  outputModality?: string[];
  /** Filter by listing type (e.g., "API", "DATASET"). */
  listingType?: string;
  /** Maximum price in USDC. */
  maxPriceUsdc?: number;
  /** Minimum capacity in requests per minute. */
  minCapacityRpm?: number;
}

/**
 * Build a Prisma `where` clause from metadata filters.
 * All conditions are ANDed together — every filter must pass.
 */
export function buildMetadataWhereClause(
  filters: MetadataFilters,
): Prisma.ListingWhereInput {
  const conditions: Prisma.ListingWhereInput[] = [];

  // Always filter to active listings
  conditions.push({ status: "ACTIVE" });

  // Geo availability: listing is global (empty array) OR contains the region
  // AND restricted regions do NOT contain the region
  if (filters.availabilityRegion) {
    const region = filters.availabilityRegion.toUpperCase();
    conditions.push({
      OR: [
        { availabilityRegions: { isEmpty: true } },
        { availabilityRegions: { has: region } },
      ],
    });
    conditions.push({
      NOT: { restrictedRegions: { has: region } },
    });
  }

  // Compliance: listing must have ALL required tags
  if (filters.complianceRequired && filters.complianceRequired.length > 0) {
    conditions.push({
      complianceTags: { hasEvery: filters.complianceRequired },
    });
  }

  // Capabilities: listing must have ANY required tag
  if (filters.capabilityRequired && filters.capabilityRequired.length > 0) {
    conditions.push({
      capabilityTags: { hasSome: filters.capabilityRequired },
    });
  }

  // Input modalities: listing must support ANY required modality
  if (filters.inputModality && filters.inputModality.length > 0) {
    conditions.push({
      inputModalities: { hasSome: filters.inputModality },
    });
  }

  // Output modalities: listing must support ANY required modality
  if (filters.outputModality && filters.outputModality.length > 0) {
    conditions.push({
      outputModalities: { hasSome: filters.outputModality },
    });
  }

  // Listing type
  if (filters.listingType) {
    conditions.push({
      listingType: filters.listingType as Prisma.EnumListingTypeFilter["equals"],
    });
  }

  // Max price
  if (filters.maxPriceUsdc !== undefined) {
    conditions.push({
      currentPriceUsdc: { lte: filters.maxPriceUsdc },
    });
  }

  // Min capacity
  if (filters.minCapacityRpm !== undefined) {
    conditions.push({
      capacityPerMinute: { gte: filters.minCapacityRpm },
    });
  }

  return { AND: conditions };
}
