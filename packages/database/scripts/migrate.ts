#!/usr/bin/env ts-node
// ═══════════════════════════════════════════════════════════════
// NexusX — Migration Helper
// packages/database/scripts/migrate.ts
//
// Wrapper around `prisma migrate dev` with naming conventions,
// validation, and environment safety checks.
//
// Usage:
//   npx ts-node scripts/migrate.ts "add_listing_webhooks"
//   npm run db:migrate -- "add_listing_webhooks"
// ═══════════════════════════════════════════════════════════════

import { execSync } from "child_process";

const ENV = process.env.NODE_ENV || "development";

async function main() {
  const migrationName = process.argv[2];

  if (!migrationName) {
    console.error("❌ Migration name required.");
    console.error("   Usage: npx ts-node scripts/migrate.ts <name>");
    console.error('   Example: npx ts-node scripts/migrate.ts "add_listing_webhooks"');
    process.exit(1);
  }

  // Validate naming convention: snake_case, alphanumeric + underscores.
  if (!/^[a-z][a-z0-9_]*$/.test(migrationName)) {
    console.error("❌ Migration name must be snake_case (lowercase, underscores only).");
    console.error(`   Got: "${migrationName}"`);
    process.exit(1);
  }

  if (ENV === "production") {
    console.error("❌ Cannot create migrations against production. Use `prisma migrate deploy` instead.");
    process.exit(1);
  }

  console.log(`\n📦 Creating migration: ${migrationName}\n`);

  // Step 1: Validate schema.
  console.log("  1/3  Validating schema...");
  try {
    execSync("npx prisma validate", { stdio: "inherit", cwd: process.cwd() });
  } catch {
    console.error("❌ Schema validation failed. Fix errors before migrating.");
    process.exit(1);
  }

  // Step 2: Format schema.
  console.log("\n  2/3  Formatting schema...");
  execSync("npx prisma format", { stdio: "inherit", cwd: process.cwd() });

  // Step 3: Create migration.
  console.log(`\n  3/3  Creating migration: ${migrationName}...`);
  execSync(`npx prisma migrate dev --name ${migrationName}`, {
    stdio: "inherit",
    cwd: process.cwd(),
  });

  console.log(`\n✅ Migration "${migrationName}" created successfully!\n`);
}

main().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
