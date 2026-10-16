-- Up Migration
-- ai_calls.outcome now says why a call failed, in the same words the logs use (timeout, http,
-- network, invalid_output, breaker, other), so "AI unavailable" can be told apart in SQL. The old
-- 'error' (no detail kept) becomes 'other'; 'skipped_breaker' becomes 'breaker'.
ALTER TABLE ai_calls DROP CONSTRAINT ai_calls_outcome_check;
UPDATE ai_calls SET outcome = 'other' WHERE outcome = 'error';
UPDATE ai_calls SET outcome = 'breaker' WHERE outcome = 'skipped_breaker';
ALTER TABLE ai_calls ADD CONSTRAINT ai_calls_outcome_check
  CHECK (outcome IN ('ok', 'timeout', 'http', 'network', 'invalid_output', 'breaker', 'other'));

-- Down Migration
ALTER TABLE ai_calls DROP CONSTRAINT ai_calls_outcome_check;
UPDATE ai_calls SET outcome = 'error' WHERE outcome IN ('timeout', 'http', 'network', 'other');
UPDATE ai_calls SET outcome = 'skipped_breaker' WHERE outcome = 'breaker';
ALTER TABLE ai_calls ADD CONSTRAINT ai_calls_outcome_check
  CHECK (outcome IN ('ok', 'invalid_output', 'error', 'skipped_breaker'));
