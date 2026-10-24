#!/usr/bin/env bash
# Three Gemini failures that cost no quota, captured so the error handling is tested against what
# Google really answers (modules/ai/gemini.ts wrap, failure.ts):
#   1. an invalid key           -> 400 INVALID_ARGUMENT, reason API_KEY_INVALID (a made-up key)
#   2. an unknown model name    -> 404 NOT_FOUND       (needs a real key; the request never runs)
#   3. an oversize input        -> 400 INVALID_ARGUMENT (needs a real key; rejected before the model)
#   scripts/probe/gemini-free-triggers.sh <model>
# <model> is used for 1 and 3. It must be AVAILABLE (a retired model answers 404 and the oversize
# input is never tested; the script warns when that happens) and one that no deployment or eval
# names: take it from scripts/probe/gemini-list-models.sh.
# Use the EVALS PROJECT key for 2 and 3 (read with `read -rs`, or GEMINI_PROBE_KEY; Enter alone
# skips them). It goes to curl through stdin only and is stripped from everything printed or saved.
# 3 sends about 6 MB once. Files: apps/api/src/testing/observed/<model>__<kind>__<timestamp>.json,
# never overwritten.
set -u
. "$(dirname "$0")/lib.sh"
MODEL="${1:-}"
if [ -z "$MODEL" ]; then
  echo "usage: $0 <model>   (see scripts/probe/gemini-list-models.sh)" >&2
  exit 2
fi
FAKE="AIzaSyProbeFakeKeyNotReal000000000000"
probe_require_unused_model "$MODEL"
probe_read_key optional

mkdir -p "$PROBE_OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

trigger() { # kind key model bodyfile [seconds]
  local kind="$1" key="$2" model="$3" bodyfile="$4" limit="${5:-60}" status file
  status=$(printf 'header = "x-goog-api-key: %s"\n' "$key" |
    curl -sS -m "$limit" -K - -D "$TMP/h" -o "$TMP/b" -w '%{http_code}' -H 'content-type: application/json' \
      -d "@$bodyfile" "https://$PROBE_HOST/v1beta/models/$model:generateContent" 2>/dev/null) || status=000
  echo "=== $kind ($model): HTTP $status  error.status=$(jq -r '.error.status // "none"' "$TMP/b" 2>/dev/null)"
  jq . "$TMP/b" 2>/dev/null | probe_redact
  if [ "$kind" = oversize-input ] && [ "$status" = 404 ]; then
    echo "WARNING: $model answered 404 (not available to this key). The oversize input was NOT tested; pick another model."
  fi
  file="$(probe_fixture_path "$model" "$kind")"
  jq -n --arg kind "$kind" --arg model "$model" --arg at "$(date -u +%FT%TZ)" --argjson status "$status" \
    --rawfile headers <(tr -d '\r' <"$TMP/h" | grep -viE '^(set-cookie|x-goog-api-key|authorization):' | probe_redact) \
    --slurpfile body <(probe_redact <"$TMP/b") \
    '{source:"scripts/probe/gemini-free-triggers.sh", observed:"real", kind:$kind, model:$model,
      observedAt:$at, status:$status, headers:($headers|split("\n")|map(select(length>0))), body:$body[0]}' \
    >"$file" && echo "saved $file"
}

echo '{"contents":[{"parts":[{"text":"Reply with the word ok."}]}],"generationConfig":{"maxOutputTokens":4}}' >"$TMP/small.json"
trigger invalid-key "$FAKE" "$MODEL" "$TMP/small.json"
if [ -n "$KEY" ]; then
  trigger unknown-model "$KEY" "gemini-probe-no-such-model" "$TMP/small.json"
  # About 3 million tokens of "1 1 1 ..." against a free-tier limit of 250,000 input tokens a minute (seen: 429).
  { printf '{"contents":[{"parts":[{"text":"'; yes '1' | head -n 3000000 | tr '\n' ' '; printf '"}]}]}'; } >"$TMP/big.json"
  trigger oversize-input "$KEY" "$MODEL" "$TMP/big.json" 60
else
  echo "(no key: skipped unknown-model and oversize-input)"
fi
echo "Review $PROBE_OUT/*.json before committing."
