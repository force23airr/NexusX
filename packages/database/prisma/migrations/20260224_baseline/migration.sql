-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('PROVIDER', 'BUYER', 'ADMIN');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NONE', 'PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'PAUSED', 'SUSPENDED', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "ListingType" AS ENUM ('REST_API', 'GRAPHQL_API', 'WEBSOCKET', 'DATASET', 'MODEL_INFERENCE', 'COMPOSITE');

-- CreateEnum
CREATE TYPE "DemandSignalType" AS ENUM ('API_CALL', 'VIEW', 'WATCHLIST_ADD', 'SANDBOX_TEST', 'SUBSCRIPTION', 'UNSUBSCRIPTION', 'RATE_LIMITED');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'REFUNDED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "TransactionBillingMode" AS ENUM ('INDIVIDUAL', 'BUNDLE_STEP');

-- CreateEnum
CREATE TYPE "BundleSessionStatus" AS ENUM ('REGISTERED', 'IN_PROGRESS', 'FINALIZED', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'BATCHED', 'SUBMITTED', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "X402SettlementStatus" AS ENUM ('SETTLEMENT_PENDING', 'SETTLED', 'UPSTREAM_FAILED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ApiKeyStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'SUSPEND', 'ACTIVATE', 'PAYOUT', 'REFUND', 'PRICE_OVERRIDE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "external_id" TEXT,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "roles" "UserRole"[],
    "kyc_status" "KycStatus" NOT NULL DEFAULT 'NONE',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "company_name" TEXT,
    "website" TEXT,
    "description" TEXT,
    "total_revenue" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "total_payouts" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "pending_balance" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "payout_address" TEXT,
    "auto_payout_enabled" BOOLEAN NOT NULL DEFAULT false,
    "auto_payout_threshold" DECIMAL(18,6) NOT NULL DEFAULT 100,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "address" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL DEFAULT 8453,
    "balance_usdc" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "escrow_usdc" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "nonce" INTEGER NOT NULL DEFAULT 0,
    "last_synced_at" TIMESTAMP(3),
    "auto_deposit_enabled" BOOLEAN NOT NULL DEFAULT false,
    "auto_deposit_amount_usdc" DECIMAL(18,6) NOT NULL DEFAULT 50,
    "auto_deposit_threshold" DECIMAL(18,6) NOT NULL DEFAULT 5,
    "funding_source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parent_id" UUID,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "listing_type" "ListingType" NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "base_url" TEXT NOT NULL,
    "health_check_url" TEXT,
    "docs_url" TEXT,
    "sandbox_url" TEXT,
    "auth_type" TEXT NOT NULL DEFAULT 'api_key',
    "floor_price_usdc" DECIMAL(18,6) NOT NULL,
    "ceiling_price_usdc" DECIMAL(18,6),
    "current_price_usdc" DECIMAL(18,6) NOT NULL,
    "capacity_per_minute" INTEGER NOT NULL DEFAULT 60,
    "is_unique" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "intents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sample_request" JSONB,
    "sample_response" JSONB,
    "schema_spec" JSONB,
    "availability_regions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "restricted_regions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "compliance_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "capability_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "input_modalities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "output_modalities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "domain_metadata" JSONB,
    "embedding" vector(512),
    "embedding_model" TEXT,
    "embedded_at" TIMESTAMP(3),
    "synthetic_queries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "synthetic_queries_version" INTEGER NOT NULL DEFAULT 0,
    "source_type" TEXT,
    "source_resource_url" TEXT,
    "listing_index_version" INTEGER NOT NULL DEFAULT 0,
    "discovery_impressions" INTEGER NOT NULL DEFAULT 0,
    "discovery_clicks" INTEGER NOT NULL DEFAULT 0,
    "total_calls" BIGINT NOT NULL DEFAULT 0,
    "total_revenue" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "avg_rating" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "published_at" TIMESTAMP(3),
    "deprecated_at" TIMESTAMP(3),

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demand_signals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "listing_id" UUID NOT NULL,
    "buyer_id" UUID,
    "type" "DemandSignalType" NOT NULL,
    "weight" DECIMAL(6,3) NOT NULL,
    "metadata" JSONB DEFAULT '{}',
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demand_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demand_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "listing_id" UUID NOT NULL,
    "score" DECIMAL(6,2) NOT NULL,
    "raw_signal_sum" DECIMAL(12,3) NOT NULL,
    "unique_buyers" INTEGER NOT NULL,
    "velocity" DECIMAL(8,4) NOT NULL,
    "window_ms" INTEGER NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "demand_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_metrics_raw" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "listing_id" UUID NOT NULL,
    "success_count" INTEGER NOT NULL,
    "failure_count" INTEGER NOT NULL,
    "median_latency_ms" DECIMAL(10,2) NOT NULL,
    "p99_latency_ms" DECIMAL(10,2) NOT NULL,
    "uptime_minutes" INTEGER NOT NULL,
    "total_minutes" INTEGER NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_metrics_raw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "listing_id" UUID NOT NULL,
    "uptime_percent" DECIMAL(6,3) NOT NULL,
    "median_latency_ms" DECIMAL(10,2) NOT NULL,
    "p99_latency_ms" DECIMAL(10,2) NOT NULL,
    "error_rate_percent" DECIMAL(6,3) NOT NULL,
    "average_rating" DECIMAL(3,2) NOT NULL,
    "rating_count" INTEGER NOT NULL,
    "composite_score" DECIMAL(6,2) NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quality_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "listing_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "competitor_count" INTEGER NOT NULL,
    "is_unique" BOOLEAN NOT NULL,
    "capacity_per_minute" INTEGER NOT NULL,
    "utilization_pct" DECIMAL(6,2) NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "listing_id" UUID NOT NULL,
    "floor_price" DECIMAL(18,6) NOT NULL,
    "ceiling_price" DECIMAL(18,6),
    "current_price" DECIMAL(18,6) NOT NULL,
    "previous_price" DECIMAL(18,6) NOT NULL,
    "price_change_pct" DECIMAL(8,4) NOT NULL,
    "demand_multiplier" DECIMAL(8,4) NOT NULL,
    "scarcity_multiplier" DECIMAL(8,4) NOT NULL,
    "quality_multiplier" DECIMAL(8,4) NOT NULL,
    "momentum_multiplier" DECIMAL(8,4) NOT NULL,
    "temporal_multiplier" DECIMAL(8,4) NOT NULL,
    "combined_multiplier" DECIMAL(8,4) NOT NULL,
    "windows_at_floor" INTEGER NOT NULL DEFAULT 0,
    "windows_at_ceiling" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auction_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "listing_id" UUID NOT NULL,
    "price" DECIMAL(18,6) NOT NULL,
    "floor_price" DECIMAL(18,6) NOT NULL,
    "multipliers" JSONB NOT NULL,
    "inputs" JSONB NOT NULL,
    "compute_time_us" INTEGER NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auction_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "listing_id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "billing_mode" "TransactionBillingMode" NOT NULL DEFAULT 'INDIVIDUAL',
    "bundle_session_id" UUID,
    "bundle_step_index" INTEGER,
    "settled_via_bundle" BOOLEAN NOT NULL DEFAULT false,
    "price_usdc" DECIMAL(18,6) NOT NULL,
    "platform_fee_usdc" DECIMAL(18,6) NOT NULL,
    "provider_amount_usdc" DECIMAL(18,6) NOT NULL,
    "fee_rate_applied" DECIMAL(6,4) NOT NULL,
    "quoted_price_usdc" DECIMAL(18,6),
    "quoted_platform_fee_usdc" DECIMAL(18,6),
    "quoted_provider_amount_usdc" DECIMAL(18,6),
    "request_id" TEXT NOT NULL,
    "response_time_ms" INTEGER,
    "http_status" INTEGER,
    "bytes_transferred" INTEGER,
    "settlement_id" UUID,
    "settled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "x402_settlement_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "request_id" TEXT NOT NULL,
    "listing_id" UUID NOT NULL,
    "payer_address" TEXT NOT NULL,
    "listing_slug" TEXT NOT NULL,
    "payment_header" TEXT,
    "payment_header_hash" TEXT NOT NULL,
    "payment_requirement" JSONB NOT NULL,
    "status" "X402SettlementStatus" NOT NULL DEFAULT 'SETTLEMENT_PENDING',
    "quoted_price_usdc" DECIMAL(18,6) NOT NULL,
    "platform_fee_usdc" DECIMAL(18,6) NOT NULL,
    "provider_amount_usdc" DECIMAL(18,6) NOT NULL,
    "upstream_status" INTEGER,
    "response_time_ms" INTEGER,
    "bytes_transferred" INTEGER,
    "tx_hash" TEXT,
    "claimed_at" TIMESTAMP(3),
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "settled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "x402_settlement_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bundle_execution_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buyer_id" UUID NOT NULL,
    "api_key_id" UUID,
    "bundle_slug" TEXT NOT NULL,
    "bundle_name" TEXT,
    "status" "BundleSessionStatus" NOT NULL DEFAULT 'REGISTERED',
    "tool_slugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "registered_gross_price_usdc" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "executed_gross_price_usdc" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "target_bundle_price_usdc" DECIMAL(18,6) NOT NULL,
    "billed_price_usdc" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "discount_usdc" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "platform_fee_rate" DECIMAL(6,4) NOT NULL,
    "platform_fee_usdc" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "provider_pool_usdc" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "metadata" JSONB DEFAULT '{}',
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "finalized_at" TIMESTAMP(3),

    CONSTRAINT "bundle_execution_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bundle_provider_settlements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bundle_session_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "list_price_usdc" DECIMAL(18,6) NOT NULL,
    "weight" DECIMAL(10,8) NOT NULL,
    "allocated_price_usdc" DECIMAL(18,6) NOT NULL,
    "platform_fee_usdc" DECIMAL(18,6) NOT NULL,
    "provider_amount_usdc" DECIMAL(18,6) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bundle_provider_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "total_usdc" DECIMAL(18,6) NOT NULL,
    "platform_fee_usdc" DECIMAL(18,6) NOT NULL,
    "provider_pay_usdc" DECIMAL(18,6) NOT NULL,
    "transaction_count" INTEGER NOT NULL,
    "tx_hash" TEXT,
    "block_number" BIGINT,
    "chain_id" INTEGER NOT NULL DEFAULT 8453,
    "gas_used" BIGINT,
    "gas_cost_usdc" DECIMAL(18,6),
    "batched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "failure_reason" TEXT,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_id" UUID NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "amount_usdc" DECIMAL(18,6) NOT NULL,
    "destination_addr" TEXT NOT NULL,
    "tx_hash" TEXT,
    "chain_id" INTEGER NOT NULL DEFAULT 8453,
    "initiated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "failure_reason" TEXT,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "key_prefix" VARCHAR(8) NOT NULL,
    "status" "ApiKeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "rate_limit_rpm" INTEGER NOT NULL DEFAULT 60,
    "allowed_ips" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buyer_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "monthly_budget_usdc" DECIMAL(18,6),
    "spent_this_month_usdc" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "total_spent_usdc" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "total_calls" BIGINT NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paused_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watchlist_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buyer_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "alert_on_price_drop" BOOLEAN NOT NULL DEFAULT false,
    "alert_threshold" DECIMAL(18,6),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watchlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ratings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "listing_id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "score" SMALLINT NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "query_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "buyer_id" UUID NOT NULL,
    "raw_query" TEXT NOT NULL,
    "normalized_query" TEXT,
    "intent_classified" TEXT,
    "matched_listing_id" UUID,
    "confidence_score" DECIMAL(5,4),
    "alternative_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "route_time_ms" INTEGER,
    "was_accepted" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "query_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_config" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_config_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_id" UUID NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_activations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "listing_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "claimed_at" TIMESTAMP(3),
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_activations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demand_gaps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "intent_cluster" TEXT NOT NULL,
    "sample_queries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "query_count" INTEGER NOT NULL DEFAULT 1,
    "avg_confidence" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "is_resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_by_listing_id" UUID,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "demand_gaps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_external_id_key" ON "users"("external_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_kyc_status_idx" ON "users"("kyc_status");

-- CreateIndex
CREATE UNIQUE INDEX "provider_profiles_user_id_key" ON "provider_profiles"("user_id");

-- CreateIndex
CREATE INDEX "provider_profiles_payout_address_idx" ON "provider_profiles"("payout_address");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_user_id_key" ON "wallets"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_address_key" ON "wallets"("address");

-- CreateIndex
CREATE INDEX "wallets_address_idx" ON "wallets"("address");

-- CreateIndex
CREATE INDEX "wallets_chain_id_idx" ON "wallets"("chain_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_parent_id_idx" ON "categories"("parent_id");

-- CreateIndex
CREATE INDEX "categories_slug_idx" ON "categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "listings_slug_key" ON "listings"("slug");

-- CreateIndex
CREATE INDEX "listings_provider_id_idx" ON "listings"("provider_id");

-- CreateIndex
CREATE INDEX "listings_category_id_idx" ON "listings"("category_id");

-- CreateIndex
CREATE INDEX "listings_status_idx" ON "listings"("status");

-- CreateIndex
CREATE INDEX "listings_listing_type_idx" ON "listings"("listing_type");

-- CreateIndex
CREATE INDEX "listings_current_price_usdc_idx" ON "listings"("current_price_usdc");

-- CreateIndex
CREATE INDEX "listings_total_calls_idx" ON "listings"("total_calls");

-- CreateIndex
CREATE INDEX "listings_avg_rating_idx" ON "listings"("avg_rating");

-- CreateIndex
CREATE INDEX "listings_tags_idx" ON "listings" USING GIN ("tags");

-- CreateIndex
CREATE INDEX "listings_availability_regions_idx" ON "listings" USING GIN ("availability_regions");

-- CreateIndex
CREATE INDEX "listings_compliance_tags_idx" ON "listings" USING GIN ("compliance_tags");

-- CreateIndex
CREATE INDEX "listings_capability_tags_idx" ON "listings" USING GIN ("capability_tags");

-- CreateIndex
CREATE INDEX "listings_input_modalities_idx" ON "listings" USING GIN ("input_modalities");

-- CreateIndex
CREATE INDEX "listings_output_modalities_idx" ON "listings" USING GIN ("output_modalities");

-- CreateIndex
CREATE INDEX "listings_created_at_idx" ON "listings"("created_at");

-- CreateIndex
CREATE INDEX "listings_source_type_source_resource_url_idx" ON "listings"("source_type", "source_resource_url");

-- CreateIndex
CREATE INDEX "demand_signals_listing_id_captured_at_idx" ON "demand_signals"("listing_id", "captured_at");

-- CreateIndex
CREATE INDEX "demand_signals_listing_id_type_idx" ON "demand_signals"("listing_id", "type");

-- CreateIndex
CREATE INDEX "demand_signals_buyer_id_idx" ON "demand_signals"("buyer_id");

-- CreateIndex
CREATE INDEX "demand_signals_captured_at_idx" ON "demand_signals"("captured_at");

-- CreateIndex
CREATE INDEX "demand_snapshots_listing_id_computed_at_idx" ON "demand_snapshots"("listing_id", "computed_at");

-- CreateIndex
CREATE INDEX "demand_snapshots_computed_at_idx" ON "demand_snapshots"("computed_at");

-- CreateIndex
CREATE INDEX "provider_metrics_raw_listing_id_period_end_idx" ON "provider_metrics_raw"("listing_id", "period_end");

-- CreateIndex
CREATE INDEX "provider_metrics_raw_period_end_idx" ON "provider_metrics_raw"("period_end");

-- CreateIndex
CREATE INDEX "quality_snapshots_listing_id_computed_at_idx" ON "quality_snapshots"("listing_id", "computed_at");

-- CreateIndex
CREATE INDEX "quality_snapshots_composite_score_idx" ON "quality_snapshots"("composite_score");

-- CreateIndex
CREATE INDEX "supply_snapshots_listing_id_computed_at_idx" ON "supply_snapshots"("listing_id", "computed_at");

-- CreateIndex
CREATE INDEX "supply_snapshots_category_id_computed_at_idx" ON "supply_snapshots"("category_id", "computed_at");

-- CreateIndex
CREATE INDEX "price_snapshots_listing_id_computed_at_idx" ON "price_snapshots"("listing_id", "computed_at");

-- CreateIndex
CREATE INDEX "price_snapshots_computed_at_idx" ON "price_snapshots"("computed_at");

-- CreateIndex
CREATE INDEX "auction_results_listing_id_computed_at_idx" ON "auction_results"("listing_id", "computed_at");

-- CreateIndex
CREATE INDEX "auction_results_computed_at_idx" ON "auction_results"("computed_at");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_request_id_key" ON "transactions"("request_id");

-- CreateIndex
CREATE INDEX "transactions_listing_id_created_at_idx" ON "transactions"("listing_id", "created_at");

-- CreateIndex
CREATE INDEX "transactions_buyer_id_created_at_idx" ON "transactions"("buyer_id", "created_at");

-- CreateIndex
CREATE INDEX "transactions_settlement_id_idx" ON "transactions"("settlement_id");

-- CreateIndex
CREATE INDEX "transactions_bundle_session_id_idx" ON "transactions"("bundle_session_id");

-- CreateIndex
CREATE INDEX "transactions_billing_mode_created_at_idx" ON "transactions"("billing_mode", "created_at");

-- CreateIndex
CREATE INDEX "transactions_settled_via_bundle_idx" ON "transactions"("settled_via_bundle");

-- CreateIndex
CREATE INDEX "transactions_status_idx" ON "transactions"("status");

-- CreateIndex
CREATE INDEX "transactions_request_id_idx" ON "transactions"("request_id");

-- CreateIndex
CREATE INDEX "transactions_created_at_idx" ON "transactions"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "x402_settlement_records_request_id_key" ON "x402_settlement_records"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "x402_settlement_records_payment_header_hash_key" ON "x402_settlement_records"("payment_header_hash");

-- CreateIndex
CREATE UNIQUE INDEX "x402_settlement_records_tx_hash_key" ON "x402_settlement_records"("tx_hash");

-- CreateIndex
CREATE INDEX "x402_settlement_records_listing_id_created_at_idx" ON "x402_settlement_records"("listing_id", "created_at");

-- CreateIndex
CREATE INDEX "x402_settlement_records_status_available_at_claimed_at_crea_idx" ON "x402_settlement_records"("status", "available_at", "claimed_at", "created_at");

-- CreateIndex
CREATE INDEX "x402_settlement_records_payer_address_created_at_idx" ON "x402_settlement_records"("payer_address", "created_at");

-- CreateIndex
CREATE INDEX "bundle_execution_sessions_buyer_id_created_at_idx" ON "bundle_execution_sessions"("buyer_id", "created_at");

-- CreateIndex
CREATE INDEX "bundle_execution_sessions_status_created_at_idx" ON "bundle_execution_sessions"("status", "created_at");

-- CreateIndex
CREATE INDEX "bundle_execution_sessions_bundle_slug_idx" ON "bundle_execution_sessions"("bundle_slug");

-- CreateIndex
CREATE UNIQUE INDEX "bundle_provider_settlements_transaction_id_key" ON "bundle_provider_settlements"("transaction_id");

-- CreateIndex
CREATE INDEX "bundle_provider_settlements_bundle_session_id_idx" ON "bundle_provider_settlements"("bundle_session_id");

-- CreateIndex
CREATE INDEX "bundle_provider_settlements_provider_id_created_at_idx" ON "bundle_provider_settlements"("provider_id", "created_at");

-- CreateIndex
CREATE INDEX "bundle_provider_settlements_listing_id_created_at_idx" ON "bundle_provider_settlements"("listing_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_tx_hash_key" ON "settlements"("tx_hash");

-- CreateIndex
CREATE INDEX "settlements_status_idx" ON "settlements"("status");

-- CreateIndex
CREATE INDEX "settlements_tx_hash_idx" ON "settlements"("tx_hash");

-- CreateIndex
CREATE INDEX "settlements_batched_at_idx" ON "settlements"("batched_at");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_tx_hash_key" ON "payouts"("tx_hash");

-- CreateIndex
CREATE INDEX "payouts_provider_id_initiated_at_idx" ON "payouts"("provider_id", "initiated_at");

-- CreateIndex
CREATE INDEX "payouts_status_idx" ON "payouts"("status");

-- CreateIndex
CREATE INDEX "payouts_tx_hash_idx" ON "payouts"("tx_hash");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_key_hash_idx" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_key_prefix_idx" ON "api_keys"("key_prefix");

-- CreateIndex
CREATE INDEX "api_keys_user_id_idx" ON "api_keys"("user_id");

-- CreateIndex
CREATE INDEX "api_keys_status_idx" ON "api_keys"("status");

-- CreateIndex
CREATE INDEX "subscriptions_buyer_id_idx" ON "subscriptions"("buyer_id");

-- CreateIndex
CREATE INDEX "subscriptions_listing_id_idx" ON "subscriptions"("listing_id");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_buyer_id_listing_id_key" ON "subscriptions"("buyer_id", "listing_id");

-- CreateIndex
CREATE INDEX "watchlist_items_buyer_id_idx" ON "watchlist_items"("buyer_id");

-- CreateIndex
CREATE INDEX "watchlist_items_listing_id_idx" ON "watchlist_items"("listing_id");

-- CreateIndex
CREATE UNIQUE INDEX "watchlist_items_buyer_id_listing_id_key" ON "watchlist_items"("buyer_id", "listing_id");

-- CreateIndex
CREATE INDEX "ratings_listing_id_idx" ON "ratings"("listing_id");

-- CreateIndex
CREATE INDEX "ratings_buyer_id_idx" ON "ratings"("buyer_id");

-- CreateIndex
CREATE INDEX "ratings_score_idx" ON "ratings"("score");

-- CreateIndex
CREATE UNIQUE INDEX "ratings_listing_id_buyer_id_key" ON "ratings"("listing_id", "buyer_id");

-- CreateIndex
CREATE INDEX "query_logs_buyer_id_created_at_idx" ON "query_logs"("buyer_id", "created_at");

-- CreateIndex
CREATE INDEX "query_logs_matched_listing_id_idx" ON "query_logs"("matched_listing_id");

-- CreateIndex
CREATE INDEX "query_logs_intent_classified_idx" ON "query_logs"("intent_classified");

-- CreateIndex
CREATE INDEX "query_logs_created_at_idx" ON "query_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "pending_activations_created_at_idx" ON "pending_activations"("created_at");

-- CreateIndex
CREATE INDEX "pending_activations_available_at_claimed_at_created_at_idx" ON "pending_activations"("available_at", "claimed_at", "created_at");

-- CreateIndex
CREATE INDEX "demand_gaps_intent_cluster_idx" ON "demand_gaps"("intent_cluster");

-- CreateIndex
CREATE INDEX "demand_gaps_is_resolved_idx" ON "demand_gaps"("is_resolved");

-- CreateIndex
CREATE INDEX "demand_gaps_query_count_idx" ON "demand_gaps"("query_count");

-- AddForeignKey
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demand_signals" ADD CONSTRAINT "demand_signals_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demand_snapshots" ADD CONSTRAINT "demand_snapshots_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_metrics_raw" ADD CONSTRAINT "provider_metrics_raw_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_snapshots" ADD CONSTRAINT "quality_snapshots_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_snapshots" ADD CONSTRAINT "supply_snapshots_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_results" ADD CONSTRAINT "auction_results_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_bundle_session_id_fkey" FOREIGN KEY ("bundle_session_id") REFERENCES "bundle_execution_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "x402_settlement_records" ADD CONSTRAINT "x402_settlement_records_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_execution_sessions" ADD CONSTRAINT "bundle_execution_sessions_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_provider_settlements" ADD CONSTRAINT "bundle_provider_settlements_bundle_session_id_fkey" FOREIGN KEY ("bundle_session_id") REFERENCES "bundle_execution_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_provider_settlements" ADD CONSTRAINT "bundle_provider_settlements_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_provider_settlements" ADD CONSTRAINT "bundle_provider_settlements_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_provider_settlements" ADD CONSTRAINT "bundle_provider_settlements_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "query_logs" ADD CONSTRAINT "query_logs_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "query_logs" ADD CONSTRAINT "query_logs_matched_listing_id_fkey" FOREIGN KEY ("matched_listing_id") REFERENCES "listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

