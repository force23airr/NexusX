/**
 * nexusx deploy — deploy an API to the NexusX marketplace
 *
 * Usage:
 *   npx nexusx deploy --spec ./openapi.json --floor 0.001 --payout 0x...
 *   npx nexusx deploy --url https://api.example.com --floor 0.001 --payout 0x...
 */

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { loadSpecFile, extractFromSpec } from "../lib/spec.js";
import { detectSpec, createListing, updatePayoutAddress } from "../lib/api.js";

const CATEGORY_PRICING: Record<string, { floor: number; ceiling: number }> = {
  "language-models": { floor: 0.003, ceiling: 0.05 },
  "translation": { floor: 0.001, ceiling: 0.01 },
  "sentiment-analysis": { floor: 0.0005, ceiling: 0.005 },
  "embeddings": { floor: 0.0001, ceiling: 0.002 },
  "object-detection": { floor: 0.002, ceiling: 0.02 },
  "datasets": { floor: 0.01, ceiling: 0.10 },
};

const NEXUS_FEE = 0.15;

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function payoutPreview(floor: number, ceiling: number, addr: string) {
  const avg = ceiling > 0 ? (floor + ceiling) / 2 : floor;
  const calls = 1000;
  const gross = calls * avg;
  const fee = gross * NEXUS_FEE;
  const net = gross - fee;

  console.log();
  console.log(chalk.bold("  Payout preview (1,000 calls/day estimate)"));
  console.log(
    `  ${calls} calls × $${avg.toFixed(4)} avg = ${chalk.white("$" + gross.toFixed(4))} gross`
  );
  console.log(
    `  Nexus fee (15%)                  ${chalk.dim("-$" + fee.toFixed(4))}`
  );
  console.log(
    `  ${chalk.green("You receive")}                      ${chalk.green("$" + net.toFixed(4) + " USDC/day")}`
  );
  console.log(
    `  ${chalk.dim("Settled to")} ${chalk.cyan(shortAddr(addr))} ${chalk.dim("on Base L2")}`
  );
  console.log();
}

