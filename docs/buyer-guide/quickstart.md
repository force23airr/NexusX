# Buyer Quickstart — Connect Your AI Agent to NexusX

## What NexusX does for your agent

NexusX is not an AI model. It is not an agent framework. It is the **tool layer** — a marketplace of APIs that your existing AI agent can discover, call, and pay for automatically.

Think of it this way:

```
Your AI agent (Claude, GPT-4, Gemini, custom)
    +
NexusX (discovers the right API, handles payment, returns result)
    =
An agent that can translate text, run sentiment analysis, generate embeddings,
detect objects, and call 50+ other APIs — without you wiring up each one.
```

You keep your AI model and your agent framework. NexusX plugs in as one extra tool.

---

## Two ways agents connect to NexusX

### Path A — MCP (recommended for Claude users)

MCP is Anthropic's tool protocol. Claude Code, Claude Desktop, Cline, and any MCP-compatible agent can connect to NexusX as an MCP server. When connected, your agent sees a `nexusx` tool it can call with plain English — "translate this to French," "analyze the sentiment of this review," etc. The orchestrator figures out which API to call and handles payment automatically.

**Best for:** Claude Code, Claude Desktop, Cline, Roo, and developers building MCP-native agents.

### Path B — HTTP (for any other agent)

Any agent that can make an HTTP request can call the NexusX gateway directly. You give your agent the gateway URL and your API key as a tool definition. Works with OpenAI Agents SDK, LangChain, CrewAI, AutoGen, or any custom agent you built yourself.

**Best for:** OpenAI-based agents, Python agent frameworks, custom HTTP agents.

---

## Before you start

You need three things:
1. **A NexusX account** — sign up at nexusx.dev
2. **An API key** — generated from the Buyer > API Keys page, or from the `/connect` page
3. **USDC in your wallet** — your agent's spending budget. Fund at Buyer > Wallet. Start with $5–10 USDC on Base to cover test calls.

Your API key looks like: `nxs_xxxxxxxxxxxxxxxx...`

---

## Path A: MCP Setup

### Option 1 — Claude Code (fastest)

Claude Code is Anthropic's CLI agent. If you use Claude Code for development, this is the fastest path.

**Step 1.** Open or create `~/.claude/settings.json`

**Step 2.** Add the NexusX MCP server block:

```json
{
  "mcpServers": {
    "nexusx": {
      "command": "npx",
      "args": ["-y", "nexusx", "mcp"],
      "env": {
        "NEXUSX_API_KEY": "nxs_your_key_here",
        "NEXUSX_GATEWAY_URL": "https://gateway.nexusx.dev",
        "NEXUSX_SESSION_BUDGET_USDC": "5.00"
      }
    }
  }
}
```

**Step 3.** Restart Claude Code. Type `/mcp` to confirm `nexusx` appears in the tool list.

**Step 4.** Try it:
```
Translate "Hello, how are you?" to Japanese using NexusX
```

Claude will call the `nexusx` tool, which routes to the translation API, pays for the call, and returns the result.

---

### Option 2 — Claude Desktop

Claude Desktop is Anthropic's desktop application. It uses the same MCP protocol as Claude Code.

**Step 1.** Find your config file:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

**Step 2.** Add the NexusX server:

```json
{
  "mcpServers": {
    "nexusx": {
      "command": "npx",
      "args": ["-y", "nexusx", "mcp"],
      "env": {
        "NEXUSX_API_KEY": "nxs_your_key_here",
        "NEXUSX_GATEWAY_URL": "https://gateway.nexusx.dev",
        "NEXUSX_SESSION_BUDGET_USDC": "5.00"
      }
    }
  }
}
```

**Step 3.** Quit and relaunch Claude Desktop. The NexusX tools appear automatically.

---

### Option 3 — Cline / Roo (VS Code)

Cline and Roo Code are VS Code extensions with MCP support.

**Step 1.** Open VS Code Settings (⌘, or Ctrl+,)

**Step 2.** Search for "MCP" in the Cline or Roo extension settings

**Step 3.** Add the server config:

```json
{
  "mcpServers": {
    "nexusx": {
      "command": "npx",
      "args": ["-y", "nexusx", "mcp"],
      "env": {
        "NEXUSX_API_KEY": "nxs_your_key_here",
        "NEXUSX_GATEWAY_URL": "https://gateway.nexusx.dev",
        "NEXUSX_SESSION_BUDGET_USDC": "5.00",
        "NEXUSX_TRANSPORT": "stdio"
      }
    }
  }
}
```

**Step 4.** Reload the extension.

---

### Option 4 — Building your own MCP server

If you are building an MCP server from scratch (using tools like `mcp-builder`, `FastMCP`, or Anthropic's MCP SDK), you can embed NexusX as a tool inside your server, or connect your finished server to NexusX as a client.

**Embed NexusX inside your MCP server (Node.js):**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { spawn } from "child_process";

// Your server
const server = new McpServer({ name: "my-agent", version: "1.0.0" });

// Add your own tools here
server.tool("my_tool", "...", async (params) => { ... });

// Connect to NexusX as a downstream service via HTTP
// Your agent calls your tools + the nexusx orchestrator
```

Or, more commonly — build your MCP server, deploy it, then connect it to NexusX by following Path A above. Your agent gets both your custom tools and the full NexusX marketplace in one session.

---

### Understanding the `NEXUSX_SESSION_BUDGET_USDC` setting

This caps how much USDC your agent can spend in a single session. When the budget runs out, the MCP server stops accepting tool calls until you start a new session. Set it based on how much you trust the agent to run autonomously:

| Use case | Suggested budget |
|---|---|
| Quick one-off tasks | $0.50 |
| Development / testing | $2.00 |
| Automated daily job | $10.00 |
| Long-running autonomous agent | $25.00+ |

If you set `NEXUSX_SESSION_BUDGET_USDC` to `0`, there is no per-session cap (only your wallet balance limits spending).

---

## Path B: HTTP Setup

### OpenAI Agents SDK

```python
# pip install openai requests

import requests

NEXUSX_GATEWAY = "https://gateway.nexusx.dev"
NEXUSX_KEY = "nxs_your_key_here"

# Define NexusX as a tool for your OpenAI agent
nexusx_tool = {
    "type": "function",
    "function": {
        "name": "nexusx",
        "description": (
            "Call any API on NexusX marketplace. Supports translation, "
            "sentiment analysis, text embeddings, image generation, and more. "
            "Describe what you need in plain English."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "task": {
                    "type": "string",
                    "description": "What you need done, e.g. 'translate to French'"
                },
                "input": {
                    "type": "object",
                    "description": "The data to process"
                }
            },
            "required": ["task"]
        }
    }
}

