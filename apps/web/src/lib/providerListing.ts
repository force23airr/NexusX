import {
  ListingRiskLevel,
  ListingSideEffectLevel,
  ListingType,
} from "@prisma/client";
import { assertSafeHttpUrl } from "@/lib/ssrf";
import {
  extractOperationContracts,
  sanitizeOperationContractsInput,
} from "@/lib/listingOperationContracts";

const MAX_ARRAY_ITEMS = 32;
const ISO_COUNTRY = /^[A-Z]{2}$/;
const SAFE_TOKEN = /^[a-z0-9][a-z0-9:_./-]{0,63}$/i;
const READY_DESCRIPTION_MIN_LENGTH = 40;

const DEFAULT_INTERACTION_MODES: Record<ListingType, string[]> = {
  REST_API: ["sync"],
  GRAPHQL_API: ["sync"],
  WEBSOCKET: ["streaming"],
  DATASET: ["batch"],
  MODEL_INFERENCE: ["sync"],
  COMPOSITE: ["sync"],
};

export interface ListingReadinessInput {
  listingType: ListingType;
  baseUrl: string;
  healthCheckUrl?: string | null;
  sandboxUrl?: string | null;
  docsUrl?: string | null;
  authType?: string | null;
  authSchemes?: string[];
  interactionModes?: string[];
  humanApprovalRequired?: boolean;
  noHealthProbe?: boolean;
  riskLevel?: ListingRiskLevel;
  sideEffectLevel?: ListingSideEffectLevel;
  description: string;
  tags: string[];
  intents: string[];
  capabilityTags?: string[];
  inputModalities?: string[];
  outputModalities?: string[];
  availabilityRegions?: string[];
  complianceTags?: string[];
  sampleRequest?: unknown | null;
  sampleResponse?: unknown | null;
  schemaSpec?: unknown | null;
  domainMetadata?: unknown | null;
}

