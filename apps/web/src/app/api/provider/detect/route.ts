import { NextRequest, NextResponse } from "next/server";
import { assertSafeHttpUrl, isPrivateHost, safeFetch } from "@/lib/ssrf";
import { validateManifest } from "@nexusx/database";
import { buildDetectedOperationContract } from "@/lib/listingOperationContracts";

// ─── Category slug suggestion from spec keywords ───

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  "language-models": ["chat", "completion", "generate", "llm", "gpt", "language model"],
  "translation": ["translate", "translation", "localize", "language"],
  "sentiment-analysis": ["sentiment", "opinion", "emotion", "tone"],
  "embeddings": ["embed", "embedding", "vector", "encode"],
  "object-detection": ["detect", "object", "image", "vision", "recognition"],
  "datasets": ["dataset", "data", "download", "bulk", "export"],
};

function suggestCategory(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [slug, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) return slug;
  }
  return null;
}

// ─── Tag inference from spec content ───

function inferTags(spec: Record<string, unknown>, endpoints: SpecEndpoint[]): string[] {
  const tags = new Set<string>();

  // From spec-level tags
  if (Array.isArray(spec.tags)) {
    for (const t of spec.tags as { name?: string }[]) {
      if (t.name) tags.add(t.name.toLowerCase());
    }
  }

  // From endpoint tags
  for (const ep of endpoints) {
    if (ep.tags) {
      for (const t of ep.tags) tags.add(t.toLowerCase());
    }
  }

  // From endpoint paths — extract meaningful segments
  for (const ep of endpoints) {
    const segments = ep.path.split("/").filter((s) => s && !s.startsWith("{"));
    for (const seg of segments) {
      if (seg.length > 2 && seg.length < 20 && !/^v\d+$/.test(seg) && seg !== "api") {
        tags.add(seg.toLowerCase());
      }
    }
  }

  return Array.from(tags).slice(0, 10);
}

function inferKeywordModalities(
  text: string,
  target: Set<string>,
  options: { image?: boolean; audio?: boolean; video?: boolean; text?: boolean; structured?: boolean } = {},
) {
  const lower = text.toLowerCase();
  if (options.image && /(image|vision|photo|ocr|object-detect)/.test(lower)) target.add("image");
  if (options.audio && /(audio|speech|voice|transcrib)/.test(lower)) target.add("audio");
  if (options.video && /(video|stream|frame)/.test(lower)) target.add("video");
  if (options.text && /(text|chat|translate|summari|embed|classif|sentiment|search|extract)/.test(lower)) target.add("text");
  if (options.structured && /(json|schema|structured|payload|record|dataset|form)/.test(lower)) target.add("structured-data");
}

function inferModalities(params: {
  spec: Record<string, unknown>;
  endpoints: SpecEndpoint[];
  sampleRequest: Record<string, unknown> | null;
  sampleResponse: Record<string, unknown> | null;
  description: string;
  name: string;
}): { inputModalities: string[]; outputModalities: string[] } {
  const input = new Set<string>();
  const output = new Set<string>();

  const combinedText = [
    params.name,
    params.description,
    ...params.endpoints.map((endpoint) => `${endpoint.path} ${endpoint.summary} ${endpoint.tags.join(" ")}`),
  ].join(" ");

  inferKeywordModalities(combinedText, input, {
    image: true,
    audio: true,
    video: true,
    text: true,
    structured: true,
  });
  inferKeywordModalities(combinedText, output, {
    image: /(generate|render)/.test(combinedText.toLowerCase()),
    audio: /(generate audio|synthesize|tts)/.test(combinedText.toLowerCase()),
    video: /(generate video|render video)/.test(combinedText.toLowerCase()),
    text: true,
    structured: true,
  });

  for (const endpoint of params.endpoints) {
    if (endpoint.requestSchema) input.add("structured-data");
  }

  if (params.sampleRequest && Object.keys(params.sampleRequest).length > 0) {
    input.add("structured-data");
  }
  if (params.sampleResponse && Object.keys(params.sampleResponse).length > 0) {
    output.add("structured-data");
  }

  if (input.size === 0) input.add("text");
  if (output.size === 0) output.add("text");

  return {
    inputModalities: Array.from(input).slice(0, 5),
    outputModalities: Array.from(output).slice(0, 5),
  };
}

