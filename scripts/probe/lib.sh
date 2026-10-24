# Shared by the Gemini probe scripts (source it, do not run it).
# - which models our deployment, workflows and evals name (a probe must not spend their quota);
# - reading the evals key without showing it (both formats Google issues);
# - redaction of everything that is printed or saved;
# - a fixture path that never overwrites an earlier file.

PROBE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROBE_OUT="${PROBE_OUT_DIR:-$PROBE_ROOT/apps/api/src/testing/observed}"
PROBE_HOST="generativelanguage.googleapis.com"

# Every Gemini model id written in config, not in tests: render.yaml, the workflows, the eval files,
# the apps' source, .env.example and the compose file.
probe_used_models() {
  grep -rhoE "gemini-[a-z0-9.-]+" \
    "$PROBE_ROOT/render.yaml" "$PROBE_ROOT/.github/workflows" "$PROBE_ROOT/evals" \
    "$PROBE_ROOT/apps" "$PROBE_ROOT/.env.example" "$PROBE_ROOT/docker-compose.yml" \
    --exclude='*.test.ts' --exclude='*.test.tsx' --exclude-dir=reports --exclude-dir=.cache \
    --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=observed 2>/dev/null |
    sed -E 's/[.-]+$//' | grep -E '^gemini-[0-9a-z]' | grep -vE '^gemini-(quota|free|list|probe)' | sort -u
}

# Exits 2 unless $1 is a plain model id that none of our config names.
probe_require_unused_model() {
  local model="$1" used
  case "$model" in
    "" | *[!a-z0-9.-]*)
      echo "refused: the model name may only contain a-z, 0-9, '.' and '-'" >&2
      exit 2
      ;;
  esac
  used="$(probe_used_models)"
  if printf '%s\n' "$used" | grep -qxF -- "$model"; then
    echo "refused: $model is named in render.yaml, the workflows, the evals or the app config." >&2
    echo "Models in use: $(printf '%s' "$used" | tr '\n' ' ')" >&2
    exit 2
  fi
}

PROBE_KEY_RE_CLASSIC='^AIza[0-9A-Za-z_-]{35}$'
PROBE_KEY_RE_NEW='^AQ\.[0-9A-Za-z_-]{40,80}$'

# Sets KEY from GEMINI_PROBE_KEY or `read -rs`. $1 = "optional" lets an empty answer through.
probe_read_key() {
  KEY="${GEMINI_PROBE_KEY:-}"
  if [ -z "$KEY" ]; then
    echo "Paste the EVALS PROJECT Gemini key (not production, not local dev). Nothing is shown." >&2
    read -rs KEY || KEY=""
    echo >&2
  fi
  if [ -z "$KEY" ] && [ "${1:-}" = optional ]; then return 0; fi
  if ! [[ "$KEY" =~ $PROBE_KEY_RE_CLASSIC || "$KEY" =~ $PROBE_KEY_RE_NEW ]]; then
    echo "refused: that does not look like a Gemini API key (AIza... or AQ....)" >&2
    exit 2
  fi
}

# Everything that leaves a script passes through here: the key in use, a made-up key, anything
# key-shaped in either format, and the project number Google puts in some error links.
probe_redact() {
  local text
  text=$(cat)
  [ -n "${KEY:-}" ] && text=${text//"$KEY"/[key]}
  [ -n "${FAKE:-}" ] && text=${text//"$FAKE"/[fake-key]}
  printf '%s' "$text" | sed -E 's/AIza[A-Za-z0-9_-]{10,}/[key]/g; s/AQ\.[A-Za-z0-9_-]{10,}/[key]/g; s#projects/[0-9]+#projects/[project]#g; s/"projectNumber": *"[0-9]+"/"projectNumber": "[project]"/g'
}

# <model>__<kind>__<UTC timestamp>.json under the observed directory; never an existing file.
probe_fixture_path() {
  local model="$1" kind="$2" stamp path n=1
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  path="$PROBE_OUT/${model}__${kind}__${stamp}.json"
  while [ -e "$path" ]; do
    n=$((n + 1))
    path="$PROBE_OUT/${model}__${kind}__${stamp}-${n}.json"
  done
  printf '%s' "$path"
}
