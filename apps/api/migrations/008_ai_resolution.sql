-- Up Migration
-- Every call to a language model or embedding model writes one row here (ADR-0020). There is
-- deliberately no column for prompt or answer text: tokens, latency and outcome are enough to
-- measure cost, and free-tier prompts must not be kept around.
CREATE TABLE ai_calls (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose       text NOT NULL,
  provider      text NOT NULL,
  model         text NOT NULL,
  input_tokens  integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  latency_ms    integer NOT NULL DEFAULT 0,
  outcome       text NOT NULL CHECK (outcome IN ('ok', 'invalid_output', 'error', 'skipped_breaker')),
  request_id    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_calls_purpose_created ON ai_calls (purpose, created_at);

-- Catalog embeddings (name, Hindi name and synonyms). 768 dimensions: the size of EMBED_DIM; a
-- different size needs a new migration. The hash says what text the vector was made from, so
-- `npm run ai:embed-catalog` only re-embeds items whose text changed.
ALTER TABLE items
  ADD COLUMN embedding vector(768),
  ADD COLUMN embedding_source_hash text;

CREATE INDEX items_embedding_hnsw ON items USING hnsw (embedding vector_cosine_ops);

-- A query answered once by an embedding or the LLM is remembered, so it never costs a call again.
-- item_id set: that item. item_id NULL and options NULL: "nothing fits". options set: ask the
-- customer (question + the item ids to offer).
CREATE TABLE query_cache (
  normalised text PRIMARY KEY,
  item_id    uuid REFERENCES items (id) ON DELETE CASCADE,
  method     text NOT NULL CHECK (method IN ('embedding', 'llm')),
  question   text,
  options    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Pairs the LLM resolved, for a person to review and maybe add to the catalog file. Never applied
-- automatically.
CREATE TABLE suggested_synonyms (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term       text NOT NULL,
  item_id    uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  source     text NOT NULL DEFAULT 'llm',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (term, item_id)
);

-- Which step answered a search. NULL: unresolved.
ALTER TABLE search_queries DROP CONSTRAINT search_queries_matched_by_check;
ALTER TABLE search_queries ADD CONSTRAINT search_queries_matched_by_check
  CHECK (matched_by IN ('cache', 'synonym', 'trigram', 'embedding', 'llm'));

-- Down Migration
ALTER TABLE search_queries DROP CONSTRAINT search_queries_matched_by_check;
ALTER TABLE search_queries ADD CONSTRAINT search_queries_matched_by_check
  CHECK (matched_by IN ('synonym', 'trigram'));
DROP TABLE suggested_synonyms;
DROP TABLE query_cache;
DROP INDEX items_embedding_hnsw;
ALTER TABLE items DROP COLUMN embedding_source_hash, DROP COLUMN embedding;
DROP TABLE ai_calls;
