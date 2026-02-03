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

export interface HealthRouteConfig {
  routeResolver: RouteResolver;
  billingService: BillingService;
  startedAt: number;
}

export function createHealthRoutes(config: HealthRouteConfig): Router {
  const router = Router();
  const { routeResolver, billingService, startedAt } = config;

  // ─── Liveness probe (k8s) ───
  router.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // ─── Readiness probe (k8s) ───
  router.get("/ready", (_req: Request, res: Response) => {
    // In production, check DB/Redis connectivity here.
    res.status(200).json({
      status: "ready",
      uptime: Math.round((Date.now() - startedAt) / 1000),
      cache: routeResolver.stats(),
    });
  });

  // ─── Pricing transparency endpoint ───
  // GET /pricing/:listingSlug
  // Returns current price and fee split for a listing.
  // Public — no auth required.
  router.get("/pricing/:listingSlug", async (req: Request, res: Response) => {
    const slug = req.params.listingSlug;

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
    const memUsage = process.memoryUsage();

    res.status(200).json({
      service: "nexusx-gateway",
      version: "1.0.0",
      uptime: uptimeSeconds,
      cache: routeResolver.stats(),
      memory: {
        rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
      },
    });
  });

  return router;
}
