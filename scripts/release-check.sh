#!/usr/bin/env bash
# Read-only pre-tag check for a release (docs/release.md). Prints PASS or FAIL per condition and
# exits 1 if any failed. It changes nothing and reads no file: ADMIN_TOKEN comes from the
# environment (read -rs ADMIN_TOKEN && export ADMIN_TOKEN) and goes to curl through stdin, never
# on a command line or into the output.
#   scripts/release-check.sh [base-url]
set -u
B="${1:-${RELEASE_BASE_URL:-https://kahanmilega-api.onrender.com}}"
B="${B%/}"
SECURITY="${RELEASE_CHECK_SECURITY_SCRIPT:-$(dirname "$0")/verify-live-security.sh}"
fail=0

case "$B" in
  https://* | http://localhost* | http://127.0.0.1*) ;;
  *)
    echo "The base URL must be https:// (or http://localhost): the token is sent to it." >&2
    exit 2
    ;;
esac
case "${ADMIN_TOKEN:-}" in
  *[!A-Za-z0-9._~+/=-]*)
    echo "ADMIN_TOKEN has characters this script will not send; use letters, digits and ._~+/=-" >&2
    exit 2
    ;;
esac

report() { # name ok detail
  if [ "$2" = 1 ]; then echo "PASS  $1  ($3)"; else echo "FAIL  $1  ($3)"; fail=1; fi
}
code() { curl -s -m 60 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null; }

# 1. main's last CI run.
ci=$(gh run list --workflow ci.yml --branch main --limit 1 --json status,conclusion 2>/dev/null |
  jq -r '.[0] | "\(.status)/\(.conclusion)"' 2>/dev/null)
[ "$ci" = "completed/success" ] && ok=1 || ok=0
report "main CI green" "$ok" "last run on main: ${ci:-unknown}"

# 2. Open PRs.
open=$(gh pr list --state open --json number 2>/dev/null | jq -r 'length' 2>/dev/null)
[ "${open:-x}" = 0 ] && ok=1 || ok=0
report "no open PRs" "$ok" "${open:-unknown} open"

# 3 to 5. The live site. The free instance sleeps, so wake it first.
echo "Waking $B (the free instance sleeps)..."
for _ in 1 2 3 4 5 6; do [ "$(code "$B/health")" = 200 ] && break; done
for path in /health / /app/; do
  c=$(code "$B$path")
  [ "$c" = 200 ] && ok=1 || ok=0
  report "live $path" "$ok" "HTTP ${c:-none}"
done

# 6. Sign-in protections.
echo "Note: verify-live-security.sh uses this machine's IP budget (the per-IP sign-in limit) (wait 10 minutes before running it again)."
if [ -x "$SECURITY" ]; then
  "$SECURITY" "$B" >/dev/null 2>&1
  rc=$?
  [ "$rc" = 0 ] && ok=1 || ok=0
  detail="exit $rc"
  [ "$rc" = 2 ] && detail="exit 2: IP budget already used, wait 10 minutes"
else
  ok=0
  detail="script not found"
fi
report "verify-live-security.sh" "$ok" "$detail"

# 7 to 9. Admin details: reachable, autopilot on, no failed jobs in 24 h.
if [ -z "${ADMIN_TOKEN:-}" ]; then
  report "/admin/health/details reachable" 0 "ADMIN_TOKEN is not set in the environment"
  report "/admin/health/details autopilot on" 0 "not checked"
  report "/admin/health/details no failed jobs" 0 "not checked"
else
  out=$(printf 'header = "authorization: Bearer %s"\n' "$ADMIN_TOKEN" |
    curl -s -m 60 -K - -w '\n%{http_code}' "$B/admin/health/details" 2>/dev/null)
  status=$(printf '%s' "$out" | tail -n 1)
  body=$(printf '%s' "$out" | sed '$d')
  if [ "$status" = 200 ]; then
    report "/admin/health/details reachable" 1 "HTTP 200"
    on=$(printf '%s' "$body" | jq -r '.autopilot.on' 2>/dev/null)
    [ "$on" = true ] && ok=1 || ok=0
    report "/admin/health/details autopilot on" "$ok" "autopilot.on=${on:-unknown}"
    failed=$(printf '%s' "$body" | jq -r '[.queues[].failedLast24h] | add // 0' 2>/dev/null)
    [ "${failed:-x}" = 0 ] && ok=1 || ok=0
    report "/admin/health/details no failed jobs" "$ok" "failed in 24 h: ${failed:-unknown}"
  else
    d="HTTP ${status:-none}"
    [ "$status" = 404 ] && d="HTTP 404: the server did not accept ADMIN_TOKEN"
    report "/admin/health/details reachable" 0 "$d"
    report "/admin/health/details autopilot on" 0 "not checked"
    report "/admin/health/details no failed jobs" 0 "not checked"
  fi
fi

[ "$fail" = 0 ] && echo "READY to tag." || echo "NOT ready: fix the FAIL lines above."
exit "$fail"
