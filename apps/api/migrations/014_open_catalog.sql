-- Up Migration
-- Open catalog (ADR-0028): the catalog is memory, not a gate. A real product nobody catalogued
-- becomes an item with source 'user' and unverified until a shop says yes. Five more shop and item
-- categories come with it; shops may carry up to three.

-- The item categories: the eight launch ones plus dairy, sabzi_fruit, pooja, medical, bakery_sweets.
ALTER TABLE items DROP CONSTRAINT items_category_check;
ALTER TABLE items ADD CONSTRAINT items_category_check CHECK (category IN (
  'grocery', 'hardware', 'electrical', 'stationery', 'mobile_accessories', 'household_kitchen',
  'personal_care', 'general_store', 'dairy', 'sabzi_fruit', 'pooja', 'medical', 'bakery_sweets'
));
ALTER TABLE items DROP CONSTRAINT items_categories_valid;
ALTER TABLE items ADD CONSTRAINT items_categories_valid CHECK (
  cardinality(categories) BETWEEN 1 AND 4
  AND categories[1] = category
  AND categories <@ ARRAY[
    'grocery', 'hardware', 'electrical', 'stationery', 'mobile_accessories', 'household_kitchen',
    'personal_care', 'general_store', 'dairy', 'sabzi_fruit', 'pooja', 'medical', 'bakery_sweets'
  ]
);

-- Where an item came from. created_at already exists. The creating user is kept for the daily
-- limit and for abuse tracing; it is never sent to a model.
ALTER TABLE items
  ADD COLUMN source text NOT NULL DEFAULT 'catalog' CHECK (source IN ('catalog', 'user')),
  ADD COLUMN unverified boolean NOT NULL DEFAULT false,
  ADD COLUMN created_by uuid REFERENCES users (id) ON DELETE SET NULL;
CREATE INDEX items_user_created ON items (created_by, created_at) WHERE source = 'user';

-- Shops: the same thirteen categories, one to three per shop. A shop with none becomes a kirana.
UPDATE shops SET categories = ARRAY['grocery'] WHERE cardinality(categories) = 0;
ALTER TABLE shops DROP CONSTRAINT shops_categories_valid;
ALTER TABLE shops ADD CONSTRAINT shops_categories_valid CHECK (
  cardinality(categories) BETWEEN 1 AND 3
  AND categories <@ ARRAY[
    'grocery', 'hardware', 'electrical', 'stationery', 'mobile_accessories', 'household_kitchen',
    'personal_care', 'general_store', 'dairy', 'sabzi_fruit', 'pooja', 'medical', 'bakery_sweets'
  ]::text[]
) NOT VALID;
-- Validate it only if every row passes, so a stray old row on a deployed database cannot fail this
-- migration (then it stays NOT VALID), as migration 013 did.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM shops
     WHERE NOT (
       cardinality(categories) BETWEEN 1 AND 3
       AND categories <@ ARRAY[
         'grocery', 'hardware', 'electrical', 'stationery', 'mobile_accessories',
         'household_kitchen', 'personal_care', 'general_store', 'dairy', 'sabzi_fruit', 'pooja',
         'medical', 'bakery_sweets'
       ]::text[]
     )
  ) THEN
    ALTER TABLE shops VALIDATE CONSTRAINT shops_categories_valid;
  END IF;
END $$;

ALTER TABLE search_queries DROP CONSTRAINT search_queries_matched_by_check;
ALTER TABLE search_queries ADD CONSTRAINT search_queries_matched_by_check
  CHECK (matched_by IN ('cache', 'synonym', 'trigram', 'default', 'embedding', 'llm', 'new_item'));

-- One row per attempt to add an item that was created or blocked. It counts the limits (5 new
-- items per errand, 10 per user per day) and records the rule that blocked, never the text.
CREATE TABLE new_item_attempts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  errand_id  uuid REFERENCES errands (id) ON DELETE SET NULL,
  outcome    text NOT NULL CHECK (outcome IN ('created', 'blocked')),
  rule       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX new_item_attempts_user_created ON new_item_attempts (user_id, created_at);
CREATE INDEX new_item_attempts_errand ON new_item_attempts (errand_id) WHERE errand_id IS NOT NULL;

-- Down Migration
DROP TABLE new_item_attempts;
ALTER TABLE search_queries DROP CONSTRAINT search_queries_matched_by_check;
UPDATE search_queries SET matched_by = NULL WHERE matched_by = 'new_item';
ALTER TABLE search_queries ADD CONSTRAINT search_queries_matched_by_check
  CHECK (matched_by IN ('cache', 'synonym', 'trigram', 'default', 'embedding', 'llm'));
ALTER TABLE shops DROP CONSTRAINT shops_categories_valid;
UPDATE shops SET categories = ARRAY['grocery'] WHERE NOT categories <@ ARRAY[
  'grocery', 'hardware', 'electrical', 'stationery', 'mobile_accessories', 'household_kitchen',
  'personal_care', 'general_store'
]::text[];
ALTER TABLE shops ADD CONSTRAINT shops_categories_valid CHECK (
  cardinality(categories) BETWEEN 1 AND 2
  AND categories <@ ARRAY[
    'grocery', 'hardware', 'electrical', 'stationery', 'mobile_accessories', 'household_kitchen',
    'personal_care', 'general_store'
  ]::text[]
) NOT VALID;
DROP INDEX items_user_created;
DELETE FROM items WHERE source = 'user';
ALTER TABLE items DROP COLUMN created_by, DROP COLUMN unverified, DROP COLUMN source;
ALTER TABLE items DROP CONSTRAINT items_categories_valid;
ALTER TABLE items ADD CONSTRAINT items_categories_valid CHECK (
  cardinality(categories) BETWEEN 1 AND 4
  AND categories[1] = category
  AND categories <@ ARRAY[
    'grocery', 'hardware', 'electrical', 'stationery', 'mobile_accessories', 'household_kitchen',
    'personal_care', 'general_store'
  ]
);
ALTER TABLE items DROP CONSTRAINT items_category_check;
ALTER TABLE items ADD CONSTRAINT items_category_check CHECK (category IN (
  'grocery', 'hardware', 'electrical', 'stationery', 'mobile_accessories', 'household_kitchen',
  'personal_care', 'general_store'
));
