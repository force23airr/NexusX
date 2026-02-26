/**
 * OpenAPI spec loader — reads a file path or URL, returns parsed JSON.
 * Supports JSON and basic YAML (key: value, no nested anchors needed for most specs).
 */

import { readFileSync } from "fs";
import { parse as parseYaml } from "yaml";

export interface ParsedSpec {
  name: string;
  description: string;
  version: string;
  baseUrl: string;
  docsUrl?: string;
  authType: string;
  listingType: string;
  endpoints: Array<{ method: string; path: string; summary?: string }>;
  sampleRequest?: unknown;
  sampleResponse?: unknown;
}

/** Load spec from a file path (JSON or YAML) */
export function loadSpecFile(filePath: string): Record<string, unknown> {
  const content = readFileSync(filePath, "utf-8").trim();
  if (content.startsWith("{") || content.startsWith("[")) {
    return JSON.parse(content) as Record<string, unknown>;
  }
  return parseYaml(content) as Record<string, unknown>;
}

/** Extract listing fields from a parsed OpenAPI 3.x or Swagger 2.x spec */
export function extractFromSpec(
  spec: Record<string, unknown>,
  specFilePathOrUrl?: string
): ParsedSpec {
  const info = (spec.info ?? {}) as Record<string, unknown>;
  const name = (info.title as string) || "My API";
  const description = (info.description as string) || "";
  const version = (info.version as string) || "1.0.0";

  // Base URL — OpenAPI 3.x servers array, or Swagger 2.x host+basePath
  let baseUrl = "";
  if (Array.isArray(spec.servers) && spec.servers.length > 0) {
    baseUrl = ((spec.servers[0] as Record<string, unknown>).url as string) || "";
  } else if (spec.host) {
    const scheme = Array.isArray(spec.schemes) ? spec.schemes[0] : "https";
    baseUrl = `${scheme}://${spec.host}${spec.basePath ?? ""}`;
  }

  // Auth type inference
  let authType = "none";
  const secSchemes =
    ((spec.components as Record<string, unknown>)?.securitySchemes as Record<string, unknown>) ??
    (spec.securityDefinitions as Record<string, unknown>) ??
    {};
  const schemeValues = Object.values(secSchemes) as Record<string, unknown>[];
  if (schemeValues.some((s) => s.type === "oauth2")) authType = "oauth2";
  else if (schemeValues.some((s) => s.type === "http" && s.scheme === "bearer")) authType = "jwt";
  else if (schemeValues.some((s) => s.type === "apiKey" || s.in === "header")) authType = "api_key";
  else if (schemeValues.length > 0) authType = "api_key";

  // Endpoints
  const paths = (spec.paths ?? {}) as Record<string, Record<string, unknown>>;
  const endpoints: ParsedSpec["endpoints"] = [];
  let sampleRequest: unknown = undefined;
  let sampleResponse: unknown = undefined;

  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      const operation = op as Record<string, unknown>;
      const summary = (operation.summary as string) || (operation.operationId as string) || undefined;
      endpoints.push({ method: method.toUpperCase(), path, summary });

      // Grab the first POST body as sample request
      if (!sampleRequest && method === "post") {
        const reqBody = (operation.requestBody as Record<string, unknown>)?.content as
          | Record<string, unknown>
          | undefined;
        if (reqBody) {
          const jsonContent = (reqBody["application/json"] as Record<string, unknown>)?.schema as
            | Record<string, unknown>
            | undefined;
          if (jsonContent?.example) sampleRequest = jsonContent.example;
          else if (jsonContent?.properties) {
            sampleRequest = Object.fromEntries(
              Object.entries(jsonContent.properties as Record<string, unknown>).map(([k, v]) => [
                k,
                (v as Record<string, unknown>).example ?? (v as Record<string, unknown>).type ?? "string",
              ])
            );
          }
        }

        // Grab 200 response as sample response
        const responses = (operation.responses as Record<string, unknown>) ?? {};
        const resp200 = (responses["200"] as Record<string, unknown>)?.content as
          | Record<string, unknown>
          | undefined;
        if (resp200) {
          const respJson = (resp200["application/json"] as Record<string, unknown>)?.schema as
            | Record<string, unknown>
            | undefined;
          if (respJson?.example) sampleResponse = respJson.example;
        }
      }
    }
  }

  // Docs URL heuristic from spec file path
  let docsUrl: string | undefined;
  if (specFilePathOrUrl?.startsWith("http")) {
    const u = new URL(specFilePathOrUrl);
    docsUrl = `${u.origin}/docs`;
  }

  return {
    name,
    description,
    version,
    baseUrl,
    docsUrl,
    authType,
    listingType: "REST_API",
    endpoints,
    sampleRequest,
    sampleResponse,
  };
}
