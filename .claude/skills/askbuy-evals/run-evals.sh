#!/usr/bin/env bash
# Dispatch eval workflows one at a time and wait for each to finish.
#
#   run-evals.sh resolve                  # the resolve suite
#   run-evals.sh agent                    # agent dev set, fallback model
#   run-evals.sh resolve agent:dev:fallback
#
# A spec is suite[:set[:model]]. Defaults: set=dev, model=fallback (agent only).
# The run id comes from the URL `gh workflow run` prints, never from "the latest run": a latest-run
# lookup can return another run, or nothing. No id means stop.
#
# Exit codes: 0 all succeeded, 1 a run did not succeed, 2 bad usage, 3 dispatch failed,
# 4 gh printed no run id, 5 gave up waiting.
# Env: GH_BIN (default gh), EVAL_REF (branch to run on), POLL_SECS (30), MAX_WAIT_SECS (3600).
set -uo pipefail

GH="${GH_BIN:-gh}"
POLL="${POLL_SECS:-30}"
MAX_WAIT="${MAX_WAIT_SECS:-3600}"

usage() {
  echo "usage: run-evals.sh <suite[:set[:model]]>...   (suite: resolve|agent)" >&2
  exit 2
}
[ "$#" -ge 1 ] || usage

# Check every spec before dispatching anything, so a typo in the second does not leave the first running.
for spec in "$@"; do
  IFS=: read -r suite set model <<<"$spec"
  case "$suite" in resolve | agent) ;; *) echo "unknown suite in '$spec'" >&2; usage ;; esac
  # The agent hold-out set is run by hand by the user and never through this script.
  if [ "${set:-dev}" != "dev" ]; then
    echo "refusing '$spec': only the dev set runs here; the other set is run by hand (see docs/runbook.md)" >&2
    exit 2
  fi
  case "${model:-fallback}" in primary | fallback) ;; *) echo "unknown model in '$spec'" >&2; usage ;; esac
done

run_one() {
  local spec="$1" suite set model args out id status conclusion line start
  IFS=: read -r suite set model <<<"$spec"
  args=(workflow run evals.yml -f "suite=$suite")
  if [ "$suite" = agent ]; then
    args+=(-f "set=${set:-dev}" -f "model=${model:-fallback}")
  fi
  [ -n "${EVAL_REF:-}" ] && args+=(--ref "$EVAL_REF")

  if ! out=$("$GH" "${args[@]}" 2>&1); then
    echo "dispatch of '$spec' failed: $out" >&2
    return 3
  fi
  id=$(grep -oE '/actions/runs/[0-9]+' <<<"$out" | head -1 | grep -oE '[0-9]+')
  if [ -z "$id" ]; then
    echo "no run id in gh's output for '$spec'; not guessing the latest run. gh said: $out" >&2
    return 4
  fi
  echo "$spec: dispatched, run $id"

  start=$SECONDS
  while :; do
    line=$("$GH" run view "$id" --json status,conclusion --jq '.status + " " + (.conclusion // "")' 2>&1) || line=""
    status="${line%% *}"
    conclusion="${line#* }"
    [ "$status" = completed ] && break
    if [ $((SECONDS - start)) -ge "$MAX_WAIT" ]; then
      echo "$spec: run $id still running after ${MAX_WAIT}s; not waiting longer and not dispatching more" >&2
      return 5
    fi
    sleep "$POLL"
  done

  echo "$spec: $conclusion (run $id)"
  [ "$conclusion" = success ]
}

total=$#
n=0
for spec in "$@"; do
  n=$((n + 1))
  run_one "$spec"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    # QUOTA_EXHAUSTED shows up as a failed run: starting the next eval would only spend more quota.
    [ "$n" -lt "$total" ] && echo "not starting the rest ($((total - n)) left) after '$spec' did not succeed" >&2
    exit "$rc"
  fi
done
