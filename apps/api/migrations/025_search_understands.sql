-- Up Migration
-- ADR-0046: an item the classifier could not file under a kind of shop ("other") is marked
-- uncategorised (its real category stays general_store, so the shop CHECKs and pickers are
-- untouched); a request for it is "misc" and goes to the nearest open shops of any kind.
ALTER TABLE items ADD COLUMN uncategorised boolean NOT NULL DEFAULT false;
ALTER TABLE requests ADD COLUMN misc boolean NOT NULL DEFAULT false;

-- ADR-0047: the catalog word the customer's text matched ("maida" for refined flour), read back
-- from item_synonyms or item_defaults. Never the customer's own text.
ALTER TABLE requests ADD COLUMN matched_alias text;

-- ADR-0048: questions cached before this release were written in Hinglish. Dropping them makes
-- the next search ask again in English. Rows without a question (plain answers) stay.
DELETE FROM query_cache WHERE question IS NOT NULL;

-- Down Migration
ALTER TABLE requests DROP COLUMN matched_alias;
ALTER TABLE requests DROP COLUMN misc;
ALTER TABLE items DROP COLUMN uncategorised;
