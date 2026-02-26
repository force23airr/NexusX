/**
 * nexusx status — show your listings and recent activity
 */

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { getListings } from "../lib/api.js";

export const statusCommand = new Command("status")
  .description("Show your NexusX listings and activity")
  .option("--token <token>", "NexusX API token (or set NEXUSX_API_TOKEN)")
  .action(async (opts) => {
    if (opts.token) process.env.NEXUSX_API_TOKEN = opts.token;

    if (!process.env.NEXUSX_API_TOKEN) {
      console.error(
        chalk.red("✖  NEXUSX_API_TOKEN is not set.\n   Get your token at nexusx.dev/provider/settings")
      );
      process.exit(1);
    }

    const spinner = ora("Fetching listings...").start();
    try {
      const listings = await getListings();
      spinner.stop();

      if (listings.length === 0) {
        console.log(chalk.dim("\n  No listings yet. Run: npx nexusx deploy --help\n"));
        return;
      }

      console.log();
      console.log(chalk.bold(`  Your NexusX Listings (${listings.length})`));
      console.log(chalk.dim("  ─────────────────────────────────────────────────────────────"));

      for (const l of listings) {
        const statusBadge =
          l.status === "ACTIVE"
            ? chalk.green("● ACTIVE")
            : l.status === "DRAFT"
            ? chalk.yellow("○ DRAFT")
            : chalk.dim(`○ ${l.status}`);

        console.log(
          `  ${statusBadge}  ${chalk.bold(l.name.padEnd(30))}  ` +
          `${String(l.totalCalls).padStart(6)} calls  ` +
          `${chalk.green("$" + l.totalRevenueUsdc.toFixed(4))} USDC`
        );
        console.log(
          chalk.dim(
            `            nexusx.dev/marketplace/${l.slug}    ` +
            `$${l.floorPriceUsdc.toFixed(6)}/call`
          )
        );
      }
      console.log();
    } catch (err) {
      spinner.fail(`Failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });
