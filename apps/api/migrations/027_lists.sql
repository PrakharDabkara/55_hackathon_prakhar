-- Up Migration
-- Shopping lists (ADR-0055, PR U1). A customer sorts up to 10 typed lines (DRAFT), sends the list
-- (OPEN), and each nearby shop gets ONE parchi with the lines it could sell. Shops answer per line.
-- Only adds: the previous release keeps working against it.

CREATE TABLE shopping_lists (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- DRAFT: sorted, not sent. OPEN: listening. FULL: enough shops answered; answers stay binding.
  -- ORDERED, STOPPED (the customer stopped asking), EXPIRED (the 15 minutes passed): not live.
  state               text NOT NULL DEFAULT 'DRAFT'
                      CHECK (state IN ('DRAFT', 'OPEN', 'FULL', 'ORDERED', 'STOPPED', 'EXPIRED')),
  -- Set when the list is sent.
  location            geography(Point, 4326),
  radius_m            integer CHECK (radius_m > 0),
  wants_delivery      boolean NOT NULL DEFAULT false,
  delivery_address_id uuid REFERENCES saved_addresses (id) ON DELETE SET NULL,
  -- A draft is forgotten after an hour; a sent list lives LIST_TTL_MIN minutes.
  expires_at          timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz,
  closed_at           timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shopping_lists_sent_has_place CHECK (state = 'DRAFT' OR location IS NOT NULL)
);
CREATE INDEX shopping_lists_user ON shopping_lists (user_id, created_at DESC);
-- The sweeper looks for lists past their deadline.
CREATE INDEX shopping_lists_due ON shopping_lists (expires_at) WHERE state IN ('DRAFT', 'OPEN', 'FULL');

CREATE TABLE list_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id       uuid NOT NULL REFERENCES shopping_lists (id) ON DELETE CASCADE,
  position      smallint NOT NULL CHECK (position BETWEEN 0 AND 9),
  -- The customer's cleaned line (trimmed, at most 80 characters).
  text          text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 80),
  status        text NOT NULL CHECK (status IN ('item', 'ambiguous', 'other', 'refused')),
  -- Set for a catalog item. An "other" line has no item: it is text only (ADR-0055).
  item_id       uuid REFERENCES items (id),
  matched_alias text,
  quantity      jsonb,
  -- An ambiguous line: the question and up to 3 item ids (until the customer chooses).
  question      text,
  options       jsonb,
  as_typed      boolean NOT NULL DEFAULT false,
  refused_reason text CHECK (refused_reason IN ('blocked', 'unclear')),
  UNIQUE (list_id, position),
  CONSTRAINT list_lines_item_has_item CHECK (status <> 'item' OR item_id IS NOT NULL),
  CONSTRAINT list_lines_refused_has_reason CHECK ((status = 'refused') = (refused_reason IS NOT NULL))
);

-- One parchi per shop per list.
CREATE TABLE list_pings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id            uuid NOT NULL REFERENCES shopping_lists (id) ON DELETE CASCADE,
  shop_id            uuid NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  state              text NOT NULL DEFAULT 'SENT' CHECK (state IN ('SENT', 'ANSWERED', 'NO_REPLY')),
  sent_at            timestamptz NOT NULL DEFAULT now(),
  answered_at        timestamptz,
  -- One answer per shop per list: whether it will bring it, and ONE fee for the whole list.
  can_deliver        boolean NOT NULL DEFAULT false,
  delivery_fee_paise integer CHECK (delivery_fee_paise >= 0),
  UNIQUE (list_id, shop_id),
  CONSTRAINT list_pings_fee_needs_delivery CHECK (can_deliver OR delivery_fee_paise IS NULL)
);
CREATE INDEX list_pings_shop ON list_pings (shop_id, state);

-- The lines a parchi carries, and the shop's answer to each (have is null until it answers).
CREATE TABLE list_ping_lines (
  list_ping_id uuid NOT NULL REFERENCES list_pings (id) ON DELETE CASCADE,
  line_id      uuid NOT NULL REFERENCES list_lines (id) ON DELETE CASCADE,
  have         boolean,
  price_paise  integer CHECK (price_paise >= 0),
  PRIMARY KEY (list_ping_id, line_id),
  CONSTRAINT list_ping_lines_price_with_have CHECK (
    (have IS TRUE) = (price_paise IS NOT NULL)
  )
);
CREATE INDEX list_ping_lines_line ON list_ping_lines (line_id);

-- A list is a third source of orders, next to a search (request) and an errand.
ALTER TABLE delivery_orders ADD COLUMN list_id uuid REFERENCES shopping_lists (id) ON DELETE SET NULL;
ALTER TABLE delivery_orders DROP CONSTRAINT delivery_orders_one_source;
ALTER TABLE delivery_orders ADD CONSTRAINT delivery_orders_one_source CHECK (
  (request_id IS NOT NULL)::int + (errand_id IS NOT NULL)::int + (list_id IS NOT NULL)::int <= 1
);

-- Down Migration
ALTER TABLE delivery_orders DROP CONSTRAINT delivery_orders_one_source;
ALTER TABLE delivery_orders ADD CONSTRAINT delivery_orders_one_source CHECK (request_id IS NULL OR errand_id IS NULL);
ALTER TABLE delivery_orders DROP COLUMN list_id;
DROP TABLE list_ping_lines;
DROP TABLE list_pings;
DROP TABLE list_lines;
DROP TABLE shopping_lists;
