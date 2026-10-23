#!/usr/bin/env bash
# Seeds or resets the demo data on the live site (ADR-0062). Counts only are printed.
#   ADMIN_TOKEN must be in the environment (read -rs ADMIN_TOKEN && export ADMIN_TOKEN). The script
#   reads no file, and never puts the token on a command line.
#   scripts/demo.sh seed|reset [base-url]
set -u
cmd="${1:-}"
B="${2:-${DEMO_BASE_URL:-https://kahanmilega-api.onrender.com}}"
B="${B%/}"

# The token goes only to an allowlisted host (scripts/lib/allowed-host.sh).
. "$(dirname "$0")/lib/allowed-host.sh"
require_allowed_base_url "$B"
case "${ADMIN_TOKEN:-}" in
  *[!A-Za-z0-9._~+/=-]*)
    echo "ADMIN_TOKEN has characters this script will not send; use letters, digits and ._~+/=-" >&2
    exit 2
    ;;
esac

case "$cmd" in seed | reset) ;; *)
  echo "usage: scripts/demo.sh seed|reset [base-url]" >&2
  exit 2
  ;;
esac
if [ -z "${ADMIN_TOKEN:-}" ]; then
  echo "Set ADMIN_TOKEN in this shell first: read -rs ADMIN_TOKEN && export ADMIN_TOKEN" >&2
  exit 2
fi

echo "Waking $B (the free instance sleeps)..." >&2
for _ in 1 2 3 4 5 6; do
  [ "$(curl -s -m 30 -o /dev/null -w '%{http_code}' "$B/health")" = 200 ] && break
done

# The header goes in through stdin (curl -K -), so the token is never in the process list.
out=$(printf 'header = "authorization: Bearer %s"\n' "$ADMIN_TOKEN" |
  curl -s -m 120 -K - -X POST -w '\n%{http_code}' "$B/admin/demo/$cmd")
status=$(printf '%s' "$out" | tail -n 1)
body=$(printf '%s' "$out" | sed '$d')

case "$status" in
  200) printf '%s\n' "$body" ;;
  404)
    echo "404: the server did not accept ADMIN_TOKEN (wrong value, none set on Render, or not deployed yet)." >&2
    exit 1
    ;;
  *)
    echo "Failed with HTTP $status" >&2
    exit 1
    ;;
esac
