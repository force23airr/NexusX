// ═══════════════════════════════════════════════════════════════
// NexusX — Frontend Utilities
// apps/web/src/lib/utils.ts
//
// Shared formatting, display, and computation helpers.
// ═══════════════════════════════════════════════════════════════

import type { ListingType, ListingStatus, TransactionStatus } from "@/types";

// ─── USDC Formatting ───

/**
 * Format a USDC amount for display.
 * Adapts precision based on magnitude:
 *   < 0.01   → 6 decimals  ($0.000500)
 *   < 1      → 4 decimals  ($0.0080)
 *   < 1000   → 2 decimals  ($12.50)
 *   ≥ 1000   → abbreviated ($12.5K)
 */
export function formatUsdc(amount: number): string {
  if (amount < 0.01) return `$${amount.toFixed(6)}`;
  if (amount < 1) return `$${amount.toFixed(4)}`;
  if (amount < 1_000) return `$${amount.toFixed(2)}`;
  if (amount < 1_000_000) return `$${(amount / 1_000).toFixed(1)}K`;
  return `$${(amount / 1_000_000).toFixed(2)}M`;
}

/**
 * Format a USDC price per call with appropriate precision.
 */
export function formatPricePerCall(usdc: number): string {
  if (usdc < 0.0001) return `$${usdc.toFixed(6)}`;
  if (usdc < 0.01) return `$${usdc.toFixed(4)}`;
  return `$${usdc.toFixed(3)}`;
}

// ─── Number Formatting ───

export function formatNumber(n: number): string {
  if (n < 1_000) return n.toString();
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}

export function formatPercent(n: number, decimals: number = 1): string {
  return `${n.toFixed(decimals)}%`;
}

export function formatLatency(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ─── Time ───

export function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const seconds = Math.floor(diffMs / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

// ─── Status Badges ───

export function listingStatusColor(status: ListingStatus): string {
  const map: Record<ListingStatus, string> = {
    DRAFT: "bg-zinc-500/15 text-zinc-400",
    PENDING_REVIEW: "bg-amber-500/15 text-amber-400",
    ACTIVE: "bg-emerald-500/15 text-emerald-400",
    PAUSED: "bg-blue-500/15 text-blue-400",
    SUSPENDED: "bg-red-500/15 text-red-400",
    DEPRECATED: "bg-zinc-500/15 text-zinc-500",
  };
  return map[status] || "bg-zinc-500/15 text-zinc-400";
}

export function transactionStatusColor(status: TransactionStatus): string {
  const map: Record<TransactionStatus, string> = {
    PENDING: "bg-amber-500/15 text-amber-400",
    CONFIRMED: "bg-emerald-500/15 text-emerald-400",
    FAILED: "bg-red-500/15 text-red-400",
    REFUNDED: "bg-blue-500/15 text-blue-400",
    DISPUTED: "bg-orange-500/15 text-orange-400",
  };
  return map[status] || "bg-zinc-500/15 text-zinc-400";
}

// ─── Listing Type Labels ───

export function listingTypeLabel(type: ListingType): string {
  const map: Record<ListingType, string> = {
    REST_API: "REST API",
    GRAPHQL_API: "GraphQL",
    WEBSOCKET: "WebSocket",
    DATASET: "Dataset",
    MODEL_INFERENCE: "Model",
    COMPOSITE: "Composite",
  };
  return map[type] || type;
}

export function listingTypeIcon(type: ListingType): string {
  const map: Record<ListingType, string> = {
    REST_API: "⚡",
    GRAPHQL_API: "◈",
    WEBSOCKET: "⇄",
    DATASET: "▦",
    MODEL_INFERENCE: "◆",
    COMPOSITE: "⬡",
  };
  return map[type] || "●";
}

// ─── Price Direction ───

export function priceDirection(current: number, previous: number): "up" | "down" | "flat" {
  if (current > previous * 1.001) return "up";
  if (current < previous * 0.999) return "down";
  return "flat";
}

export function priceChangePercent(current: number, previous: number): number {
  if (previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}

// ─── Score to Rating ───

export function scoreToStars(score: number, max: number = 5): number {
  return Math.round((score / max) * 10) / 10;
}

// ─── Class Merge Utility ───

export function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(" ");
}
