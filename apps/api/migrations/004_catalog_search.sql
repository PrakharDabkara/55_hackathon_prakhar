-- Up Migration
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text NOT NULL UNIQUE,
  name_en    text NOT NULL,
  name_hi    text NOT NULL,
  category   text NOT NULL CHECK (category IN (
    'grocery', 'hardware', 'electrical', 'stationery',
    'mobile_accessories', 'household_kitchen', 'personal_care', 'general_store'
  )),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Every way people write an item: English, Devanagari, Hinglish, misspellings.
-- `term` is stored normalised (see normaliseQuery) and belongs to exactly one item.
CREATE TABLE item_synonyms (
  term    text PRIMARY KEY,
  item_id uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE
);

CREATE INDEX item_synonyms_item ON item_synonyms (item_id);
CREATE INDEX item_synonyms_term_trgm ON item_synonyms USING GIN (term gin_trgm_ops);

-- Learned stock: what a shop has said yes to. It fades at expires_at.
-- Money is integer paise, never a float.
CREATE TABLE shop_stock (
  shop_id           uuid NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  item_id           uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  source            text NOT NULL CHECK (source IN ('ping_yes', 'seed')),
  quantity_hint     text CHECK (quantity_hint IN ('few', 'plenty')),
  price_paise       integer CHECK (price_paise >= 0),
  last_confirmed_at timestamptz NOT NULL,
  expires_at        timestamptz NOT NULL,
  PRIMARY KEY (shop_id, item_id)
);

CREATE INDEX shop_stock_item_expires ON shop_stock (item_id, expires_at);

-- One row per search. Rows with item_id NULL are queries nothing could resolve:
-- they become the labelled eval set for Day 9 (embeddings and LLM fallback).
CREATE TABLE search_queries (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  raw_text   text NOT NULL,
  normalised text NOT NULL,
  item_id    uuid REFERENCES items (id) ON DELETE SET NULL,
  matched_by text CHECK (matched_by IN ('synonym', 'trigram')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX search_queries_unresolved ON search_queries (created_at) WHERE item_id IS NULL;

-- Day 4 left the shops category check NOT VALID. Validate it only if every row passes, so a stray
-- old row on a deployed database cannot fail this migration (then it stays NOT VALID).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM shops
     WHERE NOT (
       cardinality(categories) BETWEEN 1 AND 2
       AND categories <@ ARRAY[
         'grocery', 'hardware', 'electrical', 'stationery',
         'mobile_accessories', 'household_kitchen', 'personal_care', 'general_store'
       ]::text[]
     )
  ) THEN
    ALTER TABLE shops VALIDATE CONSTRAINT shops_categories_valid;
  END IF;
END $$;

-- Down Migration
DROP TABLE search_queries;
DROP TABLE shop_stock;
DROP TABLE item_synonyms;
DROP TABLE items;
