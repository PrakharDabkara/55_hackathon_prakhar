-- Up Migration
-- Delivery orders (ADR-0031, PR D). Cash on delivery: no money moves in the app. The address is
-- typed text on the order and nowhere else: not on requests, pings or errands, and never sent to a
-- model. The pin is the request's (or errand's) own location, copied here so the shop can open a
-- map once it has accepted. Only adds: the previous release keeps working against it.

CREATE TABLE delivery_orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  shop_id             uuid NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  -- What it came from: a result card (request) or a plan card (errand). Exactly one.
  request_id          uuid REFERENCES requests (id) ON DELETE SET NULL,
  errand_id           uuid REFERENCES errands (id) ON DELETE SET NULL,
  source_id           uuid NOT NULL,
  state               text NOT NULL DEFAULT 'REQUESTED' CHECK (state IN (
    'REQUESTED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'
  )),
  -- [{name, count, pricePaise|null}], worked out by the server from the shop's own answer.
  lines               jsonb NOT NULL,
  items_total_paise   integer CHECK (items_total_paise >= 0),
  unknown_price_count integer NOT NULL DEFAULT 0 CHECK (unknown_price_count >= 0),
  fee_paise           integer CHECK (fee_paise >= 0),
  fee_minutes         integer CHECK (fee_minutes > 0),
  address_text        text NOT NULL CHECK (char_length(address_text) BETWEEN 5 AND 300),
  -- The first word of a name the customer chose to give; the shop sees "Grahak" without it.
  customer_first_name text CHECK (char_length(customer_first_name) BETWEEN 1 AND 30),
  lat                 double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng                 double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  expires_at          timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_orders_one_source CHECK (request_id IS NULL OR errand_id IS NULL)
);

-- One open order per customer, shop and source: pressing "Order bhejo" twice is one order.
CREATE UNIQUE INDEX delivery_orders_one_open
  ON delivery_orders (user_id, shop_id, source_id)
  WHERE state IN ('REQUESTED', 'ACCEPTED', 'OUT_FOR_DELIVERY');
CREATE INDEX delivery_orders_shop ON delivery_orders (shop_id, created_at DESC);
CREATE INDEX delivery_orders_user ON delivery_orders (user_id, created_at DESC);
CREATE INDEX delivery_orders_overdue ON delivery_orders (expires_at) WHERE state = 'REQUESTED';

-- Down Migration
DROP TABLE delivery_orders;
