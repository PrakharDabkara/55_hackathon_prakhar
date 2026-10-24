#!/usr/bin/env bash
# Lists the models this key can call, with ModelService.ListModels. That call costs no generate
# quota. Use the EVALS PROJECT key only (read with `read -rs`, or GEMINI_PROBE_KEY).
#   scripts/probe/gemini-list-models.sh
# Prints every model that supports generateContent or embedContent, marks the ones our config names
# (render.yaml, the workflows, the evals, the apps' source, .env.example), checks that each of those
# exists with the exact spelling we use, and flags anything whose name or description says
# deprecated, retired or legacy. Saves a trimmed, redacted copy as
# apps/api/src/testing/observed/models__list__<timestamp>.json.
set -u
. "$(dirname "$0")/lib.sh"
probe_read_key
mkdir -p "$PROBE_OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Follow the pages (pageSize 1000 is the most the API allows).
token=""
: >"$TMP/models.jsonl"
for _ in 1 2 3 4 5 6 7 8; do
  url="https://$PROBE_HOST/v1beta/models?pageSize=1000"
  [ -n "$token" ] && url="$url&pageToken=$token"
  status=$(printf 'header = "x-goog-api-key: %s"\n' "$KEY" |
    curl -sS -m 60 -K - -o "$TMP/page" -w '%{http_code}' "$url" 2>/dev/null) || status=000
  if [ "$status" != 200 ]; then
    echo "ListModels answered HTTP $status:" >&2
    jq . "$TMP/page" 2>/dev/null | probe_redact >&2
    exit 1
  fi
  jq -c '.models[]?' "$TMP/page" >>"$TMP/models.jsonl"
  token=$(jq -r '.nextPageToken // empty' "$TMP/page")
  [ -z "$token" ] && break
done

probe_used_models >"$TMP/used.txt"
jq -s --rawfile used "$TMP/used.txt" '
  ($used | split("\n") | map(select(length>0))) as $used
  | map({
      id: (.name | sub("^models/"; "")),
      generate: ((.supportedGenerationMethods // []) | index("generateContent") != null),
      embed: ((.supportedGenerationMethods // []) | index("embedContent") != null),
      inputTokens: .inputTokenLimit,
      outputTokens: .outputTokenLimit,
      version: .version,
      flag: ((((.displayName // "") + " " + (.description // "")) | test("deprecat|retire|legacy|shut ?down|no longer"; "i")))
    })
  | map(select(.generate or .embed))
  | map(. + {inUse: (.id as $i | $used | index($i) != null)})
  | sort_by(.id)' "$TMP/models.jsonl" >"$TMP/list.json"

echo "Models that support generateContent (G) or embedContent (E):"
jq -r '.[] | [(if .inUse then "IN USE " else "       "end), .id, ((if .generate then "G" else "-" end) + (if .embed then "E" else "-" end)), ("in:" + (.inputTokens|tostring)), ("out:" + ((.outputTokens // 0)|tostring)), (if .flag then "<-- says deprecated/retired/legacy" else "" end)] | @tsv' "$TMP/list.json" | probe_redact
echo
echo "Models our config names, checked against that list:"
status_all=0
while IFS= read -r id; do
  [ -z "$id" ] && continue
  if jq -e --arg id "$id" 'map(select(.id == $id)) | length > 0' "$TMP/list.json" >/dev/null; then
    flagged=$(jq -r --arg id "$id" 'map(select(.id == $id and .flag)) | length' "$TMP/list.json")
    if [ "$flagged" != 0 ]; then echo "  FLAGGED  $id exists but says deprecated/retired/legacy"; status_all=1; else echo "  OK       $id"; fi
  else
    echo "  MISSING  $id is not in the list (wrong spelling, retired, or not offered to this key)"
    status_all=1
  fi
done <"$TMP/used.txt"
echo
echo "A model with a small free daily limit is not shown by ListModels: check the limits table in AI Studio for the ones marked unused."

file="$(probe_fixture_path models list)"
jq -n --arg at "$(date -u +%FT%TZ)" --slurpfile list "$TMP/list.json" \
  '{source:"scripts/probe/gemini-list-models.sh", observed:"real", kind:"list", observedAt:$at, models:$list[0]}' |
  probe_redact >"$file" && echo "saved $file"
exit $status_all
