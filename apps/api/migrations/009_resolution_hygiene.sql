-- Up Migration
-- Variant defaults as data: a generic word ("pen") that means one usual item of a family. Filled
-- from "defaultFor" in the catalog file by the seed. Resolved after trigram, before embeddings.
CREATE TABLE item_defaults (
  term    text PRIMARY KEY,
  item_id uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE
);

ALTER TABLE search_queries DROP CONSTRAINT search_queries_matched_by_check;
ALTER TABLE search_queries ADD CONSTRAINT search_queries_matched_by_check
  CHECK (matched_by IN ('cache', 'synonym', 'trigram', 'default', 'embedding', 'llm'));

-- Cached answers now say which catalog file they were made for and when they stop being trusted.
-- Rows that already exist get version '' and expire at once: they predate both rules.
ALTER TABLE query_cache
  ADD COLUMN catalog_version text NOT NULL DEFAULT '',
  ADD COLUMN expires_at timestamptz NOT NULL DEFAULT now();

-- Known bad entries: "xyzzy plugh" had been resolved to a plug, and trigram results are free so
-- they are never cached (the first delete is a safety net, the check constraint already forbids it).
DELETE FROM query_cache WHERE method = 'trigram' OR normalised = 'xyzzy plugh';

-- Down Migration
DELETE FROM search_queries WHERE matched_by = 'default';
ALTER TABLE query_cache DROP COLUMN expires_at, DROP COLUMN catalog_version;
ALTER TABLE search_queries DROP CONSTRAINT search_queries_matched_by_check;
ALTER TABLE search_queries ADD CONSTRAINT search_queries_matched_by_check
  CHECK (matched_by IN ('cache', 'synonym', 'trigram', 'embedding', 'llm'));
DROP TABLE item_defaults;