export interface ListingReadinessReport {
  score: number;
  readyForActivation: boolean;
  blockers: string[];
  warnings: string[];
  normalized: {
    authSchemes: string[];
    interactionModes: string[];
    humanApprovalRequired: boolean;
    noHealthProbe: boolean;
    riskLevel: ListingRiskLevel;
    sideEffectLevel: ListingSideEffectLevel;
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasJsonContent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function mergeSchemaSpecValue(
  existing: unknown,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const base = isPlainObject(existing) ? { ...existing } : {};
  return { ...base, ...patch };
}

function deriveAuthSchemes(
  authType: string | null | undefined,
  authSchemes: string[] | undefined,
): string[] {
  if (authSchemes && authSchemes.length > 0) {
    return authSchemes;
  }
  const fallback = typeof authType === "string" ? authType.trim().toLowerCase() : "";
  return fallback ? [fallback] : [];
}

function inferInteractionModes(
  listingType: ListingType,
  interactionModes: string[] | undefined,
  schemaSpec: unknown,
): string[] {
  if (interactionModes && interactionModes.length > 0) {
    return interactionModes;
  }

  const inferred = new Set(DEFAULT_INTERACTION_MODES[listingType]);
  if (isPlainObject(schemaSpec)) {
    if (Array.isArray(schemaSpec.operations)) {
      for (const operation of schemaSpec.operations) {
        if (!isPlainObject(operation)) continue;
        if (typeof operation.mode === "string" && operation.mode.trim()) {
          inferred.add(operation.mode.trim().toLowerCase());
        }
      }
    }

    if (isPlainObject(schemaSpec.endpoint)) {
      const endpointMode = schemaSpec.endpoint.mode;
      if (typeof endpointMode === "string" && endpointMode.trim()) {
        inferred.add(endpointMode.trim().toLowerCase());
      }
    }
  }

  return Array.from(inferred);
}

function countOperationContracts(schemaSpec: unknown): number {
  const contracts = extractOperationContracts(schemaSpec);
  if (contracts.length > 0) return contracts.length;

  if (!isPlainObject(schemaSpec) || !isPlainObject(schemaSpec.endpoint)) {
    return 0;
  }

  const path = typeof schemaSpec.endpoint.path === "string" ? schemaSpec.endpoint.path.trim() : "";
  const method = typeof schemaSpec.endpoint.method === "string" ? schemaSpec.endpoint.method.trim() : "";
  return path || method ? 1 : 0;
}

function extractTemplateKeys(path: string): string[] {
  return Array.from(path.matchAll(/\{([^}]+)\}/g), (match) => match[1]);
}

function computeListingReadinessScore(input: {
  hasDiscoveryIntent: boolean;
  hasCapabilityTags: boolean;
  hasModalities: boolean;
  hasExecutionExamples: boolean;
  hasDocs: boolean;
  hasHealthStrategy: boolean;
  hasAvailabilitySignals: boolean;
  hasComplianceSignals: boolean;
  hasDomainMetadata: boolean;
  hasHumanApprovalPolicy: boolean;
}): number {
  let score = 0;

  if (input.hasDiscoveryIntent) score += 15;
  if (input.hasCapabilityTags) score += 15;
  if (input.hasModalities) score += 15;
  if (input.hasExecutionExamples) score += 20;
  if (input.hasHealthStrategy) score += 10;
  if (input.hasDocs) score += 10;
  if (input.hasAvailabilitySignals) score += 5;
  if (input.hasComplianceSignals) score += 5;
  if (input.hasDomainMetadata) score += 2;
  if (input.hasHumanApprovalPolicy) score += 3;

  return Math.max(0, Math.min(100, score));
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
    authSchemes: sanitizeStringArray(body.authSchemes, { maxItems: 8, tokenPattern: SAFE_TOKEN }),
    interactionModes: sanitizeStringArray(body.interactionModes, { maxItems: 8, tokenPattern: SAFE_TOKEN }),
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

  if (body.humanApprovalRequired !== undefined) {
    if (typeof body.humanApprovalRequired !== "boolean") {
      throw new Error("humanApprovalRequired must be a boolean");
    }
    data.humanApprovalRequired = body.humanApprovalRequired;
  }

  if (body.noHealthProbe !== undefined) {
    if (typeof body.noHealthProbe !== "boolean") {
      throw new Error("noHealthProbe must be a boolean");
    }
    data.noHealthProbe = body.noHealthProbe;
  }

  if (body.riskLevel !== undefined) {
    if (
      typeof body.riskLevel !== "string" ||
      !Object.values(ListingRiskLevel).includes(body.riskLevel as ListingRiskLevel)
    ) {
      throw new Error("Invalid riskLevel");
    }
    data.riskLevel = body.riskLevel;
  }

  if (body.sideEffectLevel !== undefined) {
    if (
      typeof body.sideEffectLevel !== "string" ||
      !Object.values(ListingSideEffectLevel).includes(body.sideEffectLevel as ListingSideEffectLevel)
    ) {
      throw new Error("Invalid sideEffectLevel");
    }
    data.sideEffectLevel = body.sideEffectLevel;
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
    data.sampleRequest = body.sampleRequest === null ? null : body.sampleRequest;
  }
  if (body.sampleResponse !== undefined) {
    data.sampleResponse = body.sampleResponse === null ? null : body.sampleResponse;
  }

  if (body.schemaSpec !== undefined) {
    if (body.schemaSpec === null || body.schemaSpec === "") {
      data.schemaSpec = null;
    } else if (isPlainObject(body.schemaSpec)) {
      data.schemaSpec = body.schemaSpec;
    } else {
      throw new Error("schemaSpec must be a plain JSON object");
    }
  }

  if (body.operationContracts !== undefined) {
    const operationContracts = sanitizeOperationContractsInput(body.operationContracts) ?? [];
    const baseSchemaSpec = isPlainObject(data.schemaSpec) ? data.schemaSpec : {};
    if (operationContracts.length > 0) {
      data.schemaSpec = mergeSchemaSpecValue(baseSchemaSpec, {
        operations: operationContracts,
      });
    } else if (Object.keys(baseSchemaSpec).length > 0) {
      const { operations: _ignored, ...rest } = baseSchemaSpec;
      data.schemaSpec = Object.keys(rest).length > 0 ? rest : null;
    } else {
      data.schemaSpec = null;
    }
  }

  if (body.videoUrl !== undefined) {
    if (body.videoUrl === null || body.videoUrl === "") {
      if (data.schemaSpec === undefined) {
        data.schemaSpec = null;
      }
    } else if (typeof body.videoUrl === "string") {
      data.schemaSpec = mergeSchemaSpecValue(data.schemaSpec, {
        videoUrl: body.videoUrl.trim(),
      });
    } else {
      throw new Error("videoUrl must be a string");
    }
  }

  return data;
}

export function buildListingReadinessWriteData(report: ListingReadinessReport): Record<string, unknown> {
  return {
    authSchemes: report.normalized.authSchemes,
    interactionModes: report.normalized.interactionModes,
    humanApprovalRequired: report.normalized.humanApprovalRequired,
    noHealthProbe: report.normalized.noHealthProbe,
    riskLevel: report.normalized.riskLevel,
    sideEffectLevel: report.normalized.sideEffectLevel,
    readinessScore: report.score,
    readinessIssues: report.blockers,
    readinessWarnings: report.warnings,
    readinessUpdatedAt: new Date(),
  };
}

export async function evaluateListingReadiness(
  listing: ListingReadinessInput,
): Promise<ListingReadinessReport> {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const authSchemes = deriveAuthSchemes(listing.authType, listing.authSchemes);
  const interactionModes = inferInteractionModes(
    listing.listingType,
    listing.interactionModes,
    listing.schemaSpec,
  );
  const humanApprovalRequired = Boolean(listing.humanApprovalRequired);
  const noHealthProbe = Boolean(listing.noHealthProbe);
  const riskLevel = listing.riskLevel ?? "LOW";
  const sideEffectLevel = listing.sideEffectLevel ?? "READ_ONLY";
  const operationContracts = extractOperationContracts(listing.schemaSpec);

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
      blockers.push(`${label}: ${error instanceof Error ? error.message : "invalid URL"}`);
    }
  }

  if (listing.description.trim().length < READY_DESCRIPTION_MIN_LENGTH) {
    blockers.push(
      `description must be at least ${READY_DESCRIPTION_MIN_LENGTH} characters before activation`,
    );
  }

  const hasDiscoveryIntent =
    listing.tags.length > 0 || listing.intents.length > 0 || (listing.capabilityTags?.length ?? 0) > 0;
  if (!hasDiscoveryIntent) {
    blockers.push("add tags, intents, or capabilityTags before activation so agents can discover the listing");
  }

  if ((listing.capabilityTags?.length ?? 0) === 0) {
    blockers.push("add at least one capabilityTag so the marketplace can apply hard capability filters");
  }

  const hasModalities =
    (listing.inputModalities?.length ?? 0) > 0 &&
    (listing.outputModalities?.length ?? 0) > 0;
  if (!hasModalities) {
    blockers.push("inputModalities and outputModalities are required before activation");
  }

  if (authSchemes.length === 0) {
    blockers.push("at least one authScheme is required before activation");
  }

  if (interactionModes.length === 0) {
    blockers.push("at least one interactionMode is required before activation");
  }

  const operationCount = countOperationContracts(listing.schemaSpec);
  const hasExecutionExamples =
    (hasJsonContent(listing.sampleRequest) && hasJsonContent(listing.sampleResponse)) ||
    operationCount > 0;
  if (!hasExecutionExamples) {
    blockers.push(
      "provide sampleRequest and sampleResponse or a schemaSpec operation contract before activation",
    );
  }

  const hasHealthStrategy = Boolean(listing.healthCheckUrl) || noHealthProbe;
  if (!hasHealthStrategy) {
    blockers.push("provide a healthCheckUrl or explicitly mark noHealthProbe before activation");
  }

  const requiresApproval =
    riskLevel === "HIGH" ||
    riskLevel === "CRITICAL" ||
    sideEffectLevel === "REVERSIBLE" ||
    sideEffectLevel === "IRREVERSIBLE";
  if (requiresApproval && !humanApprovalRequired) {
    blockers.push(
      "high-risk or side-effecting listings must set humanApprovalRequired before activation",
    );
  }

  if (!listing.docsUrl) {
    warnings.push("docsUrl is missing; agents and operators will have less context for this listing");
  }

  if ((listing.availabilityRegions?.length ?? 0) === 0) {
    warnings.push("availabilityRegions is empty; region-aware routing will assume global availability");
  }

  if ((listing.complianceTags?.length ?? 0) === 0) {
    warnings.push("complianceTags is empty; policy-aware routing will have less signal");
  }

  if (!hasJsonContent(listing.domainMetadata)) {
    warnings.push("domainMetadata is empty; richer domain-specific routing hints are missing");
  }

  if (!listing.sandboxUrl && sideEffectLevel !== "READ_ONLY") {
    warnings.push("sandboxUrl is missing for a side-effecting listing");
  }

  if (operationCount === 0) {
    warnings.push("schemaSpec does not define operation contracts; agents will rely on samples only");
  } else if (
    operationContracts.length > 0 &&
    operationContracts.every(
      (operation) =>
        !hasJsonContent(operation.sampleInput) &&
        !hasJsonContent(operation.sampleOutput) &&
        !hasJsonContent(operation.inputSchema) &&
        !hasJsonContent(operation.outputSchema),
    )
  ) {
    warnings.push("operation contracts are missing sample or schema details; agents will rely on generic payload guesses");
  }

  if (operationContracts.length > 0) {
    const seenOperationIds = new Set<string>();
    const seenTargets = new Set<string>();

    for (const operation of operationContracts) {
      const operationTarget = `${operation.method} ${operation.path}`;
      if (seenOperationIds.has(operation.operationId)) {
        blockers.push(`operationContracts contains duplicate operationId "${operation.operationId}"`);
      } else {
        seenOperationIds.add(operation.operationId);
      }

      if (seenTargets.has(operationTarget)) {
        blockers.push(`operationContracts contains duplicate target "${operationTarget}"`);
      } else {
        seenTargets.add(operationTarget);
      }

      if (operation.authScheme && !authSchemes.includes(operation.authScheme)) {
        blockers.push(
          `operation "${operation.name}" declares authScheme "${operation.authScheme}" which is not in listing authSchemes`,
        );
      }

      if (operation.mode && !interactionModes.includes(operation.mode)) {
        blockers.push(
          `operation "${operation.name}" declares mode "${operation.mode}" which is not in listing interactionModes`,
        );
      }

      if (!operation.description) {
        warnings.push(`operation "${operation.name}" is missing a description`);
      }

      if (operation.method === "GET" && operation.sideEffect) {
        warnings.push(`operation "${operation.name}" is GET but marked sideEffect=true`);
      }

      if (operation.method === "GET" && !operation.idempotent) {
        warnings.push(`operation "${operation.name}" is GET but marked idempotent=false`);
      }

      const templateKeys = extractTemplateKeys(operation.path);
      if (templateKeys.length > 0) {
        const sampleInput = isPlainObject(operation.sampleInput) ? operation.sampleInput : {};
        const missingKeys = templateKeys.filter((key) => !(key in sampleInput));
        if (missingKeys.length > 0) {
          warnings.push(
            `operation "${operation.name}" has templated path params without sampleInput values: ${missingKeys.join(", ")}`,
          );
        }
      }
    }
  }

  const score = computeListingReadinessScore({
    hasDiscoveryIntent,
    hasCapabilityTags: (listing.capabilityTags?.length ?? 0) > 0,
    hasModalities,
    hasExecutionExamples,
    hasDocs: Boolean(listing.docsUrl),
    hasHealthStrategy,
    hasAvailabilitySignals: (listing.availabilityRegions?.length ?? 0) > 0,
    hasComplianceSignals: (listing.complianceTags?.length ?? 0) > 0,
    hasDomainMetadata: hasJsonContent(listing.domainMetadata),
    hasHumanApprovalPolicy: !requiresApproval || humanApprovalRequired,
  });

  return {
    score,
    readyForActivation: blockers.length === 0,
    blockers,
    warnings,
    normalized: {
      authSchemes,
      interactionModes,
      humanApprovalRequired,
      noHealthProbe,
      riskLevel,
      sideEffectLevel,
    },
  };
}

export async function validateActivationReadiness(listing: ListingReadinessInput): Promise<string[]> {
  const report = await evaluateListingReadiness(listing);
  return report.blockers;
}
