/**
 * nexusx mcp — start the NexusX MCP server for agent connections
 *
 * This bridges to apps/mcp-server. When running via npx, it starts
 * the published MCP server so agents can connect to NexusX tools.
 */

import { Command } from "commander";
import chalk from "chalk";
import { spawn } from "child_process";

export const mcpCommand = new Command("mcp")
  .description("Start the NexusX MCP server (for Claude and other agents)")
  .option("--transport <transport>", "Transport: stdio | http", "stdio")
  .option("--port <port>", "HTTP port (when --transport http)", "3400")
  .option("--budget <usdc>", "Per-session USDC budget for agent calls", "5.00")
  .option("--token <token>", "NexusX API token (or set NEXUSX_API_TOKEN)")
  .action((opts) => {
    if (opts.token) process.env.NEXUSX_API_TOKEN = opts.token;

    const env = {
      ...process.env,
      NEXUSX_TRANSPORT: opts.transport,
      PORT: opts.port,
      NEXUSX_BUDGET_USDC: opts.budget,
    };

    // In the published package, resolve the bundled mcp-server.
    // In the monorepo, defer to the apps/mcp-server package.
    const serverPath =
      process.env.NEXUSX_MCP_SERVER_PATH ??
      new URL("../../../mcp-server/dist/server.js", import.meta.url).pathname;

    if (opts.transport === "http") {
      console.log(chalk.dim(`  NexusX MCP server starting on port ${opts.port}...`));
    }

    const child = spawn(process.execPath, [serverPath], {
      env,
      stdio: "inherit",
    });

    child.on("error", (err) => {
      console.error(chalk.red(`Failed to start MCP server: ${err.message}`));
      console.error(
        chalk.dim(
          "Make sure you have the full NexusX package installed or are running from the monorepo."
        )
      );
      process.exit(1);
    });

    child.on("exit", (code) => {
      process.exit(code ?? 0);
    });
  });
