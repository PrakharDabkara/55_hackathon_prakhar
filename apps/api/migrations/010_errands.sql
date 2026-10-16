-- Up Migration
-- An errand is one seeker's task ("things for my son's school project"). The agent that plans it
-- runs as a background job; Postgres holds the truth, so a restart loses nothing (ADR-0024).
--
-- `state` is text with a named CHECK, not a Postgres enum: Day 13 adds NEEDS_INPUT and
-- WAITING_FOR_SHOPS by dropping and re-adding the constraint, which is a quick metadata change
-- (ALTER TYPE ... ADD VALUE is the awkward one).
CREATE TABLE errands (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  task           text NOT NULL,
  -- Where the user is. The model never sees it; tools take it from here.
  location       geography(Point, 4326) NOT NULL,
  budget_paise   integer CHECK (budget_paise > 0),
  state          text NOT NULL DEFAULT 'PLANNING',
  version        integer NOT NULL DEFAULT 0,
  -- Rows written to errand_steps so far (model and tool steps together).
  step_count     integer NOT NULL DEFAULT 0,
  tokens_in      integer NOT NULL DEFAULT 0,
  tokens_out     integer NOT NULL DEFAULT 0,
  -- The checked plan, or for FAILED the partial findings ({"partial": true, ...}).
  plan           jsonb,
  failure_reason text,
  -- One run at a time: a run owns the errand until this time and renews it every step. A crashed
  -- run's lease runs out and the job may start again.
  lease_until    timestamptz,
  -- The HTTP request that created it; the agent's logs and ai_calls rows carry it.
  request_id     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT errands_state_check CHECK (state IN ('PLANNING', 'PLAN_READY', 'FAILED'))
);

-- The per-user hourly limit counts recent rows of one user.
CREATE INDEX errands_user_created ON errands (user_id, created_at DESC);

-- The step log: every model call and every tool call, in order. Day 13 resumes from it.
CREATE TABLE errand_steps (
  errand_id      uuid NOT NULL REFERENCES errands (id) ON DELETE CASCADE,
  n              integer NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('model', 'tool')),
  tool_name      text,
  -- model: {calls: [{name, args}], text?}; tool: the arguments the model gave.
  args           jsonb NOT NULL DEFAULT '{}',
  -- A small digest of the result (counts, labels), never the full result.
  result_summary jsonb NOT NULL DEFAULT '{}',
  tokens         integer NOT NULL DEFAULT 0,
  latency_ms     integer NOT NULL DEFAULT 0,
  at             timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (errand_id, n)
);

-- Down Migration
DROP TABLE errand_steps;
DROP TABLE errands;
