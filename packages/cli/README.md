# nexusx

Deploy and monetize APIs on the [NexusX](https://nexusx.dev) agentic marketplace — the x402 pay-per-call network for AI agents.

```bash
npx nexusx deploy --spec ./openapi.json --floor 0.001 --payout 0xYourAddress
```

## What it does

NexusX turns any API into a monetized MCP tool that AI agents (Claude, GPT, etc.) can discover, call, and pay for autonomously in USDC on Base L2. No subscriptions. No API key management. Payments happen on-chain via the x402 protocol.

## Commands

### `nexusx deploy`
Deploy an API to the marketplace from an OpenAPI spec or URL.

```bash
# From a spec file
npx nexusx deploy \
  --spec ./openapi.json \
  --floor 0.001 \
  --ceiling 0.01 \
  --payout 0xYourBaseL2Address

# Auto-detect from a URL (no spec needed)
npx nexusx deploy \
  --url https://api.example.com \
  --floor 0.001 \
  --payout 0xYourBaseL2Address

# Preview without deploying
npx nexusx deploy --spec ./openapi.json --floor 0.001 --payout 0x... --dry-run
```

**Options:**

| Flag | Description |
|---|---|
| `--spec <path>` | Path to OpenAPI spec (JSON or YAML) |
| `--url <url>` | API base URL (auto-detects spec) |
| `--name <name>` | Listing name (auto-detected from spec) |
| `--floor <usdc>` | Minimum price per call in USDC (**required**) |
| `--ceiling <usdc>` | Maximum price per call (enables surge pricing) |
| `--payout <addr>` | Base L2 wallet for USDC settlements (**required**) |
| `--category <slug>` | `language-models` \| `translation` \| `embeddings` \| `sentiment-analysis` \| `object-detection` \| `datasets` |
| `--auth <type>` | `api_key` \| `oauth2` \| `jwt` \| `none` |
| `--network` | `base-mainnet` (default) \| `base-sepolia` |
| `--dry-run` | Preview without deploying |
| `--token <token>` | API token (or `NEXUSX_API_TOKEN` env var) |

### `nexusx status`
Show your listings, call counts, and USDC earned.

```bash
npx nexusx status
```

### `nexusx test`
Simulate an agent calling your listing through the full x402 payment flow.

```bash
npx nexusx test --listing my-weather-api --network base-sepolia
```

### `nexusx mcp`
Start the NexusX MCP server so Claude and other agents can discover and call your tools.

```bash
npx nexusx mcp
```

Add to your Claude MCP config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "nexusx": {
      "command": "npx",
      "args": ["nexusx", "mcp"],
      "env": {
        "NEXUSX_API_KEY": "nxs_...",
        "NEXUSX_SESSION_BUDGET_USDC": "5.00"
      }
    }
  }
}
```

## Payout model

- **85% to provider** — settled in USDC to your Base L2 address
- **15% Nexus platform fee**
- **Pay-on-success** — you only get paid when the API call succeeds
- **No monthly fees, no setup costs**

## Environment variables

```bash
NEXUSX_API_TOKEN=nxp_...          # Your provider token (nexusx.dev/provider/settings)
NEXUSX_PAYOUT_ADDRESS=0x...       # Default Base L2 payout wallet
NEXUSX_NETWORK=base-mainnet       # or base-sepolia for testing
NEXUSX_GATEWAY_URL=https://gateway.nexusx.dev
```

## Built for the agentic economy

NexusX is purpose-built for AI agent workflows:
- Every listed API becomes a typed **MCP tool** agents can call
- **Dynamic auction pricing** — price rises under demand, falls at idle
- **x402 protocol** — HTTP-native micropayments, no subscription billing
- **Semantic discovery** — agents find your tool by intent, not exact name
- **CDP wallet support** — agents pay autonomously with on-chain wallets

## Links

- [NexusX Marketplace](https://nexusx.dev)
- [Provider Dashboard](https://nexusx.dev/provider)
- [x402 Protocol](https://x402.org)
- [Base L2](https://base.org)
