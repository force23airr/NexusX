# Agent Integration Guide

How AI agents discover, authenticate, pay for, and call APIs on NexusX.

---

## Supported Agent Frameworks

Any agent that speaks MCP (Model Context Protocol) or plain HTTP can connect.

| Agent / Framework | Transport | Connection method |
|---|---|---|
| Claude Desktop | stdio | Spawns MCP server as child process |
| Claude Code | stdio | `npx nexusx mcp` |
| Cline / Roo Code (VS Code) | stdio | Same MCP config |
| OpenClaw | stdio | MCP server declared in `openclaw.yaml` |
| OpenAI Agents SDK | HTTP | `POST http://localhost:3400/mcp` |
| LangChain (Python) | HTTP | Same HTTP endpoint |
| Kimi K2 / OpenRouter | HTTP | Same HTTP endpoint |
| Any custom agent | HTTP | JSON-RPC over HTTP with session headers |

Non-MCP agents can also call the gateway directly at `/v1/{listingSlug}/...` using an API key or x402 payment — no MCP required.

### Transport Modes

- **stdio** (default): The agent spawns the MCP server as a child process. Used by Claude Desktop, Claude Code, and VS Code extensions.
- **HTTP**: Standalone MCP server on port 3400. Used for remote deployment, multi-agent setups, and non-MCP frameworks. Set `NEXUSX_TRANSPORT=http` to enable.

---

## Integration Levels

There are three levels of integration, from simplest to most powerful.

### Level 1: Direct Gateway Calls (Any HTTP Client)

The simplest path — agents call APIs directly through the gateway with an API key:

```bash
curl -X POST http://localhost:3100/v1/text-embeddings-v3/embed \
  -H "Authorization: Bearer nxs_abcd1234_..." \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello world"}'
```

API keys are accepted via two headers:
- `Authorization: Bearer <key>`
- `X-NexusX-Key: <key>`

### Level 2: Autonomous x402 Payment (No API Key Needed)

Agents can pay per-request with USDC on Base L2 — no API key or account required:

1. Agent calls gateway without credentials
2. Gateway returns `402 Payment Required` with USDC price and payment requirements
3. Agent signs an EIP-3009 authorization (off-chain, gas-free)
4. Agent retries with `X-Payment` header containing the signed proof
5. Gateway verifies the signature on-chain via the x402 facilitator
6. Request is proxied to the upstream API
7. Settlement only happens if the upstream returns a non-5xx response (pay-on-success)

```
Agent                    Gateway                  Facilitator         Upstream
  |                        |                          |                  |
  |-- POST /v1/api/chat -->|                          |                  |
  |<-- 402 + requirements -|                          |                  |
  |                        |                          |                  |
  |  (sign EIP-3009)       |                          |                  |
  |                        |                          |                  |
  |-- POST + X-Payment --->|-- verify payment ------->|                  |
  |                        |<-- { isValid, payer } ---|                  |
  |                        |                          |                  |
  |                        |-- proxy request -------->|----------------->|
  |                        |<-- response -------------|<-----------------|
  |                        |                          |                  |
  |                        |-- settle (if 2xx) ------>|                  |
  |<-- response -----------|                          |                  |
```

### Level 3: MCP Tools (Full Orchestration)

Agents use the `nexusx` orchestrator tool — describe what you need in plain English:

```json
{
  "name": "nexusx",
  "arguments": {
    "task": "translate 'Hello' to French then analyze sentiment",
    "input": { "text": "Hello" },
    "budget_max_usdc": 0.05,
    "priority_mode": "balanced"
  }
}
```

The orchestrator automatically:

- **Parses** the task into steps (splits on "then", "and then", "after that")
- **Searches** pgvector embeddings to find the best API for each step
- **Chains** outputs between steps (translation result feeds into sentiment analysis)
- **Handles** payment via x402, retries on failure, and falls back to alternative APIs
- **Ranks** results by the selected priority mode

#### Priority Modes

| Mode | Behavior |
|---|---|
| `frugal` | Minimize cost |
| `balanced` (default) | Cost × quality tradeoff |
| `mission_critical` | Maximize quality, ignore cost |

#### Task Chaining

The orchestrator splits multi-step tasks on keywords: `then`, `and then`, `after that`, `followed by`, `next`, `afterwards`.

Each step's output automatically becomes the next step's input:

```
"translate to French then analyze sentiment"

→ Step 1: translation API with input text → Spanish translation
→ Step 2: sentiment API with translated output → { positive: 0.85 }
```

---

## MCP Resources

Agents can browse the marketplace programmatically via MCP resources:

| URI | Description |
|---|---|
| `nexusx://listings` | All active API listings with pricing and quality scores |
| `nexusx://listings/{slug}` | Single listing detail, schema, and sample requests |
| `nexusx://categories` | Hierarchical API category tree |
| `nexusx://prices` | Live USDC price ticks |
| `nexusx://prices/history/{slug}` | Price trajectory and demand signals |
| `nexusx://wallet` | Agent's wallet balance and session budget |
| `nexusx://reliability/{slug}` | Error rate, latency (p50/p95/p99), uptime |
| `nexusx://bundles` | Generated composite tools |

## MCP Prompts

Pre-built prompts for common agent workflows:

