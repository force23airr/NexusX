-- Run this on live databases after the vector columns exist.
-- This must run outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_embedding_hnsw
ON listings USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 200);
