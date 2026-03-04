-- Add source tracking fields for Bazaar-imported listings
ALTER TABLE "listings" ADD COLUMN "source_type" TEXT;
ALTER TABLE "listings" ADD COLUMN "source_resource_url" TEXT;

-- Compound index for dedup lookups
CREATE INDEX "listings_source_type_source_resource_url_idx" ON "listings"("source_type", "source_resource_url");
