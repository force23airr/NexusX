-- ═══════════════════════════════════════════════════════════════
-- NexusX — Bundle Settlement Migration
-- packages/database/prisma/migrations/20260225_add_bundle_settlement/migration.sql
--
-- Adds gateway-ledger primitives for true bundle billing:
--   1) Bundle execution session registration/finalization
--   2) Bundle-scoped transaction linkage
--   3) Provider revenue split audit records
-- ═══════════════════════════════════════════════════════════════

-- Enums
DO $$
BEGIN
  CREATE TYPE "TransactionBillingMode" AS ENUM ('INDIVIDUAL', 'BUNDLE_STEP');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "BundleSessionStatus" AS ENUM (
    'REGISTERED',
    'IN_PROGRESS',
    'FINALIZED',
    'FAILED',
    'CANCELLED',
    'EXPIRED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Bundle session lifecycle table
CREATE TABLE IF NOT EXISTS "bundle_execution_sessions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "buyer_id" UUID NOT NULL,
  "api_key_id" UUID,
  "bundle_slug" TEXT NOT NULL,
  "bundle_name" TEXT,
  "status" "BundleSessionStatus" NOT NULL DEFAULT 'REGISTERED',
  "tool_slugs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "registered_gross_price_usdc" NUMERIC(18, 6) NOT NULL DEFAULT 0,
  "executed_gross_price_usdc" NUMERIC(18, 6) NOT NULL DEFAULT 0,
  "target_bundle_price_usdc" NUMERIC(18, 6) NOT NULL,
  "billed_price_usdc" NUMERIC(18, 6) NOT NULL DEFAULT 0,
  "discount_usdc" NUMERIC(18, 6) NOT NULL DEFAULT 0,
  "platform_fee_rate" NUMERIC(6, 4) NOT NULL,
  "platform_fee_usdc" NUMERIC(18, 6) NOT NULL DEFAULT 0,
  "provider_pool_usdc" NUMERIC(18, 6) NOT NULL DEFAULT 0,
  "metadata" JSONB DEFAULT '{}'::jsonb,
  "expires_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "finalized_at" TIMESTAMPTZ,
  CONSTRAINT "bundle_execution_sessions_buyer_id_fkey"
    FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "bundle_execution_sessions_buyer_id_created_at_idx"
  ON "bundle_execution_sessions" ("buyer_id", "created_at");
CREATE INDEX IF NOT EXISTS "bundle_execution_sessions_status_created_at_idx"
  ON "bundle_execution_sessions" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "bundle_execution_sessions_bundle_slug_idx"
  ON "bundle_execution_sessions" ("bundle_slug");

-- Transaction linkage for bundle settlement
ALTER TABLE "transactions"
  ADD COLUMN IF NOT EXISTS "billing_mode" "TransactionBillingMode" NOT NULL DEFAULT 'INDIVIDUAL',
  ADD COLUMN IF NOT EXISTS "bundle_session_id" UUID,
  ADD COLUMN IF NOT EXISTS "bundle_step_index" INTEGER,
  ADD COLUMN IF NOT EXISTS "settled_via_bundle" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "quoted_price_usdc" NUMERIC(18, 6),
  ADD COLUMN IF NOT EXISTS "quoted_platform_fee_usdc" NUMERIC(18, 6),
  ADD COLUMN IF NOT EXISTS "quoted_provider_amount_usdc" NUMERIC(18, 6);

DO $$
BEGIN
  ALTER TABLE "transactions"
    ADD CONSTRAINT "transactions_bundle_session_id_fkey"
    FOREIGN KEY ("bundle_session_id")
    REFERENCES "bundle_execution_sessions"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "transactions_bundle_session_id_idx"
  ON "transactions" ("bundle_session_id");
CREATE INDEX IF NOT EXISTS "transactions_billing_mode_created_at_idx"
  ON "transactions" ("billing_mode", "created_at");
CREATE INDEX IF NOT EXISTS "transactions_settled_via_bundle_idx"
  ON "transactions" ("settled_via_bundle");

-- Provider split audit rows (one per settled bundle step transaction)
CREATE TABLE IF NOT EXISTS "bundle_provider_settlements" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "bundle_session_id" UUID NOT NULL,
  "transaction_id" UUID NOT NULL UNIQUE,
  "provider_id" UUID NOT NULL,
  "listing_id" UUID NOT NULL,
  "list_price_usdc" NUMERIC(18, 6) NOT NULL,
  "weight" NUMERIC(10, 8) NOT NULL,
  "allocated_price_usdc" NUMERIC(18, 6) NOT NULL,
  "platform_fee_usdc" NUMERIC(18, 6) NOT NULL,
  "provider_amount_usdc" NUMERIC(18, 6) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "bundle_provider_settlements_bundle_session_id_fkey"
    FOREIGN KEY ("bundle_session_id") REFERENCES "bundle_execution_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "bundle_provider_settlements_transaction_id_fkey"
    FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "bundle_provider_settlements_provider_id_fkey"
    FOREIGN KEY ("provider_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "bundle_provider_settlements_listing_id_fkey"
    FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "bundle_provider_settlements_bundle_session_id_idx"
  ON "bundle_provider_settlements" ("bundle_session_id");
CREATE INDEX IF NOT EXISTS "bundle_provider_settlements_provider_id_created_at_idx"
  ON "bundle_provider_settlements" ("provider_id", "created_at");
CREATE INDEX IF NOT EXISTS "bundle_provider_settlements_listing_id_created_at_idx"
  ON "bundle_provider_settlements" ("listing_id", "created_at");
