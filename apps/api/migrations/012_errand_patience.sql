-- Up Migration
-- Day 13 (ADR-0024 amendment): the errand agent can ask shops, wait, ask the user and be resumed
-- from the database. Four new states, the deadlines that wake it, the link to the requests it
-- made, and the exact conversation so a resumed turn is valid for the model provider.

-- `state` is text with a named CHECK (migration 010): widening it is a metadata change.
ALTER TABLE errands DROP CONSTRAINT errands_state_check;
ALTER TABLE errands ADD CONSTRAINT errands_state_check CHECK (
  state IN ('PLANNING', 'WAITING_FOR_SHOPS', 'NEEDS_INPUT', 'PLAN_READY', 'FAILED', 'EXPIRED', 'CANCELLED')
);

ALTER TABLE errands
  -- Overall limit (ERRAND_EXPIRY_MS, 15 min): past it the errand becomes EXPIRED with what it has.
  ADD COLUMN expires_at      timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  -- Total time spent in WAITING_FOR_SHOPS; ERRAND_MAX_WAIT_MS caps it.
  ADD COLUMN waited_ms       integer NOT NULL DEFAULT 0,
  ADD COLUMN wait_started_at timestamptz,
  -- When a waiting errand resumes by itself (the shorter of the resume timer and the wait left).
  ADD COLUMN wait_deadline   timestamptz,
  -- When an unanswered question gives up (ERRAND_ANSWER_TIMEOUT_MS).
  ADD COLUMN answer_deadline timestamptz,
  -- {question, options?} while NEEDS_INPUT.
  ADD COLUMN question        jsonb,
  -- {text} or {timedOut: true}: what the next run tells the model.
  ADD COLUMN answer          jsonb,
  ADD COLUMN questions_asked integer NOT NULL DEFAULT 0,
  -- Why the next run starts: replies | timer | answered | answer_timeout. Cleared once the run has
  -- written its note into the log.
  ADD COLUMN resume_reason   text,
  -- Next number in errand_steps. step_count counts model and tool steps only; notes do not count.
  ADD COLUMN step_seq        integer NOT NULL DEFAULT 0;
UPDATE errands SET step_seq = step_count;

-- Sweeper: live errands by state.
CREATE INDEX errands_live ON errands (state, updated_at)
  WHERE state IN ('PLANNING', 'WAITING_FOR_SHOPS', 'NEEDS_INPUT');

-- The step log now holds the whole conversation. `payload` is the message as the model saw it:
--   model: {role, text?, toolCalls: [{id, name, args, signature?}]}  (signature = Gemini thought signature)
--   tool:  {id, name, result}   (the full result the model was given)
--   note:  {text}               (a user-role message the server added: resume notes, answers, nudges)
ALTER TABLE errand_steps DROP CONSTRAINT errand_steps_kind_check;
ALTER TABLE errand_steps ADD CONSTRAINT errand_steps_kind_check CHECK (kind IN ('model', 'tool', 'note'));
ALTER TABLE errand_steps ADD COLUMN payload jsonb;

-- The requests an errand made with ask_shops. One per item; the agent reads only these.
CREATE TABLE errand_requests (
  errand_id  uuid NOT NULL REFERENCES errands (id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES requests (id) ON DELETE CASCADE,
  item_id    uuid NOT NULL REFERENCES items (id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (errand_id, request_id),
  UNIQUE (errand_id, item_id)
);
-- "Which errands wait for this request?" (the request.updated hook)
CREATE INDEX errand_requests_request ON errand_requests (request_id);

-- Down Migration
DROP TABLE errand_requests;
ALTER TABLE errand_steps DROP COLUMN payload;
DELETE FROM errand_steps WHERE kind = 'note';
ALTER TABLE errand_steps DROP CONSTRAINT errand_steps_kind_check;
ALTER TABLE errand_steps ADD CONSTRAINT errand_steps_kind_check CHECK (kind IN ('model', 'tool'));
DROP INDEX errands_live;
ALTER TABLE errands
  DROP COLUMN step_seq, DROP COLUMN resume_reason, DROP COLUMN questions_asked,
  DROP COLUMN answer, DROP COLUMN question, DROP COLUMN answer_deadline,
  DROP COLUMN wait_deadline, DROP COLUMN wait_started_at, DROP COLUMN waited_ms,
  DROP COLUMN expires_at;
ALTER TABLE errands DROP CONSTRAINT errands_state_check;
ALTER TABLE errands ADD CONSTRAINT errands_state_check CHECK (state IN ('PLANNING', 'PLAN_READY', 'FAILED'));
