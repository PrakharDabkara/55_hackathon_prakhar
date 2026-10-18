-- Up Migration
-- Optional photos on both sides (ADR-0030): a customer's picture of what they want, and a shop's
-- picture of what it has. Stored in Postgres, re-encoded and stripped of metadata by the server.
-- A customer photo links to the request it was asked with; a shop photo links to the ping it
-- answered. `errand_id` and `errand_label` hold a photo given to a checklist item until the agent
-- opens the request for that item.
CREATE TABLE photos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role          text NOT NULL CHECK (role IN ('request', 'answer')),
  data          bytea NOT NULL,
  mime          text NOT NULL CHECK (mime = 'image/jpeg'),
  size          integer NOT NULL CHECK (size > 0),
  request_id    uuid REFERENCES requests (id) ON DELETE CASCADE,
  ping_id       uuid REFERENCES pings (id) ON DELETE CASCADE,
  errand_id     uuid REFERENCES errands (id) ON DELETE CASCADE,
  errand_label  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT photos_links CHECK (
    (role = 'request' AND ping_id IS NULL)
    OR (role = 'answer' AND request_id IS NULL AND errand_id IS NULL)
  )
);

-- The daily limit counts one owner's recent rows; the sweeper looks at links and age.
CREATE INDEX photos_owner_created ON photos (owner_user_id, created_at);
CREATE INDEX photos_created ON photos (created_at);
-- One photo per request and per answer.
CREATE UNIQUE INDEX photos_request ON photos (request_id) WHERE request_id IS NOT NULL;
CREATE UNIQUE INDEX photos_ping ON photos (ping_id) WHERE ping_id IS NOT NULL;
CREATE INDEX photos_errand ON photos (errand_id) WHERE errand_id IS NOT NULL;

-- Down Migration
DROP TABLE photos;
