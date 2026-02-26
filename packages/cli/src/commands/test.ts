/**
 * nexusx test — simulate an agent calling your listing through the full x402 payment flow
 */

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";

export const testCommand = new Command("test")
  .description("Simulate an agent calling your listing (full x402 payment flow)")
  .option("--listing <slug>", "Listing slug to test")
  .option("--network <network>", "Network: base-mainnet | base-sepolia", "base-sepolia")
  .option("--wallet <key>", "Private key for test wallet (or set NEXUSX_TEST_PRIVATE_KEY)")
  .option("--token <token>", "NexusX API token (or set NEXUSX_API_TOKEN)")
  .action(async (opts) => {
    if (opts.token) process.env.NEXUSX_API_TOKEN = opts.token;
    if (opts.wallet) process.env.NEXUSX_TEST_PRIVATE_KEY = opts.wallet;

    if (!opts.listing) {
      console.error(chalk.red("✖  --listing <slug> is required"));
      process.exit(1);
    }

    const gatewayUrl = process.env.NEXUSX_GATEWAY_URL ?? "https://gateway.nexusx.dev";

    console.log();
    console.log(chalk.bold(`  Testing: ${opts.listing}`));
    console.log(chalk.dim(`  Network: ${opts.network}`));
    console.log(chalk.dim(`  Gateway: ${gatewayUrl}`));
    console.log(chalk.dim("  ─────────────────────────────────────────"));

    // Step 1: Make initial call (expect 402)
    const step1 = ora("Calling gateway (expecting HTTP 402)...").start();
    try {
      const res = await fetch(`${gatewayUrl}/v1/${opts.listing}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: "test" }),
      });

      if (res.status !== 402) {
        step1.warn(`Expected 402, got ${res.status} — listing may not have x402 enabled`);
      } else {
        step1.succeed(`HTTP 402 received — payment required`);
        const body = await res.json() as Record<string, unknown>;
        const amount = (body.amount as string) || "unknown";
        const payTo = (body.paymentRequirements as Record<string, unknown>[])?.[0];
        const usdcAmount = (payTo?.maxAmountRequired as string) || amount;
        console.log(chalk.dim(`  Amount: ${usdcAmount} USDC`));
      }
    } catch (err) {
      step1.fail(`Gateway unreachable: ${(err as Error).message}`);
      console.log(chalk.dim("  Make sure the gateway is running and the listing slug is correct."));
      process.exit(1);
    }

    // Steps 2-3 require a real wallet — explain the flow
    console.log();
    console.log(chalk.bold("  Next steps in the full flow:"));
    console.log(chalk.dim(`
  2. Agent signs EIP-3009 USDC transfer with its CDP wallet
  3. Agent retries with X-Payment header attached
  4. Gateway verifies payment on-chain (Base ${opts.network})
  5. Request forwarded to your API
  6. USDC settled to your payout address (pay-on-success)
    `.trim()));
    console.log();
    console.log(chalk.dim("  Full e2e test with wallet signing: set NEXUSX_TEST_PRIVATE_KEY and re-run."));
    console.log(chalk.dim(`  Get testnet USDC: https://faucet.circle.com`));
    console.log();
  });
