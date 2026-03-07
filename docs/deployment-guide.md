# NexusX Deployment Guide

How to deploy NexusX to a cloud platform (Render, Railway, Fly.io, etc). This covers every service, database, environment variable, and configuration step.

---

## Architecture Overview

NexusX is a monorepo with 6 deployable services and 2 infrastructure dependencies:

| Service | Default Port | Description |
|---------|-------------|-------------|
| **Web** (`apps/web`) | 3000 | Next.js dashboard + provider/buyer APIs |
| **Gateway** (`apps/gateway`) | 3100 | API proxy, billing, x402 payments, rate limiting |
| **Auction Engine** (`apps/auction-engine`) | 3200 | Dynamic pricing, demand tracking |
| **AI Router** (`apps/ai-router`) | 3300 | Intent classification |
| **MCP Server** (`apps/mcp-server`) | 3400 | AI agent tool integration via MCP protocol |
| **Provider** (`apps/provider`) | 3500 | Demo upstream API (6 endpoints) |

| Infrastructure | Default Port | Notes |
|----------------|-------------|-------|
| **PostgreSQL** | 5432 | Must use `pgvector/pgvector:pg16` image (pgvector + pgcrypto + pg_trgm) |
| **Redis** | 6379 | Redis 7+ (caching, rate limits, price history, search version) |

---

## Step 1: Provision Infrastructure

### PostgreSQL

- **Required extensions**: `pgvector`, `pgcrypto`, `pg_trgm`
- On Render: Use their managed PostgreSQL (pgvector is pre-installed on Render Postgres)
- On Railway/other: Ensure the Postgres instance includes pgvector. Use the `pgvector/pgvector:pg16` Docker image if self-hosting.
- **Minimum plan**: 1 GB RAM recommended (pgvector queries benefit from memory)

Connection string format:
```
postgresql://USER:PASSWORD@HOST:5432/nexusx?sslmode=require
```

### Redis

- Redis 7+ (Alpine is fine)
- On Render: Use their managed Redis
- Needed by: Gateway, MCP Server, Auction Engine

Connection string format:
```
redis://USER:PASSWORD@HOST:6379
```

### Run Migrations

After provisioning Postgres, run the Prisma migration from your local machine or CI:

```bash
cd packages/database
DATABASE_URL="postgresql://..." npx prisma migrate deploy
```

This applies the baseline migration at `prisma/migrations/20260224_baseline/migration.sql`.

To seed initial data (categories, demo listings):
```bash
DATABASE_URL="postgresql://..." npx prisma db seed
```

---

## Step 2: Deploy Services

### Build Commands

All TypeScript services need to be built before starting:

| Service | Build | Start |
|---------|-------|-------|
| Web | `cd apps/web && npm run build` | `cd apps/web && npm start` |
| Gateway | `cd apps/gateway && npm run build` | `cd apps/gateway && npm start` |
| Auction Engine | `cd apps/auction-engine && npm run build` | `cd apps/auction-engine && npm start` |
| AI Router | `cd apps/ai-router && npm run build` | `cd apps/ai-router && npm start` |
| MCP Server | `cd apps/mcp-server && npm run build` | `cd apps/mcp-server && npm start` |
| Provider | `cd apps/provider && npm run build` | `cd apps/provider && npm start` |

Install dependencies from the monorepo root first:
```bash
npm install
```

### Monorepo Root Install

Because of workspace dependencies (`@nexusx/database`, `@nexusx/types`), you need to install from the root. A typical Render build command:

```bash
npm install && npm run build --workspace=packages/database --workspace=packages/types && npm run build --workspace=apps/web
```

Adjust the final workspace for whichever service you're deploying.

### Health Checks

| Service | Health Endpoint |
|---------|----------------|
| Gateway | `GET /health` (returns `{ status: "ok" }`) |
| Web | `GET /` (Next.js serves the page) |
| MCP Server | HTTP mode: `GET /health` |

---

## Step 3: Environment Variables

### Shared (All Services)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `NODE_ENV` | Recommended | `production` |

### Web (`apps/web`)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `NEXT_PUBLIC_API_URL` | Yes | Public URL of the Gateway (e.g. `https://gateway.example.com`) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | Clerk frontend key |
| `CLERK_SECRET_KEY` | Yes | Clerk backend key |
| `CLERK_WEBHOOK_SECRET` | If using webhooks | Svix webhook signing secret |
| `OPENAI_API_KEY` | For embeddings | OpenAI key for `text-embedding-3-small` |
| `PORT` | No | Default: 3000 |

