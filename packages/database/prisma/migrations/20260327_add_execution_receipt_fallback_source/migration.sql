ALTER TABLE "execution_receipts"
ADD COLUMN "fallback_source_receipt_id" UUID;

CREATE INDEX "execution_receipts_fallback_source_receipt_id_idx"
ON "execution_receipts"("fallback_source_receipt_id");
