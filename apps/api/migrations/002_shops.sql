-- Up Migration
CREATE TABLE shops (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  phone      text NOT NULL,
  categories text[] NOT NULL DEFAULT '{}',
  location   geography(Point, 4326) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX shops_location_gist ON shops USING GIST (location);

-- Down Migration
DROP TABLE shops;