function unique(values: Array<string | undefined | null>): string[] {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim().toLowerCase()),
    ),
  );
}

function uniqueUpper(values: Array<string | undefined | null>): string[] {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim().toUpperCase()),
    ),
  );
}

function buildRoutingMetadata(input: {
  base?: Record<string, unknown>;
  latencyRegions?: string[];
  routingRegions?: string[];
  edgeRegions?: string[];
}): Record<string, unknown> | undefined {
  const base = { ...(input.base || {}) };
  const latencyRegions = uniqueUpper(input.latencyRegions || []);
  const routingRegions = uniqueUpper(input.routingRegions || []);
  const edgeRegions = uniqueUpper(input.edgeRegions || []);

  if (latencyRegions.length === 0 && routingRegions.length === 0 && edgeRegions.length === 0) {
    return Object.keys(base).length > 0 ? base : undefined;
  }

  const existingRouting =
    typeof base.nexusxRouting === "object" && base.nexusxRouting && !Array.isArray(base.nexusxRouting)
      ? (base.nexusxRouting as Record<string, unknown>)
      : {};

  base.nexusxRouting = {
    ...existingRouting,
    ...(latencyRegions.length > 0 ? { latencyRegions } : {}),
    ...(routingRegions.length > 0 ? { routingRegions } : {}),
    ...(edgeRegions.length > 0 ? { edgeRegions } : {}),
  };

  return base;
}

function readExtensionStringArray(source: Record<string, unknown>, key: string): string[] {
  const value = source[key];
  if (!Array.isArray(value)) return [];
  return uniqueUpper(value.filter((entry): entry is string => typeof entry === "string"));
}

