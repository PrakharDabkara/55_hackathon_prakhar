-- Up Migration
-- When the shop accepted an order, for the customer's tracking steps (ADR-0042). Only adds.
-- Orders accepted before this release have no time and show none.
ALTER TABLE delivery_orders ADD COLUMN accepted_at timestamptz;

-- Down Migration
ALTER TABLE delivery_orders DROP COLUMN accepted_at;
