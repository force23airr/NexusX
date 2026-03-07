-- CreateEnum
CREATE TYPE "ExecutionAuthMode" AS ENUM ('API_KEY', 'X402');

-- CreateEnum
CREATE TYPE "ExecutionReceiptOutcome" AS ENUM ('SUCCESS', 'FAILED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ExecutionSettlementStatus" AS ENUM (
  'NONE',
  'SETTLED',
  'PENDING_RECONCILIATION',
  'UPSTREAM_FAILED',
  'DEFERRED_BUNDLE',
  'ABANDONED'
);

-- CreateTable
CREATE TABLE "execution_receipts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "request_id" TEXT NOT NULL,
  "query_log_id" UUID,
  "listing_id" UUID,
  "listing_slug" TEXT NOT NULL,
  "buyer_id" UUID,
  "payer_address" TEXT,
  "auth_mode" "ExecutionAuthMode" NOT NULL,
  "billing_mode" "TransactionBillingMode" NOT NULL DEFAULT 'INDIVIDUAL',
  "outcome" "ExecutionReceiptOutcome" NOT NULL,
  "settlement_status" "ExecutionSettlementStatus" NOT NULL DEFAULT 'NONE',
  "sandbox" BOOLEAN NOT NULL DEFAULT false,
  "quoted_price_usdc" DECIMAL(18,6),
  "charged_price_usdc" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "platform_fee_usdc" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "provider_amount_usdc" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "http_status" INTEGER NOT NULL,
  "upstream_status" INTEGER,
  "latency_ms" INTEGER,
  "bytes_transferred" INTEGER,
  "bundle_session_id" UUID,
  "bundle_step_index" INTEGER,
  "tx_hash" TEXT,
  "circuit_state" TEXT,
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "error_code" TEXT,
  "error_message" TEXT,
  "metadata" JSONB DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "execution_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "execution_receipts_request_id_key" ON "execution_receipts"("request_id");

-- CreateIndex
CREATE INDEX "execution_receipts_listing_id_created_at_idx" ON "execution_receipts"("listing_id", "created_at");

-- CreateIndex
CREATE INDEX "execution_receipts_buyer_id_created_at_idx" ON "execution_receipts"("buyer_id", "created_at");

-- CreateIndex
CREATE INDEX "execution_receipts_query_log_id_idx" ON "execution_receipts"("query_log_id");

-- CreateIndex
CREATE INDEX "execution_receipts_outcome_created_at_idx" ON "execution_receipts"("outcome", "created_at");

-- CreateIndex
CREATE INDEX "execution_receipts_settlement_status_created_at_idx" ON "execution_receipts"("settlement_status", "created_at");

-- CreateIndex
CREATE INDEX "execution_receipts_bundle_session_id_idx" ON "execution_receipts"("bundle_session_id");
