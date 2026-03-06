ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS availability_regions text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS restricted_regions text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS compliance_tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS capability_tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS input_modalities text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS output_modalities text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS domain_metadata jsonb,
  ADD COLUMN IF NOT EXISTS listing_index_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discovery_impressions integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discovery_clicks integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS listings_availability_regions_idx ON listings USING GIN (availability_regions);
CREATE INDEX IF NOT EXISTS listings_compliance_tags_idx ON listings USING GIN (compliance_tags);
CREATE INDEX IF NOT EXISTS listings_capability_tags_idx ON listings USING GIN (capability_tags);
CREATE INDEX IF NOT EXISTS listings_input_modalities_idx ON listings USING GIN (input_modalities);
CREATE INDEX IF NOT EXISTS listings_output_modalities_idx ON listings USING GIN (output_modalities);

CREATE TABLE IF NOT EXISTS pending_activations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL,
  event_type text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pending_activations
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS pending_activations_created_at_idx ON pending_activations (created_at);
CREATE INDEX IF NOT EXISTS pending_activations_available_claimed_created_idx
  ON pending_activations (available_at, claimed_at, created_at);

CREATE TABLE IF NOT EXISTS demand_gaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_cluster text NOT NULL,
  sample_queries text[] NOT NULL DEFAULT ARRAY[]::text[],
  query_count integer NOT NULL DEFAULT 1,
  avg_confidence numeric(5,4) NOT NULL DEFAULT 0,
  is_resolved boolean NOT NULL DEFAULT false,
  resolved_by_listing_id uuid,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS demand_gaps_intent_cluster_idx ON demand_gaps (intent_cluster);
CREATE INDEX IF NOT EXISTS demand_gaps_is_resolved_idx ON demand_gaps (is_resolved);
CREATE INDEX IF NOT EXISTS demand_gaps_query_count_idx ON demand_gaps (query_count);
