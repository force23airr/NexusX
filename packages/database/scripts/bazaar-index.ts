#!/usr/bin/env ts-node
// ═══════════════════════════════════════════════════════════════
// NexusX — Bazaar Indexer CLI
// packages/database/scripts/bazaar-index.ts
//
// Pulls x402 Bazaar services from Coinbase's discovery endpoint
// into the NexusX database for semantic search and routing.
//
// Usage:
//   npx tsx packages/database/scripts/bazaar-index.ts
//   npx tsx packages/database/scripts/bazaar-index.ts --dry-run
//   npx tsx packages/database/scripts/bazaar-index.ts --limit 50
//   npx tsx packages/database/scripts/bazaar-index.ts --skip-embed
//   npx tsx packages/database/scripts/bazaar-index.ts --dry-run --limit 10
// ═══════════════════════════════════════════════════════════════

import { prisma, disconnectDatabase } from "../src/client";
import { indexBazaar } from "../src/bazaar-indexer";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const skipEmbed = args.includes("--skip-embed");

  let limit: number | undefined;
  const limitIdx = args.indexOf("--limit");
  if (limitIdx !== -1 && args[limitIdx + 1]) {
    limit = parseInt(args[limitIdx + 1], 10);
    if (isNaN(limit) || limit <= 0) {
      console.error("Invalid --limit value. Must be a positive integer.");
      process.exit(1);
    }
  }

  console.log("\n=== NexusX Bazaar Indexer ===\n");
  console.log(`  Mode:       ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`  Limit:      ${limit ?? "none (full sync)"}`);
  console.log(`  Embed:      ${skipEmbed ? "skip" : "auto"}`);
  console.log();

  const result = await indexBazaar(prisma, { dryRun, limit, skipEmbed });

  console.log("\n=== Summary ===\n");
  console.log(`  Fetched:      ${result.fetched}`);
  console.log(`  Filtered:     ${result.filtered}`);
  console.log(`  Created:      ${result.created}`);
  console.log(`  Updated:      ${result.updated}`);
  console.log(`  Deactivated:  ${result.deactivated}`);
  console.log(`  Skipped:      ${result.skipped}`);
  console.log();

  await disconnectDatabase();
}

main().catch(async (err) => {
  console.error("Bazaar indexer failed:", err);
  await disconnectDatabase();
  process.exit(1);
});
