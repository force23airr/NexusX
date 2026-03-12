import { PublicSourceStatus, PublicSourceType, ListingProvenanceKind, ListingSupplyTier, ListingVerificationState } from "@prisma/client";
import { sanitizeUrlField } from "@/lib/providerListing";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function optionalString(value: unknown, max = 5000): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new Error("Expected a string value");
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function requiredString(value: unknown, field: string, max = 500): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
  return value.trim().slice(0, max);
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new Error("Expected a boolean value");
  }
  return value;
}

function parseEnumValue<T extends string>(
  value: unknown,
  valid: readonly T[],
  field: string,
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !valid.includes(value as T)) {
    throw new Error(`Invalid ${field}`);
  }
  return value as T;
}

export async function extractPublicSourceWriteData(
  body: Record<string, unknown>,
  options: { partial?: boolean } = {},
): Promise<Record<string, unknown>> {
  const partial = options.partial ?? false;
  const data: Record<string, unknown> = {};

  if (!partial || body.name !== undefined) {
    const name = partial ? optionalString(body.name, 200) : requiredString(body.name, "name", 200);
    if (!partial || name !== undefined) data.name = name;
  }

  if (!partial || body.slug !== undefined || body.name !== undefined) {
    if (body.slug === undefined && !partial && typeof body.name === "string") {
      data.slug = slugify(body.name);
    } else if (body.slug !== undefined) {
      const slug = requiredString(body.slug, "slug", 120).toLowerCase();
      if (!SLUG_PATTERN.test(slug)) {
        throw new Error("slug must use lowercase letters, numbers, and hyphens only");
      }
      data.slug = slug;
    }
  }

  const sourceType = parseEnumValue(
    body.sourceType,
    Object.values(PublicSourceType),
    "sourceType",
  );
  if (!partial || sourceType !== undefined) {
    if (!sourceType && !partial) throw new Error("sourceType is required");
    if (sourceType) data.sourceType = sourceType;
  }

  const catalogUrl = await sanitizeUrlField(body.catalogUrl, { required: !partial });
  if (!partial || catalogUrl !== undefined) {
    if (!catalogUrl && !partial) throw new Error("catalogUrl is required");
    if (catalogUrl !== undefined) data.catalogUrl = catalogUrl;
  }

  const baseUrl = await sanitizeUrlField(body.baseUrl);
  if (baseUrl !== undefined) data.baseUrl = baseUrl;

  const ownerUrl = await sanitizeUrlField(body.ownerUrl);
  if (ownerUrl !== undefined) data.ownerUrl = ownerUrl;

  const termsUrl = await sanitizeUrlField(body.termsUrl);
  if (termsUrl !== undefined) data.termsUrl = termsUrl;

  const ownerName = optionalString(body.ownerName, 200);
  if (ownerName !== undefined) data.ownerName = ownerName;

  const license = optionalString(body.license, 120);
  if (license !== undefined) data.license = license;

  const notes = optionalString(body.notes, 4000);
  if (notes !== undefined) data.notes = notes;

  const status = parseEnumValue(
    body.status,
    Object.values(PublicSourceStatus),
    "status",
  );
  if (status !== undefined) data.status = status;

  const attributionRequired = optionalBoolean(body.attributionRequired);
  if (attributionRequired !== undefined) data.attributionRequired = attributionRequired;

  const allowDiscovery = optionalBoolean(body.allowDiscovery);
  if (allowDiscovery !== undefined) data.allowDiscovery = allowDiscovery;

  const allowExecution = optionalBoolean(body.allowExecution);
  if (allowExecution !== undefined) data.allowExecution = allowExecution;

  return data;
}

export async function extractListingProvenanceWriteData(
  body: Record<string, unknown>,
): Promise<{
  provenance: Record<string, unknown>;
  listing: Record<string, unknown>;
}> {
  const kind = parseEnumValue(
    body.kind,
    Object.values(ListingProvenanceKind),
    "kind",
  );
  if (!kind) {
    throw new Error("kind is required");
  }

  const publicSourceId = optionalString(body.publicSourceId, 100);
  if (kind === "PUBLIC_SOURCE" && !publicSourceId) {
    throw new Error("publicSourceId is required for PUBLIC_SOURCE provenance");
  }
  if (kind !== "PUBLIC_SOURCE" && publicSourceId) {
    throw new Error("publicSourceId is only allowed for PUBLIC_SOURCE provenance");
  }

  const supplyTier = parseEnumValue(
    body.supplyTier,
    Object.values(ListingSupplyTier),
    "supplyTier",
  );
  const verificationState = parseEnumValue(
    body.verificationState,
    Object.values(ListingVerificationState),
    "verificationState",
  );
  const verificationReason = optionalString(body.verificationReason, 1000);

  const externalUrl = await sanitizeUrlField(body.externalUrl);

  return {
    provenance: {
      kind,
      publicSourceId: publicSourceId ?? null,
      externalId: optionalString(body.externalId, 255) ?? null,
      externalUrl: externalUrl ?? null,
      externalVersion: optionalString(body.externalVersion, 255) ?? null,
      attribution: optionalString(body.attribution, 1000) ?? null,
      usageNotes: optionalString(body.usageNotes, 2000) ?? null,
      lastSeenAt: body.lastSeenAt instanceof Date ? body.lastSeenAt : undefined,
    },
    listing: {
      sourceControlled: kind === "PUBLIC_SOURCE",
      ...(supplyTier ? { supplyTier } : {}),
      ...(verificationState ? { verificationState } : {}),
      ...(verificationReason !== undefined ? { verificationReason } : {}),
    },
  };
}
