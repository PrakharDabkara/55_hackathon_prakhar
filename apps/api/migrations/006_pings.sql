-- Up Migration
-- A ping asks one shop "do you have this item?" for one request. In the in-app channel SENT means
-- the ping is visible to the shop. Pings left unanswered when the request ends become NO_REPLY;
-- a late answer is still accepted so it can teach inventory (ADR-0016).
CREATE TABLE pings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    uuid NOT NULL REFERENCES requests (id) ON DELETE CASCADE,
  shop_id       uuid NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES items (id),
  state         text NOT NULL DEFAULT 'QUEUED'
                CHECK (state IN ('QUEUED', 'SENT', 'YES', 'NO', 'NO_REPLY')),
  price_paise   integer CHECK (price_paise >= 0),
  quantity_hint text CHECK (quantity_hint IN ('few', 'plenty')),
  late          boolean NOT NULL DEFAULT false,
  sent_at       timestamptz,
  answered_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, shop_id)
);

-- A shop's open pings, and a request's pings by state.
CREATE INDEX pings_shop_state ON pings (shop_id, state);
CREATE INDEX pings_request_state ON pings (request_id, state);

-- The price the seeker has seen elsewhere (price check). Integer paise, never a float.
ALTER TABLE requests ADD COLUMN target_price_paise integer CHECK (target_price_paise > 0);

-- Down Migration
ALTER TABLE requests DROP COLUMN target_price_paise;
DROP TABLE pings;
