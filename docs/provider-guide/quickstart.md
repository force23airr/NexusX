# Provider Quickstart — List Your API on NexusX

## What it means to be a NexusX provider

When you list an API on NexusX, you are making it available to every AI agent connected to the marketplace. Agents discover your API automatically — they don't search by name, they describe what they need ("translate this text," "analyze this image") and the NexusX orchestrator routes them to the best available provider.

You set a price per call. You connect a Base L2 wallet to receive USDC. Every successful API call earns you 85% of the call price, settled in USDC. You never handle payments, API keys, or billing logic — the gateway does it all.

```
Developer's AI agent asks: "translate this to French"
    │
    ▼
NexusX orchestrator selects your listing
    │
    ▼
Agent pays (USDC via x402 or API key balance)
    │
    ▼
Gateway calls YOUR API with the request
    │
    ▼
Your API returns the response
    │
    ▼
Gateway forwards response to agent
    │
    ▼
85% of the call price → your Base L2 wallet
```

Your API never touches payment logic. You just handle the actual work.

---

## What kind of APIs can you list?

Anything an AI agent might need as a tool. Examples:

| Category | Examples |
|---|---|
| Language models | Chat completions, instruction following, code generation |
| Translation | Text translation between any language pair |
| Sentiment & classification | Positive/negative/neutral scoring, topic classification |
| Embeddings | Text-to-vector for semantic search, RAG pipelines |
| Computer vision | Object detection, image classification, OCR |
| Data & search | Web search, dataset access, knowledge retrieval |
| Audio | Speech-to-text, text-to-speech |
| Specialized tools | Legal document analysis, financial data, scientific databases |

If an AI agent could benefit from calling it, it belongs in the marketplace.

---

## Payout model

- **85%** to you, settled in USDC to your Base L2 wallet
- **15%** NexusX platform fee
- **Pay-on-success** — you only earn when your API returns a successful response (2xx). If your API returns a 5xx or times out, the call is not billed and you receive nothing for that request.
- **No monthly fees, no listing fees, no setup costs**

Example: 1,000 calls/day at $0.005 average price = $5.00/day gross → **$4.25/day net**

USDC settlements happen on Base L2. Gas is covered by NexusX.

---

## Pricing your API

Every listing has a **floor price** and an optional **ceiling price**.

- **Floor price**: the minimum you charge per call, even at zero demand
- **Ceiling price**: the maximum price during peak demand

NexusX runs a continuous auction. As demand for your API increases, the price rises toward the ceiling. As demand falls, it drops back to floor. You capture surge value automatically without changing anything.

### Pricing benchmarks by category

| Category | Typical floor | Typical ceiling |
|---|---|---|
| Language models | $0.003 | $0.05 |
| Translation | $0.001 | $0.01 |
| Sentiment analysis | $0.0005 | $0.005 |
| Embeddings | $0.0001 | $0.002 |
| Object detection | $0.002 | $0.02 |
| Datasets | $0.01 | $0.10 |

Start at or below these benchmarks until you have call volume. You can raise prices later.

---

## Three ways to list your API

### Path 1 — CLI deploy (fastest, 2 minutes)

The NexusX CLI reads your OpenAPI spec and creates the listing automatically.

**Prerequisites:**
- Node.js 18+
- A NexusX provider account
- An OpenAPI spec (JSON or YAML) for your API, or just its base URL

**Deploy from a spec file:**

```bash
npx nexusx deploy \
  --spec ./openapi.json \
  --floor 0.001 \
  --ceiling 0.01 \
  --payout 0xYourBaseL2WalletAddress
```

The CLI will:
1. Parse your spec and extract all endpoints, descriptions, and schemas
2. Auto-generate a listing name and MCP tool definition
3. Create the listing on NexusX
4. Return your listing slug and a shareable URL

**Deploy from a URL (no spec file needed):**

```bash
npx nexusx deploy \
  --url https://api.yourdomain.com \
  --floor 0.001 \
  --payout 0xYourBaseL2WalletAddress
```

NexusX will probe the URL and attempt to auto-detect available endpoints.

**All deploy options:**

```bash
npx nexusx deploy --help

Options:
  --spec <path>       Path to OpenAPI spec (JSON or YAML)
  --url <url>         Your API's base URL
  --name <name>       Listing name (auto-detected from spec if omitted)
  --floor <usdc>      Minimum price per call in USDC  [required]
  --ceiling <usdc>    Maximum price per call (optional, enables surge pricing)
  --category <slug>   language-models | translation | embeddings |
                      sentiment-analysis | object-detection | datasets
  --payout <addr>     Base L2 wallet address for USDC settlements  [required]
  --auth <type>       api_key | oauth2 | jwt | none  [default: api_key]
  --network           base-mainnet | base-sepolia  [default: base-mainnet]
  --dry-run           Preview listing without creating it
  --token <token>     NexusX provider token (or set NEXUSX_API_TOKEN)
```

Preview before deploying:

```bash
npx nexusx deploy --spec ./openapi.json --floor 0.001 --payout 0x... --dry-run
```

---

### Path 2 — Web UI (guided, no CLI needed)

Go to `nexusx.dev/provider/listings/new` and follow the Deploy Wizard:

**Step 1 — Auto-detect**
Paste your API's OpenAPI spec URL or upload the file. Click "Auto-Detect." NexusX fills in the listing name, description, endpoints, and inferred auth type.

**Step 2 — Configure pricing**
Set your floor price. Optionally set a ceiling to enable surge pricing. The wizard shows you a payout preview: at your floor price with 1,000 calls/day you'd earn X USDC.

**Step 3 — Connect payout wallet**
Paste your Base L2 wallet address. This is where USDC is sent after each successful call. You can use any Base-compatible wallet: Coinbase Wallet, MetaMask, Rainbow, etc.

