const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const DEFAULT_OPERATION_MODES = ["sync", "async", "streaming", "batch", "webhook"] as const;

export type ListingOperationMethod = (typeof HTTP_METHODS)[number];
export type ListingOperationMode = (typeof DEFAULT_OPERATION_MODES)[number] | string;

export interface ListingOperationContract {
  operationId: string;
  name: string;
  description: string;
  method: ListingOperationMethod;
  path: string;
  mode: ListingOperationMode;
  authScheme: string | null;
  idempotent: boolean;
  sideEffect: boolean;
  inputSchema: Record<string, unknown> | null;
  outputSchema: Record<string, unknown> | null;
  sampleInput: Record<string, unknown> | null;
  sampleOutput: Record<string, unknown> | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function slugifyOperationId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "operation";
}

function sanitizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function sanitizeJsonObject(
  value: unknown,
  field: string,
  index: number,
): Record<string, unknown> | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (!isPlainObject(value)) {
    throw new Error(`operationContracts[${index}].${field} must be a JSON object`);
  }
  return value;
}

function sanitizeOperationMethod(
  value: unknown,
  index: number,
): ListingOperationMethod {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!HTTP_METHODS.includes(normalized as ListingOperationMethod)) {
    throw new Error(`operationContracts[${index}].method must be one of ${HTTP_METHODS.join(", ")}`);
  }
  return normalized as ListingOperationMethod;
}

function normalizeMode(value: unknown): ListingOperationMode {
  const normalized = typeof value === "string" ? normalizeToken(value) : "";
  return normalized || "sync";
}

function deriveOperationName(
  input: Record<string, unknown>,
  method: ListingOperationMethod,
  path: string,
): string {
  const explicitName =
    typeof input.name === "string" ? input.name.trim() : "";
  if (explicitName) return explicitName;

  const operationId =
    typeof input.operationId === "string" ? input.operationId.trim() : "";
  if (operationId) {
    return operationId
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  return `${method} ${path}`;
}

export function sanitizeOperationContractsInput(
  value: unknown,
): ListingOperationContract[] | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return [];
  if (!Array.isArray(value)) {
    throw new Error("operationContracts must be an array");
  }

  const operations: ListingOperationContract[] = [];

  value.forEach((raw, index) => {
    if (!isPlainObject(raw)) {
      throw new Error(`operationContracts[${index}] must be an object`);
    }

    const method = sanitizeOperationMethod(raw.method, index);
    const path = sanitizePath(typeof raw.path === "string" ? raw.path : "");
    const name = deriveOperationName(raw, method, path);
    const operationId =
      typeof raw.operationId === "string" && raw.operationId.trim()
        ? slugifyOperationId(raw.operationId)
        : slugifyOperationId(name);
    const description =
      typeof raw.description === "string" ? raw.description.trim() : "";
    const authScheme =
      typeof raw.authScheme === "string" && raw.authScheme.trim()
        ? normalizeToken(raw.authScheme)
        : null;
    const idempotent =
      typeof raw.idempotent === "boolean"
        ? raw.idempotent
        : method === "GET" || method === "PUT" || method === "DELETE";
    const sideEffect =
      typeof raw.sideEffect === "boolean"
        ? raw.sideEffect
        : method !== "GET";

    operations.push({
      operationId,
      name,
      description,
      method,
      path,
      mode: normalizeMode(raw.mode),
      authScheme,
      idempotent,
      sideEffect,
      inputSchema: sanitizeJsonObject(raw.inputSchema, "inputSchema", index),
      outputSchema: sanitizeJsonObject(raw.outputSchema, "outputSchema", index),
      sampleInput: sanitizeJsonObject(raw.sampleInput, "sampleInput", index),
      sampleOutput: sanitizeJsonObject(raw.sampleOutput, "sampleOutput", index),
    });
  });

  return operations.slice(0, 24);
}

export function extractOperationContracts(schemaSpec: unknown): ListingOperationContract[] {
  if (!isPlainObject(schemaSpec) || !Array.isArray(schemaSpec.operations)) {
    return [];
  }

  try {
    return sanitizeOperationContractsInput(schemaSpec.operations) ?? [];
  } catch {
    return [];
  }
}

export function mergeOperationContractsIntoSchemaSpec(
  schemaSpec: unknown,
  operations: ListingOperationContract[],
): Record<string, unknown> | null {
  const base = isPlainObject(schemaSpec) ? { ...schemaSpec } : {};
  if (operations.length > 0) {
    base.operations = operations;
  } else {
    delete base.operations;
  }

  return Object.keys(base).length > 0 ? base : null;
}

export function buildDetectedOperationContract(input: {
  operationId?: string;
  name?: string;
  description?: string;
  method: string;
  path: string;
  authScheme?: string | null;
  mode?: string;
  inputSchema?: Record<string, unknown> | null;
  outputSchema?: Record<string, unknown> | null;
  sampleInput?: Record<string, unknown> | null;
  sampleOutput?: Record<string, unknown> | null;
}): ListingOperationContract {
  const method = sanitizeOperationMethod(input.method, 0);
  const path = sanitizePath(input.path);
  const name = deriveOperationName(
    {
      name: input.name,
      operationId: input.operationId,
    },
    method,
    path,
  );

  return {
    operationId: slugifyOperationId(input.operationId || name),
    name,
    description: input.description?.trim() || "",
    method,
    path,
    mode: normalizeMode(input.mode),
    authScheme: input.authScheme ? normalizeToken(input.authScheme) : null,
    idempotent: method === "GET" || method === "PUT" || method === "DELETE",
    sideEffect: method !== "GET",
    inputSchema: input.inputSchema ?? null,
    outputSchema: input.outputSchema ?? null,
    sampleInput: input.sampleInput ?? null,
    sampleOutput: input.sampleOutput ?? null,
  };
}

export function createEmptyOperationContract(
  index = 0,
): ListingOperationContract {
  return {
    operationId: `operation_${index + 1}`,
    name: "",
    description: "",
    method: "POST",
    path: "/",
    mode: "sync",
    authScheme: null,
    idempotent: false,
    sideEffect: true,
    inputSchema: null,
    outputSchema: null,
    sampleInput: null,
    sampleOutput: null,
  };
}

export function summarizeOperationTarget(
  operation: Pick<ListingOperationContract, "method" | "path">,
): string {
  return `${operation.method} ${operation.path}`;
}
