-- Up Migration
-- Demo data (ADR-0062). POST /admin/demo/seed marks every user and shop it makes or adopts, so a
-- reset and a person reading the table can tell them from real ones at a glance. Only adds: the
-- previous release keeps working against it.
ALTER TABLE users ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE shops ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
CREATE INDEX shops_demo ON shops (id) WHERE is_demo;
CREATE INDEX users_demo ON users (id) WHERE is_demo;

-- Down Migration
DROP INDEX users_demo;
DROP INDEX shops_demo;
ALTER TABLE shops DROP COLUMN is_demo;
ALTER TABLE users DROP COLUMN is_demo;