**Step 4 — Review and deploy**
Review auto-detected fields. Publish as a draft first if you want to test before going live. Click "Go Live" when ready.

---

### Path 3 — Add x402 middleware (for MCP servers you're building)

If you're building a new MCP server and want to monetize it before deploying to NexusX, you can add the x402 payment middleware directly to your server. Agents that try to call your endpoints without payment will receive an HTTP 402 response with payment requirements. They'll sign a USDC transfer and retry — all automatically.

**Express / Node.js:**

```bash
npm install @nexusx/x402-middleware
```

```typescript
import express from 'express';
import { nexusX402 } from '@nexusx/x402-middleware';

const app = express();

app.use('/v1', nexusX402({
  listingSlug: 'my-api-slug',
  gatewayUrl: 'https://gateway.nexusx.dev',
  network: 'base-mainnet',
}));

// Your routes are unchanged — NexusX handles payments
app.post('/v1/analyze', async (req, res) => {
  const { text } = req.body;
  // ... your logic
  res.json({ result: '...' });
});
```

**FastMCP / Python:**

```bash
pip install nexusx-x402
```

```python
from fastmcp import FastMCP
from nexusx_x402 import NexusX402Middleware

mcp = FastMCP("my-api")
mcp.add_middleware(NexusX402Middleware(
    listing_slug="my-api-slug",
    gateway_url="https://gateway.nexusx.dev",
    network="base-mainnet",
))

@mcp.tool()
def analyze(text: str) -> dict:
    """Analyze the provided text."""
    return {"result": "..."}
```

---

## Handling authentication to your upstream API

When an agent calls your listing through NexusX, the gateway forwards the request to your API. If your API requires an auth header (API key, Bearer token, etc.), you store that credential once in the NexusX provider dashboard — it gets injected per-request by the gateway.

Agents never see your upstream API key. They authenticate with NexusX using their own buyer key. NexusX authenticates with your API using the credential you stored.

**To configure credential injection:**

1. Go to Provider > Listings > your listing > Settings
2. Under "Upstream Credentials," add your API key or Bearer token
3. Save — the gateway will inject it on every proxied request

Or set it as an environment variable for self-hosted gateway setups:

```bash
PROVIDER_CRED_YOUR_LISTING_SLUG=Authorization:Bearer your_upstream_key
```

---

## Testing your listing

Use Base Sepolia testnet to test the full x402 payment flow for free before going live on mainnet.

**Deploy to testnet:**

```bash
npx nexusx deploy \
  --spec ./openapi.json \
  --floor 0.001 \
  --payout 0xYourAddress \
  --network base-sepolia
```

**Simulate an agent call:**

```bash
npx nexusx test --listing your-listing-slug --network base-sepolia
```

This simulates the full flow: agent → gateway → payment → your API → settlement. You'll see each step logged.

Get free testnet USDC from the [Base Sepolia faucet](https://www.coinbase.com/faucets/base-ethereum-goerli-faucet).

**Check your listing status:**

```bash
npx nexusx status
```

Shows all your listings, call counts for the last 24h, and USDC earned.

---

## Going live checklist

Before your listing goes live, confirm:

- [ ] Your API is publicly reachable at the baseUrl you registered (not localhost)
- [ ] Your API returns 2xx for valid requests and appropriate 4xx/5xx for invalid ones
- [ ] Your payout wallet address is correct (Base L2, not Ethereum mainnet)
- [ ] You've set a realistic floor price (see benchmarks above)
- [ ] You've tested with `--network base-sepolia` and seen successful settlement
- [ ] Your upstream credentials are stored if your API requires auth

---

## What agents see after you list

Your listing becomes a typed MCP tool that any NexusX-connected agent can discover and call. The tool name, description, and input schema come from your OpenAPI spec (or are auto-generated). Agents find your tool by describing what they need — the orchestrator matches by intent, not by name.

Example: you list a translation API. An agent says "translate this to German." The orchestrator classifies the intent as "translation," scores your listing against others in that category by price and reliability, and routes the call to you. The agent doesn't need to know your listing name.

---

## Frequently asked questions

**Does my API need to be public?**

Yes. The NexusX gateway proxies requests to your `baseUrl`. That URL must be reachable from the internet. If you're running locally during development, use a tunnel like ngrok while testing, then deploy to a real host before going live.

**What if my API has rate limits?**

Set your `capacityPerMinute` during listing creation. NexusX will stop routing calls to you if you're at capacity and route to the next best provider instead. This protects you from being overwhelmed and protects agents from failed calls.

**Can I have multiple listings?**

Yes. Each listing is an independent entry in the marketplace. List each endpoint family separately if they serve different intents and you want to price them differently.

**What if my API goes down?**

NexusX tracks your API's reliability score. If your API starts returning 5xx errors, your reliability score drops and the orchestrator will route agents to alternative providers. When your API recovers and serves 2xx responses, your score improves and traffic returns. You are never charged for calls that fail.

**Can I pause a listing?**

Yes. From Provider > Listings, you can pause any listing. Paused listings don't receive traffic. Resume when you're ready. Pausing does not affect pending USDC settlements.

**When does USDC land in my wallet?**

Settlement is triggered per-call after a successful response. USDC is transferred on-chain to your payout address after each call (or batched in high-volume scenarios). You can view pending and completed payouts under Provider > Payouts.

**Do I need to know anything about blockchain to get paid?**

No. You provide a Base L2 wallet address and USDC shows up in it. You don't need to interact with any smart contracts or sign transactions. If you don't have a Base wallet yet, create one at [Coinbase Wallet](https://wallet.coinbase.com) in about 2 minutes.
