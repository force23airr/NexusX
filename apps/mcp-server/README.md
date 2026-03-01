# NexusX MCP Server

NexusX MCP Server connects AI agents to hundreds of APIs — translation, LLMs, embeddings, vision, datasets — through a single tool interface. Every call is billed automatically in USDC on Base L2. You only pay for successful responses (HTTP 2xx). Unsuccessful calls (5xx errors) are never charged.

Works with any MCP client: Claude Desktop, Claude Code, Cline, Kimi K2, OpenAI Agents SDK, LangChain, or a plain HTTP client.

---

## Quickstart — Claude Desktop / Claude Code (stdio)

This is the most common integration path. The MCP server runs as a child process of your MCP client.

### 1. Configure Claude Desktop

Edit `claude_desktop_config.json`:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "nexusx": {
      "command": "npx",
      "args": ["nexusx", "mcp"],
      "env": {
        "DATABASE_URL": "postgresql://user:pass@localhost:5432/nexusx",
        "NEXUSX_GATEWAY_URL": "http://localhost:3100",
        "OPENAI_API_KEY": "sk-...",
        "CDP_WALLET_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

### 2. Restart Claude Desktop

Tools from NexusX listings will appear in the tool picker. The `nexusx` orchestrator tool is always available for natural-language requests.

---

## Quickstart — HTTP Transport (custom clients, remote deployment)

Use HTTP transport when running the MCP server as a standalone process or deploying it remotely.

### Start the server

```bash
NEXUSX_TRANSPORT=http \
DATABASE_URL="postgresql://..." \
NEXUSX_GATEWAY_URL="http://localhost:3100" \
OPENAI_API_KEY="sk-..." \
CDP_WALLET_PRIVATE_KEY="0x..." \
npm start
```

Server listens on port 3400 by default.

### Session lifecycle

MCP over HTTP uses stateful sessions:

```bash
# 1. Create a session (first request — no session header)
curl -X POST http://localhost:3400/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"my-client","version":"1.0"}}}'

# Response includes: mcp-session-id: <session-id>

# 2. Use the session (include header in all subsequent requests)
curl -X POST http://localhost:3400/mcp \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: <session-id>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"nexusx","arguments":{"task":"translate Hello to Spanish"}}}'

# 3. Close the session when done
curl -X DELETE http://localhost:3400/mcp \
  -H "mcp-session-id: <session-id>"
```

### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | Yes | `application/json` |
| `mcp-session-id` | After init | Session token from initialize response |

### Health check

```bash
curl http://localhost:3400/health
```

```json
{
  "status": "ok",
  "transport": "http",
  "sessions": 2,
  "uptime": 3600
}
```

Sessions idle for 30 minutes are automatically closed.

---

## Environment Variables

### Core

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string (must have pgvector extension) |
| `NEXUSX_GATEWAY_URL` | Yes | — | URL of the running gateway (e.g. `http://localhost:3100`) |
| `OPENAI_API_KEY` | No | — | Enables semantic vector search. Falls back to keyword search if absent. |
| `NEXUSX_TRANSPORT` | No | `stdio` | `stdio` for Claude Desktop, `http` for standalone HTTP server |
| `MCP_PORT` | No | `3400` | HTTP server port (HTTP transport only) |

### CDP Wallet — Mode A: Local EOA (simplest)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CDP_WALLET_PRIVATE_KEY` | Yes (Mode A) | — | Hex private key `0x...` for signing EIP-3009 payment authorizations |
| `CDP_NETWORK_ID` | No | `base-sepolia` | `base-mainnet` or `base-sepolia` |

### CDP Wallet — Mode B: CDP Platform

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CDP_API_KEY_NAME` | Yes (Mode B) | — | CDP API key name (must be ECDSA, not Ed25519) |
| `CDP_API_KEY_PRIVATE_KEY` | Yes (Mode B) | — | CDP API key private key (PKCS#8 PEM format) |
| `CDP_WALLET_SECRET` | Yes (Mode B) | — | CDP wallet seed secret |
| `CDP_NETWORK_ID` | No | `base-sepolia` | `base-mainnet` or `base-sepolia` |

### Optional Tuning

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `REDIS_URL` | No | — | Redis for query embedding cache (5-min TTL, reduces OpenAI API calls) |
| `NEXUSX_MAX_BUDGET_USDC` | No | `1.0` | Default per-call budget cap in USDC |
| `LOG_LEVEL` | No | `info` | `debug`, `info`, `warn`, `error` |

---

## The `nexusx` Orchestrator Tool

The single entry point for natural-language API calls. Handles API selection, chaining, payment, and fallback automatically.

### Schema

```json
{
  "name": "nexusx",
  "arguments": {
    "task": "translate 'Hello World' to Japanese",
    "input": "Hello World",
    "budget_max_usdc": 0.05,
    "priority_mode": "balanced"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `task` | string | Yes | Natural-language description of what to do |
| `input` | string | No | Explicit input data (overrides extraction from task) |
| `budget_max_usdc` | number | No | Maximum spend per call in USDC |
| `priority_mode` | string | No | `frugal`, `balanced`, or `mission_critical` (see below) |

### Priority Modes

| Mode | Optimises for | Use when |
|------|--------------|----------|
| `frugal` | Lowest price | Batch jobs, dev/testing, cost-sensitive workflows |
| `balanced` | Price + quality | Default for most tasks |
| `mission_critical` | Highest quality | Production customer-facing calls, SLA-critical tasks |

### Chaining Syntax

Separate steps with **"then"**, **"and then"**, or **"after that"**:

```
translate this to French then analyze sentiment
embed the document then store in dataset after that detect language
```

Output from each step is automatically passed as input to the next step.

---

## x402 Automatic Payment

NexusX uses the x402 protocol for automatic USDC micropayments on Base L2. The payment loop is invisible to you:

1. MCP server calls the gateway
2. Gateway returns `HTTP 402 Payment Required` with a payment request
3. MCP server signs an EIP-3009 authorization with your CDP wallet
4. MCP server retries the call with the `X-Payment` header
5. Gateway verifies payment on-chain and proxies to the upstream API
6. If the upstream returns a 5xx error, payment is not settled (pay-on-success)

### Setup: Local EOA (recommended for getting started)

```bash
# Generate a wallet or use an existing one
export CDP_WALLET_PRIVATE_KEY=0xYOUR_PRIVATE_KEY
```

Fund the wallet with USDC on Base Sepolia (testnet) or Base Mainnet before first use.

### Setup: CDP Platform

```bash
export CDP_API_KEY_NAME="my-key"
export CDP_API_KEY_PRIVATE_KEY="$(cat ~/.cdp/key.pem)"
export CDP_WALLET_SECRET="your-wallet-secret"
```

CDP API keys must be ECDSA type. If you have an Ed25519 or SEC1 PEM key, convert it:

```bash
openssl pkcs8 -topk8 -nocrypt -in sec1.pem -out pkcs8.pem
```

### USDC Contract Addresses

| Network | Chain ID | USDC Address |
|---------|----------|-------------|
| Base Mainnet | 8453 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Base Sepolia | 84532 | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

---

## Available Tools, Resources & Prompts

### Tools

| Tool | Description |
|------|-------------|
| `nexusx` | Orchestrator: natural-language → automatic API selection + payment |
| `nexusx_<slug>` | Direct tool for each active listing (e.g. `nexusx_text-embeddings-v3`) |

Dynamic tools are registered at startup from active listings in the database. Run `prisma db seed` to populate listings.

### Resources

| URI | Description |
|-----|-------------|
| `nexusx://listings` | All active API listings with metadata |
| `nexusx://listings/{slug}` | Single listing detail including schema and sample request/response |
| `nexusx://prices` | Current USDC prices for all listings |
| `nexusx://wallet` | Your connected wallet address and USDC balance |
| `nexusx://categories` | Category tree with listing counts |

### Prompts

| Name | Description |
|------|-------------|
| `nexusx_find_api` | "Find the best API for [task]" — semantic search with ranking |
| `nexusx_price_check` | "What does [API] cost?" — price and budget estimation |
| `nexusx_compare_tools` | "Compare [API A] vs [API B]" — side-by-side quality/price/latency |
| `nexusx_budget_status` | "How much have I spent?" — session spend summary |

---

## Integration Examples

### Claude Desktop (JSON config)

```json
{
  "mcpServers": {
    "nexusx": {
      "command": "npx",
      "args": ["nexusx", "mcp"],
      "env": {
        "DATABASE_URL": "postgresql://user:pass@host:5432/nexusx",
        "NEXUSX_GATEWAY_URL": "https://gateway.nexusx.io",
        "OPENAI_API_KEY": "sk-...",
        "CDP_WALLET_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

### Cline / Roo Code (VS Code MCP Extension)

In VS Code settings (`settings.json`):

```json
{
  "cline.mcpServers": {
    "nexusx": {
      "command": "npx",
      "args": ["nexusx", "mcp"],
      "env": {
        "DATABASE_URL": "postgresql://...",
        "NEXUSX_GATEWAY_URL": "http://localhost:3100",
        "CDP_WALLET_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

### Kimi K2 / OpenRouter (HTTP transport)

```python
import requests

BASE = "http://localhost:3400"

# Initialize session
resp = requests.post(f"{BASE}/mcp", json={
    "jsonrpc": "2.0", "id": 1, "method": "initialize",
    "params": {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "kimi-client", "version": "1.0"}
    }
})
session_id = resp.headers["mcp-session-id"]

# Call the nexusx orchestrator
resp = requests.post(f"{BASE}/mcp",
    headers={"mcp-session-id": session_id},
    json={
        "jsonrpc": "2.0", "id": 2, "method": "tools/call",
        "params": {
            "name": "nexusx",
            "arguments": {"task": "translate 'Hello' to Chinese"}
        }
    }
)
print(resp.json())
```

### OpenAI Agents SDK (Python)

```python
from agents import Agent, Tool
import requests

def call_nexusx(task: str, budget_max_usdc: float = 0.1) -> str:
    """Call any NexusX API via the orchestrator."""
    # Initialize session
    session = requests.Session()
    init = session.post("http://localhost:3400/mcp", json={
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                   "clientInfo": {"name": "openai-agent", "version": "1.0"}}
    })
    session_id = init.headers["mcp-session-id"]

    resp = session.post("http://localhost:3400/mcp",
        headers={"mcp-session-id": session_id},
        json={"jsonrpc": "2.0", "id": 2, "method": "tools/call",
              "params": {"name": "nexusx",
                         "arguments": {"task": task, "budget_max_usdc": budget_max_usdc}}}
    )
    result = resp.json()
    return result["result"]["content"][0]["text"]

nexusx_tool = Tool(name="nexusx", description="Call any AI API", func=call_nexusx)
agent = Agent(tools=[nexusx_tool], model="gpt-4o")
```

### LangChain (Python)

```python
from langchain.tools import Tool
import requests, json

def nexusx_run(task: str) -> str:
    s = requests.Session()
    init = s.post("http://localhost:3400/mcp", json={
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                   "clientInfo": {"name": "langchain", "version": "1.0"}}
    })
    sid = init.headers["mcp-session-id"]
    r = s.post("http://localhost:3400/mcp",
        headers={"mcp-session-id": sid},
        json={"jsonrpc": "2.0", "id": 2, "method": "tools/call",
              "params": {"name": "nexusx", "arguments": {"task": task}}}
    )
    return r.json()["result"]["content"][0]["text"]

nexusx_tool = Tool(name="NexusX", func=nexusx_run,
                   description="AI API marketplace — translation, LLMs, embeddings, vision")
```

### Direct HTTP (curl)

```bash
# Health check
curl http://localhost:3400/health

# Initialize session
SESSION=$(curl -s -D - -X POST http://localhost:3400/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}' \
  | grep mcp-session-id | awk '{print $2}' | tr -d '\r')

# List available tools
curl -X POST http://localhost:3400/mcp \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# Call the nexusx orchestrator
curl -X POST http://localhost:3400/mcp \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SESSION" \
  -d '{
    "jsonrpc": "2.0", "id": 3,
    "method": "tools/call",
    "params": {
      "name": "nexusx",
      "arguments": {
        "task": "translate Hello World to Spanish",
        "budget_max_usdc": 0.05,
        "priority_mode": "balanced"
      }
    }
  }'

# List resources
curl -X POST http://localhost:3400/mcp \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":4,"method":"resources/list","params":{}}'

# Read wallet balance
curl -X POST http://localhost:3400/mcp \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":5,"method":"resources/read","params":{"uri":"nexusx://wallet"}}'

# Close session
curl -X DELETE http://localhost:3400/mcp \
  -H "mcp-session-id: $SESSION"
```

---

## Troubleshooting

### "No tools showing up in Claude"

The tool list is built from active database listings.

```bash
# Check database connection
psql $DATABASE_URL -c "SELECT count(*) FROM listings WHERE status='ACTIVE';"

# Regenerate Prisma client
npx prisma generate

# Seed listings if table is empty
npx prisma db seed
```

### "402 Payment Required — no payment sent"

The MCP server needs a funded CDP wallet to pay for API calls.

```bash
# Mode A: set your private key
export CDP_WALLET_PRIVATE_KEY=0x...

# Verify the wallet has USDC on the right network
# Base Sepolia faucet: https://faucet.circle.com (select Base Sepolia)
```

### "Semantic search not working / falling back to keyword"

Semantic search requires `OPENAI_API_KEY` and at least one embedded listing.

```bash
export OPENAI_API_KEY=sk-...

# Re-embed all listings (run from packages/database)
npx ts-node scripts/embed-listings.ts --force
```

The server falls back to keyword search automatically if embeddings are unavailable. No action needed for basic operation.

### "Session expired" (HTTP transport)

Sessions idle for 30 minutes are closed automatically. Create a new session by repeating the `initialize` call.

### "Connection refused" / Gateway not reachable

```bash
# Check NEXUSX_GATEWAY_URL points to the running gateway
curl $NEXUSX_GATEWAY_URL/health

# Start the gateway if needed (from apps/gateway)
npm start
```

### "CDP API key error: Ed25519 not supported"

ECDSA keys are required. Convert your key:

```bash
openssl pkcs8 -topk8 -nocrypt -in sec1.pem -out pkcs8.pem
export CDP_API_KEY_PRIVATE_KEY="$(cat pkcs8.pem)"
```

### TypeScript build errors

```bash
# In the monorepo root
npm run build

# Or build only the MCP server
cd apps/mcp-server && npx tsc --noEmit
```
