#!/usr/bin/env bash
# Seeds or resets the demo data on the live site (ADR-0062). Counts only are printed.
#   ADMIN_TOKEN must be in the environment (read -rs ADMIN_TOKEN && export ADMIN_TOKEN). The script
#   reads no file, and never puts the token on a command line.
#   scripts/demo.sh seed|reset [base-url]
set -u
cmd="${1:-}"
B="${2:-${DEMO_BASE_URL:-https://kahanmilega-api.onrender.com}}"
B="${B%/}"

# Match the host exactly: a prefix match would let http://localhost.evil.com receive the token.
case "$B" in
  *@*) bad=1 ;;
  https://*) bad=0 ;;
  http://localhost | http://localhost:[0-9]* | http://localhost/* | http://127.0.0.1 | http://127.0.0.1:[0-9]* | http://127.0.0.1/*) bad=0 ;;
  *) bad=1 ;;
esac
case "$bad" in
  0) ;;
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
