# Milestone 1 Plan: Trusted Open Supply Provenance

## Objective

Establish the control-plane foundation for public API supply before any broad ingestion happens.

Milestone 1 is about one thing:

`NexusX must know exactly where a public listing came from, what state it is in, and how to disable it safely.`

This milestone does **not** try to import the whole internet. It creates the source registry, provenance model, and operator controls that make later ingestion safe.

---

## Why Milestone 1 Comes First

If NexusX ingests open/public APIs without provenance and source controls, the marketplace becomes:

- noisy
- legally ambiguous
- operationally hard to unwind
- difficult to trust

The agentic economy will punish that.

Before scale, NexusX needs:

1. source-level traceability
2. listing-level provenance
3. operator-level control
4. explicit trust states

That is what makes later ingestion compatible with a trusted agent marketplace.

---

## Milestone Scope

Milestone 1 covers:

- public source registry
- listing provenance model
- public supply trust states
- admin APIs for source management
- discovery gating for public supply visibility
- source-level auditability

Milestone 1 does **not** cover:

- full ingestion adapters
- verification probes
- trust scoring from executions
- free-to-paid routing
- public source bulk import

Those belong to Milestones 2 and 3.

---

## Strategic Outcome

At the end of Milestone 1, NexusX should support this flow:

1. an operator registers a curated public source
2. the source is classified and enabled or disabled explicitly
3. any listing tied to that source carries provenance metadata
4. public listings can be shown, hidden, quarantined, or retired independently of provider-owned listings
5. discovery can safely exclude non-verified public supply by policy

This gives NexusX the legal and operational footing to later import aggressively without losing control.

---

## Data Model Changes

### New Model: `PublicSource`

Purpose:

- represent a curated external supply source
- allow enable/disable, allowlist, attribution, and source-wide control

Proposed fields:

- `id`
- `name`
- `slug`
- `sourceType`
  - `github_repo`
  - `manifest_catalog`
  - `api_directory`
  - `manual_curated`
- `baseUrl`
- `catalogUrl`
- `ownerName`
- `ownerUrl`
- `license`
- `attributionRequired`
- `termsUrl`
- `notes`
- `status`
  - `ACTIVE`
  - `PAUSED`
  - `DISABLED`
  - `BLOCKED`
- `allowDiscovery`
- `allowExecution`
- `lastSyncedAt`
- `lastError`
- `createdAt`
- `updatedAt`

Indexes:

- `slug` unique
- `status`
- `sourceType`

### New Model: `ListingProvenance`

Purpose:

- attach a listing to either a provider-owned or public source origin
- preserve source identity even if listing metadata changes later

Proposed fields:

- `id`
- `listingId`
- `kind`
  - `provider_direct`
  - `provider_imported_manifest`
  - `public_source`
  - `bazaar_import`
- `publicSourceId` nullable
- `externalId`
- `externalUrl`
- `externalVersion`
- `importedAt`
- `lastSeenAt`
- `attribution`
- `usageNotes`
- `createdAt`
- `updatedAt`

Indexes:

- `listingId` unique
- `publicSourceId`
- `kind`

### Listing Additions

Add public supply state directly on `Listing` so discovery and admin control stay simple.

Proposed fields:

- `supplyTier`
  - `provider_verified`
  - `public_verified`
  - `public_unverified`
  - `public_quarantined`
- `verificationState`
  - `none`
  - `ingested`
  - `verified`
  - `degraded`
  - `quarantined`
  - `retired`
- `verificationReason` nullable
- `sourceControlled` boolean
- `sourceDisabledAt` nullable

Indexes:

- `(status, supplyTier)`
- `(verificationState, status)`

### Audit Log Usage

No new audit model is required in Milestone 1.

Use existing `AuditLog` for:

- source creation
- source pause/disable
- listing quarantine/unquarantine
- source discovery allow/deny changes

---

## API Surface

### Admin Source Registry API

Create admin-only routes:

- `POST /api/admin/public-sources`
- `GET /api/admin/public-sources`
- `GET /api/admin/public-sources/:id`
- `PATCH /api/admin/public-sources/:id`
- `POST /api/admin/public-sources/:id/disable`
- `POST /api/admin/public-sources/:id/enable`

Payload capabilities:

- create/update source metadata
- toggle discovery
- toggle execution
- pause or disable a source
- store legal/attribution notes

### Admin Listing Control Additions

Extend admin listing controls so public listings can be:

- quarantined
- restored
- retired

without touching provider flows.

### Provider/Buyer API Policy

Milestone 1 should not expose source-wide platform controls to providers or buyers.

Provider and buyer APIs may later receive read-only visibility into public provenance, but not during this milestone.

---

## Discovery Policy for Milestone 1

Milestone 1 must change discovery gating, even before ingestion exists.

Policy:

- `provider_verified`: discoverable
- `public_verified`: discoverable
- `public_unverified`: hidden by default
- `public_quarantined`: excluded

