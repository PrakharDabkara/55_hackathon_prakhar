#!/usr/bin/env bash
# Captures what Google REALLY answers when a free-tier Gemini quota is used up, so the retry and
# quota code (modules/ai/quota.ts, failure.ts, client.ts) is tested against the real body.
#
# RUN IT WITH THE EVALS PROJECT KEY ONLY. Never the production key, never the local-dev key.
#   scripts/probe/gemini-quota-probe.sh [model]        (default: gemini-2.5-flash-lite)
#
# What it does, at most 25 tiny generateContent calls in total (about 10 tokens each):
#   1. up to 12 calls back to back inside one minute, to catch the per-minute 429;
#   2. then one call every 5 s until 25 calls in all, to catch the per-day 429. After a per-minute
#      429 it waits the retry delay Google asked for (at most 65 s) first.
#   It stops at the first daily 429, prints the status, error.status, details and headers of each
#   kind of failure, and saves the first of each kind, redacted, to apps/api/src/testing/observed/.
#
# The model must NOT be one our deployment or evals use (render.yaml, the workflows, the eval and
# config files): spending its quota would break something. The key is read with `read -rs` (or
# taken from GEMINI_PROBE_KEY), goes to curl through stdin only, and is stripped from everything
# printed or saved. If the model's real limit is above 25 calls a day you will see no 429 at all:
# the script says so. That is a result, not a failure. Pick a model with a smaller free quota then.
set -u
MODEL="${1:-gemini-2.5-flash-lite}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${PROBE_OUT_DIR:-$ROOT/apps/api/src/testing/observed}"
MAX_CALLS=25
BURST_CALLS=12
HOST="generativelanguage.googleapis.com"

case "$MODEL" in
  "" | *[!a-z0-9.-]*)
    echo "refused: the model name may only contain a-z, 0-9, '.' and '-'" >&2
    exit 2
    ;;
esac

# Refuse a model the deployment, the workflows or the evals name. Whole-word match, so
# gemini-3.5-flash is not refused because gemini-3.5-flash-lite is named (and the reverse).
used=$(grep -rhoE "gemini-[a-z0-9.-]+" \
  "$ROOT/render.yaml" "$ROOT/.github/workflows" "$ROOT/evals" \
  "$ROOT/apps/api/src/config/config.ts" "$ROOT/.env.example" "$ROOT/docker-compose.yml" \
  --exclude-dir=reports --exclude-dir=.cache 2>/dev/null | sort -u)
if printf '%s\n' "$used" | grep -qxF -- "$MODEL"; then
  echo "refused: $MODEL is named in render.yaml, the workflows, the evals or the config." >&2
  echo "Models in use: $(printf '%s' "$used" | tr '\n' ' ')" >&2
  exit 2
fi

KEY="${GEMINI_PROBE_KEY:-}"
if [ -z "$KEY" ]; then
  echo "Paste the EVALS PROJECT Gemini key (not production, not local dev). Nothing is shown." >&2
  read -rs KEY || { echo "no key read" >&2; exit 2; }
  echo >&2
fi
case "$KEY" in
  "" | *[!A-Za-z0-9_-]*) echo "refused: that does not look like an API key" >&2; exit 2 ;;
esac

mkdir -p "$OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Everything that leaves this script passes through here: the key itself, anything key-shaped, and
# the project number Google puts in some error links.
redact() {
  local text
  text=$(cat)
  text=${text//"$KEY"/[key]}
  printf '%s' "$text" | sed -E 's/AIza[A-Za-z0-9_-]{10,}/[key]/g; s#projects/[0-9]+#projects/[project]#g; s/"projectNumber": *"[0-9]+"/"projectNumber": "[project]"/g'
}

BODY='{"contents":[{"parts":[{"text":"Reply with the word ok."}]}],"generationConfig":{"maxOutputTokens":4,"temperature":0}}'
URL="https://$HOST/v1beta/models/$MODEL:generateContent"

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
    local file="$OUT/gemini-$kind.json"
    jq -n --arg model "$MODEL" --arg at "$(date -u +%FT%TZ)" --argjson status "$STATUS" \
      --argjson call "$CALLS" --arg elapsed "$(($(date +%s) - STARTED))" \
      --rawfile headers <(tr -d '\r' <"$TMP/headers" | grep -viE '^(set-cookie|x-goog-api-key|authorization):' | redact) \
      --slurpfile body <(redact <"$TMP/body") \
      '{source:"scripts/probe/gemini-quota-probe.sh", observed:"real", model:$model, observedAt:$at,
        callNumber:$call, secondsIntoRun:($elapsed|tonumber), status:$status,
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
echo "Review $OUT/gemini-*.json before committing; each is redacted, but read it."
