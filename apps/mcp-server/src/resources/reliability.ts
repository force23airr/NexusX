// ═══════════════════════════════════════════════════════════════
// NexusX — MCP Reliability Resource
// apps/mcp-server/src/resources/reliability.ts
//
// Resource: nexusx://reliability/{slug}
// Returns the full reliability breakdown for agents that want
// granular real-time quality data beyond what the listing detail
// provides.
// ═══════════════════════════════════════════════════════════════

import type { GatewayClient } from "../services/gateway-client";

export function createReliabilityResourceHandler(gateway: GatewayClient) {
  return async (slug: string): Promise<string> => {
    const score = await gateway.getReliability(slug);

    if (!score) {
      return JSON.stringify({
        slug,
        reliability: null,
        message: "No reliability data available yet. The API needs call history before scores can be computed.",
      }, null, 2);
    }

    const status = getStatus(score.errorRate, score.uptimePct);

    return JSON.stringify({
      slug,
      status,
      reliability: {
        errorRate: `${(score.errorRate * 100).toFixed(1)}%`,
        p50Latency: `${score.p50LatencyMs}ms`,
        p95Latency: `${score.p95LatencyMs}ms`,
        p99Latency: `${score.p99LatencyMs}ms`,
        uptime: `${(score.uptimePct * 100).toFixed(1)}%`,
        callCount: score.callCount,
        qualityScore: `${score.qualityScore}/100`,
        computedAt: new Date(score.computedAt).toISOString(),
      },
      interpretation: {
        errorRate: interpretErrorRate(score.errorRate),
        latency: interpretLatency(score.p95LatencyMs),
        uptime: interpretUptime(score.uptimePct),
        overall: interpretOverall(status, score.qualityScore),
      },
      note: "Scores computed from the last 1,000 calls. 429 (rate limit) responses are excluded from error rate and uptime calculations — they indicate high demand, not poor reliability.",
    }, null, 2);
  };
}

function getStatus(errorRate: number, uptimePct: number): "healthy" | "degraded" | "unreliable" {
  if (errorRate < 0.02 && uptimePct > 0.98) return "healthy";
  if (errorRate < 0.05 && uptimePct > 0.95) return "degraded";
  return "unreliable";
}

function interpretErrorRate(rate: number): string {
  if (rate < 0.01) return "Excellent — less than 1% of calls fail.";
  if (rate < 0.02) return "Good — error rate is within normal range.";
  if (rate < 0.05) return "Elevated — consider monitoring or using an alternative.";
  return "High — this API is experiencing significant failures.";
}

function interpretLatency(p95Ms: number): string {
  if (p95Ms < 100) return "Excellent — sub-100ms p95 latency.";
  if (p95Ms < 300) return "Good — responsive for most use cases.";
  if (p95Ms < 1000) return "Moderate — acceptable for non-latency-critical work.";
  return "Slow — consider alternatives if latency matters.";
}

function interpretUptime(pct: number): string {
  if (pct > 0.999) return "Excellent — three-nines availability.";
  if (pct > 0.99) return "Good — two-nines availability.";
  if (pct > 0.95) return "Degraded — availability below 99%.";
  return "Poor — significant downtime observed.";
}

function interpretOverall(status: string, qualityScore: number): string {
  if (status === "healthy") return `Healthy (${qualityScore}/100). Safe to use with confidence.`;
  if (status === "degraded") return `Degraded (${qualityScore}/100). Usable but monitor closely. Consider alternatives for critical workloads.`;
  return `Unreliable (${qualityScore}/100). Not recommended for production use. Look for alternatives.`;
}
