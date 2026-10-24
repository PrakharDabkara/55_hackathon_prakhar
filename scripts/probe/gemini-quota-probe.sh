#!/usr/bin/env bash
# Captures what Google REALLY answers when a free-tier Gemini quota is used up, so the retry and
# quota code (modules/ai/quota.ts, failure.ts, client.ts) is tested against the real body.
#
# RUN IT WITH THE EVALS PROJECT KEY ONLY. Never the production key, never the local-dev key.
#   scripts/probe/gemini-quota-probe.sh <model>
# Pick the model from scripts/probe/gemini-list-models.sh: available, unused, and with a small free
# daily limit (20 requests a day is ideal). There is no default: a retired model only answers 404.
#
# What it does, at most 25 tiny generateContent calls in total (about 10 tokens each):
#   1. up to 12 calls back to back inside one minute, to catch the per-minute 429;
#   2. then one call every 5 s until 25 calls in all, to catch the per-day 429. After a per-minute
#      429 it waits the retry delay Google asked for (at most 65 s) first.
#   It stops at the first daily 429, prints the status, error.status, details and headers of each
#   kind of failure, and saves the first of each kind, redacted, as
#   apps/api/src/testing/observed/<model>__<kind>__<timestamp>.json. It never overwrites a file.
#
# The model must NOT be one our deployment or evals use: spending its quota would break something.
# The key is read with `read -rs` (or taken from GEMINI_PROBE_KEY), goes to curl through stdin only,
# and is stripped from everything printed or saved. If the model's real limit is above 25 calls a
# day you will see no 429 at all: the script says so. Pick a model with a smaller free quota then.
set -u
. "$(dirname "$0")/lib.sh"
MODEL="${1:-}"
if [ -z "$MODEL" ]; then
  echo "usage: $0 <model>   (see scripts/probe/gemini-list-models.sh)" >&2
  exit 2
fi
MAX_CALLS=25
BURST_CALLS=12

probe_require_unused_model "$MODEL"
probe_read_key

mkdir -p "$PROBE_OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

redact() { probe_redact; }

BODY='{"contents":[{"parts":[{"text":"Reply with the word ok."}]}],"generationConfig":{"maxOutputTokens":4,"temperature":0}}'
URL="https://$PROBE_HOST/v1beta/models/$MODEL:generateContent"

CALLS=0
SAVED=""
STOP=""
STARTED=$(date +%s)

one_call() { # sets STATUS, ERR_STATUS, RETRY_SEC, DAILY
  CALLS=$((CALLS + 1))
  STATUS=$(printf 'header = "x-goog-api-key: %s"\n' "$KEY" |
    curl -sS -m 60 -K - -D "$TMP/headers" -o "$TMP/body" -w '%{http_code}' \
      -H 'content-type: application/json' -d "$BODY" "$URL" 2>"$TMP/curlerr") || STATUS="000"
  ERR_STATUS=$(jq -r '.error.status // empty' "$TMP/body" 2>/dev/null)
  DAILY=0
  if jq -e '[.error.details[]? | .violations[]? | (.quotaId // "")] | any(test("PerDay"; "i"))' \
    "$TMP/body" >/dev/null 2>&1 || jq -e '(.error.message // "") | test("per day|daily"; "i")' \
    "$TMP/body" >/dev/null 2>&1; then DAILY=1; fi
  RETRY_SEC=$(jq -r '[.error.details[]? | .retryDelay? // empty] | first // empty' "$TMP/body" 2>/dev/null | sed -E 's/s$//; s/\..*//')
}

report_failure() { # prints the failure and saves the first of each kind
  local kind="$STATUS"
  [ -n "$ERR_STATUS" ] && kind="$STATUS-$ERR_STATUS"
  [ "$STATUS" = 429 ] && { [ "$DAILY" = 1 ] && kind="429-per-day" || kind="429-per-minute"; }
  echo
  echo "=== call $CALLS ($(($(date +%s) - STARTED)) s in): HTTP $STATUS  error.status=${ERR_STATUS:-none}  kind=$kind"
  echo "--- headers"
  tr -d '\r' <"$TMP/headers" | grep -viE '^(set-cookie|x-goog-api-key|authorization):' | redact
  echo "--- body"
  jq . "$TMP/body" 2>/dev/null | redact || redact <"$TMP/body"
  if ! printf '%s' "$SAVED" | grep -qF -- "|$kind|"; then
    SAVED="$SAVED|$kind|"
    local file
    file="$(probe_fixture_path "$MODEL" "$kind")"
    jq -n --arg model "$MODEL" --arg kind "$kind" --arg at "$(date -u +%FT%TZ)" --argjson status "$STATUS" \
      --argjson call "$CALLS" --arg elapsed "$(($(date +%s) - STARTED))" \
      --rawfile headers <(tr -d '\r' <"$TMP/headers" | grep -viE '^(set-cookie|x-goog-api-key|authorization):' | redact) \
      --slurpfile body <(redact <"$TMP/body") \
      '{source:"scripts/probe/gemini-quota-probe.sh", observed:"real", model:$model, kind:$kind,
        observedAt:$at, callNumber:$call, secondsIntoRun:($elapsed|tonumber), status:$status,
        headers:($headers|split("\n")|map(select(length>0))), body:$body[0]}' >"$file" 2>/dev/null &&
      echo "saved $file" || echo "(could not save a fixture for $kind)"
  fi
}

echo "Probing $MODEL: at most $MAX_CALLS calls ($BURST_CALLS back to back first). Key: not shown."
OKS=0
FAILS=0
while [ "$CALLS" -lt "$MAX_CALLS" ] && [ -z "$STOP" ]; do
  one_call
  if [ "$STATUS" = 200 ]; then
    OKS=$((OKS + 1))
    printf '.'
  else
    FAILS=$((FAILS + 1))
    report_failure
    if [ "$STATUS" = 429 ] && [ "$DAILY" = 1 ]; then STOP="daily 429 reached"; fi
    # Anything but a rate limit or a busy spell will not change by asking again.
    if [ "$STATUS" != 429 ] && [ "$STATUS" != 503 ] && [ "$STATUS" != 500 ]; then STOP="status $STATUS will not clear by retrying"; fi
    if [ -z "$STOP" ] && [ "$STATUS" = 429 ]; then
      wait_s=${RETRY_SEC:-30}
      [ "$wait_s" -gt 65 ] && wait_s=65
      echo "waiting ${wait_s}s as Google asked, then carrying on"
      ${PROBE_SLEEP:-sleep} "$((wait_s + 1))"
    fi
  fi
  if [ -z "$STOP" ] && [ "$CALLS" -ge "$BURST_CALLS" ]; then ${PROBE_SLEEP:-sleep} 5; fi
done

echo
echo "Done: $CALLS calls, $OKS answered, $FAILS failed. ${STOP:-No daily 429 within $MAX_CALLS calls.}"
if [ "$FAILS" = 0 ]; then
  echo "No 429 at all: this model's free limits are above $MAX_CALLS calls a day and $BURST_CALLS a minute."
  echo "Rerun with a model with a smaller free quota that no deployment or eval names."
fi
echo "Review $PROBE_OUT/*.json before committing; each is redacted, but read it."
