CREATE TYPE "public"."ListingRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "public"."ListingSideEffectLevel" AS ENUM ('READ_ONLY', 'REVERSIBLE', 'IRREVERSIBLE');

ALTER TABLE "public"."listings"
ADD COLUMN "auth_schemes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "interaction_modes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "human_approval_required" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "no_health_probe" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "risk_level" "public"."ListingRiskLevel" NOT NULL DEFAULT 'LOW',
ADD COLUMN "side_effect_level" "public"."ListingSideEffectLevel" NOT NULL DEFAULT 'READ_ONLY',
ADD COLUMN "readiness_score" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "readiness_issues" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "readiness_warnings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "readiness_updated_at" TIMESTAMP(3);

UPDATE "public"."listings"
SET
  "auth_schemes" = CASE
    WHEN COALESCE(NULLIF(TRIM("auth_type"), ''), '') = '' THEN ARRAY[]::TEXT[]
    ELSE ARRAY[LOWER(TRIM("auth_type"))]
  END,
  "interaction_modes" = CASE "listing_type"
    WHEN 'WEBSOCKET' THEN ARRAY['streaming']
    WHEN 'DATASET' THEN ARRAY['batch']
    ELSE ARRAY['sync']
  END,
  "human_approval_required" = false,
  "no_health_probe" = false,
  "risk_level" = 'LOW',
  "side_effect_level" = 'READ_ONLY',
  "readiness_score" = 0,
  "readiness_issues" = ARRAY[]::TEXT[],
  "readiness_warnings" = ARRAY[]::TEXT[],
  "readiness_updated_at" = NOW();

CREATE INDEX "listings_risk_level_status_idx" ON "public"."listings"("risk_level", "status");
CREATE INDEX "listings_status_readiness_score_idx" ON "public"."listings"("status", "readiness_score");