This should be enforced in the shared search path, not only in UI code.

Target paths:

- `packages/database/src/embeddings.ts`
- `packages/database/src/metadata-filters.ts`
- `apps/web/src/app/api/search/route.ts`
- `apps/mcp-server/src/services/discovery.ts`

This matters because once ingestion starts, discovery behavior must already be safe by default.

---

## Admin and Operator UX

Milestone 1 should create operator control surfaces before operator load exists.

Minimum UI/API capabilities:

1. source list
2. source detail
3. source status toggle
4. source discovery allow/deny toggle
5. source execution allow/deny toggle
6. public listing quarantine action
7. public listing provenance view

The UI can be minimal. The control model cannot be minimal.

---

## Repo Impact

### Primary Files

- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/*`
- `packages/database/src/index.ts`
- `packages/database/src/*`
- `apps/web/src/app/api/admin/*`
- `apps/web/src/lib/auth.ts`
- `apps/web/src/middleware.ts`
- `apps/web/src/types/index.ts`
- `packages/database/src/embeddings.ts`
- `apps/web/src/app/api/search/route.ts`
- `apps/mcp-server/src/services/discovery.ts`

### Likely New Modules

- `packages/database/src/public-sources.ts`
- `packages/database/src/listing-provenance.ts`
- `apps/web/src/app/api/admin/public-sources/...`

---

## Implementation Order

### Step 1: Schema and enums

Add:

- `PublicSource`
- `ListingProvenance`
- `Listing.supplyTier`
- `Listing.verificationState`
- `Listing.verificationReason`
- `Listing.sourceControlled`
- `Listing.sourceDisabledAt`

Acceptance:

- Prisma generate succeeds
- migration applies cleanly
- existing provider listing flows remain valid

### Step 2: Shared database helpers

Add helpers for:

- create/update public source
- attach provenance to a listing
- disable a source and mark affected listings non-discoverable
- list source-linked listings

Acceptance:

- one helper call can disable a source and consistently mark its listings

### Step 3: Admin routes

Add admin APIs for:

- CRUD source registry
- enable/disable source
- quarantine/restore source-controlled listings

Acceptance:

- admin can operate entirely through API routes
- all mutations are audit logged

### Step 4: Discovery gating

Patch shared discovery to exclude:

- `public_unverified`
- `public_quarantined`
- any listing tied to a disabled source

Acceptance:

- hidden public supply does not leak into web search or MCP discovery

### Step 5: Read models and types

Expose safe internal/admin read models for:

- source detail
- listing provenance
- verification state

Acceptance:

- admin observability can show provenance cleanly

---

## Acceptance Criteria

Milestone 1 is done when all of the following are true:

1. a curated public source can be registered in NexusX
2. a listing can be marked as source-controlled with explicit provenance
3. a disabled source can suppress all of its public listings from discovery
4. `public_unverified` and `public_quarantined` listings do not surface in normal discovery
5. all source and provenance mutations are audit logged
6. provider-owned listings remain unaffected by public-source controls

---

## Testing Plan

### Schema / migration

- migration applies cleanly to a fresh DB
- migration preserves existing listing behavior

### Admin API

- create source
- update source
- disable source
- enable source
- quarantine listing
- restore listing

### Discovery regression

- `provider_verified` listing still appears
- `public_verified` listing appears
- `public_unverified` listing is excluded
- `public_quarantined` listing is excluded
- disabled-source listing is excluded

### Audit coverage

- source create/update/disable logs written
- listing quarantine/restore logs written

---

## Rollout Strategy

1. Ship schema and admin APIs first.
2. Do not ingest real public sources yet.
3. Seed one or two internal test sources manually.
4. Verify discovery gating works end-to-end.
5. Only then begin Milestone 2 ingestion.

This is important.

If Milestone 2 starts before Milestone 1 is stable, the platform will expand supply faster than it can control it.

---

## Risks

### Risk 1: Overloading `Listing.status`

Do not try to represent public-source verification purely with `Listing.status`.

Reason:

- `ACTIVE` / `PAUSED` / `SUSPENDED` already serve marketplace lifecycle
- public-source trust needs a separate dimension

Mitigation:

- keep lifecycle state and provenance/trust state separate

### Risk 2: Letting providers see internal source controls too early

Provider-facing APIs should not receive source-control internals by default.

Mitigation:

- keep source registry admin-only in Milestone 1

### Risk 3: Discovery leakage

If discovery gating is not updated centrally, hidden public listings will leak through some path.

Mitigation:

- enforce gating in shared database search logic, not only route handlers

---

## Definition of Done

Milestone 1 is complete when NexusX has a defensible control plane for public supply:

- source registry exists
- provenance exists
- trust state exists
- admin controls exist
- discovery gating exists
- auditability exists

Only after that should NexusX start importing large-scale public API supply.
