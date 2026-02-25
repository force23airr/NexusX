// ═══════════════════════════════════════════════════════════════
// NexusX — MCP Tool Schema Generator
// apps/mcp-server/src/tools/schemas.ts
//
// Generates JSON Schema for each tool's input parameters.
// Priority:
//   1. schemaSpec (OpenAPI-style) → extract requestBody schema
//   2. sampleRequest → infer types from sample JSON
//   3. Fallback → generic callable schema (path, method, body)
// ═══════════════════════════════════════════════════════════════

import type { BundleDefinition, DiscoveredListing } from "../types";

/** The generic schema that makes any listing callable. */
const GENERIC_SCHEMA = {
  type: "object" as const,
  properties: {
    path: {
      type: "string",
      description: "Sub-path appended after the listing endpoint (e.g., '/chat/completions'). Use '/' for the root endpoint.",
    },
    method: {
      type: "string",
      enum: ["GET", "POST", "PUT", "DELETE"],
      default: "POST",
      description: "HTTP method for the request.",
    },
    body: {
      type: "object",
      description: "JSON request body. Omit for GET requests.",
      additionalProperties: true,
    },
    query: {
      type: "object",
      description: "URL query parameters.",
      additionalProperties: { type: "string" },
    },
    headers: {
      type: "object",
      description: "Additional HTTP headers.",
      additionalProperties: { type: "string" },
    },
  },
  required: ["path"],
};

/** Generic schema for bundle tools (server-side chained execution). */
const BUNDLE_SCHEMA = {
  type: "object" as const,
  properties: {
    path: {
      type: "string",
      description: "Sub-path used for each step endpoint. Use '/' for root.",
      default: "/",
    },
    method: {
      type: "string",
      enum: ["GET", "POST", "PUT", "DELETE"],
      default: "POST",
      description: "HTTP method applied to each step call.",
    },
    body: {
      type: "object",
      description: "Initial JSON request body for the first step.",
      additionalProperties: true,
    },
    query: {
      type: "object",
      description: "Query parameters forwarded to each step.",
      additionalProperties: { type: "string" },
    },
    headers: {
      type: "object",
      description: "Additional headers forwarded to each step.",
      additionalProperties: { type: "string" },
    },
    fail_fast: {
      type: "boolean",
      default: true,
      description: "Stop immediately when a step fails.",
    },
    return_intermediate: {
      type: "boolean",
      default: false,
      description: "Include intermediate step responses in output.",
    },
  },
  required: [],
};

/**
 * Generate a JSON Schema for a listing's tool input.
 */
export function generateInputSchema(listing: DiscoveredListing): Record<string, unknown> {
  // Priority 1: OpenAPI-style schemaSpec
  if (listing.schemaSpec) {
    const extracted = extractFromSchemaSpec(listing.schemaSpec);
    if (extracted) return extracted;
  }

  // Priority 2: Infer from sampleRequest
  if (listing.sampleRequest) {
    const inferred = inferFromSample(listing.sampleRequest);
    if (inferred) return inferred;
  }

  // Priority 3: Generic fallback
  return GENERIC_SCHEMA;
}

/**
 * Generate a bundle input schema with step-specific context.
 */
export function generateBundleInputSchema(bundle: BundleDefinition): Record<string, unknown> {
  return {
    ...BUNDLE_SCHEMA,
    description: `Composite execution bundle: ${bundle.steps.map((s) => s.slug).join(" -> ")}`,
  };
}

/**
 * Extract a usable JSON Schema from an OpenAPI-style schemaSpec.
 */
function extractFromSchemaSpec(spec: Record<string, unknown>): Record<string, unknown> | null {
  try {
    // Try to find requestBody schema in common OpenAPI locations
    const requestBody = spec.requestBody as Record<string, unknown> | undefined;
    if (requestBody?.content) {
      const content = requestBody.content as Record<string, unknown>;
      const jsonContent = content["application/json"] as Record<string, unknown> | undefined;
      if (jsonContent?.schema) {
        return wrapWithGenericFields(jsonContent.schema as Record<string, unknown>);
      }
    }

    // If the spec itself looks like a JSON Schema, use it directly
    if (spec.type === "object" && spec.properties) {
      return wrapWithGenericFields(spec);
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Infer a JSON Schema from a sample JSON object.
 */
function inferFromSample(sample: Record<string, unknown>): Record<string, unknown> | null {
  try {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(sample)) {
      properties[key] = inferType(value);
      required.push(key);
    }

    if (Object.keys(properties).length === 0) return null;

    return wrapWithGenericFields({
      type: "object",
      properties,
      required,
    });
  } catch {
    return null;
  }
}

/**
 * Infer JSON Schema type from a JavaScript value.
 */
function inferType(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) {
    return { type: "string" };
  }
  if (typeof value === "string") {
    return { type: "string" };
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? { type: "integer" } : { type: "number" };
  }
  if (typeof value === "boolean") {
    return { type: "boolean" };
  }
  if (Array.isArray(value)) {
    const itemType = value.length > 0 ? inferType(value[0]) : { type: "string" };
    return { type: "array", items: itemType };
  }
  if (typeof value === "object") {
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      props[k] = inferType(v);
    }
    return { type: "object", properties: props };
  }
  return { type: "string" };
}

/**
 * Wrap a body schema with the generic path/method/query/headers fields.
 */
function wrapWithGenericFields(bodySchema: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Sub-path appended after the listing endpoint (e.g., '/chat/completions'). Use '/' for the root endpoint.",
      },
      method: {
        type: "string",
        enum: ["GET", "POST", "PUT", "DELETE"],
        default: "POST",
        description: "HTTP method for the request.",
      },
      body: {
        ...bodySchema,
        description: "JSON request body.",
      },
      query: {
        type: "object",
        description: "URL query parameters.",
        additionalProperties: { type: "string" },
      },
      headers: {
        type: "object",
        description: "Additional HTTP headers.",
        additionalProperties: { type: "string" },
      },
    },
    required: ["path"],
  };
}
