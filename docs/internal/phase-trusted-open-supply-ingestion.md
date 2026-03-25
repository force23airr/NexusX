# NexusX Next Phase: Trusted Open Supply Ingestion

## Objective

Turn public API sprawl into trusted agent-native supply without degrading marketplace quality.

At the end of this phase, NexusX should be able to:

1. ingest large volumes of public API supply from curated sources
2. normalize that supply into consistent agent-usable listings
3. verify, quarantine, and rank public APIs by observed trust
4. route agents intelligently across free and paid tools
5. expand marketplace breadth without poisoning reliability

This is a supply-expansion phase with strict trust controls. It is not a naive “import more APIs” phase.

---

## Why This Phase Matters

The agentic economy will reward the platform that gives agents the fastest path from:

- task needed
- capability discovered
- tool executed
- result returned

Public and free APIs are the fastest way to expand breadth. But raw public API directories are not enough.

Without normalization and verification, they create:

- dead listings
- broken auth flows
- noisy discovery
- legal ambiguity
- low-trust execution

NexusX should not become another API list.

It should become the trusted execution layer over the world’s APIs.

---

## Strategic Outcome

At the end of this phase, NexusX should behave like this:

- public APIs can be imported from curated sources into a dedicated ingestion pipeline
- every imported public API is classified into a trust tier
- broken or non-compliant public APIs are quarantined instead of surfacing to agents
- agents can choose free tools first when appropriate, then escalate to paid tools when quality or reliability matters
- operators can see which public sources are healthy, noisy, stale, or unsafe

---

## Phase Scope

### Workstream 1: Public Supply Model

Add first-class modeling for non-provider-ingested public supply.

Deliverables:

- listing provenance model for:
  - `provider_verified`
  - `public_verified`
  - `public_unverified`
  - `public_quarantined`
- source metadata for each imported listing:
  - source repository / catalog
  - source URL
  - import timestamp
  - last verification timestamp
  - attribution metadata
  - legal/usage notes
- support for public supply ownership that is distinct from direct provider-owned listings

Target files:

- `packages/database/prisma/schema.prisma`
- `packages/database/src/*`
- `apps/web/src/types/index.ts`

Acceptance criteria:

- every imported public listing has explicit provenance and trust state
- agents and operators can distinguish public supply from provider-owned supply
- public listings can be suspended or quarantined independently of provider flows

---

### Workstream 2: Ingestion Pipeline

Build a durable ingestion flow from curated public sources into draft or verified listings.

Deliverables:

- source adapters for:
  - curated GitHub repos
  - public manifests
  - structured API catalogs
- ingestion worker that:
  - fetches source metadata
  - normalizes schema
  - infers listing type, auth mode, category, capability tags, modalities
  - generates sample request/response where possible
  - stores provenance and import logs
- deduplication logic across:
  - same base URL
  - same docs URL
  - same endpoint/provider fingerprints

Target files:

- `packages/database/src/*`
- `apps/web/src/app/api/admin/*`
- `apps/gateway/src/workers/*`

Acceptance criteria:

- a curated source can be ingested repeatably without duplicate listing explosions
- ingestion failures are durable, inspectable, and retryable
- imported listings are normalized into the same discovery model used by provider listings

---

### Workstream 3: Verification and Quarantine

Do not trust imported public supply by default.

Deliverables:

- verification pipeline for imported listings:
  - URL safety validation
  - docs/base URL reachability
  - auth scheme plausibility
  - health probe support
  - sample request sanity checks
- quarantine policy for:
  - dead endpoints
  - malformed responses
  - unsafe redirects
  - loopback/private-network abuse attempts
  - clearly incompatible terms or missing attribution
- verification state transitions:
  - `ingested`
  - `verified`
  - `degraded`
  - `quarantined`
  - `retired`

Target files:

- `apps/web/src/lib/ssrf.ts`
- `apps/gateway/src/utils/ssrf.ts`
- `packages/database/src/*`
- `apps/web/src/app/api/admin/*`

Acceptance criteria:

- broken public listings do not reach agent discovery as first-class results
- verification state is visible and queryable
- quarantine decisions are auditable and reversible

---

### Workstream 4: Public Trust Policy

Rank public APIs by trust, not by import volume.

Deliverables:

- public trust tier policy based on:
  - successful verification
  - execution success rate
  - latency stability
  - auth correctness
  - rate-limit behavior
  - legal/compliance flags
  - sustained freshness checks
- public supply penalty model so:
  - `public_unverified` is discoverable only in limited scenarios
  - `public_verified` can compete fairly when it performs well
  - `public_quarantined` is hidden from normal search
- trust-state visibility in provider/admin analytics

Target files:

- `packages/database/src/observability.ts`
- `packages/database/src/deterministic-ranker.ts`
- `packages/database/src/embeddings.ts`
- `apps/web/src/app/api/search/route.ts`

Acceptance criteria:

