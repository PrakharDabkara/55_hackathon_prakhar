-- Up Migration
-- Web Push (ADR-0034). One row per browser a person turned notifications on in. The endpoint is a
-- URL on the browser maker's push service and the keys let us encrypt for that one browser; they
-- are never logged and never sent to a client. Rows go with the user, and when a push service
-- answers 404 or 410 (the browser forgot us). Only adds: the previous release keeps working.

CREATE TABLE push_subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  endpoint        text NOT NULL UNIQUE CHECK (char_length(endpoint) <= 2048),
  p256dh          text NOT NULL CHECK (char_length(p256dh) <= 256),
  auth            text NOT NULL CHECK (char_length(auth) <= 256),
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz
);

CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id, created_at);

-- Down Migration
DROP TABLE push_subscriptions;
