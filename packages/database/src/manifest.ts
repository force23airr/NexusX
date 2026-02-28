// ═══════════════════════════════════════════════════════════════
// NexusX — .well-known/nexusx.json Manifest Types & Validator
// packages/database/src/manifest.ts
//
// Shared types for the NexusX provider discovery manifest.
// Any domain can host /.well-known/nexusx.json to declare
// their API capabilities, pricing, and endpoints.
// ═══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export interface NexusXManifest {
  version: string;
  provider: {
    name: string;
    website?: string;
    contact?: string;
  };
  capabilities: NexusXManifestCapability[];
}

export interface NexusXManifestCapability {
  name: string;
  description: string;
  listingType: string;
  intents: string[];
  category: string; // category slug
  baseUrl: string;
  endpoint?: { method: string; path: string };
  healthCheckUrl?: string;
  docsUrl?: string;
  authType?: string;
  pricing: {
    floorUsdc: number;
    ceilingUsdc?: number;
    currency: "USDC";
  };
  capacityPerMinute?: number;
  tags?: string[];
  sampleRequest?: Record<string, unknown>;
  sampleResponse?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────
// VALIDATOR
// ─────────────────────────────────────────────────────────────

type ValidationResult =
  | { valid: true; manifest: NexusXManifest }
  | { valid: false; errors: string[] };

export function validateManifest(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== "object") {
    return { valid: false, errors: ["Manifest must be a JSON object"] };
  }

  const obj = data as Record<string, unknown>;

  // version
  if (typeof obj.version !== "string" || !obj.version) {
    errors.push("'version' must be a non-empty string");
  }

  // provider
  if (!obj.provider || typeof obj.provider !== "object") {
    errors.push("'provider' must be an object");
  } else {
    const p = obj.provider as Record<string, unknown>;
    if (typeof p.name !== "string" || !p.name) {
      errors.push("'provider.name' must be a non-empty string");
    }
  }

  // capabilities
  if (!Array.isArray(obj.capabilities) || obj.capabilities.length === 0) {
    errors.push("'capabilities' must be a non-empty array");
  } else {
    for (let i = 0; i < obj.capabilities.length; i++) {
      const cap = obj.capabilities[i];
      const prefix = `capabilities[${i}]`;

      if (!cap || typeof cap !== "object") {
        errors.push(`${prefix} must be an object`);
        continue;
      }

      const c = cap as Record<string, unknown>;

      if (typeof c.name !== "string" || !c.name) {
        errors.push(`${prefix}.name must be a non-empty string`);
      }
      if (typeof c.description !== "string" || !c.description) {
        errors.push(`${prefix}.description must be a non-empty string`);
      }
      if (typeof c.baseUrl !== "string" || !c.baseUrl) {
        errors.push(`${prefix}.baseUrl must be a non-empty string`);
      }
      if (!Array.isArray(c.intents) || c.intents.length === 0) {
        errors.push(`${prefix}.intents must be a non-empty array of strings`);
      }

      // pricing
      if (!c.pricing || typeof c.pricing !== "object") {
        errors.push(`${prefix}.pricing must be an object`);
      } else {
        const p = c.pricing as Record<string, unknown>;
        if (typeof p.floorUsdc !== "number" || p.floorUsdc <= 0) {
          errors.push(`${prefix}.pricing.floorUsdc must be a positive number`);
        }
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, manifest: data as NexusXManifest };
}
