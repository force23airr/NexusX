ALTER TABLE "execution_receipts"
ADD COLUMN "operation_id" TEXT;

CREATE INDEX "execution_receipts_listing_id_operation_id_created_at_idx"
ON "execution_receipts"("listing_id", "operation_id", "created_at");
