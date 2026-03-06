# NexusX — Features & Services

The intelligent routing layer for AI agent commerce. Every feature below is implemented and running in the codebase today.

---

## Platform Services

### 1. Intelligent API Routing

The core differentiator. When an agent needs an API, NexusX doesn't just look it up — it finds the *best* one.

- **Semantic vector search** — Agents describe what they need in plain English. pgvector + OpenAI `text-embedding-3-small` (512-dim) finds matching APIs by meaning, not keywords.
- **Quality-aware ranking** — Real composite scores (60% uptime + 40% latency) from live traffic data. Not self-reported. Not static.
- **Priority modes** — `frugal` (minimize cost), `balanced` (cost × quality tradeoff), `mission_critical` (maximize quality, ignore cost).
- **Automatic fallback** — If the top-ranked API fails, the orchestrator retries with the next best match.
- **Provider-declared intents** — APIs declare capabilities ("translate", "embed", "detect objects") that get embedded into the vector index alongside descriptions and tags.

### 2. Autonomous Payments (x402)

AI agents pay for APIs with USDC on Base L2 — no API keys, no accounts, no human in the loop.

- **x402 protocol** — HTTP-native micropayments. Agent gets a 402 response, signs an EIP-3009 authorization off-chain (gas-free), retries with proof.
- **Pay-on-success** — Settlement only happens if the upstream API returns a non-5xx response. Failed calls cost nothing.
- **Two wallet modes** — Local EOA (private key + viem) or CDP Platform (managed keys via Coinbase Developer Platform).
- **USDC on Base** — Mainnet (chain 8453) and Sepolia testnet (chain 84532). Sub-cent transaction costs.

### 3. API Gateway

Production-grade proxy that sits between agents and upstream APIs.

- **Authentication** — API key (Bearer token) or x402 payment. Both paths fully implemented.
- **Rate limiting** — Per-key, per-listing rate limits with demand signal emission on throttle.
- **Credential injection** — Gateway injects upstream API credentials so agents never see provider secrets. Configured via `PROVIDER_CRED_<SLUG>` env vars.
- **Request billing** — Every proxied call is metered, priced, and recorded as a transaction.
- **CORS + body parsing** — Production middleware stack with configurable body size limits.

### 4. Multi-Step Orchestration

Agents describe complex tasks and the orchestrator breaks them into steps.

- **Natural language chaining** — "Translate to French then analyze sentiment" splits on `then`, `and then`, `after that`, `followed by`, `next`, `afterwards`.
- **Output threading** — Each step's result automatically becomes the next step's input.
- **Per-step routing** — Each step independently routed to the best API for that specific task.
- **Budget enforcement** — Multi-step tasks respect the agent's spending limit across all steps.

### 5. Quality Monitoring

Live quality data powers routing decisions. Not sampled — every call is measured.

- **ReliabilityAggregator** — Records every proxied call to Redis. Computes p50/p95/p99 latency, error rate (excluding 429s), uptime percentage, and composite quality score.
- **Quality Monitor Worker** — Background worker (60s tick) bridges Redis metrics into the database as `QualitySnapshot` and `ProviderMetricRaw` rows.
- **Synthetic health probes** — APIs with no recent traffic get probed every 5 minutes. SSRF-protected. Bazaar-sourced listings skipped.
- **Auto-pause** — Services degraded below quality threshold (score < 30) for 5 consecutive ticks are automatically paused. No human intervention needed.

### 6. Dynamic Pricing

API prices move based on real market signals.

- **Auction engine** — Price floats between provider-set floor and ceiling based on demand, scarcity, quality, momentum, and temporal factors.
- **Price history** — Redis sorted sets + database fallback for 30-day price trajectories.
- **WebSocket price stream** — Real-time price ticks via `ws://gateway/ws/prices`.
- **Demand signals** — Every API call and rate limit event emits demand data that feeds the pricing engine.

### 7. Bundle Settlement

Multi-step agent workflows with deferred, consolidated billing.

- **Session registration** — Agent pre-registers a bundle of tools with a target price.
- **Deferred billing** — Individual steps are tracked but not settled until the bundle finalizes.
- **Proportional allocation** — Bundle discount distributed proportionally across providers based on usage.
- **Lifecycle** — REGISTERED → IN_PROGRESS → FINALIZED with TTL-based expiry.

### 8. Bazaar Integration

NexusX absorbs the Coinbase x402 Bazaar — every external service becomes routable.

- **Automatic indexing** — Pulls services from `api.cdp.coinbase.com/platform/v2/x402/discovery/resources`, filters, generates slugs, infers categories, embeds into pgvector.
- **Semantic routing** — Bazaar services are searchable alongside native listings with the same quality ranking.
- **Direct execution** — Orchestrator calls Bazaar services directly with x402 (no gateway proxy, avoids double payment).
- **Collision prevention** — Bazaar slugs prefixed with `bazaar-` to separate from native listings.

---

## Developer Tools

### Agent SDK (`@nexusx/sdk`)

Drop-in TypeScript client for any AI agent framework.