**Clerk Setup**:
1. Create a Clerk application at [clerk.com](https://clerk.com)
2. Enable email + OAuth providers as desired
3. Copy the publishable key and secret key
4. Set the Clerk sign-in/sign-up URLs in your Clerk dashboard to match your deployed domain

### Gateway (`apps/gateway`)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `PORT` | No | Default: 3100 |
| `PLATFORM_FEE_RATE` | No | Platform fee as decimal (default: `0.12` = 12%) |
| `UPSTREAM_TIMEOUT_MS` | No | Proxy timeout (default: 30000) |
| `ROUTE_CACHE_TTL_MS` | No | Listing route cache TTL (default: 60000) |
| `SANDBOX_ENABLED` | No | `"true"` to enable sandbox mode (no billing) |
| `AUCTION_ENGINE_URL` | No | Internal URL of auction engine |
| `AI_ROUTER_URL` | No | Internal URL of AI router |

**x402 Payment Protocol** (enable for on-chain USDC payments):

| Variable | Required | Description |
|----------|----------|-------------|
| `X402_ENABLED` | No | `"true"` to enable x402 payment flow |
| `X402_FACILITATOR_URL` | If x402 | Default: `https://x402.org/facilitator` |
| `X402_NETWORK` | If x402 | `eip155:8453` (Base mainnet) or `eip155:84532` (Base Sepolia) |
| `X402_PLATFORM_ADDRESS` | If x402 | Platform wallet address that receives USDC |

**x402 Settlement Worker**:

| Variable | Required | Description |
|----------|----------|-------------|
| `X402_SETTLEMENT_WORKER_ENABLED` | No | Default: `"true"` |
| `X402_SETTLEMENT_WORKER_TICK_MS` | No | Poll interval (default: 15000) |
| `X402_SETTLEMENT_WORKER_BATCH_SIZE` | No | Records per tick (default: 10) |

**Credential Injection** (per-listing upstream API keys):

```
PROVIDER_CRED_<LISTING_SLUG>=HeaderName:HeaderValue
```

Example: `PROVIDER_CRED_TEXT_EMBEDDINGS_V3=Authorization:Bearer sk-xxx`

Slugs are uppercased with hyphens replaced by underscores.

### Auction Engine (`apps/auction-engine`)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `PORT` | No | Default: 3200 |

### AI Router (`apps/ai-router`)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | No | Redis connection string |
| `PORT` | No | Default: 3300 |
| `ANTHROPIC_API_KEY` | For LLM mode | Claude API key for intent classification |
| `CLASSIFIER_MODE` | No | `rule_based` (default) or `llm` |

### MCP Server (`apps/mcp-server`)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `NEXUSX_GATEWAY_URL` | Yes | Internal URL of the Gateway |
| `NEXUSX_API_KEY` | No | API key for gateway auth |
| `NEXUSX_TRANSPORT` | No | `stdio` (default) or `http` |
| `MCP_PORT` | No | Default: 3400 (HTTP mode) |
| `MCP_HOST` | No | Default: `127.0.0.1` |
| `MCP_ALLOWED_ORIGINS` | No | Comma-separated CORS origins |
| `NEXUSX_SANDBOX` | No | `"true"` for sandbox mode |
| `NEXUSX_SESSION_BUDGET_USDC` | No | Per-session spending cap |
| `NEXUSX_REGISTRY_REFRESH_MS` | No | Registry poll interval (default: 60000) |

**CDP Wallet** (for x402 on-chain payments from MCP):

| Variable | Required | Description |
|----------|----------|-------------|
| `CDP_WALLET_PRIVATE_KEY` | Option A | Local EOA private key (`0x...`) |
| `CDP_API_KEY_NAME` | Option B | CDP platform API key name |
| `CDP_API_KEY_PRIVATE_KEY` | Option B | CDP platform API key (ECDSA, PKCS#8 PEM) |
| `CDP_WALLET_SECRET` | Option B | CDP v2 wallet encryption secret |
| `CDP_NETWORK_ID` | No | `base-mainnet` or `base-sepolia` |

Use Option A (local EOA) for simplicity. Use Option B (CDP platform) for managed wallet infrastructure.

### Provider (`apps/provider`)

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Default: 3500 |

The provider service is a demo upstream API. In production, real provider APIs are external services — you only need this for testing/demo purposes.

---

## Step 4: Render-Specific Setup

### Service Configuration

Create these as **Web Services** on Render:

| Service | Root Directory | Build Command | Start Command |
|---------|---------------|---------------|---------------|
| Web | (repo root) | `npm install && npm run build -w packages/database -w packages/types -w apps/web` | `cd apps/web && npm start` |
| Gateway | (repo root) | `npm install && npm run build -w packages/database -w packages/types -w apps/gateway` | `cd apps/gateway && npm start` |
| Auction Engine | (repo root) | `npm install && npm run build -w packages/database -w packages/types -w apps/auction-engine` | `cd apps/auction-engine && npm start` |
| MCP Server | (repo root) | `npm install && npm run build -w packages/database -w packages/types -w apps/mcp-server` | `cd apps/mcp-server && NEXUSX_TRANSPORT=http npm start` |

Create these as **Background Workers** (no port exposure needed) if the service is internal-only. Or as Web Services if they need external access.

### Render Internal Networking

Render services on the same team can communicate using internal URLs:
- Gateway internal: `http://gateway:3100` (Render auto-resolves service names)
- Set `AUCTION_ENGINE_URL`, `AI_ROUTER_URL`, `NEXUSX_GATEWAY_URL` to internal URLs

### Render Databases

1. Create a **PostgreSQL** database (Render includes pgvector)
2. Create a **Redis** instance
3. Copy the internal connection strings into each service's env vars

### Deploy Order

1. Provision PostgreSQL + Redis
2. Run `npx prisma migrate deploy` (from local or a one-off Render job)
3. Deploy Gateway (no dependencies on other services at boot)
4. Deploy Auction Engine
5. Deploy AI Router
6. Deploy Web (needs `NEXT_PUBLIC_API_URL` pointing to the Gateway's public URL)
7. Deploy MCP Server (needs Gateway URL)

### Custom Domain

Point your domain at the **Web** service. The Gateway should also get a public URL (or subdomain like `api.yourdomain.com`) since agents and the frontend call it directly.

---

## Step 5: Indexing Worker & Background Jobs

The Gateway runs three background workers automatically when it starts:

1. **QualityMonitorWorker** — Aggregates reliability metrics from Redis into quality snapshots (requires Prisma + Redis)
2. **IndexingWorker** — Processes listing activation events: generates synthetic queries, creates embeddings, increments search version
3. **X402SettlementWorker** — Retries pending x402 settlements with exponential backoff (only when `X402_ENABLED=true`)

These are all in-process (no separate deployment needed). They start automatically in `apps/gateway/src/server.ts`.

**Indexing Worker config**:

| Variable | Default | Description |
|----------|---------|-------------|
| `INDEXING_WORKER_ENABLED` | `"true"` | Enable/disable |
| `INDEXING_WORKER_TICK_MS` | `"10000"` | Poll interval |
| `INDEXING_WORKER_BATCH_SIZE` | `"5"` | Events per tick |
| `OPENAI_API_KEY` | — | Required for embedding generation |

---

## Step 6: Post-Deploy Checklist

### Database

- [ ] Migrations applied (`npx prisma migrate deploy`)
- [ ] Seed data loaded if needed (`npx prisma db seed`)
- [ ] pgvector extension enabled (migrations handle this automatically)

### Authentication

- [ ] Clerk publishable + secret keys set on Web service
- [ ] Clerk webhook endpoint configured if using Svix webhooks
- [ ] Provider API keys created in the dashboard for programmatic access

### x402 Payments (if enabled)

- [ ] `X402_ENABLED=true` on Gateway
- [ ] `X402_PLATFORM_ADDRESS` set to your USDC-receiving wallet
- [ ] `X402_NETWORK` set (`eip155:8453` for mainnet, `eip155:84532` for testnet)
- [ ] CDP wallet configured on MCP Server (for agent-initiated payments)
- [ ] Platform wallet funded with gas (ETH on Base) for settlement transactions

### Embeddings / Search

- [ ] `OPENAI_API_KEY` set on Gateway (for IndexingWorker) and Web (for search API)
- [ ] After first deploy: listings need to be activated to trigger embedding generation
- [ ] Verify search works: `POST /api/search` with a query

### Connectivity

- [ ] Web can reach Gateway (`NEXT_PUBLIC_API_URL`)
- [ ] Gateway can reach Auction Engine + AI Router (internal URLs)
- [ ] MCP Server can reach Gateway (`NEXUSX_GATEWAY_URL`)
- [ ] All services can reach PostgreSQL and Redis

### CORS

The Gateway has CORS middleware that defaults to allowing all origins in development. For production, you may want to restrict `Access-Control-Allow-Origin` to your web domain. Check `apps/gateway/src/middleware/cors.ts`.

---

## Step 7: Smoke Test

After deploying, verify the pipeline end-to-end:

```bash
# Set these to your deployed URLs
export NEXUSX_PROVIDER_API_URL=https://your-web-service.com
export NEXUSX_PROVIDER_API_KEY=your-provider-api-key
export NEXUSX_WEB_URL=https://your-web-service.com
export NEXUSX_GATEWAY_URL=https://your-gateway.com
export NEXUSX_SMOKE_TARGET_BASE_URL=https://your-provider-endpoint.com

npm run smoke:discovery
```

This creates a listing, activates it, waits for indexing, runs a structured search, and cleans up.

---

## Minimal Viable Deploy

If you want to start small, you only need **3 services**:

1. **PostgreSQL** (with pgvector)
2. **Redis**
3. **Web** (includes all provider/buyer APIs as Next.js API routes)
4. **Gateway** (proxy + billing + workers)

The Auction Engine, AI Router, MCP Server, and Provider are optional and can be added later. The Gateway will log warnings if it can't reach the Auction Engine / AI Router but will continue to function.

---

## Security Notes

- Never commit `.env` files or API keys to the repository
- Use Render's secret environment variable feature for all keys
- The Gateway's `trust proxy` is set to `1` — appropriate for a single load balancer
- SSRF protection is built into the proxy layer (blocks private IPs, cloud metadata endpoints)
- The pre-commit security review hook runs locally only — it does not run in CI by default
- Provider credential injection uses env vars (`PROVIDER_CRED_*`) — ensure these are marked as secrets