- a dead or unstable free API does not outrank a stable verified tool
- a verified free API can outrank a paid tool when it is good enough for the task
- public trust movement is explainable from observed signals

---

### Workstream 5: Free-to-Paid Routing Policy

Let agents optimize for cost without sacrificing outcome quality.

Deliverables:

- routing mode policy for:
  - `free_first`
  - `balanced`
  - `trust_first`
  - `mission_critical`
- candidate generation that mixes:
  - public verified free supply
  - provider-owned paid supply
  - x402-payable tools
- fallback semantics:
  - try trusted free tool first
  - escalate to paid verified tool on failure or low trust
  - preserve receipt and billing semantics across fallback

Target files:

- `packages/database/src/deterministic-ranker.ts`
- `apps/mcp-server/src/services/discovery.ts`
- `packages/sdk/src/agent/*`
- `apps/gateway/src/routes/proxy.ts`

Acceptance criteria:

- agents can explicitly prefer free supply where appropriate
- paid escalation is deterministic and observable
- fallback does not hide billing or trust transitions from developers

---

### Workstream 6: Attribution, Legal, and Source Policy

Public supply must be operationally and legally defensible.

Deliverables:

- source allowlist policy for curated ingestion
- attribution requirements for imported listings
- usage-note fields for:
  - free tier limits
  - attribution required
  - personal/non-commercial restrictions
  - unclear terms
- operator controls for source-level disablement

Target files:

- `packages/database/prisma/schema.prisma`
- `apps/web/src/app/api/admin/*`
- `docs/provider-guide/*`

Acceptance criteria:

- every imported source is attributable
- operators can disable an entire source feed without manual row surgery
- legally questionable or unclear listings can be hidden quickly

---

### Workstream 7: Public Supply Observability

Operators need one view into the health of imported supply.

Deliverables:

- admin observability for:
  - total ingested listings
  - verified vs quarantined counts
  - source freshness lag
  - top failing sources
  - top dead endpoints
  - free-to-paid fallback rate
  - public listing execution success rate
- source-level and listing-level verification audit trails

Target files:

- `packages/database/src/observability.ts`
- `apps/web/src/app/api/admin/observability/route.ts`
- `apps/web/src/app/api/admin/*`

Acceptance criteria:

- operators can identify failing public sources in one request
- stale or degraded source feeds are visible before they pollute discovery
- free-to-paid routing effectiveness is measurable

---

## Non-Goals

This phase does not include:

- importing arbitrary uncurated API dumps with no source policy
- replacing direct provider onboarding
- public listing monetization optimization
- consumer-facing UI redesign
- broad marketplace growth campaigns before trust metrics are stable

---

## Architecture Direction

### Current

- provider-owned listings are the primary trusted supply path
- public API supply can be manually reasoned about, but not systematized
- discovery and trust infrastructure exist
- ingestion, provenance, and quarantine for public supply are not first-class

### Target

- public supply is modeled as a first-class, provenance-aware listing tier
- ingestion is durable, repeatable, and observable
- verification and quarantine protect discovery quality
- routing policy can treat free/public supply as a strategic layer, not noise

---

## Milestones

### Milestone 1: Provenance and Source Modeling

Ship:

- public source model
- listing provenance fields
- admin source registry
- source allowlist

Done when:

- every imported public listing can be traced to a source
- source-level disablement exists

Implementation plan:

- see [milestone-1-trusted-open-supply-provenance.md](./milestone-1-trusted-open-supply-provenance.md)

### Milestone 2: Ingestion and Verification

Ship:

- curated source adapter
- ingestion worker
- verification worker
- quarantine state machine

Done when:

- imported public listings can be ingested and verified end-to-end
- broken listings are quarantined automatically

### Milestone 3: Trust and Routing

Ship:

- public trust tiers
- free-to-paid routing modes
- ranking integration
- analytics and admin observability

Done when:

- agents can reliably use verified free supply without flooding discovery with weak results
- fallback from free to paid is measurable and deterministic

---

## Success Metrics

- percent of imported listings that become verified
- percent of verified public listings that remain healthy after 7 days
- free-to-paid fallback rate
- execution success rate for `public_verified` listings
- search-to-execution conversion for public supply
- quarantine rate by source
- average time from import to verified

---

## Rollout Strategy

1. Start with one curated source.
2. Ingest into admin-only visibility first.
3. Verify and quarantine aggressively.
4. Expose only `public_verified` to normal discovery.
5. Add `free_first` routing for selected agent SDK users.
6. Expand sources only after observability is stable.

---

## Definition of Done

This phase is complete when:

- NexusX can ingest public APIs from curated sources without degrading trust
- public supply has provenance, verification, and quarantine states
- agents can use verified free tools through the same control plane as paid/provider tools
- operators can explain why a public listing is visible, hidden, trusted, or quarantined
- free supply increases breadth without damaging execution quality
