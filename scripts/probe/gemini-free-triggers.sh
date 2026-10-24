#!/usr/bin/env bash
# Three Gemini failures that cost no quota, captured so the error handling is tested against what
# Google really answers (modules/ai/gemini.ts wrap, failure.ts):
#   1. an invalid key           -> 400 API_KEY_INVALID (uses a made-up key; needs no real one)
#   2. an unknown model name    -> 404 NOT_FOUND       (needs a real key; the request never runs)
#   3. an oversize input        -> 400 INVALID_ARGUMENT (needs a real key; rejected before the model)
# Use the EVALS PROJECT key for 2 and 3 (read with `read -rs`, or GEMINI_PROBE_KEY). It goes to curl
# through stdin only and is stripped from everything printed or saved. 3 sends about 6 MB once.
#   scripts/probe/gemini-free-triggers.sh
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${PROBE_OUT_DIR:-$ROOT/apps/api/src/testing/observed}"
HOST="generativelanguage.googleapis.com"
MODEL="${PROBE_MODEL:-gemini-2.5-flash-lite}"
FAKE="AIzaSyProbeFakeKeyNotReal000000000000"

KEY="${GEMINI_PROBE_KEY:-}"
if [ -z "$KEY" ]; then
  echo "Paste the EVALS PROJECT Gemini key for triggers 2 and 3 (Enter alone skips them). Nothing is shown." >&2
  read -rs KEY || KEY=""
  echo >&2
fi
# Both formats Google issues: the classic AIza + 35 characters, and the newer AQ. + 40 to 80.
if [ -n "$KEY" ] && ! [[ "$KEY" =~ ^AIza[0-9A-Za-z_-]{35}$ || "$KEY" =~ ^AQ\.[0-9A-Za-z_-]{40,80}$ ]]; then
  echo "refused: that does not look like a Gemini API key (AIza... or AQ....)" >&2
  exit 2
fi

mkdir -p "$OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

redact() {
  local text
  text=$(cat)
  [ -n "$KEY" ] && text=${text//"$KEY"/[key]}
  text=${text//"$FAKE"/[fake-key]}
  printf '%s' "$text" | sed -E 's/AIza[A-Za-z0-9_-]{10,}/[key]/g; s/AQ\.[A-Za-z0-9_-]{10,}/[key]/g; s#projects/[0-9]+#projects/[project]#g'
}

trigger() { # name key model bodyfile
  local name="$1" key="$2" model="$3" bodyfile="$4" status
  status=$(printf 'header = "x-goog-api-key: %s"\n' "$key" |
    curl -sS -m 90 -K - -D "$TMP/h" -o "$TMP/b" -w '%{http_code}' -H 'content-type: application/json' \
      -d "@$bodyfile" "https://$HOST/v1beta/models/$model:generateContent" 2>/dev/null) || status=000
  echo "=== $name: HTTP $status  error.status=$(jq -r '.error.status // "none"' "$TMP/b" 2>/dev/null)"
  jq . "$TMP/b" 2>/dev/null | redact
  jq -n --arg name "$name" --arg model "$model" --arg at "$(date -u +%FT%TZ)" --argjson status "$status" \
    --rawfile headers <(tr -d '\r' <"$TMP/h" | grep -viE '^(set-cookie|x-goog-api-key|authorization):' | redact) \
    --slurpfile body <(redact <"$TMP/b") \
    '{source:"scripts/probe/gemini-free-triggers.sh", observed:"real", trigger:$name, model:$model,
      observedAt:$at, status:$status, headers:($headers|split("\n")|map(select(length>0))), body:$body[0]}' \
    >"$OUT/gemini-free-$name.json" && echo "saved $OUT/gemini-free-$name.json"
}

echo '{"contents":[{"parts":[{"text":"Reply with the word ok."}]}],"generationConfig":{"maxOutputTokens":4}}' >"$TMP/small.json"
trigger invalid-key "$FAKE" "$MODEL" "$TMP/small.json"
if [ -n "$KEY" ]; then
  trigger unknown-model "$KEY" "gemini-probe-no-such-model" "$TMP/small.json"
  # About 3 million tokens of "1 1 1 ..." against a limit of about 1 million.
  { printf '{"contents":[{"parts":[{"text":"'; yes '1' | head -n 3000000 | tr '\n' ' '; printf '"}]}]}'; } >"$TMP/big.json"
  trigger oversize-input "$KEY" "$MODEL" "$TMP/big.json"
else
  echo "(no key: skipped unknown-model and oversize-input)"
fi
echo "Review $OUT/gemini-free-*.json before committing."
