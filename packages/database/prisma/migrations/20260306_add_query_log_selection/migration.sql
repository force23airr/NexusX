ALTER TABLE "query_logs"
ADD COLUMN "selected_listing_id" UUID,
ADD COLUMN "selected_at" TIMESTAMP(3);

ALTER TABLE "query_logs"
ADD CONSTRAINT "query_logs_selected_listing_id_fkey"
FOREIGN KEY ("selected_listing_id") REFERENCES "listings"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

CREATE INDEX "query_logs_selected_listing_id_idx" ON "query_logs"("selected_listing_id");
CREATE INDEX "query_logs_selected_at_idx" ON "query_logs"("selected_at");
