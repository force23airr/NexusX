// ═══════════════════════════════════════════════════════════════
// NexusX — Bundle Session Routes
// apps/gateway/src/routes/bundle-sessions.ts
//
// Bundle lifecycle endpoints:
//   POST /bundle-sessions/register
//   GET  /bundle-sessions/:bundleSessionId
//   POST /bundle-sessions/:bundleSessionId/finalize
//
// Registration pre-allocates a bundle execution session.
// Finalization charges once at bundle price and allocates provider shares.
// ═══════════════════════════════════════════════════════════════

import { Router, type Request, type Response } from "express";
import type {
  BundleSessionFinalizeResult,
  BundleSessionRecord,
  BundleSessionRegistrationInput,
  RequestContext,
} from "../types";

export interface BundleSessionRouteConfig {
  registerBundleSession: (
    input: BundleSessionRegistrationInput,
  ) => Promise<BundleSessionRecord>;
  lookupBundleSession: (bundleSessionId: string) => Promise<BundleSessionRecord | null>;
  finalizeBundleSession: (input: {
    bundleSessionId: string;
    buyerId: string;
  }) => Promise<BundleSessionFinalizeResult>;
  defaultBundlePlatformFeeRate: number;
  defaultSessionTtlMs: number;
}

export function createBundleSessionRoutes(config: BundleSessionRouteConfig): Router {
  const router = Router();

  router.post("/register", async (req: Request, res: Response) => {
    const ctx = (req as any).ctx as RequestContext | undefined;
    if (!ctx) {
      res.status(500).json({ error: "INTERNAL_ERROR", message: "Missing request context." });
      return;
    }

    let body: Record<string, unknown>;
    try {
      body = parseJsonBody(req);
    } catch {
      res.status(400).json({
        error: "INVALID_JSON",
        message: "Request body must be valid JSON.",
      });
      return;
    }

    const bundleSlug = coerceNonEmptyString(body.bundle_slug ?? body.bundleSlug);
    const bundleName = coerceOptionalString(body.bundle_name ?? body.bundleName);
    const toolSlugs = coerceStringArray(body.tool_slugs ?? body.toolSlugs);
    const bundlePriceUsdc = coerceNumber(body.bundle_price_usdc ?? body.bundlePriceUsdc);
    const overrideBundleFeeRate = coerceOptionalNumber(
      body.bundle_platform_fee_rate ?? body.bundlePlatformFeeRate,
    );
    const metadata = isRecord(body.metadata) ? body.metadata : null;

    if (!bundleSlug || toolSlugs.length === 0 || bundlePriceUsdc === null) {
      res.status(400).json({
        error: "INVALID_INPUT",
        message:
          "Required fields: bundle_slug (string), tool_slugs (string[]), bundle_price_usdc (number).",
      });
      return;
    }

    const feeRate = clamp(
      overrideBundleFeeRate ?? config.defaultBundlePlatformFeeRate,
      0,
      1,
    );

    try {
      const session = await config.registerBundleSession({
        buyerId: ctx.buyerId,
        apiKeyId: ctx.apiKeyId,
        bundleSlug,
        bundleName,
        toolSlugs,
        bundlePriceUsdc,
        bundlePlatformFeeRate: feeRate,
        expiresAt: new Date(Date.now() + config.defaultSessionTtlMs),
        metadata,
      });

      res.status(201).json({
        bundleSessionId: session.id,
        status: session.status,
        bundleSlug: session.bundleSlug,
        bundleName: session.bundleName,
        toolSlugs: session.toolSlugs,
        registeredGrossPriceUsdc: session.registeredGrossPriceUsdc,
        targetBundlePriceUsdc: session.targetBundlePriceUsdc,
        bundlePlatformFeeRate: session.platformFeeRate,
        expiresAt: session.expiresAt?.toISOString() ?? null,
        createdAt: session.createdAt.toISOString(),
      });
    } catch (err) {
      const { status, error, message } = mapRouteError(err);
      res.status(status).json({ error, message });
    }
  });

  router.get("/:bundleSessionId", async (req: Request, res: Response) => {
    const ctx = (req as any).ctx as RequestContext | undefined;
    if (!ctx) {
      res.status(500).json({ error: "INTERNAL_ERROR", message: "Missing request context." });
      return;
    }

    const bundleSessionId = String(req.params.bundleSessionId ?? "");
    if (!bundleSessionId) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Missing bundleSessionId." });
      return;
    }

    const session = await config.lookupBundleSession(bundleSessionId);
    if (!session || session.buyerId !== ctx.buyerId) {
      res.status(404).json({ error: "NOT_FOUND", message: "Bundle session not found." });
      return;
    }

    res.status(200).json({
      bundleSessionId: session.id,
      status: session.status,
      bundleSlug: session.bundleSlug,
      bundleName: session.bundleName,
      toolSlugs: session.toolSlugs,
      registeredGrossPriceUsdc: session.registeredGrossPriceUsdc,
      executedGrossPriceUsdc: session.executedGrossPriceUsdc,
      targetBundlePriceUsdc: session.targetBundlePriceUsdc,
      billedPriceUsdc: session.billedPriceUsdc,
      discountUsdc: session.discountUsdc,
      platformFeeRate: session.platformFeeRate,
      platformFeeUsdc: session.platformFeeUsdc,
      providerPoolUsdc: session.providerPoolUsdc,
      expiresAt: session.expiresAt?.toISOString() ?? null,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      finalizedAt: session.finalizedAt?.toISOString() ?? null,
    });
  });

  router.post("/:bundleSessionId/finalize", async (req: Request, res: Response) => {
    const ctx = (req as any).ctx as RequestContext | undefined;
    if (!ctx) {
      res.status(500).json({ error: "INTERNAL_ERROR", message: "Missing request context." });
      return;
    }

    const bundleSessionId = String(req.params.bundleSessionId ?? "");
    if (!bundleSessionId) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Missing bundleSessionId." });
      return;
    }

    try {
      const finalized = await config.finalizeBundleSession({
        bundleSessionId,
        buyerId: ctx.buyerId,
      });

      res.status(200).json({
        bundleSessionId: finalized.bundleSessionId,
        status: finalized.status,
        billedPriceUsdc: finalized.billedPriceUsdc,
        executedGrossPriceUsdc: finalized.executedGrossPriceUsdc,
        discountUsdc: finalized.discountUsdc,
        platformFeeUsdc: finalized.platformFeeUsdc,
        providerPoolUsdc: finalized.providerPoolUsdc,
        settlementCount: finalized.settlementCount,
        allocations: finalized.allocations,
      });
    } catch (err) {
      const { status, error, message } = mapRouteError(err);
      res.status(status).json({ error, message });
    }
  });

  return router;
}

