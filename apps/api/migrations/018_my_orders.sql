-- Up Migration
-- PR E (ADR-0033). An order's address and pin are cleared 30 days after it reaches a final state,
-- so they may be empty now; the order itself stays. "Saved address" is kept only when the customer
-- ticks "Is pate ko yaad rakhein" on an order: one row per customer, deletable by them.

ALTER TABLE delivery_orders
  ALTER COLUMN address_text DROP NOT NULL,
  ALTER COLUMN lat DROP NOT NULL,
  ALTER COLUMN lng DROP NOT NULL,
  ADD COLUMN address_cleared_at timestamptz;

-- The sweep looks for finished orders that still hold an address.
CREATE INDEX delivery_orders_address_due ON delivery_orders (updated_at)
  WHERE address_text IS NOT NULL AND state IN ('DECLINED', 'EXPIRED', 'DELIVERED', 'CANCELLED');

CREATE TABLE saved_addresses (
  user_id             uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  address_text        text NOT NULL CHECK (char_length(address_text) BETWEEN 5 AND 300),
  customer_first_name text CHECK (char_length(customer_first_name) BETWEEN 1 AND 30),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Down Migration
DROP TABLE saved_addresses;
DROP INDEX delivery_orders_address_due;
-- The columns stay nullable: putting NOT NULL back would fail on cleared rows.
ALTER TABLE delivery_orders DROP COLUMN address_cleared_at;
