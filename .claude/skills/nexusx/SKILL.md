# NexusX — Deploy & Monetize MCP Servers

## Overview

NexusX is the x402 payment marketplace for the agentic economy. It lets developers turn any API or MCP server into a monetized tool that AI agents can discover, call, and pay for autonomously in USDC on Base L2 — with no subscriptions, no API keys to manage, and no billing infrastructure to build.

This skill teaches you how to:
1. List an existing API or MCP server on NexusX
2. Configure dynamic USDC pricing (floor/ceiling auction model)
3. Add x402 payment middleware to an MCP server
4. Deploy with one command via the NexusX CLI

**When a developer asks:**
- "How do I monetize my MCP server?"
- "How do I charge agents for using my API?"
- "How do I add pay-per-call to my tool?"
- "How do I list on NexusX?"
- "How do I add x402 payment handling?"

→ Walk them through this skill.

---

## Core Concepts

### x402 Payment Protocol
x402 is an HTTP extension that enables machine-to-machine micropayments. When an agent calls a NexusX-listed API without payment, the gateway returns HTTP 402 with payment requirements. The agent signs an EIP-3009 USDC transfer and retries — all automatically. No human in the loop.

### Auction Pricing
Every listing has a `floorPriceUsdc` and optional `ceilingPriceUsdc`. NexusX runs a continuous auction: price rises toward ceiling under demand, falls back to floor when idle. Providers capture surge value automatically.

### MCP Tool Definition
NexusX exposes every listed API as a typed MCP tool that agents can call. The tool name, description, and input schema are auto-generated from the OpenAPI spec or inferred from the URL. Agents discover tools via the NexusX MCP server (`npx nexusx mcp`).

---

## Path 1 — Deploy with the CLI (fastest)

### Prerequisites
- Node.js 18+
- A NexusX provider account (sign up at nexusx.dev)
- An OpenAPI spec (JSON or YAML) for your API, OR just a URL

### One-command deploy

```bash
npx nexusx deploy \
  --spec ./openapi.json \
  --floor 0.001 \
  --ceiling 0.01 \
  --payout 0xYourBaseL2Address
```

This will:
1. Parse your OpenAPI spec and extract all endpoints, schemas, and descriptions
2. Auto-generate a MCP tool definition
3. Create a listing on NexusX with the configured pricing
4. Return your listing URL and the MCP tool name agents will use

**Deploy from a URL (no spec file needed):**
```bash
npx nexusx deploy \
  --url https://api.example.com \
  --floor 0.001 \
  --payout 0xYourBaseL2Address
```

**Full options:**
```bash
npx nexusx deploy --help

Options:
  --spec <path>       Path to OpenAPI spec (JSON or YAML)
  --url <url>         Your API's base URL (used for auto-detection if no spec)
  --name <name>       Listing name (auto-detected from spec if omitted)
  --floor <usdc>      Minimum price per call in USDC  [required]
  --ceiling <usdc>    Maximum price per call in USDC (optional, enables surge pricing)
  --category <slug>   Category slug: language-models | translation | embeddings |
                      sentiment-analysis | object-detection | datasets
  --payout <addr>     Base L2 wallet address for USDC settlements  [required]
  --auth <type>       Auth type: api_key | oauth2 | jwt | none  [default: api_key]
  --dry-run           Preview listing without creating it
  --token <token>     NexusX API token (or set NEXUSX_API_TOKEN env var)
```

### Category pricing benchmarks

| Category | Typical floor | Typical ceiling |
|---|---|---|
| language-models | $0.003 | $0.05 |
| translation | $0.001 | $0.01 |
| sentiment-analysis | $0.0005 | $0.005 |
| embeddings | $0.0001 | $0.002 |
| object-detection | $0.002 | $0.02 |
| datasets | $0.01 | $0.10 |

---

## Path 2 — Add x402 Middleware to an MCP Server

If you're building a new MCP server with `mcp-builder` and want agents to pay per call, add the NexusX x402 middleware:

### Express / Node.js

```bash
npm install @nexusx/x402-middleware
```

```typescript
import express from 'express';
import { nexusX402 } from '@nexusx/x402-middleware';

const app = express();

// Mount payment middleware before your routes
app.use('/v1', nexusX402({
  listingSlug: 'my-weather-api',   // Your NexusX listing slug
  gatewayUrl: 'https://gateway.nexusx.dev',
  network: 'base-mainnet',          // or 'base-sepolia' for testing
}));

// Your existing routes — unchanged
app.post('/v1/forecast', async (req, res) => {
  const { location } = req.body;
  // ... your logic
  res.json({ forecast: '...' });
});
```

