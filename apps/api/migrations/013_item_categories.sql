-- Up Migration
-- Day 14a (ADR-0025): an item can be carried by shops of more than one kind (fevicol: hardware and
-- stationery). `categories` lists them, the primary first. `category` stays as the primary one, so
-- code that reads a single category keeps working; the check keeps the two in step.
ALTER TABLE items ADD COLUMN categories text[];
UPDATE items SET categories = ARRAY[category];
ALTER TABLE items
  ALTER COLUMN categories SET NOT NULL,
  ADD CONSTRAINT items_categories_valid CHECK (
    cardinality(categories) BETWEEN 1 AND 4
    AND categories[1] = category
    AND categories <@ ARRAY[
      'grocery', 'hardware', 'electrical', 'stationery',
      'mobile_accessories', 'household_kitchen', 'personal_care', 'general_store'
    ]
  );

-- Down Migration
ALTER TABLE items DROP CONSTRAINT items_categories_valid, DROP COLUMN categories;