```typescript
import { NexusXAgent, createViemSigner } from "@nexusx/sdk";

const nx = new NexusXAgent({
  gatewayUrl: "https://gateway.nexusx.ai",
  wallet: createViemSigner("0x...", "base-mainnet"),
  budgetUsdc: 1.00,
});

// Single call
const result = await nx.call("sentiment-pro", "/sentiment", { body: { text: "hello" } });

// Multi-step chain
const chain = await nx.chain([
  { slug: "translation-v2", path: "/translate", body: { text: "hello", target: "es" } },
  { slug: "sentiment-pro", path: "/sentiment" },
]);

// Discovery
const matches = await nx.search("best embedding API");
const pricing = await nx.pricing("text-embeddings-v3");
const quality = await nx.reliability("text-embeddings-v3");
```

- **Two auth modes** — API key (Bearer) or x402 wallet (autonomous payment).
- **Pluggable signing** — `WalletSigner` interface. Ship with viem factory, bring your own signer (CDP SDK, hardware wallet, MPC).
- **Budget tracking** — `nx.spent`, `nx.remaining`, throws on exceeded.
- **Chain auto-threading** — Step N's output becomes step N+1's body automatically.
- **Zero framework dependency** — Works with LangChain, CrewAI, OpenAI Agents SDK, or raw code.

### Provider SDK (`@nexusx/sdk`)

Full lifecycle management for API providers.

- **Listing management** — Create, update, publish, pause, deprecate listings programmatically.
- **Health reporting** — `reportMetrics()` and `startAutoReporter()` for automatic health probe reporting.
- **Webhooks** — Register HTTPS endpoints for events (listing.activated, transaction.completed, price.updated, quality.degraded, etc.).
- **Payouts** — Request USDC payouts to any Base L2 wallet.
- **Analytics** — Per-listing analytics with configurable time periods.

### MCP Server

AI agents that speak MCP (Model Context Protocol) get full orchestration out of the box.

- **`nexusx` orchestrator tool** — Natural language task → API selection → execution → chaining.
- **Per-listing tools** — Every active listing auto-registered as an MCP tool (`nexusx_<slug>`), refreshed every 60s.
- **MCP resources** — `nexusx://listings`, `nexusx://prices`, `nexusx://wallet`, `nexusx://reliability/{slug}`, etc.
- **MCP prompts** — Pre-built prompts for `nexusx_find_api`, `nexusx_price_check`, `nexusx_compare_tools`, `nexusx_budget_status`.
- **Two transports** — stdio (Claude Desktop, VS Code) and HTTP (any framework, port 3400).

### Provider API Service

Real upstream API service with 6 working endpoints for development and testing.

- `POST /embed` — Text embeddings
- `POST /sentiment` — Sentiment analysis
- `POST /translate` — Translation
- `POST /chat/completions` — Chat completion
- `POST /detect` — Object detection
- `GET /reviews` — Dataset access

### Security Review Agent

Automated pre-commit security scanning.

- **Pre-commit hook** — Runs Claude-powered security review before every commit. Blocks on CRITICAL/HIGH findings.
- **12 threat categories** — Including data leaks, MCP trail leakage, credential exposure, injection attacks.
- **Manual trigger** — `/security-review` command for on-demand reviews.

---

## Discovery & Search

| Endpoint | Location | Auth | Description |
|----------|----------|------|-------------|
| `POST /api/search` | Web app | None | Intent-aware semantic search with multi-signal ranking |
| `GET /api/listings` | Web app | None | Paginated listing directory with filters and sorting |
| `GET /api/listings/{slug}` | Web app | None | Full listing detail with price history |
| `GET /api/categories` | Web app | None | Category taxonomy tree |
| `GET /api/intents?q=...` | Web app | None | Intent discovery across all active listings |
| `GET /.well-known/nexusx.json` | Web app | None | Machine-readable marketplace manifest |
| `GET /pricing/{slug}` | Gateway | None | Live pricing with fee breakdown |
| `GET /reliability/{slug}` | Gateway | None | Live quality score (latency, uptime, error rate) |

---

## What's Next

Features not yet built but architecturally planned:

### Near-term
- **Agent ratings & reviews** — Agents rate API quality after calls. Feeds into composite quality score (`averageRating` and `ratingCount` fields exist in QualitySnapshot but default to 0).
- **Auto-resume** — Quality monitor currently auto-pauses degraded services but does not auto-resume. Add recovery detection: if probes show recovery for N ticks, set status back to ACTIVE.
- **Webhook delivery** — Provider SDK defines webhook types and registration, but the platform-side event dispatcher is not yet wired.
- **Provider dashboard analytics** — Web UI for providers to see calls, revenue, quality metrics, and payout history.

### Medium-term
- **Agent reputation** — Track agent behavior (payment reliability, abuse patterns) to enable trust-based rate limits and pricing.
- **Multi-chain support** — Extend x402 beyond Base L2 to Ethereum mainnet, Arbitrum, and Optimism.
- **Streaming responses** — SSE/WebSocket passthrough for LLM chat completions and real-time data feeds.
- **OpenAPI auto-import** — Providers upload an OpenAPI spec, NexusX auto-generates listing, intents, sample requests, and schema.

### Long-term
- **Agent-as-provider** — AI agents list their own capabilities as services on the marketplace, creating an agent-to-agent economy.
- **Federated routing** — Multiple NexusX instances share routing intelligence and liquidity across regions.
- **On-chain reputation** — Quality scores and agent reputation published as attestations on Base for cross-platform trust.
- **Subscription billing** — Recurring USDC subscriptions for high-volume agent workflows alongside per-call pricing.