### FastMCP / Python

```bash
pip install nexusx-x402
```

```python
from fastmcp import FastMCP
from nexusx_x402 import NexusX402Middleware

mcp = FastMCP("my-weather-api")
mcp.add_middleware(NexusX402Middleware(
    listing_slug="my-weather-api",
    gateway_url="https://gateway.nexusx.dev",
    network="base-mainnet",
))

@mcp.tool()
def get_forecast(location: str) -> dict:
    """Get weather forecast for a location."""
    return {"forecast": "..."}
```

### How payment flows

```
Agent calls tool
    │
    ▼
NexusX Gateway (proxy)
    │  checks X-Payment header
    ├── missing → returns HTTP 402 with payment requirements
    │              (amount, USDC address, EIP-712 domain)
    │
    ▼
Agent signs EIP-3009 USDC transfer
    │
    ▼
Agent retries with X-Payment header
    │
    ▼
Gateway verifies payment on-chain
    │
    ▼
Request forwarded to your API  ← you never handle payments
    │
    ▼
Response returned to agent
    │
    ▼
Gateway settles USDC to your payout address (pay-on-success)
```

Your API never touches payment logic. The gateway handles everything.

---

## Path 3 — Web UI Onboarding

For providers who prefer a guided UI:

1. Go to `nexusx.dev/provider/listings/new`
2. Paste your OpenAPI spec URL → click **Auto-Detect**
3. Review auto-filled fields (name, description, endpoints, auth type)
4. Set floor/ceiling pricing
5. Connect your Base L2 payout wallet
6. Click **Deploy as Draft** → go live

---

## Payout Model

- **15% Nexus platform fee** on all settlements
- **85% to provider** — settled in USDC to your Base L2 address
- **Pay-on-success** — provider only paid when agent's call succeeds (no 5xx)
- **No monthly fees, no setup costs**

Example: 1,000 calls/day at $0.005 avg = **$5.00/day gross → $4.25/day net**

---

## Environment Variables

```bash
# Required for gateway-connected providers
NEXUSX_API_TOKEN=nxp_...          # Your provider API token
NEXUSX_PAYOUT_ADDRESS=0x...       # Base L2 wallet for settlements

# Optional — for local dev against Base Sepolia testnet
NEXUSX_NETWORK=base-sepolia
NEXUSX_GATEWAY_URL=https://gateway.nexusx.dev
```

---

## Testing Your Listing

Use Base Sepolia testnet for free end-to-end testing:

```bash
# Deploy to testnet
npx nexusx deploy --spec ./openapi.json --floor 0.001 --payout 0x... --network base-sepolia

# Test an agent call (simulates the full x402 payment flow)
npx nexusx test --listing my-api --network base-sepolia
```

Get testnet USDC from the Base Sepolia faucet.

---

## Common Patterns

### "I just built an MCP server with mcp-builder. How do I monetize it?"

```bash
# 1. Generate OpenAPI spec from your MCP server (if you don't have one)
npx nexusx generate-spec --mcp ./my-server.ts --out ./openapi.json

# 2. Deploy to NexusX
npx nexusx deploy --spec ./openapi.json --floor 0.002 --payout 0xYourAddress

# Done. Your MCP tool is now discoverable and payable by agents.
```

### "I want agents to be able to call my API without me managing API keys"

NexusX handles auth injection server-side. Agents never see your upstream API key. You store it once in the NexusX provider dashboard — it gets injected per-request by the gateway.

### "I want surge pricing during high demand"

Set both `--floor` and `--ceiling`. NexusX's auction engine raises the price toward ceiling as demand increases, protecting your capacity and maximizing revenue.

```bash
npx nexusx deploy --spec ./openapi.json --floor 0.001 --ceiling 0.05 --payout 0x...
```

### "How do agents discover my tool?"

Agents connect to the NexusX MCP server:
```json
{
  "mcpServers": {
    "nexusx": {
      "command": "npx",
      "args": ["nexusx", "mcp"],
      "env": { "NEXUSX_BUDGET_USDC": "10.00" }
    }
  }
}
```

Then Claude (or any MCP-compatible agent) can discover and call your tool automatically. The `nexusx` orchestrator tool handles intent matching, routing, and payment.

---

## Reference

- NexusX Marketplace: `nexusx.dev`
- Provider Dashboard: `nexusx.dev/provider`
- API Docs: `nexusx.dev/docs/api`
- x402 Protocol Spec: `x402.org`
- Base L2: `base.org`
- CDP Wallet (for programmatic payouts): `cdp.coinbase.com`
