-- Up Migration
-- Exact quantity and a delivery offer on a yes, an open/closed switch for shops, and the customer's
-- pickup/delivery choice per shop on an errand (ADR-0031). Only adds: the previous release keeps
-- working against it.

-- A yes may carry an exact quantity and a delivery offer. Amount and unit come together.
ALTER TABLE pings
  ADD COLUMN qty_amount numeric(10, 3) CHECK (qty_amount > 0),
  ADD COLUMN qty_unit text CHECK (qty_unit IN ('kg', 'g', 'l', 'ml', 'piece', 'packet')),
  ADD COLUMN delivers boolean NOT NULL DEFAULT false,
  ADD COLUMN delivery_fee_paise integer CHECK (delivery_fee_paise >= 0),
  ADD COLUMN delivery_minutes integer CHECK (delivery_minutes > 0),
  ADD CONSTRAINT pings_qty_pair CHECK ((qty_amount IS NULL) = (qty_unit IS NULL)),
  ADD CONSTRAINT pings_delivery_details CHECK (delivers OR (delivery_fee_paise IS NULL AND delivery_minutes IS NULL));

-- Learned stock keeps the last quantity and delivery offer a shop gave. Never subtracted.
ALTER TABLE shop_stock
  ADD COLUMN qty_amount numeric(10, 3) CHECK (qty_amount > 0),
  ADD COLUMN qty_unit text CHECK (qty_unit IN ('kg', 'g', 'l', 'ml', 'piece', 'packet')),
  ADD COLUMN delivers boolean NOT NULL DEFAULT false,
  ADD COLUMN delivery_fee_paise integer CHECK (delivery_fee_paise >= 0),
  ADD COLUMN delivery_minutes integer CHECK (delivery_minutes > 0),
  ADD CONSTRAINT shop_stock_qty_pair CHECK ((qty_amount IS NULL) = (qty_unit IS NULL)),
  ADD CONSTRAINT shop_stock_delivery_details CHECK (delivers OR (delivery_fee_paise IS NULL AND delivery_minutes IS NULL));

-- A shop's standing delivery offer (so a yes is one tap) and its open/closed switch. A closed shop
-- is closed until `closed_until` (the end of the day, set by the app); null or past means open.
ALTER TABLE shops
  ADD COLUMN delivers_default boolean NOT NULL DEFAULT false,
  ADD COLUMN default_fee_paise integer CHECK (default_fee_paise >= 0),
  ADD COLUMN default_minutes integer CHECK (default_minutes > 0),
  ADD COLUMN closed_until timestamptz,
  ADD CONSTRAINT shops_default_delivery_details CHECK (delivers_default OR (default_fee_paise IS NULL AND default_minutes IS NULL));

-- The customer's choice of pickup or delivery per shop on a plan: {"<shopId>": "delivery"}.
ALTER TABLE errands ADD COLUMN delivery_modes jsonb NOT NULL DEFAULT '{}';

-- Down Migration
ALTER TABLE errands DROP COLUMN delivery_modes;
ALTER TABLE shops
  DROP CONSTRAINT shops_default_delivery_details,
  DROP COLUMN closed_until,
  DROP COLUMN default_minutes,
  DROP COLUMN default_fee_paise,
  DROP COLUMN delivers_default;
ALTER TABLE shop_stock
  DROP CONSTRAINT shop_stock_delivery_details,
  DROP CONSTRAINT shop_stock_qty_pair,
  DROP COLUMN delivery_minutes,
  DROP COLUMN delivery_fee_paise,
  DROP COLUMN delivers,
  DROP COLUMN qty_unit,
  DROP COLUMN qty_amount;
ALTER TABLE pings
  DROP CONSTRAINT pings_delivery_details,
  DROP CONSTRAINT pings_qty_pair,
  DROP COLUMN delivery_minutes,
  DROP COLUMN delivery_fee_paise,
  DROP COLUMN delivers,
  DROP COLUMN qty_unit,
  DROP COLUMN qty_amount;
