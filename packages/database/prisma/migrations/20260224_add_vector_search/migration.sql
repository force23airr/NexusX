-- ═══════════════════════════════════════════════════════════════
-- NexusX — Semantic Vector Search Migration
-- packages/database/prisma/migrations/20260224_add_vector_search/migration.sql
--
-- Enables pgvector, adds embedding columns to listings, and
-- creates an HNSW index for fast cosine similarity queries.
-- ═══════════════════════════════════════════════════════════════

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding columns to listings
ALTER TABLE listings ADD COLUMN embedding vector(512);
ALTER TABLE listings ADD COLUMN embedding_model TEXT;
ALTER TABLE listings ADD COLUMN embedded_at TIMESTAMPTZ;
ALTER TABLE listings ADD COLUMN synthetic_queries TEXT[] DEFAULT '{}';
ALTER TABLE listings ADD COLUMN synthetic_queries_version INT DEFAULT 0;

-- NOTE: Do not create the HNSW index in this migration.
-- Prisma migrations run in a transaction and CREATE INDEX CONCURRENTLY
-- is not allowed inside a transaction block.
--
-- Create it as a separate manual operation:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_embedding_hnsw
--   ON listings USING hnsw (embedding vector_cosine_ops)
--   WITH (m = 16, ef_construction = 200);
