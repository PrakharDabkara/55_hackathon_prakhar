-- Up Migration
-- Pickup orders for shopping lists (ADR-0055 follow-up). An order is delivery (the default, so every
-- existing row stays what it was) or pickup: the shop packs it, taps READY, and the customer
-- collects it. A pickup never holds the customer's address, pin or name. Only adds and widens.

ALTER TABLE delivery_orders
  ADD COLUMN fulfilment text NOT NULL DEFAULT 'delivery' CHECK (fulfilment IN ('delivery', 'pickup'));

ALTER TABLE delivery_orders DROP CONSTRAINT delivery_orders_state_check;
ALTER TABLE delivery_orders ADD CONSTRAINT delivery_orders_state_check CHECK (state IN (
  'REQUESTED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED',
  'NOT_CONFIRMED', 'READY', 'COLLECTED'
));

-- The database itself refuses to keep who or where on a pickup.
ALTER TABLE delivery_orders ADD CONSTRAINT delivery_orders_pickup_is_anonymous CHECK (
  fulfilment = 'delivery'
  OR (address_text IS NULL AND lat IS NULL AND lng IS NULL AND customer_first_name IS NULL)
);

-- READY is an open state: one open order per customer, shop and source; the 3-hour sweep sees it;
-- the 30-day address clearing includes COLLECTED.
DROP INDEX delivery_orders_one_open;
CREATE UNIQUE INDEX delivery_orders_one_open
  ON delivery_orders (user_id, shop_id, source_id)
  WHERE state IN ('REQUESTED', 'ACCEPTED', 'OUT_FOR_DELIVERY', 'READY');
DROP INDEX delivery_orders_receive_due;
CREATE INDEX delivery_orders_receive_due ON delivery_orders (receive_by)
  WHERE state IN ('OUT_FOR_DELIVERY', 'READY');
DROP INDEX delivery_orders_address_due;
CREATE INDEX delivery_orders_address_due ON delivery_orders (updated_at)
  WHERE address_text IS NOT NULL
    AND state IN ('DECLINED', 'EXPIRED', 'DELIVERED', 'CANCELLED', 'NOT_CONFIRMED', 'COLLECTED');

-- Down Migration
DROP INDEX delivery_orders_address_due;
CREATE INDEX delivery_orders_address_due ON delivery_orders (updated_at)
  WHERE address_text IS NOT NULL
    AND state IN ('DECLINED', 'EXPIRED', 'DELIVERED', 'CANCELLED', 'NOT_CONFIRMED');
DROP INDEX delivery_orders_receive_due;
CREATE INDEX delivery_orders_receive_due ON delivery_orders (receive_by) WHERE state = 'OUT_FOR_DELIVERY';
DROP INDEX delivery_orders_one_open;
CREATE UNIQUE INDEX delivery_orders_one_open
  ON delivery_orders (user_id, shop_id, source_id)
  WHERE state IN ('REQUESTED', 'ACCEPTED', 'OUT_FOR_DELIVERY');
ALTER TABLE delivery_orders DROP CONSTRAINT delivery_orders_pickup_is_anonymous;
UPDATE delivery_orders SET state = 'ACCEPTED' WHERE state = 'READY';
UPDATE delivery_orders SET state = 'DELIVERED' WHERE state = 'COLLECTED';
ALTER TABLE delivery_orders DROP CONSTRAINT delivery_orders_state_check;
ALTER TABLE delivery_orders ADD CONSTRAINT delivery_orders_state_check CHECK (state IN (
  'REQUESTED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED',
  'NOT_CONFIRMED'
));
ALTER TABLE delivery_orders DROP COLUMN fulfilment;