function extractSpecRoutingMetadata(spec: Record<string, unknown>): {
  latencyRegions: string[];
  routingRegions: string[];
  edgeRegions: string[];
} {
  const rootLatency = readExtensionStringArray(spec, "x-nexusx-latency-regions");
  const rootRouting = readExtensionStringArray(spec, "x-nexusx-routing-regions");
  const rootEdge = readExtensionStringArray(spec, "x-nexusx-edge-regions");
  const servers = Array.isArray(spec.servers) ? spec.servers : [];
  const serverRecords = servers.filter(
    (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null && !Array.isArray(entry),
  );
  const serverLatency = serverRecords.flatMap((server) => readExtensionStringArray(server, "x-nexusx-latency-regions"));
  const serverRouting = serverRecords.flatMap((server) => readExtensionStringArray(server, "x-nexusx-routing-regions"));
  const serverEdge = serverRecords.flatMap((server) => readExtensionStringArray(server, "x-nexusx-edge-regions"));

  return {
    latencyRegions: uniqueUpper([...rootLatency, ...serverLatency]),
    routingRegions: uniqueUpper([...rootRouting, ...serverRouting]),
    edgeRegions: uniqueUpper([...rootEdge, ...serverEdge]),
  };
}

// ─── Synthesize a marketplace description from spec info ───

function synthesizeDescription(
  specDescription: string,
  name: string,
  endpoints: SpecEndpoint[]
): string {
  // If the spec already has a good description, use it
  if (specDescription && specDescription.length > 30) {
    return specDescription;
  }

  // Build one from the endpoints
  const verbs = endpoints
    .filter((e) => e.summary)
    .slice(0, 5)
    .map((e) => e.summary);

  if (verbs.length === 0) {
    return specDescription || `API service: ${name}`;
  }

  const capabilities = verbs.join(". ");
  const prefix = specDescription
    ? `${specDescription} `
    : `${name || "This API"} provides the following capabilities. `;

  return `${prefix}${capabilities}.`;
}

// ─── Extract spec fields ───

interface SpecEndpoint {
  path: string;
  method: string;
  summary: string;
  requestSchema: Record<string, unknown> | null;
  responseSchema: Record<string, unknown> | null;
  tags: string[];
}

interface InputSchemaField {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

interface DetectionResult {
  detected: boolean;
  name: string;
  description: string;
  baseUrl: string;
  healthCheckUrl: string;
  docsUrl: string;
  authType: string;
  listingType: string;
  sampleRequest: Record<string, unknown> | null;
  sampleResponse: Record<string, unknown> | null;
  endpoints: Array<{
    path: string;
    method: string;
    summary: string;
    requestSchema: Record<string, unknown> | null;
  }>;
  operationContracts: Array<ReturnType<typeof buildDetectedOperationContract>>;
  inputSchemaFields: InputSchemaField[];
  suggestedCategorySlug: string | null;
  tags: string[];
  availabilityRegions: string[];
  restrictedRegions: string[];
  complianceTags: string[];
  capabilityTags: string[];
  inputModalities: string[];
  outputModalities: string[];
  domainMetadata?: Record<string, unknown>;
  healthCheckStatus: { ok: boolean; latencyMs: number } | null;
  warnings: string[];
}

// ─── Extract from NexusX manifest ───

function extractFromManifest(
  cap: import("@nexusx/database").NexusXManifestCapability,
  sourceUrl: string,
  totalCapabilities: number,
): DetectionResult {
  const warnings: string[] = [
    "NexusX manifest detected — use 'Import from Domain' to import all capabilities at once.",
  ];
  if (totalCapabilities > 1) {
    warnings.push(
      `This manifest declares ${totalCapabilities} capabilities. Only the first is shown here.`,
    );
  }

  const domainMetadata = buildRoutingMetadata({
    base: {
      ...(cap.domainMetadata || {}),
      manifestSourceUrl: sourceUrl,
      manifestCapabilityCount: totalCapabilities,
    },
    latencyRegions: cap.latencyRegions,
    routingRegions: cap.routingRegions,
    edgeRegions: cap.edgeRegions,
  });
  const operationContracts =
    Array.isArray(cap.operations) && cap.operations.length > 0
      ? cap.operations.slice(0, 20).map((operation) =>
          buildDetectedOperationContract({
            operationId: operation.operationId,
            name: operation.name,
            description: operation.description,
            method: operation.method,
            path: operation.path,
            mode: operation.mode,
            authScheme: operation.authScheme || cap.authType || "api_key",
            inputSchema: operation.inputSchema || null,
            outputSchema: operation.outputSchema || null,
            sampleInput: operation.sampleInput || null,
            sampleOutput: operation.sampleOutput || null,
          }),
        )
      : cap.endpoint
        ? [
            buildDetectedOperationContract({
              name: cap.name,
              description: cap.description,
              method: cap.endpoint.method,
              path: cap.endpoint.path,
              authScheme: cap.authType || "api_key",
              sampleInput: cap.sampleRequest || null,
              sampleOutput: cap.sampleResponse || null,
            }),
          ]
        : [];

  return {
    detected: true,
    name: cap.name,
    description: cap.description,
    baseUrl: cap.baseUrl,
    healthCheckUrl: cap.healthCheckUrl || "",
    docsUrl: cap.docsUrl || "",
    authType: cap.authType || "api_key",
    listingType: cap.listingType || "REST_API",
    sampleRequest: cap.sampleRequest || null,
    sampleResponse: cap.sampleResponse || null,
    endpoints: cap.endpoint ? [{ path: cap.endpoint.path, method: cap.endpoint.method, summary: cap.description, requestSchema: null }] : [],
    operationContracts,
    inputSchemaFields: [] as { name: string; type: string; required: boolean; description: string }[],
    suggestedCategorySlug: cap.category || null,
    tags: cap.tags || [],
    availabilityRegions: cap.availabilityRegions || [],
    restrictedRegions: cap.restrictedRegions || [],
    complianceTags: cap.complianceTags || [],
    capabilityTags: cap.capabilityTags || unique([...(cap.tags || []), ...cap.intents]),
    inputModalities: cap.inputModalities || [],
    outputModalities: cap.outputModalities || [],
    domainMetadata,
    healthCheckStatus: null as { ok: boolean; latencyMs: number } | null,
    warnings,
  };
}

function extractFromSpec(spec: Record<string, unknown>, sourceUrl: string): DetectionResult {
  const info = (spec.info as Record<string, unknown>) || {};
  const name = (info.title as string) || "";
  const rawDescription = (info.description as string) || "";

  // Base URL: OpenAPI 3 servers[] or Swagger 2 host+basePath
  let baseUrl = "";
  if (Array.isArray(spec.servers) && spec.servers.length > 0) {
    baseUrl = (spec.servers[0] as Record<string, unknown>).url as string || "";
  } else if (spec.host) {
    const scheme = Array.isArray(spec.schemes) && spec.schemes.length > 0
      ? spec.schemes[0] : "https";
    baseUrl = `${scheme}://${spec.host}${spec.basePath || ""}`;
  }
  if (baseUrl && !baseUrl.startsWith("http")) {
    try {
      baseUrl = new URL(baseUrl, sourceUrl).toString();
    } catch { /* keep as-is */ }
  }

  // Auth type
  let authType = "none";
  const secSchemes =
    (spec.securityDefinitions as Record<string, Record<string, unknown>>) ||
    ((spec.components as Record<string, unknown>)?.securitySchemes as Record<string, Record<string, unknown>>);
  if (secSchemes) {
    const first = Object.values(secSchemes)[0];
    if (first) {
      const t = (first.type as string || "").toLowerCase();
      if (t === "oauth2") authType = "oauth2";
      else if (t === "http" && first.scheme === "bearer") authType = "jwt";
      else authType = "api_key";
    }
  }

  // Listing type
  let listingType = "REST_API";
  if (spec.asyncapi) listingType = "WEBSOCKET";

  // Extract endpoints
  const paths = (spec.paths as Record<string, Record<string, unknown>>) || {};
  const endpoints: SpecEndpoint[] = [];
  let healthCheckUrl = "";
  let sampleRequest: Record<string, unknown> | null = null;
  let sampleResponse: Record<string, unknown> | null = null;
  const inputSchemaFields: InputSchemaField[] = [];

  for (const [path, methods] of Object.entries(paths)) {
    if (!methods || typeof methods !== "object") continue;
    for (const [method, opObj] of Object.entries(methods)) {
      if (["get", "post", "put", "patch", "delete"].indexOf(method.toLowerCase()) === -1) continue;
      const op = opObj as Record<string, unknown>;
      const summary = (op.summary as string) || (op.description as string) || "";
      const opTags = Array.isArray(op.tags) ? (op.tags as string[]) : [];

      // Request schema extraction
      let reqSchema: Record<string, unknown> | null = null;
      let responseSchema: Record<string, unknown> | null = null;
      if (op.requestBody) {
        const rb = op.requestBody as Record<string, unknown>;
        const content = rb.content as Record<string, Record<string, unknown>> | undefined;
        if (content) {
          const json = content["application/json"];
          if (json?.schema) reqSchema = json.schema as Record<string, unknown>;
        }
      }
      if (!reqSchema && Array.isArray(op.parameters)) {
        const bodyParam = (op.parameters as Record<string, unknown>[]).find(
          (p) => p.in === "body"
        );
        if (bodyParam?.schema) reqSchema = bodyParam.schema as Record<string, unknown>;
      }
      if (op.responses) {
        const responses = op.responses as Record<string, Record<string, unknown>>;
        const success = responses["200"] || responses["201"] || responses["202"];
        if (success) {
          const content = success.content as Record<string, Record<string, unknown>> | undefined;
          if (content?.["application/json"]?.schema) {
            responseSchema = content["application/json"].schema as Record<string, unknown>;
          }
          if (!responseSchema && success.schema) {
            responseSchema = success.schema as Record<string, unknown>;
          }
        }
      }

      endpoints.push({
        path,
        method: method.toUpperCase(),
        summary,
        requestSchema: reqSchema,
        responseSchema,
        tags: opTags,
      });

      // Health check detection
      if (method.toLowerCase() === "get" && /health/i.test(path) && !healthCheckUrl) {
        healthCheckUrl = baseUrl ? `${baseUrl.replace(/\/$/, "")}${path}` : path;
      }

      // Sample + input schema fields from first POST endpoint
      if (method.toLowerCase() === "post" && !sampleRequest && reqSchema) {
        sampleRequest = generateSampleFromSchema(reqSchema);
        // Extract structured input schema fields for the MCP preview
        const requiredFields = Array.isArray(reqSchema.required) ? (reqSchema.required as string[]) : [];
        const props = reqSchema.properties as Record<string, Record<string, unknown>> | undefined;
        if (props && inputSchemaFields.length === 0) {
          for (const [key, prop] of Object.entries(props)) {
            inputSchemaFields.push({
              name: key,
              type: (prop.type as string) || "string",
              required: requiredFields.includes(key),
              description: (prop.description as string) || "",
            });
          }
        }
      }
      if (method.toLowerCase() === "post" && !sampleResponse && responseSchema) {
        sampleResponse = generateSampleFromSchema(responseSchema);
      }
    }
  }

  // Docs URL
  let docsUrl = "";
  if (spec.externalDocs && (spec.externalDocs as Record<string, unknown>).url) {
    docsUrl = (spec.externalDocs as Record<string, unknown>).url as string;
  }

  const combinedText = `${name} ${rawDescription} ${endpoints.map((e) => e.summary).join(" ")}`;
  const suggestedCategorySlug = suggestCategory(combinedText);
  const tags = inferTags(spec, endpoints);
  const description = synthesizeDescription(rawDescription, name, endpoints);
  const capabilityTags = unique([...tags, ...endpoints.flatMap((endpoint) => endpoint.tags)]);
  const routingMetadata = extractSpecRoutingMetadata(spec);
  const modalities = inferModalities({
    spec,
    endpoints,
    sampleRequest,
    sampleResponse,
    description,
    name,
  });

  const operationContracts = endpoints.slice(0, 20).map((endpoint) =>
    buildDetectedOperationContract({
      operationId: `${endpoint.method}_${endpoint.path}`,
      name: endpoint.summary || undefined,
      description: endpoint.summary,
      method: endpoint.method,
      path: endpoint.path,
      authScheme: authType === "none" ? null : authType,
      inputSchema: endpoint.requestSchema,
      outputSchema: endpoint.responseSchema,
      sampleInput:
        endpoint.method === "POST" || endpoint.method === "PUT" || endpoint.method === "PATCH"
          ? generateSampleFromSchema(endpoint.requestSchema || {})
          : null,
      sampleOutput: endpoint.responseSchema ? generateSampleFromSchema(endpoint.responseSchema) : null,
    }),
  );

  return {
    detected: true,
    name,
    description,
    baseUrl,
    healthCheckUrl,
    docsUrl,
    authType,
    listingType,
    sampleRequest,
    sampleResponse,
    endpoints: endpoints.map(({ tags: _t, responseSchema: _r, ...rest }) => rest),
    operationContracts,
    inputSchemaFields,
    suggestedCategorySlug,
    tags,
    availabilityRegions: [],
    restrictedRegions: [],
    complianceTags: [],
    capabilityTags,
    inputModalities: modalities.inputModalities,
    outputModalities: modalities.outputModalities,
    domainMetadata: buildRoutingMetadata({
      base: {
        detection: {
          source: "openapi",
          endpointCount: endpoints.length,
          inferredFromSpec: true,
        },
      },
      latencyRegions: routingMetadata.latencyRegions,
      routingRegions: routingMetadata.routingRegions,
      edgeRegions: routingMetadata.edgeRegions,
    }),
    healthCheckStatus: null as { ok: boolean; latencyMs: number } | null,
    warnings: [] as string[],
  };
}

function generateSampleFromSchema(schema: Record<string, unknown>): Record<string, unknown> | null {
  if (!schema || typeof schema !== "object") return null;
  if (schema.example && typeof schema.example === "object") {
    return schema.example as Record<string, unknown>;
  }

  const props = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (!props) return null;

  const sample: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(props)) {
    if (prop.example !== undefined) {
      sample[key] = prop.example;
    } else {
      const t = (prop.type as string) || "string";
      if (t === "string") {
        // Use enum values or description hints for better examples
        if (Array.isArray(prop.enum) && prop.enum.length > 0) {
          sample[key] = prop.enum[0];
        } else {
          sample[key] = `example_${key}`;
        }
      } else if (t === "number" || t === "integer") sample[key] = 0;
      else if (t === "boolean") sample[key] = true;
      else if (t === "array") sample[key] = [];
      else if (t === "object") sample[key] = {};
      else sample[key] = `example_${key}`;
    }
  }
  return Object.keys(sample).length > 0 ? sample : null;
}

// ─── Try to parse YAML with basic regex (no dep) ───

function tryParseYamlBasic(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text);
  } catch { /* not JSON */ }

  if (!/^\s*(openapi|swagger)\s*:/m.test(text)) return null;

  const result: Record<string, unknown> = {};

  const versionMatch = text.match(/^\s*(openapi|swagger)\s*:\s*["']?([^"'\n]+)["']?/m);
  if (versionMatch) result[versionMatch[1]] = versionMatch[2].trim();

  const titleMatch = text.match(/^\s{2,}title\s*:\s*["']?([^"'\n]+)["']?/m);
  const descMatch = text.match(/^\s{2,}description\s*:\s*["']?([^"'\n]+)["']?/m);
  if (titleMatch || descMatch) {
    result.info = {
      title: titleMatch?.[1]?.trim() || "",
      description: descMatch?.[1]?.trim() || "",
    };
  }

  const serverMatch = text.match(/servers\s*:\s*\n\s+-\s*url\s*:\s*["']?([^"'\n]+)["']?/m);
  if (serverMatch) result.servers = [{ url: serverMatch[1].trim() }];

  if (result.openapi || result.swagger) return result;
  return null;
}

