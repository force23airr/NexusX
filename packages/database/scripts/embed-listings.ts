#!/usr/bin/env ts-node
// ═══════════════════════════════════════════════════════════════
// NexusX — Batch Embed Listings (Cold Start)
// packages/database/scripts/embed-listings.ts
//
// CLI tool to generate embeddings for all active listings.
//
// Usage:
//   npm run db:embed               # Embed only un-embedded listings
//   npm run db:embed:force          # Re-embed all listings
//   npm run db:embed:synthetic      # Generate synthetic queries only
//   npm run db:embed:reindex        # Re-embed all, skip synthetic queries
//
// Requires OPENAI_API_KEY in environment.
// Optionally generates synthetic queries first (needs ANTHROPIC_API_KEY
// or OPENAI_API_KEY for the LLM call).
// ═══════════════════════════════════════════════════════════════

import { prisma, disconnectDatabase } from "../src/client";
import { embedAllListings, type EmbeddingConfig } from "../src/embeddings";
import { generateAllSyntheticQueries } from "../src/synthetic-queries";

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const syntheticOnly = args.includes("--synthetic-only");
  const skipSynthetic = args.includes("--skip-synthetic");

  const openaiKey = process.env.OPENAI_API_KEY;

  if (!openaiKey && !syntheticOnly) {
    console.error("❌ OPENAI_API_KEY is required for embedding generation.");
    console.error("   Set it in your .env file or environment.");
    process.exit(1);
  }

  // Step 1: Generate synthetic queries (unless --skip-synthetic)
  if (!skipSynthetic) {
    console.log("\n📝 Generating synthetic queries...\n");

    const syntheticResult = await generateAllSyntheticQueries(prisma, { force });
    console.log(
      `   Generated: ${syntheticResult.generated} | Skipped: ${syntheticResult.skipped} | Errors: ${syntheticResult.errors}`,
    );

    if (syntheticOnly) {
      console.log("\n✅ Synthetic query generation complete.\n");
      await disconnectDatabase();
      return;
    }
  } else {
    console.log("\n⏩ Skipping synthetic query generation (--skip-synthetic)\n");
  }

  // Step 2: Embed listings
  console.log("\n🧮 Embedding listings...\n");

  const config: EmbeddingConfig = {
    openaiApiKey: openaiKey!,
  };

  const result = await embedAllListings(prisma, config, {
    force,
    batchSize: 10,
    delayMs: 100,
  });

  console.log(
    `   Embedded: ${result.embedded}/${result.embedded + result.skipped + result.errors} listings` +
    ` (${result.skipped} skipped, ${result.errors} errors)`,
  );

  console.log("\n✅ Batch embedding complete.\n");
  await disconnectDatabase();
}

main().catch(async (err) => {
  console.error("❌ Embed script failed:", err);
  await disconnectDatabase();
  process.exit(1);
});