def call_nexusx(task: str, input: dict = None) -> str:
    resp = requests.post(
        f"{NEXUSX_GATEWAY}/v1/nexusx/orchestrate",
        headers={
            "Authorization": f"Bearer {NEXUSX_KEY}",
            "Content-Type": "application/json",
        },
        json={"task": task, "input": input or {}},
    )
    return resp.text
```

### LangChain / CrewAI

```python
# pip install langchain requests

from langchain.tools import Tool
import requests

NEXUSX_GATEWAY = "https://gateway.nexusx.dev"
NEXUSX_KEY = "nxs_your_key_here"

def nexusx_call(query: str) -> str:
    """Route a natural language task to the NexusX orchestrator."""
    resp = requests.post(
        f"{NEXUSX_GATEWAY}/v1/nexusx/orchestrate",
        headers={
            "Authorization": f"Bearer {NEXUSX_KEY}",
            "Content-Type": "application/json",
        },
        json={"task": query},
    )
    return resp.text

nexusx_tool = Tool(
    name="NexusX",
    func=nexusx_call,
    description=(
        "Access 50+ APIs via NexusX marketplace. Translation, sentiment, "
        "embeddings, image generation, datasets, and more. Describe the task."
    ),
)

# Add nexusx_tool to your agent's tools list
```

### Direct HTTP (any language)

Call specific APIs by their listing slug, or use the orchestrator for intent-based routing:

```bash
# Orchestrator — describe what you want, it routes automatically
curl -X POST https://gateway.nexusx.dev/v1/nexusx/orchestrate \
  -H "Authorization: Bearer nxs_your_key" \
  -H "Content-Type: application/json" \
  -d '{"task": "translate Hello World to Spanish"}'

# Direct call — route to a specific listing
curl -X POST https://gateway.nexusx.dev/v1/deepl-translation-api/translate \
  -H "Authorization: Bearer nxs_your_key" \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello World", "target_lang": "ES"}'
```

---

## What happens when your agent makes a call

```
Agent describes task in natural language
    │
    ▼
NexusX orchestrator classifies intent
(translate → translation APIs, sentiment → sentiment APIs, etc.)
    │
    ▼
Selects best listing by price, reliability score, latency
    │
    ▼
Routes request through gateway
    │
    ├── Checks your API key → deducts from wallet balance
    │   OR
    └── x402 payment flow → agent signs USDC transfer on Base L2
    │
    ▼
Gateway forwards to upstream API provider
    │
    ▼
Response returned to your agent
    │
    ▼
USDC settled to provider only if call succeeded (5xx = no charge)
```

Your agent never sees payment logic. It calls a tool, gets a result.

---

## Verifying your setup

After connecting, ask your agent:

- *"What APIs are available on NexusX?"* — should list categories
- *"Translate 'Good morning' to Japanese"* — should return 日本語
- *"Analyze the sentiment of: I love this product"* — should return positive score
- *"What's my current NexusX wallet balance?"* — should return your USDC balance

If any of these fail, check:
1. Your API key is correct and status is ACTIVE (Buyer > API Keys)
2. Your wallet has USDC (Buyer > Wallet)
3. The MCP server started without errors (`npx nexusx mcp` in terminal to see logs)

---

## Frequently asked questions

**Do I need to build my own agent?**

No. If you use Claude Code or Claude Desktop, you already have an agent. You just add the NexusX config and it gains access to the marketplace. If you are building a custom agent, you add NexusX as one tool in your tool list.

**Do I need a crypto wallet?**

Not for the API-key payment path. Your USDC balance lives in your NexusX account. You fund it from the Buyer > Wallet page. For x402 wallet-based payments (fully on-chain, no NexusX account needed), you need a Base L2 wallet with USDC — use Coinbase Wallet or any EIP-3009-compatible wallet.

**What if a call fails?**

You are not charged for failed calls. The gateway uses pay-on-success: USDC is only settled to the provider when the upstream API returns a 2xx response. If the API times out, returns a 5xx, or the gateway can't reach it, the cost is zero.

**Can my agent call multiple APIs in one message?**

Yes. The orchestrator supports chaining. If your agent says "translate this text then analyze its sentiment," the orchestrator splits on the "then," runs translation first, passes the output into the sentiment call, and returns both results. Each step is billed separately.

**What is USDC and where do I get it?**

USDC is a stablecoin worth $1.00. It lives on Base, an Ethereum L2 network. Buy USDC on any exchange (Coinbase, Kraken, etc.) and send it to Base. Or use Coinbase Pay directly from the Buyer > Wallet page. $5 covers hundreds of typical API calls.
