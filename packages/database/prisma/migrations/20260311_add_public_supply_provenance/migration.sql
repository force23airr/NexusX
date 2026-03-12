CREATE TYPE "ListingSupplyTier" AS ENUM (
  'PROVIDER_VERIFIED',
  'PUBLIC_VERIFIED',
  'PUBLIC_UNVERIFIED',
  'PUBLIC_QUARANTINED'
);

CREATE TYPE "ListingVerificationState" AS ENUM (
  'NONE',
  'INGESTED',
  'VERIFIED',
  'DEGRADED',
  'QUARANTINED',
  'RETIRED'
);

CREATE TYPE "PublicSourceType" AS ENUM (
  'GITHUB_REPO',
  'MANIFEST_CATALOG',
  'API_DIRECTORY',
  'MANUAL_CURATED'
);

CREATE TYPE "PublicSourceStatus" AS ENUM (
  'ACTIVE',
  'PAUSED',
  'DISABLED',
  'BLOCKED'
);

CREATE TYPE "ListingProvenanceKind" AS ENUM (
  'PROVIDER_DIRECT',
  'PROVIDER_IMPORTED_MANIFEST',
  'PUBLIC_SOURCE',
  'BAZAAR_IMPORT'
);

ALTER TABLE "listings"
ADD COLUMN "supply_tier" "ListingSupplyTier" NOT NULL DEFAULT 'PROVIDER_VERIFIED',
ADD COLUMN "verification_state" "ListingVerificationState" NOT NULL DEFAULT 'VERIFIED',
ADD COLUMN "verification_reason" TEXT,
ADD COLUMN "source_controlled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "public_sources" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "source_type" "PublicSourceType" NOT NULL,
  "base_url" TEXT,
  "catalog_url" TEXT NOT NULL,
  "owner_name" TEXT,
  "owner_url" TEXT,
  "license" TEXT,
  "attribution_required" BOOLEAN NOT NULL DEFAULT false,
  "terms_url" TEXT,
  "notes" TEXT,
  "status" "PublicSourceStatus" NOT NULL DEFAULT 'ACTIVE',
  "allow_discovery" BOOLEAN NOT NULL DEFAULT true,
  "allow_execution" BOOLEAN NOT NULL DEFAULT true,
  "last_synced_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "public_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "listing_provenances" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "listing_id" UUID NOT NULL,
  "kind" "ListingProvenanceKind" NOT NULL,
  "public_source_id" UUID,
  "external_id" TEXT,
  "external_url" TEXT,
  "external_version" TEXT,
  "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3),
  "attribution" TEXT,
  "usage_notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "listing_provenances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "public_sources_slug_key" ON "public_sources"("slug");
CREATE UNIQUE INDEX "listing_provenances_listing_id_key" ON "listing_provenances"("listing_id");

CREATE INDEX "listings_supply_tier_status_idx" ON "listings"("supply_tier", "status");
CREATE INDEX "listings_verification_state_status_idx" ON "listings"("verification_state", "status");
CREATE INDEX "public_sources_status_idx" ON "public_sources"("status");
CREATE INDEX "public_sources_source_type_idx" ON "public_sources"("source_type");
CREATE INDEX "public_sources_allow_discovery_allow_execution_idx" ON "public_sources"("allow_discovery", "allow_execution");
CREATE INDEX "listing_provenances_public_source_id_idx" ON "listing_provenances"("public_source_id");
CREATE INDEX "listing_provenances_kind_idx" ON "listing_provenances"("kind");
CREATE INDEX "listing_provenances_external_url_idx" ON "listing_provenances"("external_url");

ALTER TABLE "listing_provenances"
ADD CONSTRAINT "listing_provenances_listing_id_fkey"
FOREIGN KEY ("listing_id") REFERENCES "listings"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "listing_provenances"
ADD CONSTRAINT "listing_provenances_public_source_id_fkey"
FOREIGN KEY ("public_source_id") REFERENCES "public_sources"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
