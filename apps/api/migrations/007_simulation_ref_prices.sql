-- Up Migration
-- Reference price: the typical shelf price of the usual pack, in integer paise. AI-estimated and
-- loaded by the catalog seed. Used by the shop simulator now and the "rupees saved" metric later.
-- Nullable so rows from before the seed ran stay valid.
ALTER TABLE items ADD COLUMN ref_price_paise integer CHECK (ref_price_paise > 0);

-- Shops made by the admin simulator. Deleting them removes their users, sessions, pings and stock.
ALTER TABLE shops ADD COLUMN is_simulated boolean NOT NULL DEFAULT false;
CREATE INDEX shops_simulated ON shops (id) WHERE is_simulated;

-- Down Migration
DROP INDEX shops_simulated;
ALTER TABLE shops DROP COLUMN is_simulated;
ALTER TABLE items DROP COLUMN ref_price_paise;
