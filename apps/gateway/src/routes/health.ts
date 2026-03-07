// ═══════════════════════════════════════════════════════════════
// NexusX — Health & Status Routes
// apps/gateway/src/routes/health.ts
//
// Non-proxied endpoints: health checks, pricing lookup,
// and gateway status.
// ═══════════════════════════════════════════════════════════════

import { Router, type Request, type Response } from "express";
import type { RouteResolver } from "../services/routeResolver";
import type { BillingService } from "../services/billingService";

export interface ReadinessCheckResult {
  ok: boolean;
  latencyMs?: number;
  message?: string;
}

export interface HealthRouteConfig {
  routeResolver: RouteResolver;
  billingService: BillingService;
  startedAt: number;
  readinessChecks?: Record<string, () => Promise<ReadinessCheckResult>>;
}

async function runReadinessCheck(
  name: string,
  check: () => Promise<ReadinessCheckResult>,
): Promise<[string, ReadinessCheckResult]> {
  try {
    const result = await Promise.race<ReadinessCheckResult>([
      check(),
      new Promise<ReadinessCheckResult>((resolve) => {
        setTimeout(() => resolve({ ok: false, message: "timeout" }), 2_000);
      }),
    ]);
    return [name, result];
  } catch {
    return [name, { ok: false, message: "unavailable" }];
  }
}

export function createHealthRoutes(config: HealthRouteConfig): Router {
  const router = Router();
  const { routeResolver, billingService, startedAt, readinessChecks } = config;

  // ─── Liveness probe (k8s) ───
  router.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // ─── Readiness probe (k8s) ───
  router.get("/ready", async (_req: Request, res: Response) => {
    const checks = readinessChecks ?? {};
    const entries = await Promise.all(
      Object.entries(checks).map(([name, check]) => runReadinessCheck(name, check)),
    );
    const componentChecks = Object.fromEntries(entries);
    const isReady = Object.values(componentChecks).every((check) => check.ok);

    res.status(isReady ? 200 : 503).json({
      status: isReady ? "ready" : "not_ready",
      uptime: Math.round((Date.now() - startedAt) / 1000),
      checks: componentChecks,
    });
  });

  // ─── Pricing transparency endpoint ───
  // GET /pricing/:listingSlug
  // Returns current price and fee split for a listing.
  // Public — no auth required.
  router.get("/pricing/:listingSlug", async (req: Request, res: Response) => {
    const slug = req.params.listingSlug as string;

    try {
      const route = await routeResolver.resolveBySlug(slug);
      if (!route) {
        res.status(404).json({
          error: "LISTING_NOT_FOUND",
          message: `No listing found for slug: ${slug}`,
        });
        return;
      }

      const split = billingService.computeSplit(route.currentPriceUsdc);

      res.status(200).json({
        listing: {
          id: route.listingId,
          slug,
          status: route.status,
          type: route.isSandbox ? "sandbox" : "live",
        },
        pricing: {
          currentPriceUsdc: route.currentPriceUsdc.toFixed(6),
          floorPriceUsdc: route.floorPriceUsdc.toFixed(6),
          feeSplit: {
            buyerPays: split.price.toFixed(6),
            providerReceives: split.providerAmount.toFixed(6),
            platformFee: split.platformFee.toFixed(6),
            feeRate: `${(split.feeRate * 100).toFixed(1)}%`,
          },
        },
        capacity: {
          requestsPerMinute: route.capacityPerMinute,
        },
      });
    } catch (err) {
      console.error("[Health] Pricing lookup error:", err);
      res.status(500).json({ error: "INTERNAL_ERROR", message: "Failed to fetch pricing." });
    }
  });

  // ─── Gateway status (admin) ───
  router.get("/status", (_req: Request, res: Response) => {
    const uptimeSeconds = Math.round((Date.now() - startedAt) / 1000);

    res.status(200).json({
      service: "nexusx-gateway",
      version: "1.0.0",
      uptime: uptimeSeconds,
      status: "ok",
    });
  });

  return router;
}
