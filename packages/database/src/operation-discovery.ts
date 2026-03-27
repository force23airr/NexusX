import type { Prisma } from "@prisma/client";

export interface OperationSearchMatch {
  operationId: string;
  name: string;
  method: string;
  path: string;
  mode: string;
  authScheme?: string | null;
  idempotent: boolean;
  sideEffect: boolean;
  score: number;
  executionScore?: number;
  reasons: string[];
}

interface ParsedOperationContract {
  operationId: string;
  name: string;
  description: string;
  method: string;
  path: string;
  mode: string;
  authScheme: string | null;
  idempotent: boolean;
  sideEffect: boolean;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "for",
  "to",
  "of",
  "with",
  "on",
  "in",
  "api",
  "service",
  "data",
]);

function isJsonObject(value: Prisma.JsonValue | null | undefined): value is Prisma.JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asString(value: Prisma.JsonValue | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[_/.-]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function extractOperations(
  schemaSpec: Prisma.JsonValue | null | undefined,
): ParsedOperationContract[] {
  if (!isJsonObject(schemaSpec)) return [];
  const rawOperations = schemaSpec.operations;
  if (!Array.isArray(rawOperations)) return [];

  const operations: ParsedOperationContract[] = [];
  for (const rawOperation of rawOperations) {
    if (!isJsonObject(rawOperation)) continue;
    const operationId = asString(rawOperation.operationId);
    const name = asString(rawOperation.name);
    const method = asString(rawOperation.method).toUpperCase();
    const path = asString(rawOperation.path);

    if (!operationId || !name || !method || !path) continue;

    operations.push({
      operationId,
      name,
      description: asString(rawOperation.description),
      method,
      path,
      mode: asString(rawOperation.mode),
      authScheme: asString(rawOperation.authScheme) || null,
      idempotent:
        typeof rawOperation.idempotent === "boolean"
          ? rawOperation.idempotent
          : method === "GET" || method === "PUT" || method === "DELETE",
      sideEffect:
        typeof rawOperation.sideEffect === "boolean"
          ? rawOperation.sideEffect
          : method !== "GET",
    });
  }

  return operations;
}

export function buildOperationSearchText(
  schemaSpec: Prisma.JsonValue | null | undefined,
): string {
  return extractOperations(schemaSpec)
    .map((operation) =>
      [
        operation.operationId,
        operation.name,
        operation.description,
        operation.method,
        operation.path,
        operation.mode,
      ]
        .filter(Boolean)
        .join(" "),
    )
    .join(" ");
}

export function computeOperationSearchMatch(
  query: string,
  schemaSpec: Prisma.JsonValue | null | undefined,
): {
  score: number;
  matches: OperationSearchMatch[];
} {
  const operations = extractOperations(schemaSpec);
  if (operations.length === 0) {
    return { score: 0, matches: [] };
  }

  const normalizedQuery = normalizeText(query);
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) {
    return { score: 0, matches: [] };
  }

  const matches = operations
    .map((operation) => {
      const namePhrase = normalizeText(operation.name);
      const idPhrase = normalizeText(operation.operationId);
      const pathPhrase = normalizeText(operation.path);
      const operationTokens = new Set(
        tokenize(
          [
            operation.operationId,
            operation.name,
            operation.description,
            operation.path,
            operation.mode,
          ]
            .filter(Boolean)
            .join(" "),
        ),
      );
      const pathTokens = new Set(tokenize(operation.path));

      const matchedTokens = Array.from(queryTokens).filter((token) =>
        operationTokens.has(token),
      );
      const matchedPathTokens = Array.from(queryTokens).filter((token) =>
        pathTokens.has(token),
      );

      const overlapScore = matchedTokens.length / queryTokens.size;
      const pathScore =
        queryTokens.size > 0 ? matchedPathTokens.length / queryTokens.size : 0;
      const hasNamePhrase =
        namePhrase.length >= 4 && normalizedQuery.includes(namePhrase);
      const hasIdPhrase =
        idPhrase.length >= 4 && normalizedQuery.includes(idPhrase);
      const hasPathPhrase =
        pathPhrase.length >= 4 && normalizedQuery.includes(pathPhrase);

      let methodHint = 0;
      if (
        operation.method === "GET" &&
        Array.from(queryTokens).some((token) =>
          ["get", "fetch", "list", "read", "quote"].includes(token),
        )
      ) {
        methodHint = 0.06;
      } else if (
        ["POST", "PUT", "PATCH", "DELETE"].includes(operation.method) &&
        Array.from(queryTokens).some((token) =>
          ["create", "place", "submit", "update", "cancel", "delete"].includes(token),
        )
      ) {
        methodHint = 0.06;
      }

      const score = Math.min(
        1,
        overlapScore * 0.55 +
          pathScore * 0.15 +
          (hasNamePhrase ? 0.22 : 0) +
          (hasIdPhrase ? 0.22 : 0) +
          (hasPathPhrase ? 0.12 : 0) +
          methodHint,
      );

      const reasons: string[] = [];
      if (hasNamePhrase || hasIdPhrase) reasons.push(`Supports operation: ${operation.name}`);
      if (matchedTokens.length >= 2) {
        reasons.push(`Operation tokens overlap query: ${matchedTokens.slice(0, 3).join(", ")}`);
      }
      if (matchedPathTokens.length > 0) {
        reasons.push(`Operation path aligns with query: ${operation.path}`);
      }
      if (methodHint > 0) reasons.push(`HTTP method fits the requested action: ${operation.method}`);

      return {
        operationId: operation.operationId,
        name: operation.name,
        method: operation.method,
        path: operation.path,
        mode: operation.mode,
        authScheme: operation.authScheme,
        idempotent: operation.idempotent,
        sideEffect: operation.sideEffect,
        score,
        reasons,
      };
    })
    .filter((match) => match.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return {
    score: matches[0]?.score ?? 0,
    matches,
  };
}
