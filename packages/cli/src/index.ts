#!/usr/bin/env node
/**
 * NexusX CLI — npx nexusx <command>
 *
 * Commands:
 *   deploy   — deploy an API to the NexusX marketplace
 *   test     — simulate an agent calling your listing (full x402 flow)
 *   mcp      — start the NexusX MCP server for agent connections
 *   status   — show your listings and recent activity
 */

import { program } from "commander";
import { deployCommand } from "./commands/deploy.js";
import { testCommand } from "./commands/test.js";
import { statusCommand } from "./commands/status.js";
import { mcpCommand } from "./commands/mcp.js";

program
  .name("nexusx")
  .description("Deploy and monetize APIs on the NexusX agentic marketplace")
  .version("0.1.0");

program.addCommand(deployCommand);
program.addCommand(testCommand);
program.addCommand(statusCommand);
program.addCommand(mcpCommand);

program.parse();
