#!/usr/bin/env bash
# Restarts the self-hosted runner when it says "online, idle" but runs wait for it (the Oct 23
# incident: ~2 h without taking a job). Run by the askbuy-runner-watchdog user timer every 5 minutes.
# Rules: a run queued over 10 minutes AND the runner online and not busy -> restart the service;
# at most one restart per 30 minutes. Every action goes to the log. It handles no token: `gh` uses
# its own stored login, and the only privileged call is `sudo -n systemctl restart <service>`.
set -u
REPO="${WATCHDOG_REPO:-PrakharDabkara/55_hackathon_prakhar}"
SERVICE="${RUNNER_SERVICE:-actions.runner.PrakharDabkara-55_hackathon_prakhar.fiftyfive-ThinkPad-L14-Gen-5.service}"
LOG="${WATCHDOG_LOG:-$HOME/kahan-tools/watchdog.log}"
STATE="${WATCHDOG_STATE:-$HOME/kahan-tools/watchdog.last-restart}"
NOW="${WATCHDOG_NOW:-$(date +%s)}"
QUEUE_LIMIT=$((10 * 60))
COOLDOWN=$((30 * 60))

mkdir -p "$(dirname "$LOG")" "$(dirname "$STATE")"
log() { printf '%s %s\n' "$(date -u -d "@$NOW" +%FT%TZ)" "$*" >>"$LOG"; }

runners=$(gh api "repos/$REPO/actions/runners" 2>/dev/null) || { log "gh runners call failed; nothing done"; exit 0; }
runs=$(gh run list --repo "$REPO" --status queued --limit 50 --json createdAt 2>/dev/null) || { log "gh run list failed; nothing done"; exit 0; }

# Oldest queued run, in seconds. Empty when nothing is queued.
oldest=$(printf '%s' "$runs" | jq -r '[.[].createdAt | fromdateiso8601] | min // empty' 2>/dev/null) || { log "unreadable run list; nothing done"; exit 0; }
[ -z "$oldest" ] && exit 0
waited=$((NOW - oldest))
[ "$waited" -le "$QUEUE_LIMIT" ] && exit 0

# An idle runner: online and not busy (any one of them is enough to point at a stuck listener).
idle=$(printf '%s' "$runners" | jq -r '[.runners[] | select(.status == "online" and .busy == false)] | length' 2>/dev/null) || idle=0
if [ "${idle:-0}" -lt 1 ]; then
  log "queued ${waited}s but the runner is busy or offline; no restart"
  exit 0
fi

last=0
[ -r "$STATE" ] && last=$(cat "$STATE" 2>/dev/null)
case "$last" in '' | *[!0-9]*) last=0 ;; esac
if [ $((NOW - last)) -lt "$COOLDOWN" ]; then
  log "skip: queued ${waited}s, runner idle, but restarted $((NOW - last))s ago (limit 30 min)"
  exit 0
fi

log "restart: queued ${waited}s while the runner is online and idle; restarting $SERVICE"
if sudo -n systemctl restart "$SERVICE" >>"$LOG" 2>&1; then
  printf '%s' "$NOW" >"$STATE"
  log "restart done"
else
  printf '%s' "$NOW" >"$STATE"
  log "restart FAILED (is the sudoers snippet installed?)"
fi
exit 0