// ─── Common spec probe paths ───

const PROBE_PATHS = [
  "/.well-known/nexusx.json",
  "/openapi.json",
  "/swagger.json",
  "/.well-known/openapi.json",
  "/api-docs",
  "/docs/openapi.json",
  "/v3/api-docs",
];

async function fetchWithLimits(url: string, signal: AbortSignal): Promise<string | null> {
  try {
    const res = await safeFetch(url, {
      signal,
      headers: { Accept: "application/json, application/yaml, text/yaml, */*" },
    }, { maxRedirects: 2 });
    if (!res.ok) return null;
    const contentLength = res.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > 5 * 1024 * 1024) return null;
    const text = await res.text();
    if (text.length > 5 * 1024 * 1024) return null;
    return text;
  } catch {
    return null;
  }
}

// ─── Health check probe ───

async function probeHealth(url: string): Promise<{ ok: boolean; latencyMs: number } | null> {
  if (!url) return null;
  const start = Date.now();
  try {
    await assertSafeHttpUrl(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const res = await safeFetch(url, { method: "GET", signal: controller.signal }, { maxRedirects: 2 });
    clearTimeout(timeout);
    return { ok: res.ok, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}

// ─── Infer from non-spec response (HTML, headers) ───

function inferFromResponse(
  url: string,
  body: string | null,
  headers?: Record<string, string>
): {
  name: string;
  description: string;
  docsUrl: string;
  authType: string;
} {
  let name = "";
  let description = "";
  let docsUrl = "";
  let authType = "api_key";

  // Infer name from domain
  try {
    const parsed = new URL(url);
    const parts = parsed.hostname.replace(/^(www|api)\./, "").split(".");
    name = parts[0].charAt(0).toUpperCase() + parts[0].slice(1) + " API";
  } catch { /* skip */ }

  if (body) {
    // Extract <title>
    const titleMatch = body.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      const title = titleMatch[1].trim();
      // Only use if it's not generic browser chrome
      if (title.length > 2 && title.length < 120) {
        name = title.replace(/\s*[-|]\s*$/, "").trim();
      }
    }

    // Extract <meta name="description">
    const metaMatch = body.match(
      /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i
    ) || body.match(
      /<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i
    );
    if (metaMatch) {
      description = metaMatch[1].trim();
    }

    // Look for docs links
    const docsMatch = body.match(
      /href=["'](https?:\/\/[^"']*(?:docs|documentation|swagger|redoc|api-docs)[^"']*)["']/i
    );
    if (docsMatch) {
      docsUrl = docsMatch[1];
    }
  }

  // Infer auth from common headers
  if (headers) {
    const wwwAuth = headers["www-authenticate"] || "";
    if (/bearer/i.test(wwwAuth)) authType = "jwt";
    else if (/oauth/i.test(wwwAuth)) authType = "oauth2";
  }

  return { name, description, docsUrl, authType };
}

// ─── Fallback response shape ───

function fallbackResponse(
  url: string,
  warnings: string[],
  inferred?: ReturnType<typeof inferFromResponse>,
): DetectionResult {
  return {
    detected: false,
    name: inferred?.name || "",
    description: inferred?.description || "",
    baseUrl: url,
    healthCheckUrl: "",
    docsUrl: inferred?.docsUrl || "",
    authType: inferred?.authType || "api_key",
    listingType: "REST_API",
    sampleRequest: null,
    sampleResponse: null,
    endpoints: [],
    operationContracts: [],
    inputSchemaFields: [],
    suggestedCategorySlug: null,
    tags: [],
    availabilityRegions: [],
    restrictedRegions: [],
    complianceTags: [],
    capabilityTags: [],
    inputModalities: [],
    outputModalities: [],
    domainMetadata: undefined,
    healthCheckStatus: null,
    warnings,
  };
}

// ─── Route Handler ───

export async function POST(req: NextRequest) {
  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const url = body.url?.trim();
  if (!url) {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL format" }, { status: 400 });
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return NextResponse.json({ error: "Only HTTP/HTTPS URLs are allowed" }, { status: 400 });
  }

  if (isPrivateHost(parsed.hostname)) {
    return NextResponse.json({ error: "Private/reserved IP addresses are not allowed" }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    await assertSafeHttpUrl(url);
    // 1. Fetch URL directly — keep raw text + headers for fallback inference
    let directText: string | null = null;
    let directHeaders: Record<string, string> = {};
    try {
      const res = await safeFetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json, application/yaml, text/yaml, */*" },
      }, { maxRedirects: 2 });
      if (res.ok) {
        const contentLength = res.headers.get("content-length");
        if (!contentLength || parseInt(contentLength) <= 5 * 1024 * 1024) {
          directText = await res.text();
          if (directText.length > 5 * 1024 * 1024) directText = null;
        }
      }
      // Capture headers for fallback inference
      res.headers.forEach((v, k) => { directHeaders[k.toLowerCase()] = v; });
    } catch { /* will fall through to probes */ }

    let result: DetectionResult | null = null;

    if (directText) {
      let spec: Record<string, unknown> | null = null;
      try { spec = JSON.parse(directText); } catch { spec = tryParseYamlBasic(directText); }

      // Check for NexusX manifest first
      if (spec) {
        const manifestCheck = validateManifest(spec);
        if (manifestCheck.valid) {
          const cap = manifestCheck.manifest.capabilities[0];
          result = extractFromManifest(cap, url, manifestCheck.manifest.capabilities.length);
        } else if (spec.openapi || spec.swagger) {
          result = extractFromSpec(spec, url);
        }
      }
    }

    // 2. Probe common paths if direct fetch wasn't a spec
    if (!result) {
      const origin = parsed.origin;
      const probeResults = await Promise.all(
        PROBE_PATHS.map(async (path) => {
          const probeUrl = `${origin}${path}`;
          const text = await fetchWithLimits(probeUrl, controller.signal);
          if (!text) return null;
          let spec: Record<string, unknown> | null = null;
          try { spec = JSON.parse(text); } catch { spec = tryParseYamlBasic(text); }
          if (!spec) return null;

          // NexusX manifest
          const manifestCheck = validateManifest(spec);
          if (manifestCheck.valid) return { manifest: manifestCheck.manifest, url: probeUrl };

          // OpenAPI spec
          if (spec.openapi || spec.swagger) return { spec, url: probeUrl };
          return null;
        })
      );
      const found = probeResults.find((r) => r !== null);
      if (found) {
        if ("manifest" in found) {
          const cap = found.manifest.capabilities[0];
          result = extractFromManifest(cap, found.url, found.manifest.capabilities.length);
        } else {
          result = extractFromSpec(found.spec, found.url);
        }
      }
    }

    clearTimeout(timeout);

    // 3. No spec found — infer what we can from the HTML/headers
    if (!result) {
      const inferred = inferFromResponse(url, directText, directHeaders);
      const healthStatus = await probeHealth(url);
      const resp = fallbackResponse(url, [
        "No OpenAPI spec found. We inferred what we could from the page.",
        "Review and edit the fields below.",
      ], inferred);
      resp.healthCheckStatus = healthStatus;
      return NextResponse.json(resp);
    }

    // 4. Spec found — run health check
    const healthTarget = result.healthCheckUrl || result.baseUrl;
    if (healthTarget) {
      result.healthCheckStatus = await probeHealth(healthTarget);
    }

    return NextResponse.json(result);
  } catch (err) {
    clearTimeout(timeout);
    const message = err instanceof Error && err.name === "AbortError"
      ? "Request timed out (10s)"
      : "Failed to fetch the URL";
    return NextResponse.json(fallbackResponse(url, [message, "You can fill in the fields manually below."]));
  }
}
