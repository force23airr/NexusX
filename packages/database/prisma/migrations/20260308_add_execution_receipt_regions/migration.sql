ALTER TABLE "execution_receipts"
ADD COLUMN "caller_country" TEXT,
ADD COLUMN "caller_region_bucket" TEXT;

CREATE INDEX "execution_receipts_listing_id_caller_region_bucket_created_at_idx"
ON "execution_receipts"("listing_id", "caller_region_bucket", "created_at");

CREATE INDEX "execution_receipts_listing_id_caller_country_created_at_idx"
ON "execution_receipts"("listing_id", "caller_country", "created_at");
