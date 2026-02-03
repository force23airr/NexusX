#!/usr/bin/env ts-node
// ═══════════════════════════════════════════════════════════════
// NexusX — Database Reset Script
// packages/database/scripts/reset.ts
//
// Full database reset: drop → migrate → seed.
// WARNING: Destroys all data. Use only in development.
//
// Usage: npx ts-node scripts/reset.ts
//        npm run db:reset
// ═══════════════════════════════════════════════════════════════

import { execSync } from "child_process";

const ENV = process.env.NODE_ENV || "development";

async function main() {
  if (ENV === "production") {
    console.error("❌ Cannot reset production database. Aborting.");
    process.exit(1);
  }

  console.log(`\n🔄 Resetting NexusX database (${ENV})...\n`);

  // Step 1: Reset (drops all tables and re-applies migrations).
  console.log("  1/3  Resetting schema...");
  execSync("npx prisma migrate reset --force --skip-seed", {
    stdio: "inherit",
    cwd: process.cwd(),
  });

  // Step 2: Generate Prisma client.
  console.log("\n  2/3  Generating Prisma client...");
  execSync("npx prisma generate", {
    stdio: "inherit",
    cwd: process.cwd(),
  });

  // Step 3: Run seed.
  console.log("\n  3/3  Seeding...");
  execSync("npx ts-node prisma/seeds/seed.ts", {
    stdio: "inherit",
    cwd: process.cwd(),
  });

  console.log("\n✅ Database reset complete!\n");
}

main().catch((err) => {
  console.error("❌ Reset failed:", err);
  process.exit(1);
});
