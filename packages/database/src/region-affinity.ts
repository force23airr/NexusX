import type { Prisma } from "@prisma/client";

export interface RegionAffinityResult {
  score: number;
  reason: string | null;
}

const REGION_BUCKETS: Array<{
  bucket: string;
  countries: readonly string[];
}> = [
  { bucket: "NA", countries: ["US", "CA", "MX"] },
  { bucket: "LATAM", countries: ["AR", "BR", "CL", "CO", "CR", "DO", "EC", "GT", "HN", "NI", "PA", "PE", "PR", "PY", "SV", "UY", "VE"] },
  { bucket: "EU", countries: ["AT", "BE", "BG", "CH", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GB", "GR", "HR", "HU", "IE", "IS", "IT", "LT", "LU", "LV", "MT", "NL", "NO", "PL", "PT", "RO", "SE", "SI", "SK"] },
  { bucket: "MEA", countries: ["AE", "BH", "DZ", "EG", "IL", "IQ", "JO", "KE", "KW", "LB", "MA", "NG", "OM", "QA", "SA", "TN", "TR", "ZA"] },
  { bucket: "APAC", countries: ["AU", "BD", "CN", "HK", "ID", "IN", "JP", "KR", "LK", "MO", "MY", "NZ", "PH", "PK", "SG", "TH", "TW", "VN"] },
];

const REGION_SYNONYMS: Record<string, string> = {
  NORTH_AMERICA: "NA",
  "NORTH-AMERICA": "NA",
  NA: "NA",
  LATAM: "LATAM",
  LATIN_AMERICA: "LATAM",
  "LATIN-AMERICA": "LATAM",
  SOUTH_AMERICA: "LATAM",
  "SOUTH-AMERICA": "LATAM",
  EUROPE: "EU",
  EU: "EU",
  EMEA: "MEA",
  MEA: "MEA",
  MIDDLE_EAST: "MEA",
  "MIDDLE-EAST": "MEA",
  AFRICA: "MEA",
  APAC: "APAC",
  ASIA: "APAC",
  ASIA_PACIFIC: "APAC",
  "ASIA-PACIFIC": "APAC",
};

function isJsonObject(value: Prisma.JsonValue | null | undefined): value is Prisma.JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeToken(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "_");
}

function normalizeBucket(token: string): string | null {
  const normalized = normalizeToken(token);
  return REGION_SYNONYMS[normalized] ?? null;
}

export function inferRegionBucket(countryCode: string | null | undefined): string | null {
  if (!countryCode) return null;
  const country = normalizeToken(countryCode);
  for (const entry of REGION_BUCKETS) {
    if (entry.countries.includes(country)) {
      return entry.bucket;
    }
  }
  return null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function extractRoutingRegionHints(domainMetadata: Prisma.JsonValue | null | undefined): Set<string> {
  if (!isJsonObject(domainMetadata)) return new Set<string>();

  const rootLatencyRegions = readStringArray(domainMetadata.latencyRegions);
  const rootRoutingRegions = readStringArray(domainMetadata.routingRegions);
  const rootEdgeRegions = readStringArray(domainMetadata.edgeRegions);
  const nestedRouting = isJsonObject(domainMetadata.nexusxRouting as Prisma.JsonValue | undefined)
    ? (domainMetadata.nexusxRouting as Prisma.JsonObject)
    : null;
  const nestedLatencyRegions = nestedRouting ? readStringArray(nestedRouting.latencyRegions) : [];
  const nestedRoutingRegions = nestedRouting ? readStringArray(nestedRouting.routingRegions) : [];
  const nestedEdgeRegions = nestedRouting ? readStringArray(nestedRouting.edgeRegions) : [];

  return new Set([
    ...rootLatencyRegions,
    ...rootRoutingRegions,
    ...rootEdgeRegions,
    ...nestedLatencyRegions,
    ...nestedRoutingRegions,
    ...nestedEdgeRegions,
  ].map(normalizeToken));
}

export function computeRegionAffinity(input: {
  availabilityRegion?: string;
  availabilityRegions?: string[];
  domainMetadata?: Prisma.JsonValue | null;
}): RegionAffinityResult {
  const callerCountry = input.availabilityRegion ? normalizeToken(input.availabilityRegion) : null;
  if (!callerCountry) {
    return { score: 0, reason: null };
  }

  const callerBucket = inferRegionBucket(callerCountry);
  const regionHints = extractRoutingRegionHints(input.domainMetadata);
  const normalizedAvailability = (input.availabilityRegions ?? []).map(normalizeToken);

  if (regionHints.has(callerCountry)) {
    return {
      score: 1,
      reason: `Routing optimized for ${callerCountry}.`,
    };
  }

  if (callerBucket && Array.from(regionHints).some((token) => normalizeBucket(token) === callerBucket)) {
    return {
      score: 0.9,
      reason: `Routing optimized for ${callerBucket}.`,
    };
  }

  if (normalizedAvailability.includes(callerCountry)) {
    return {
      score: 0.72,
      reason: `Available directly in ${callerCountry}.`,
    };
  }

  if (normalizedAvailability.length === 0) {
    return {
      score: 0.45,
      reason: "Globally available.",
    };
  }

  return {
    score: 0,
    reason: null,
  };
}