export const deployCommand = new Command("deploy")
  .description("Deploy an API to the NexusX marketplace")
  .option("--spec <path>", "Path to OpenAPI spec (JSON or YAML)")
  .option("--url <url>", "API base URL (auto-detects spec if no --spec given)")
  .option("--name <name>", "Listing name (auto-detected from spec if omitted)")
  .option("--floor <usdc>", "Minimum price per call in USDC", parseFloat)
  .option("--ceiling <usdc>", "Maximum price per call in USDC (enables surge pricing)", parseFloat)
  .option("--payout <address>", "Base L2 wallet address for USDC settlements")
  .option("--category <slug>", "Category slug (auto-detected if omitted)")
  .option("--auth <type>", "Auth type: api_key | oauth2 | jwt | none")
  .option("--network <network>", "Network: base-mainnet | base-sepolia", "base-mainnet")
  .option("--dry-run", "Preview listing without creating it")
  .option("--token <token>", "NexusX API token (or set NEXUSX_API_TOKEN)")
  .action(async (opts) => {
    // ── Token ──
    if (opts.token) process.env.NEXUSX_API_TOKEN = opts.token;

    if (!opts.floor && opts.floor !== 0) {
      console.error(chalk.red("✖  --floor <usdc> is required"));
      process.exit(1);
    }
    if (!opts.payout) {
      console.error(chalk.red("✖  --payout <address> is required"));
      process.exit(1);
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(opts.payout)) {
      console.error(chalk.red("✖  --payout must be a valid Ethereum address (0x...)"));
      process.exit(1);
    }

    console.log();
    console.log(chalk.bold("  NexusX Deploy"));
    console.log(chalk.dim("  ─────────────────────────────────────────"));

    let name: string | undefined = opts.name;
    let description = "";
    let baseUrl: string = opts.url ?? "";
    let authType: string = opts.auth ?? "api_key";
    let listingType = "REST_API";
    let docsUrl: string | undefined;
    let healthCheckUrl: string | undefined;
    let categorySlug: string | undefined = opts.category;
    let sampleRequest: unknown;
    let sampleResponse: unknown;

    // ── Load from spec file ──
    if (opts.spec) {
      const spinner = ora("Loading spec file...").start();
      try {
        const raw = loadSpecFile(opts.spec);
        const parsed = extractFromSpec(raw, opts.url);
        name ??= parsed.name;
        description = parsed.description;
        baseUrl = parsed.baseUrl || baseUrl;
        authType = opts.auth ?? parsed.authType;
        listingType = parsed.listingType;
        docsUrl = parsed.docsUrl;
        sampleRequest = parsed.sampleRequest;
        sampleResponse = parsed.sampleResponse;
        spinner.succeed(
          `Spec loaded — ${parsed.endpoints.length} endpoint${parsed.endpoints.length !== 1 ? "s" : ""} found`
        );
      } catch (err) {
        spinner.fail(`Failed to load spec: ${(err as Error).message}`);
        process.exit(1);
      }
    }

    // ── Auto-detect from URL ──
    if (opts.url && !opts.spec) {
      const spinner = ora("Auto-detecting from URL...").start();
      try {
        const result = await detectSpec(opts.url);
        name ??= result.name;
        description = result.description ?? "";
        baseUrl = result.baseUrl || opts.url;
        authType = opts.auth ?? result.authType ?? "api_key";
        docsUrl = result.docsUrl;
        healthCheckUrl = result.healthCheckUrl;
        categorySlug ??= result.suggestedCategorySlug;
        sampleRequest = result.sampleRequest;
        sampleResponse = result.sampleResponse;

        if (result.detected) {
          spinner.succeed(
            `Detected — ${result.endpoints.length} endpoint${result.endpoints.length !== 1 ? "s" : ""} found`
          );
        } else {
          spinner.warn(
            result.warnings[0] ?? "No OpenAPI spec found — using inferred values"
          );
        }

        if (result.warnings.length > 0 && result.detected) {
          result.warnings.forEach((w) => console.log(chalk.yellow(`  ⚠  ${w}`)));
        }
      } catch (err) {
        spinner.fail(`Auto-detection failed: ${(err as Error).message}`);
        console.log(chalk.dim("  Proceeding with provided values..."));
      }
    }

    if (!name) {
      console.error(chalk.red("✖  Could not determine listing name. Use --name <name>"));
      process.exit(1);
    }
    if (!baseUrl) {
      console.error(chalk.red("✖  Could not determine base URL. Use --url <url>"));
      process.exit(1);
    }

    // ── Category-based pricing suggestion ──
    if (categorySlug && CATEGORY_PRICING[categorySlug]) {
      const bench = CATEGORY_PRICING[categorySlug];
      if (opts.floor < bench.floor * 0.5) {
        console.log(
          chalk.yellow(
            `  ⚠  Floor $${opts.floor} is well below typical for ${categorySlug} ($${bench.floor}–$${bench.ceiling})`
          )
        );
      }
    }

    // ── Dry run preview ──
    if (opts.dryRun) {
      console.log();
      console.log(chalk.bold("  Listing preview (dry run — not deployed)"));
      console.log(chalk.dim("  ─────────────────────────────────────────"));
      console.log(`  ${chalk.bold("Name")}         ${name}`);
      console.log(`  ${chalk.bold("Base URL")}     ${baseUrl}`);
      console.log(`  ${chalk.bold("Auth")}         ${authType}`);
      console.log(`  ${chalk.bold("Floor")}        $${opts.floor.toFixed(6)} USDC/call`);
      if (opts.ceiling) {
        console.log(`  ${chalk.bold("Ceiling")}      $${opts.ceiling.toFixed(6)} USDC/call`);
      }
      if (categorySlug) console.log(`  ${chalk.bold("Category")}     ${categorySlug}`);
      console.log(`  ${chalk.bold("Payout")}       ${shortAddr(opts.payout)} on Base L2`);
      payoutPreview(opts.floor, opts.ceiling ?? 0, opts.payout);
      console.log(chalk.dim("  Run without --dry-run to deploy."));
      return;
    }

    // ── Check token ──
    if (!process.env.NEXUSX_API_TOKEN) {
      console.error(
        chalk.red(
          "✖  NEXUSX_API_TOKEN is not set.\n" +
          "   Get your token at nexusx.dev/provider/settings\n" +
          "   then run: export NEXUSX_API_TOKEN=nxp_..."
        )
      );
      process.exit(1);
    }

    // ── Deploy ──
    const deploySpinner = ora("Creating listing on NexusX...").start();
    try {
      const result = await createListing({
        name,
        description,
        baseUrl,
        listingType,
        authType,
        floorPriceUsdc: opts.floor,
        ceilingPriceUsdc: opts.ceiling,
        categorySlug,
        docsUrl,
        healthCheckUrl,
        sampleRequest,
        sampleResponse,
        payoutAddress: opts.payout,
      });

      deploySpinner.succeed("Listing created");

      // Update payout address
      try {
        await updatePayoutAddress(opts.payout);
      } catch {
        // non-blocking — already set or will be set via dashboard
      }

      // ── Success output ──
      console.log();
      console.log(chalk.bold.green("  ✓ Deployed to NexusX"));
      console.log(chalk.dim("  ─────────────────────────────────────────"));
      console.log(`  ${chalk.bold("Listing")}      ${result.name}`);
      console.log(`  ${chalk.bold("MCP tool")}     ${chalk.cyan(result.mcpToolName)}`);
      console.log(`  ${chalk.bold("Floor")}        $${result.floorPriceUsdc.toFixed(6)} USDC/call`);
      if (result.ceilingPriceUsdc) {
        console.log(`  ${chalk.bold("Ceiling")}      $${result.ceilingPriceUsdc.toFixed(6)} USDC/call`);
      }
      console.log(`  ${chalk.bold("View")}         ${chalk.underline(`https://nexusx.dev/marketplace/${result.slug}`)}`);
      console.log();

      payoutPreview(opts.floor, opts.ceiling ?? 0, opts.payout);

      console.log(chalk.bold("  Connect agents to your listing:"));
      console.log(
        chalk.dim(`
  {
    "mcpServers": {
      "nexusx": {
        "command": "npx",
        "args": ["nexusx", "mcp"],
        "env": { "NEXUSX_SESSION_BUDGET_USDC": "5.00" }
      }
    }
  }
        `.trim())
      );
      console.log();
    } catch (err) {
      deploySpinner.fail(`Deploy failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });
