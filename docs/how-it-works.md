# How NexusX Works — Providers, Agents, and the Bridge Between Them

## The two sides of the marketplace

NexusX connects two types of participants:

**Providers** — businesses and developers who have capabilities worth selling. A payment company. A translation service. A bike shop with an inventory system. A specialized AI model. A data provider. Anyone with an API that AI agents might need.

**Buyers** — AI agents and the developers who deploy them. An autonomous agent running on your computer. A Claude instance with tools. A LangChain workflow. A custom agent built on any framework. Any software that needs to call external capabilities to complete a task.

NexusX is the bridge. It handles discovery, routing, payment, and settlement so neither side has to think about the other's complexity.

---

## What a provider actually lists

The short answer: **their API**.

What that means in practice depends on who the provider is.

### For a large company (like Coinbase)

Coinbase already has a public REST API — endpoints that accept structured requests and return structured responses. To list on NexusX, Coinbase provides:

- Their API's base URL
- An OpenAPI spec describing their endpoints, inputs, and outputs
- A price per call
- A Base L2 wallet address for USDC settlements

NexusX becomes a new distribution channel in front of their existing API. Coinbase doesn't change their infrastructure. They don't build a billing system for AI agents. They just connect once and start earning USDC every time an agent calls their API through NexusX.

### For a small business (like a bike shop)

A local bike shop probably doesn't have an API. They have a website, a Shopify store, or a Square POS. Their path to NexusX depends on their stack:

- **On Shopify** — Shopify already has an API for products, inventory, and orders. The shop connects their Shopify store to NexusX. The listing becomes: "this shop's catalog and ordering capability, accessible to AI agents."
- **On Square** — Same pattern. Square's API handles inventory and transactions. NexusX wraps it.
- **No existing API** — Someone builds a simple API for them: three endpoints that answer "what's in stock," "what does it cost," and "place this order." That API gets listed. A developer could build this in an afternoon.

The critical distinction: **agents cannot use a website. They use APIs.** A website is designed for a human with eyes and a mouse. An API is designed for a machine with structured inputs and outputs. To be part of the agentic economy, a business needs their capabilities expressed as an API. NexusX is the marketplace where those APIs become discoverable and payable by agents.

---

## How an agent ends up at NexusX

There are two paths.

### Path A — Developer connects NexusX once (the primary path)

A developer or user configures NexusX as an MCP server in their agent's settings one time. This takes about 60 seconds — copy one JSON block, paste it into a config file, restart the agent.

After that, the agent has the `nexusx` tool available in every session. When the agent is given a task that requires an external capability, it reasons its way to NexusX the same way it would reason its way to any other tool. It doesn't search the internet for NexusX. It doesn't need to find NexusX. NexusX is already there, pre-loaded, ready.

The config looks like this:

```json
{
  "mcpServers": {
    "nexusx": {
      "command": "npx",
      "args": ["-y", "nexusx", "mcp"],
      "env": {
        "NEXUSX_API_KEY": "nxs_your_key",
        "NEXUSX_GATEWAY_URL": "https://gateway.nexusx.dev",
        "NEXUSX_SESSION_BUDGET_USDC": "5.00"
      }
    }
  }
}
```

That's the entire setup. One paste. The agent is now connected to every provider in the marketplace.

### Path B — Skill installation (for agents with skills systems)

Agents like OpenClaw have a skills registry where developers publish SKILL.md files — instructions that teach an agent how and when to use a particular tool. A developer installs the NexusX skill, and the agent learns to reach for NexusX whenever a task requires external APIs — without the developer explicitly saying "use NexusX" each time.

---

## The complete flow, end to end

Here is exactly what happens when a user tells their AI agent to buy 10 USDC from Coinbase:

```
User tells OpenClaw:
"Buy 10 USDC from my Coinbase account"
        │
        ▼
OpenClaw has NexusX configured as an MCP tool
It calls: nexusx("buy 10 USDC from Coinbase")
        │
        ▼
NexusX orchestrator classifies intent → "crypto purchase / exchange"
Searches the marketplace for matching providers
Routes to: Coinbase Advanced Trade API listing
        │
        ▼
NexusX gateway calls Coinbase's actual API
Injects the user's stored Coinbase credentials server-side
The agent never sees the upstream API key
        │
        ▼
Coinbase executes the trade
Returns a success confirmation
        │
        ▼
NexusX settles USDC to Coinbase's payout wallet
(pay-on-success — only if the trade actually completed)
        │
        ▼
OpenClaw receives:
"Purchase complete. 10 USDC added to your account."
```

The agent called one tool. NexusX opened the right door. The agent never knew which API it used, how to authenticate with it, or how to pay for it. That complexity is entirely handled by NexusX.

---

## Why this is better than browser automation

An alternative approach — one that agents like OpenClaw are capable of — is browser automation. The agent opens Coinbase.com in Chrome, logs in, navigates to the buy screen, and clicks through the purchase.

This works sometimes. It fails because:

- Coinbase detects automated browser sessions and triggers security challenges
- Two-factor authentication interrupts the flow unpredictably
- Any redesign of the Coinbase website breaks the automation
- Coinbase's Terms of Service prohibit automated access through the web UI
- There is no structured error handling — the agent is interpreting a UI designed for humans

The API path through NexusX is the correct pattern for agentic workflows:
- Structured inputs and outputs the agent can reason about
- Proper error codes the agent can handle programmatically
- Authentication managed server-side, away from the agent
- Within Coinbase's official terms for programmatic access
- Reliable regardless of what Coinbase's website looks like

This is the broader principle: **agents should call the actual infrastructure of the internet, not imitate humans clicking through UIs.** NexusX is what makes that possible for any business, at any scale, without each agent developer needing to build individual integrations.

---

## What both sides never have to build

### Providers never have to build:
- A billing system for AI agent clients
- Per-developer API key management for thousands of agents
- Usage metering and invoicing
- A discovery layer so agents can find them
- Surge pricing infrastructure
- USDC payment handling

### Buyers (agents) never have to:
- Know the name or URL of any specific API
- Manage API keys for dozens of different providers
- Implement payment logic
- Handle rate limiting across multiple services
- Wire up individual integrations one by one

NexusX handles all of it. Both sides connect once. Everything else is automatic.
