-- Up Migration
-- A request is one seeker's ask for one item. Its state machine lives in
-- src/modules/requests/stateMachine.ts; the database keeps the current state and the deadline
-- (ADR-0015). `version` counts transitions.
CREATE TABLE requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  item_id         uuid NOT NULL REFERENCES items (id),
  raw_query       text NOT NULL,
  quantity        jsonb,
  -- Stored as sent for now; Day 16 rounds it before shops see it.
  location        geography(Point, 4326) NOT NULL,
  radius_m        integer NOT NULL CHECK (radius_m BETWEEN 1 AND 5000),
  state           text NOT NULL DEFAULT 'OPEN'
                  CHECK (state IN ('OPEN', 'PINGING', 'ANSWERED', 'EXPIRED', 'CLOSED')),
  version         integer NOT NULL DEFAULT 0,
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  idempotency_key text,
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX requests_user_created ON requests (user_id, created_at DESC);
-- The sweeper looks for live requests past their deadline.
CREATE INDEX requests_overdue ON requests (expires_at) WHERE state IN ('PINGING', 'ANSWERED');

-- Audit trail: one row per transition. Gives "time to first yes" later.
CREATE TABLE request_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES requests (id) ON DELETE CASCADE,
  from_state text NOT NULL,
  to_state   text NOT NULL,
  event      text NOT NULL,
  reason     text,
  at         timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX request_events_request ON request_events (request_id, at);

-- Down Migration
DROP TABLE request_events;
DROP TABLE requests;