function parseJsonBody(req: Request): Record<string, unknown> {
  const body = (req as any).body;

  if (body === undefined || body === null) {
    return {};
  }

  if (Buffer.isBuffer(body)) {
    if (body.length === 0) return {};
    return JSON.parse(body.toString("utf8"));
  }

  if (typeof body === "string") {
    if (body.trim().length === 0) return {};
    return JSON.parse(body);
  }

  if (isRecord(body)) {
    return body;
  }

  throw new Error("Invalid body type");
}

function coerceNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function coerceOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return coerceNonEmptyString(value);
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    out.push(trimmed);
  }
  return out;
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function coerceOptionalNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  return coerceNumber(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mapRouteError(err: unknown): {
  status: number;
  error: string;
  message: string;
} {
  const code = (err as any)?.code;

  if (code === "NOT_FOUND") {
    return { status: 404, error: "NOT_FOUND", message: "Bundle session not found." };
  }
  if (code === "FORBIDDEN") {
    return { status: 403, error: "FORBIDDEN", message: "Bundle session does not belong to this buyer." };
  }
  if (code === "INVALID_INPUT") {
    return {
      status: 400,
      error: "INVALID_INPUT",
      message: (err as Error).message || "Invalid bundle session input.",
    };
  }
  if (code === "INSUFFICIENT_FUNDS") {
    return {
      status: 402,
      error: "INSUFFICIENT_FUNDS",
      message: (err as Error).message || "Insufficient wallet balance to settle bundle.",
    };
  }
  if (code === "CONFLICT") {
    return {
      status: 409,
      error: "CONFLICT",
      message: (err as Error).message || "Bundle session state conflict.",
    };
  }

  return {
    status: 500,
    error: "INTERNAL_ERROR",
    message: "Bundle operation failed.",
  };
}
