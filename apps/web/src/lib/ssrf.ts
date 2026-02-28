// ═══════════════════════════════════════════════════════════════
// NexusX — SSRF Protection Utility
// apps/web/src/lib/ssrf.ts
//
// Shared utility to reject private/reserved IP addresses
// when fetching user-supplied URLs.
// ═══════════════════════════════════════════════════════════════

const PRIVATE_RANGES = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
  /^0\./, /^169\.254\./, /^fc00:/i, /^fe80:/i, /^::1$/, /^localhost$/i,
];

export function isPrivateHost(hostname: string): boolean {
  return PRIVATE_RANGES.some((re) => re.test(hostname));
}
