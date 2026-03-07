# NexusX Next Phase: Agent Commerce Control Plane

## Objective

Make NexusX the default control plane for agent commerce:

1. agents discover the right tool quickly
2. agents execute through one stable interface
3. agents pay and settle safely
4. operators can observe and control the whole marketplace
5. providers are ranked by trust, not just metadata

This phase is not a feature expansion phase. It is an infrastructure hardening phase that turns NexusX from a capable marketplace into dependable agent commerce infrastructure.

---

## Why This Phase Matters

The agentic economy will not consolidate around the product with the most endpoints. It will consolidate around the product that agents can trust to:

- route correctly
- fail safely
- settle accurately
- stay available under provider instability
- give developers predictable operational behavior

NexusX already has the foundation:

- discovery and ranking
- MCP integration
- x402 payment flow
- provider onboarding
- activation indexing
- observability snapshots
- gateway resilience primitives

The next phase must unify those pieces into a real control plane.

---

## Strategic Outcome

At the end of this phase, NexusX should behave like this:

- every execution produces a normalized receipt
- every provider has a trust score informed by outcomes
- every gateway instance shares the same protection state
- operators can see marketplace health in one place
- degraded providers fail fast instead of poisoning agent experience
- ranking uses observed execution quality, not just semantic fit

---

## Phase Scope

### Workstream 1: Shared Control Plane

Move runtime protection and routing state from process-local memory into shared infrastructure.

Deliverables:

- Redis-backed circuit breaker state
- Redis-backed route invalidation and shared route metadata cache
- shared breaker inspection API for admin observability
- explicit version keys for:
  - listing routing changes
  - pricing changes
  - provider suspension/degradation changes

Target files:

- `apps/gateway/src/services/circuitBreaker.ts`
- `apps/gateway/src/services/routeResolver.ts`
- `apps/gateway/src/server.ts`
- `apps/gateway/src/index.ts`
- `packages/database/src/control-plane.ts`

Acceptance criteria:

- a provider tripping the breaker on one gateway instance is blocked on all gateway instances
- route invalidation converges across instances in less than 10 seconds
- breaker state survives process restarts during cooldown windows

---

### Workstream 2: Admin Observability and Control

Give NexusX operators one authoritative platform view.

Deliverables:

- admin dashboard API for:
  - indexing backlog
  - settlement backlog
  - discovery conversion
  - breaker-open listings
  - route version state
  - top failing providers
  - top unresolved demand gaps
- listing-level operational status:
  - healthy
  - degraded
  - breaker_open
  - suspended
- operator control actions:
  - open breaker manually
  - close breaker manually
  - suspend listing
  - force reindex

Target files:

- `apps/web/src/app/api/admin/observability/route.ts`
- `apps/web/src/app/api/admin/...`
- `packages/database/src/observability.ts`
- `apps/gateway/src/services/circuitBreaker.ts`

Acceptance criteria:

- an admin can identify the top failing providers in one request
- an admin can manually isolate a broken listing without DB surgery
- no platform-wide control data is exposed through buyer or provider APIs

---

### Workstream 3: Execution Receipts

Every execution must return a durable machine-readable receipt.

Deliverables:

- execution receipt schema returned by gateway for successful and failed calls
- stored receipt record for:
  - query ID
  - request ID
  - listing ID
  - listing slug
  - buyer ID or x402 payer
  - auth mode
  - billing mode
  - quoted price
  - charged price
  - settlement status
  - upstream status
  - latency
  - bytes transferred
  - retry/circuit-breaker state
- MCP executor surfaces receipts cleanly to agents
- SDKs expose receipt IDs and typed receipt objects

Target files:

- `apps/gateway/src/routes/proxy.ts`
- `apps/gateway/src/types.ts`
- `apps/mcp-server/src/tools/executor.ts`
- `packages/sdk/src/agent/*`
- `packages/database/prisma/schema.prisma`

Acceptance criteria:

- every call has a stable receipt ID
- developers can correlate search -> selection -> execution -> settlement using first-class IDs
- settlement reconciliation can be performed from receipts without parsing logs

---

### Workstream 4: Provider Trust Scoring

Ranking must reflect provider trustworthiness, not just semantic match and price.