| Prompt | Purpose |
|---|---|
| `nexusx_find_api` | Search APIs by natural language description |
| `nexusx_price_check` | Get pricing and fee breakdown for a listing |
| `nexusx_compare_tools` | Side-by-side quality/price comparison |
| `nexusx_budget_status` | Session spend summary |
| `nexusx_price_trajectory` | Price trend analysis and execution recommendation |
| `nexusx_set_budget` | Set session USDC spending limit |

---

## Discovery

### Provider Discovery Endpoint

`GET /.well-known/nexusx.json` returns a machine-readable manifest of all active APIs:

```json
{
  "version": "1.0",
  "provider": { "name": "NexusX Marketplace", "website": "https://nexusx.ai" },
  "capabilities": [
    {
      "name": "GPT-4 Turbo",
      "category": "language-models",
      "intents": ["chat", "completion"],
      "pricing": { "floorUsdc": 0.001, "currency": "USDC" },
      "authType": "api_key",
      "tags": ["llm", "openai"]
    }
  ]
}
```

No auth required. Cached for 5 minutes.

### Dynamic Tool Registration

Every active marketplace listing is automatically registered as an MCP tool at startup (`nexusx_<listing-slug>`). The registry refreshes every 60 seconds and sends `sendToolListChanged` notifications when listings change.

### Semantic Search

Listings are embedded into pgvector using OpenAI `text-embedding-3-small` (512-dim). The orchestrator searches these embeddings with raw task text to find the best API match. Provider-declared intents are embedded alongside descriptions and tags for higher accuracy.

---

## Setup

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nexusx": {
      "command": "npx",
      "args": ["nexusx", "mcp"],
      "env": {
        "NEXUSX_GATEWAY_URL": "http://localhost:3100",
        "DATABASE_URL": "postgresql://user:pass@localhost:5432/nexusx",
        "OPENAI_API_KEY": "sk-...",
        "CDP_WALLET_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

### OpenClaw

OpenClaw natively supports MCP servers, spawning each as a child process and routing tool calls through the protocol. Add to your `openclaw.yaml`:

```yaml
mcp_servers:
  nexusx:
    command: npx
    args: ["nexusx", "mcp"]
    env:
      NEXUSX_GATEWAY_URL: "http://localhost:3100"
      DATABASE_URL: "postgresql://user:pass@localhost:5432/nexusx"
      OPENAI_API_KEY: "sk-..."
      CDP_WALLET_PRIVATE_KEY: "0x..."
```

Once configured, OpenClaw agents can use the `nexusx` orchestrator tool, all individual listing tools, and autonomous x402 payments. This works with any LLM backend that OpenClaw supports (Claude, DeepSeek, GPT models).

### HTTP Agents (OpenAI SDK, LangChain, custom)

Start the MCP server in HTTP mode:

```bash
NEXUSX_TRANSPORT=http \
MCP_PORT=3400 \
DATABASE_URL="postgresql://..." \
OPENAI_API_KEY="sk-..." \
CDP_WALLET_PRIVATE_KEY="0x..." \
npm start
```

Then connect via JSON-RPC:

```bash
# 1. Initialize session
curl -X POST http://localhost:3400/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}'
# Response includes mcp-session-id header

# 2. Call tools (include session header)
curl -X POST http://localhost:3400/mcp \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: <uuid>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"nexusx","arguments":{"task":"embed this text","input":{"text":"Hello"}}}}'

# 3. Close session
curl -X DELETE http://localhost:3400/mcp \
  -H "mcp-session-id: <uuid>"
```

Sessions idle-timeout after 30 minutes.

### Direct Gateway (No MCP)

No MCP server needed — call the gateway directly:

```bash
# With API key
curl -X POST http://localhost:3100/v1/sentiment-analysis/sentiment \
  -H "Authorization: Bearer nxs_..." \
  -H "Content-Type: application/json" \
  -d '{"text": "NexusX is great"}'
```

---

## Wallet Configuration

Agents using x402 autonomous payments need a funded USDC wallet on Base.

### Local EOA Mode (simplest)

```bash
CDP_WALLET_PRIVATE_KEY=0x...   # Private key with USDC balance
CDP_NETWORK_ID=base-mainnet    # or base-sepolia for testnet
```

### CDP Platform Mode (managed keys)

```bash
CDP_API_KEY_NAME=...           # ECDSA key (not Ed25519)
CDP_API_KEY_PRIVATE_KEY=...    # SEC1 PEM or PKCS#8
CDP_WALLET_SECRET=...          # Wallet encryption secret
CDP_NETWORK_ID=base-mainnet
```

### USDC Contract Addresses

| Network | Address |
|---|---|
| Base Mainnet | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Base Sepolia | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

---

## End-to-End Example

A Claude agent making a multi-step request through the orchestrator:

```
Agent: "Translate this article to Spanish, then analyze the sentiment"

Orchestrator:
  Step 1 — "Translate this article to Spanish"
    → Semantic search finds "Anthropic Translation v2" (best quality × price)
    → POST /v1/anthropic-translation/translate { text: "..." }
    → Returns: Spanish translation

  Step 2 — "Analyze the sentiment" (input = Spanish translation from step 1)
    → Semantic search finds "HuggingFace Sentiment" (lowest cost in budget)
    → POST /v1/huggingface-sentiment/sentiment { text: "<translated>" }
    → Returns: { positive: 0.85, negative: 0.10, neutral: 0.05 }

Result: Full response + execution plan + billing summary
```

Both calls are paid autonomously via x402 — no API key, no account, no human approval needed. The agent's wallet is debited only for successful responses.
