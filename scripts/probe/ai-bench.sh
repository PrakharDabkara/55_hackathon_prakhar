#!/usr/bin/env bash
# Round 3 (C-16a): latency of the short resolve call with the model's own thinking and with the
# minimal setting, on each model. Use the EVALS PROJECT key only. The key is read with `read -rs`
# (or GEMINI_PROBE_KEY), never from a settings file, and an ambient GEMINI_API_KEY (the app's own
# key, if your shell has it) is refused as the bench key. Everything printed is redacted.
#   scripts/probe/ai-bench.sh            # or: npm run ai:bench
# BENCH_ROUNDS (default 20) calls per model and setting.
set -u
. "$(dirname "$0")/lib.sh"
probe_read_key
if [ -n "${GEMINI_API_KEY:-}" ] && [ "$KEY" = "$GEMINI_API_KEY" ]; then
  echo "refused: that is the GEMINI_API_KEY of this shell (the app's key). Use the evals project key." >&2
  exit 2
fi
cd "$PROBE_ROOT" || exit 1
npm run build -w @askbuy/shared -w @askbuy/api >/dev/null 2>&1 || {
  echo "build failed" >&2
  exit 1
}
# The key goes to the script by its own name and is dropped from every other variable.
GEMINI_BENCH_KEY="$KEY" GEMINI_API_KEY= node apps/api/dist/aiBenchMain.js 2>&1 | probe_redact
echo