Deliverables:

- provider trust score derived from:
  - execution success rate
  - breaker-open frequency
  - p95 latency stability
  - settlement reconciliation health
  - schema/response consistency
  - dispute/refund rate when applicable
- listing trust score and provider trust score separated cleanly
- deterministic ranker uses trust score in the final ordering
- provider analytics show trust score inputs and recent penalties

Target files:

- `packages/database/src/observability.ts`
- `packages/database/src/deterministic-ranker.ts`
- `apps/web/src/app/api/provider/listings/[listingId]/analytics/route.ts`
- `apps/web/src/types/index.ts`

Acceptance criteria:

- a flaky provider cannot outrank a stable provider solely on price
- trust-score penalties decay over time after recovery
- operators can explain why a provider’s score moved

---

### Workstream 5: Failure Policy and Degradation Semantics

Standardize what agents see when the marketplace or a provider is degraded.

Deliverables:

- gateway error taxonomy for:
  - breaker open
  - route unavailable
  - settlement pending
  - upstream timeout
  - provider suspended
  - provider degraded
- retry guidance in headers where applicable
- fail-fast response contract for half-open and open circuits
- policy for when to bill or not bill under each failure type

Target files:

- `apps/gateway/src/routes/proxy.ts`
- `apps/gateway/src/services/billingService.ts`
- `apps/gateway/src/middleware/x402Payment.ts`
- `docs/api-reference/gateway.md`

Acceptance criteria:

- all failure classes are intentional and documented
- agent developers do not need to infer billing semantics from status codes
- breaker-open and settlement-pending responses are distinguishable and typed

---

## Non-Goals

This phase does not include:

- consumer-facing UI redesign
- major provider onboarding redesign
- speculative ranking ML
- multi-chain payment expansion
- agent workflow builder UX

Those are downstream of operational trust and control.

---

## Architecture Direction

### Current

- route cache partly shared, partly instance-local
- breaker state instance-local
- settlement state durable
- search/execution correlation exists
- provider observability exists
- platform observability exists only at API level

### Target

- control-plane state shared through Redis + DB durability where needed
- receipts durable and queryable
- ranking informed by observed execution outcomes
- operator controls surfaced through admin-only APIs
- provider failures contained before they cascade across agents

---

## Proposed Delivery Sequence

### Milestone 1: Shared Runtime State

- move circuit breaker state to Redis
- add breaker-state inspection API
- add route and listing degradation version keys

### Milestone 2: Execution Receipts

- define receipt schema
- return receipt object from gateway and SDK
- persist receipts durably

### Milestone 3: Admin Control Plane

- add admin APIs for platform observability and breaker control
- add listing suspension/degradation actions

### Milestone 4: Trust-Weighted Ranking

- compute provider trust score
- feed trust score into deterministic ranking
- expose trust components in analytics

### Milestone 5: Failure Contract Cleanup

- finalize gateway error taxonomy
- document billing/settlement behavior for each failure class

---

## Operational Metrics

Track these as first-class platform metrics:

- discovery query volume
- search-to-selection conversion
- selection-to-execution conversion
- execution success rate
- x402 settlement pending backlog
- indexing backlog age
- breaker-open listings count
- half-open probe success rate
- provider trust score distribution
- top failure reasons by listing

If NexusX cannot measure these reliably, it is not yet the control plane.

---

## Rollout Checklist

### Before shipping

- gateway type-check green
- web type-check green
- targeted gateway integration tests green
- smoke path still passes: create -> activate -> discover -> execute
- admin APIs protected by role checks and route middleware

### Before publicizing

- staging environment with at least 2 gateway instances
- confirm breaker state convergence across instances
- confirm route invalidation convergence across instances
- confirm receipts match transaction and settlement records

---

## Definition of Done

This phase is complete when:

1. NexusX can isolate bad providers automatically and globally
2. NexusX can explain every execution and settlement with a durable receipt
3. NexusX operators have a private platform control surface
4. NexusX ranks providers partly by trust earned from real outcomes
5. failure behavior is explicit, stable, and documented

At that point, NexusX stops acting like an API marketplace with extra tooling and starts acting like infrastructure for agent commerce.
