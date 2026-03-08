// ═══════════════════════════════════════════════════════════════
// NexusX — Authentication Middleware
// apps/gateway/src/middleware/auth.ts
//
// Validates API keys on every inbound request. Keys are stored
// as SHA-256 hashes in the database — plaintext never persists.
// On success, attaches a RequestContext for downstream handlers.
// ═══════════════════════════════════════════════════════════════

import { randomUUID, randomBytes } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { extractApiKeyPrefix, hashApiKey, isValidApiKeyFormat, verifyApiKeyHash } from "@nexusx/database";
import type { RequestContext } from "../types";
import type { AbuseMonitor } from "../services/abuseMonitor";

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

/** Cached API key record from the database. */
export interface ApiKeyRecord {
  id: string;
  userId: string;
  keyHash: string;
  status: string;
  rateLimitRpm: number;
  allowedIps: string[];
  expiresAt: Date | null;
  /** Buyer's wallet address, joined from wallets table. */
  walletAddress: string;
}

/** Function signature for looking up an API key by its prefix. */
export type ApiKeyLookupFn = (prefix: string) => Promise<ApiKeyRecord | null>;

/** Function signature for recording last-used timestamp. */
export type ApiKeyTouchFn = (keyId: string) => Promise<void>;

// ─────────────────────────────────────────────────────────────
// MIDDLEWARE FACTORY
// ─────────────────────────────────────────────────────────────

/**
 * Creates the authentication middleware.
 *
 * @param lookupKey  Queries the DB (or cache) for an API key by prefix.
 * @param touchKey   Updates the last_used_at timestamp asynchronously.
 * @returns Express middleware.
 */
export function createAuthMiddleware(
  lookupKey: ApiKeyLookupFn,
  touchKey: ApiKeyTouchFn,
  abuseMonitor?: AbuseMonitor,
) {
  return async function authMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const requestId = randomUUID();
    const clientIdentity = getClientIdentity(req);

    if (abuseMonitor) {
      const blockState = await abuseMonitor.checkBlock("auth", clientIdentity);
      if (blockState.blocked) {
        res.setHeader("Retry-After", Math.ceil(blockState.retryAfterMs / 1000).toString());
        res.status(429).json({
          error: "AUTH_TEMPORARILY_BLOCKED",
          message: "Too many invalid authentication attempts from this client.",
          requestId,
          retryAfterMs: blockState.retryAfterMs,
        });
        return;
      }
    }

    // ─── Extract API key ───
    const authHeader = req.headers["authorization"];
    const headerKey = req.headers["x-nexusx-key"] as string | undefined;

    let rawKey: string | undefined;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      rawKey = authHeader.slice(7).trim();
    } else if (headerKey) {
      rawKey = headerKey.trim();
    }

    if (!rawKey) {
      res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Missing API key. Provide via Authorization: Bearer <key> or X-NexusX-Key header.",
        requestId,
      });
      return;
    }

    // ─── Extract prefix (first 8 chars) for lookup ───
    if (!isValidApiKeyFormat(rawKey)) {
      void abuseMonitor?.recordAuthFailure(clientIdentity, "invalid_api_key");
      res.status(401).json({
        error: "INVALID_KEY",
        message: "Malformed API key.",
        requestId,
      });
      return;
    }

    const prefix = extractApiKeyPrefix(rawKey);
    if (!prefix) {
      void abuseMonitor?.recordAuthFailure(clientIdentity, "invalid_api_key");
      res.status(401).json({
        error: "INVALID_KEY",
        message: "Malformed API key.",
        requestId,
      });
      return;
    }

    // ─── Lookup by prefix ───
    let record: ApiKeyRecord | null;
    try {
      record = await lookupKey(prefix);
    } catch (err) {
      console.error("[Auth] Key lookup error:", err);
      res.status(500).json({
        error: "INTERNAL_ERROR",
        message: "Authentication service unavailable.",
        requestId,
      });
      return;
    }

    if (!record) {
      void abuseMonitor?.recordAuthFailure(clientIdentity, "invalid_api_key");
      res.status(401).json({
        error: "INVALID_KEY",
        message: "API key not recognized.",
        requestId,
      });
      return;
    }

    // ─── Verify full hash (timing-safe) ───
    if (!verifyApiKeyHash(rawKey, record.keyHash)) {
      void abuseMonitor?.recordAuthFailure(clientIdentity, "invalid_api_key");
      res.status(401).json({
        error: "INVALID_KEY",
        message: "API key not recognized.",
        requestId,
      });
      return;
    }

    // ─── Check status ───
    if (record.status !== "ACTIVE") {
      res.status(403).json({
        error: "KEY_INACTIVE",
        message: `API key is ${record.status.toLowerCase()}.`,
        requestId,
      });
      return;
    }

    // ─── Check expiry ───
    if (record.expiresAt && record.expiresAt.getTime() < Date.now()) {
      res.status(403).json({
        error: "KEY_EXPIRED",
        message: "API key has expired.",
        requestId,
      });
      return;
    }

    // ─── Check IP allowlist ───
    if (record.allowedIps.length > 0) {
      const clientIp = req.ip || req.socket.remoteAddress || "";

      if (!record.allowedIps.includes(clientIp)) {
        void abuseMonitor?.recordAuthFailure(clientIdentity, "ip_restricted");
        res.status(403).json({
          error: "IP_RESTRICTED",
          message: "Request from unauthorized IP address.",
          requestId,
        });
        return;
      }
    }

    // ─── Attach context ───
    const ctx: RequestContext = {
      buyerId: record.userId,
      buyerAddress: record.walletAddress,
      apiKeyId: record.id,
      rateLimitRpm: record.rateLimitRpm,
      requestId,
      receivedAt: Date.now(),
      authMode: "api_key",
    };

    (req as any).ctx = ctx;

    // ─── Touch last_used_at (fire-and-forget) ───
    touchKey(record.id).catch((err) =>
      console.error("[Auth] Touch key error:", err)
    );

    next();
  };
}

function getClientIdentity(req: Request): string {
  const candidate = req.ip || req.socket.remoteAddress || "unknown";
  return candidate.trim() || "unknown";
}

/**
 * Utility: Generate a new API key and its hash.
 * The raw key is returned once to the user; only the hash is stored.
 *
 * Format: nxs_{prefix}_{random} (total ~44 chars)
 */
export function generateApiKey(): { rawKey: string; keyHash: string; keyPrefix: string } {
  const prefix = randomChars(8);
  const body = randomChars(28);
  const rawKey = `nxs_${prefix}_${body}`;
  const keyHash = hashApiKey(rawKey);
  return { rawKey, keyHash, keyPrefix: prefix };
}

function randomChars(length: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const bytes = randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}
