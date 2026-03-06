import { ListingType } from "@prisma/client";
import { assertSafeHttpUrl } from "@/lib/ssrf";

const MAX_ARRAY_ITEMS = 32;
const ISO_COUNTRY = /^[A-Z]{2}$/;
const SAFE_TOKEN = /^[a-z0-9][a-z0-9:_./-]{0,63}$/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sanitizeStringArray(
  value: unknown,
  options: {
    maxItems?: number;
    uppercase?: boolean;
    tokenPattern?: RegExp;
  } = {},
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error("Expected an array of strings");
  }

  const maxItems = options.maxItems ?? MAX_ARRAY_ITEMS;
  const unique = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string") {
      throw new Error("Expected an array of strings");
    }

    const normalized = options.uppercase ? item.trim().toUpperCase() : item.trim();
    if (!normalized) continue;
    if (options.tokenPattern && !options.tokenPattern.test(normalized)) {
      throw new Error(`Invalid metadata value: ${normalized}`);
    }
    unique.add(normalized);
  }

  if (unique.size > maxItems) {
    throw new Error(`Too many metadata values. Maximum is ${maxItems}.`);
  }

  return Array.from(unique);
}

export async function sanitizeUrlField(
  value: unknown,
  options: { required?: boolean } = {},
): Promise<string | null | undefined> {
  if (value === undefined) return undefined;
  if (value === null || value === "") {
    if (options.required) {
      throw new Error("This URL field is required");
    }
    return null;
  }
  if (typeof value !== "string") {
    throw new Error("URL fields must be strings");
  }

  const parsed = await assertSafeHttpUrl(value);
  return parsed.toString().replace(/\/$/, "");
}

export async function extractListingWriteData(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const data: Record<string, unknown> = {};

  const baseUrl = await sanitizeUrlField(body.baseUrl, { required: true });
  if (baseUrl !== undefined) data.baseUrl = baseUrl;

  const optionalUrlFields = ["healthCheckUrl", "docsUrl", "sandboxUrl"] as const;
  for (const field of optionalUrlFields) {
    const sanitized = await sanitizeUrlField(body[field]);
    if (sanitized !== undefined) {
      data[field] = sanitized;
    }
  }

  const arrayFields = {
    tags: sanitizeStringArray(body.tags, { maxItems: 24, tokenPattern: SAFE_TOKEN }),
    intents: sanitizeStringArray(body.intents, { maxItems: 24, tokenPattern: SAFE_TOKEN }),
    availabilityRegions: sanitizeStringArray(body.availabilityRegions, { maxItems: 24, uppercase: true, tokenPattern: ISO_COUNTRY }),
    restrictedRegions: sanitizeStringArray(body.restrictedRegions, { maxItems: 24, uppercase: true, tokenPattern: ISO_COUNTRY }),
    complianceTags: sanitizeStringArray(body.complianceTags, { maxItems: 24, tokenPattern: SAFE_TOKEN }),
    capabilityTags: sanitizeStringArray(body.capabilityTags, { maxItems: 32, tokenPattern: SAFE_TOKEN }),
    inputModalities: sanitizeStringArray(body.inputModalities, { maxItems: 12, tokenPattern: SAFE_TOKEN }),
    outputModalities: sanitizeStringArray(body.outputModalities, { maxItems: 12, tokenPattern: SAFE_TOKEN }),
  };

  for (const [field, value] of Object.entries(arrayFields)) {
    if (value !== undefined) {
      data[field] = value;
    }
  }

  if (body.domainMetadata !== undefined) {
    if (body.domainMetadata === null) {
      data.domainMetadata = null;
    } else if (isPlainObject(body.domainMetadata)) {
      const encoded = JSON.stringify(body.domainMetadata);
      if (encoded.length > 20_000) {
        throw new Error("domainMetadata is too large");
      }
      data.domainMetadata = body.domainMetadata;
    } else {
      throw new Error("domainMetadata must be a plain JSON object");
    }
  }

  if (body.listingType !== undefined) {
    if (typeof body.listingType !== "string" || !Object.values(ListingType).includes(body.listingType as ListingType)) {
      throw new Error("Invalid listingType");
    }
    data.listingType = body.listingType;
  }

  if (body.authType !== undefined) {
    if (typeof body.authType !== "string" || body.authType.trim().length === 0) {
      throw new Error("Invalid authType");
    }
    data.authType = body.authType.trim();
  }

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim().length < 3) {
      throw new Error("name must be at least 3 characters");
    }
    data.name = body.name.trim();
  }

  if (body.description !== undefined) {
    if (typeof body.description !== "string") {
      throw new Error("description must be a string");
    }
    data.description = body.description.trim();
  }

  if (body.capacityPerMinute !== undefined) {
    const value = Number(body.capacityPerMinute);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error("capacityPerMinute must be a positive number");
    }
    data.capacityPerMinute = Math.floor(value);
  }

  if (body.isUnique !== undefined) {
    data.isUnique = Boolean(body.isUnique);
  }

  if (body.floorPriceUsdc !== undefined) {
    const value = Number(body.floorPriceUsdc);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error("floorPriceUsdc must be a non-negative number");
    }
    data.floorPriceUsdc = value;
  }

  if (body.ceilingPriceUsdc !== undefined) {
    if (body.ceilingPriceUsdc === null || body.ceilingPriceUsdc === "") {
      data.ceilingPriceUsdc = null;
    } else {
      const value = Number(body.ceilingPriceUsdc);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error("ceilingPriceUsdc must be a non-negative number");
      }
      data.ceilingPriceUsdc = value;
    }
  }

  if (body.categoryId !== undefined) {
    if (typeof body.categoryId !== "string" || body.categoryId.trim().length === 0) {
      throw new Error("Invalid categoryId");
    }
    data.categoryId = body.categoryId;
  }

  if (body.sampleRequest !== undefined) {
    data.sampleRequest = body.sampleRequest ?? undefined;
  }
  if (body.sampleResponse !== undefined) {
    data.sampleResponse = body.sampleResponse ?? undefined;
  }
  if (body.videoUrl !== undefined) {
    if (body.videoUrl === null || body.videoUrl === "") {
      data.schemaSpec = undefined;
    } else if (typeof body.videoUrl === "string") {
      data.schemaSpec = { videoUrl: body.videoUrl.trim() };
    } else {
      throw new Error("videoUrl must be a string");
    }
  }

  return data;
}

export async function validateActivationReadiness(listing: {
  baseUrl: string;
  healthCheckUrl?: string | null;
  sandboxUrl?: string | null;
  docsUrl?: string | null;
  description: string;
  tags: string[];
  intents: string[];
  capabilityTags?: string[];
}): Promise<string[]> {
  const errors: string[] = [];

  for (const [label, value] of [
    ["baseUrl", listing.baseUrl],
    ["healthCheckUrl", listing.healthCheckUrl],
    ["sandboxUrl", listing.sandboxUrl],
    ["docsUrl", listing.docsUrl],
  ] as const) {
    if (!value) continue;
    try {
      await assertSafeHttpUrl(value);
    } catch (error) {
      errors.push(`${label}: ${error instanceof Error ? error.message : "invalid URL"}`);
    }
  }

  if (listing.description.trim().length < 20) {
    errors.push("description must be at least 20 characters before activation");
  }

  const discoverySignals =
    listing.tags.length + listing.intents.length + (listing.capabilityTags?.length ?? 0);
  if (discoverySignals === 0) {
    errors.push("add tags, intents, or capabilityTags before activation so agents can discover the listing");
  }

  return errors;
}
