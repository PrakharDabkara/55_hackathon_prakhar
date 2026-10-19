-- Up Migration
-- "Wahan nahi tha" (ADR-0035) hides a shop's learned answer. The shop must still be asked on the
-- next search (ADR-0036), even inside the ping dedupe window, so the stock row remembers when the
-- answer was called wrong. Only adds: the previous release keeps working against it.

ALTER TABLE shop_stock ADD COLUMN invalidated_at timestamptz;

-- Down Migration
ALTER TABLE shop_stock DROP COLUMN invalidated_at;
