-- Up Migration
-- "Le liya?" (ADR-0035). When a customer taps "Raasta" for a pickup shop, a visit is noted so the
-- app can later ask whether they found the item. The customer's word keeps learned stock honest:
-- "Mil gaya" refreshes it and marks it confirmed by a customer, "Wahan nahi tha" invalidates it and
-- counts against the shop for that item. The visit knows the customer (to ask once and to ask the
-- right person); the stock row never does, so the shop cannot learn who reported. Visits go 30
-- days after the tap. Only adds: the previous release keeps working against it.

ALTER TABLE shop_stock
  ADD COLUMN customer_verified_at timestamptz,
  ADD COLUMN wrong_reports integer NOT NULL DEFAULT 0 CHECK (wrong_reports >= 0);

CREATE TABLE pickup_visits (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  shop_id      uuid NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  item_id      uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  -- What it came from: a result card (request) or a plan card (errand). At most one.
  request_id   uuid REFERENCES requests (id) ON DELETE SET NULL,
  errand_id    uuid REFERENCES errands (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- Shown on the home screen: the reminder push is then not needed.
  asked_at     timestamptz,
  push_sent_at timestamptz,
  answer       text CHECK (answer IN ('found', 'not_there', 'not_gone')),
  answered_at  timestamptz,
  -- Ask at most once per customer, shop and item.
  UNIQUE (user_id, shop_id, item_id),
  CONSTRAINT pickup_visits_one_source CHECK (request_id IS NULL OR errand_id IS NULL)
);

CREATE INDEX pickup_visits_open ON pickup_visits (user_id, created_at) WHERE answer IS NULL;
CREATE INDEX pickup_visits_created ON pickup_visits (created_at);
-- The reminder looks for visits nobody asked about yet.
CREATE INDEX pickup_visits_unreminded ON pickup_visits (created_at)
  WHERE answer IS NULL AND asked_at IS NULL AND push_sent_at IS NULL;

-- "Aaj ki maang" reads today's pings of a shop and today's requests near it.
CREATE INDEX pings_shop_created ON pings (shop_id, created_at);
CREATE INDEX requests_created ON requests (created_at);

-- Down Migration
DROP INDEX requests_created;
DROP INDEX pings_shop_created;
DROP TABLE pickup_visits;
ALTER TABLE shop_stock DROP COLUMN wrong_reports, DROP COLUMN customer_verified_at;
