-- CreateEnum
CREATE TYPE "OperationVerificationStatus" AS ENUM ('NONE', 'VERIFIED', 'WARNING', 'FAILED');

-- AlterTable
ALTER TABLE "listings"
ADD COLUMN "operation_verification_status" "OperationVerificationStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN "last_operation_verification_at" TIMESTAMP(3),
ADD COLUMN "last_successful_operation_verification_at" TIMESTAMP(3),
ADD COLUMN "operation_verification_verified_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "operation_verification_warning_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "operation_verification_failed_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "operation_verification_skipped_count" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "listing_operation_verification_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "listing_id" UUID NOT NULL,
  "provider_id" UUID NOT NULL,
  "status" "OperationVerificationStatus" NOT NULL DEFAULT 'NONE',
  "verified_count" INTEGER NOT NULL DEFAULT 0,
  "warning_count" INTEGER NOT NULL DEFAULT 0,
  "failed_count" INTEGER NOT NULL DEFAULT 0,
  "skipped_count" INTEGER NOT NULL DEFAULT 0,
  "results" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "listing_operation_verification_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listings_operation_verification_status_last_operation_veri_idx"
ON "listings"("operation_verification_status", "last_operation_verification_at");

-- CreateIndex
CREATE INDEX "listing_operation_verification_runs_listing_id_created_at_idx"
ON "listing_operation_verification_runs"("listing_id", "created_at");

-- CreateIndex
CREATE INDEX "listing_operation_verification_runs_provider_id_created_at_idx"
ON "listing_operation_verification_runs"("provider_id", "created_at");

-- CreateIndex
CREATE INDEX "listing_operation_verification_runs_status_created_at_idx"
ON "listing_operation_verification_runs"("status", "created_at");

-- AddForeignKey
ALTER TABLE "listing_operation_verification_runs"
ADD CONSTRAINT "listing_operation_verification_runs_listing_id_fkey"
FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_operation_verification_runs"
ADD CONSTRAINT "listing_operation_verification_runs_provider_id_fkey"
FOREIGN KEY ("provider_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
