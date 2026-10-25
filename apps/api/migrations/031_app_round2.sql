-- Up Migration
-- App round 2. fanned_out_at: when the shops of a request were chosen and shown the ping (also when
-- there were none), so the customer's screen never says "no shops" before the server knows.
-- ask_all: the customer pressed "Ask shops now", so shops that already remembered the item are
-- asked too. picked: the customer chose the item from the question, so it is the request's item.
-- Only adds: the previous release keeps working against it.
ALTER TABLE requests ADD COLUMN fanned_out_at timestamptz;
ALTER TABLE requests ADD COLUMN ask_all boolean NOT NULL DEFAULT false;
ALTER TABLE requests ADD COLUMN picked boolean NOT NULL DEFAULT false;
-- Every request that exists now was settled by the release that made it.
UPDATE requests SET fanned_out_at = created_at;

-- Down Migration
ALTER TABLE requests DROP COLUMN picked;
ALTER TABLE requests DROP COLUMN ask_all;
ALTER TABLE requests DROP COLUMN fanned_out_at;
