-- NexusX — x402 Reconciliation Ledger
-- packages/database/prisma/migrations/20260306_add_x402_reconciliation/migration.sql
--
-- Adds a durable, agent-native execution ledger for x402-paid requests.
-- This keeps settlement retries separate from user-account transactions.

DO $$
BEGIN
  CREATE TYPE "X402SettlementStatus" AS ENUM (
    'SETTLEMENT_PENDING',
    'SETTLED',
    'UPSTREAM_FAILED',
    'ABANDONED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "x402_settlement_records" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id" TEXT NOT NULL UNIQUE,
  "listing_id" UUID NOT NULL,
  "payer_address" TEXT NOT NULL,
  "listing_slug" TEXT NOT NULL,
  "payment_header" TEXT,
  "payment_header_hash" TEXT NOT NULL UNIQUE,
  "payment_requirement" JSONB NOT NULL,
  "status" "X402SettlementStatus" NOT NULL DEFAULT 'SETTLEMENT_PENDING',
  "quoted_price_usdc" DECIMAL(18, 6) NOT NULL,
  "platform_fee_usdc" DECIMAL(18, 6) NOT NULL,
  "provider_amount_usdc" DECIMAL(18, 6) NOT NULL,
  "upstream_status" INTEGER,
  "response_time_ms" INTEGER,
  "bytes_transferred" INTEGER,
  "tx_hash" TEXT UNIQUE,
  "claimed_at" TIMESTAMPTZ,
  "available_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "settled_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "x402_settlement_records_listing_id_fkey"
    FOREIGN KEY ("listing_id") REFERENCES "listings" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "x402_settlement_records_listing_id_created_at_idx"
  ON "x402_settlement_records" ("listing_id", "created_at");

CREATE INDEX IF NOT EXISTS "x402_settlement_records_status_available_claimed_created_idx"
  ON "x402_settlement_records" ("status", "available_at", "claimed_at", "created_at");

CREATE INDEX IF NOT EXISTS "x402_settlement_records_payer_address_created_at_idx"
  ON "x402_settlement_records" ("payer_address", "created_at");
