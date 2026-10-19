-- Up Migration
-- Delivery v2 (ADR-0039, PR J). The customer can ask for delivery when they search; shops answer
-- with a binding offer; the customer picks one shop and confirms receipt. Only adds (and widens
-- the order states): the previous release keeps working against it. The rules that a ticked
-- request has an address, and that it is the customer's own, are checked in the API, not here.

-- A saved address gets an id so a request can point at it. Still one per customer.
ALTER TABLE saved_addresses ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;

-- "Deliver to me" on a search or an errand. The address is a pointer: it never reaches a shop
-- before the order is ACCEPTED, and forgetting it just empties the pointer.
ALTER TABLE requests
  ADD COLUMN wants_delivery boolean NOT NULL DEFAULT false,
  ADD COLUMN delivery_address_id uuid REFERENCES saved_addresses (id) ON DELETE SET NULL;
ALTER TABLE errands
  ADD COLUMN wants_delivery boolean NOT NULL DEFAULT false,
  ADD COLUMN delivery_address_id uuid REFERENCES saved_addresses (id) ON DELETE SET NULL;

-- How far a shop will deliver, in km. Null means no limit.
ALTER TABLE shops ADD COLUMN delivery_max_km numeric(6, 2) CHECK (delivery_max_km > 0);

-- Orders: a customer note, when the shop set out and the deadline for "Received", who cancelled
-- and why. NOT_CONFIRMED is final: set when the customer never confirms receipt.
ALTER TABLE delivery_orders DROP CONSTRAINT delivery_orders_state_check;
ALTER TABLE delivery_orders ADD CONSTRAINT delivery_orders_state_check CHECK (state IN (
  'REQUESTED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED',
  'NOT_CONFIRMED'
));
ALTER TABLE delivery_orders
  ADD COLUMN note text CHECK (char_length(note) <= 140),
  ADD COLUMN out_for_delivery_at timestamptz,
  ADD COLUMN receive_by timestamptz,
  ADD COLUMN cancelled_by text CHECK (cancelled_by IN ('customer', 'shop')),
  -- A shop's reason is one of three; a customer's words, if any, go in cancel_text only.
  ADD COLUMN cancel_reason text CHECK (cancel_reason IN ('out_of_stock', 'cannot_deliver_now', 'other')),
  ADD COLUMN cancel_text text CHECK (char_length(cancel_text) <= 140);

-- The shop no longer marks an order delivered, so an order already out has no one to finish it:
-- give it the same three hours from now.
UPDATE delivery_orders
   SET out_for_delivery_at = updated_at, receive_by = now() + interval '3 hours'
 WHERE state = 'OUT_FOR_DELIVERY';

-- One live order per request: the customer picks ONE shop. Errands may order from several.
CREATE UNIQUE INDEX delivery_orders_one_per_request
  ON delivery_orders (request_id)
  WHERE request_id IS NOT NULL AND state IN ('REQUESTED', 'ACCEPTED', 'OUT_FOR_DELIVERY');
-- The sweep looks for orders out for delivery whose customer never confirmed.
CREATE INDEX delivery_orders_receive_due ON delivery_orders (receive_by) WHERE state = 'OUT_FOR_DELIVERY';
-- The 30-day address clearing now includes NOT_CONFIRMED.
DROP INDEX delivery_orders_address_due;
CREATE INDEX delivery_orders_address_due ON delivery_orders (updated_at)
  WHERE address_text IS NOT NULL
    AND state IN ('DECLINED', 'EXPIRED', 'DELIVERED', 'CANCELLED', 'NOT_CONFIRMED');

-- Down Migration
DROP INDEX delivery_orders_address_due;
CREATE INDEX delivery_orders_address_due ON delivery_orders (updated_at)
  WHERE address_text IS NOT NULL AND state IN ('DECLINED', 'EXPIRED', 'DELIVERED', 'CANCELLED');
DROP INDEX delivery_orders_receive_due;
DROP INDEX delivery_orders_one_per_request;
-- Orders that ended NOT_CONFIRMED become DELIVERED so the older state list holds.
UPDATE delivery_orders SET state = 'DELIVERED' WHERE state = 'NOT_CONFIRMED';
ALTER TABLE delivery_orders
  DROP COLUMN cancel_text,
  DROP COLUMN cancel_reason,
  DROP COLUMN cancelled_by,
  DROP COLUMN receive_by,
  DROP COLUMN out_for_delivery_at,
  DROP COLUMN note;
ALTER TABLE delivery_orders DROP CONSTRAINT delivery_orders_state_check;
ALTER TABLE delivery_orders ADD CONSTRAINT delivery_orders_state_check CHECK (state IN (
  'REQUESTED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'
));
ALTER TABLE shops DROP COLUMN delivery_max_km;
ALTER TABLE errands DROP COLUMN delivery_address_id, DROP COLUMN wants_delivery;
ALTER TABLE requests DROP COLUMN delivery_address_id, DROP COLUMN wants_delivery;
ALTER TABLE saved_addresses DROP COLUMN id;
