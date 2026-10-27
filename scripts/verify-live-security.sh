#!/usr/bin/env bash
# Checks the live site's sign-in protections (ADR-0058). Reads no .env and needs no secret; it uses
# throwaway fake numbers and prints status codes only, never a phone number or a token.
# Run it from one machine, once per 10 minutes: it spends this machine's per-IP budget on purpose.
#   scripts/verify-live-security.sh [--ipv4 | --ipv6 | --both] [base-url]
# --ipv4 / --ipv6 force curl -4 / -6, so a dual-stack machine tests one address family at a time.
# --both runs every check once per family; IPv6 needs its own sign-in budget (10 minutes apart if
# both families share one; about 150 requests in all). Exit 2 means a family was skipped. Without a flag curl picks the family, which may differ per request.
set -u
mode=""
while [ $# -gt 0 ]; do
  case "$1" in
    --ipv4 | --ipv6 | --both) mode="${1#--}" ;;
    -*) echo "unknown option $1" >&2; exit 64 ;;
    *) break ;;
  esac
  shift
done
B="${1:-https://kahanmilega-api.onrender.com}"
J='content-type: application/json'
fail=0
FAM=() # curl address-family flag for the run in progress

# A throwaway number: 98765 plus five random digits. The guard keeps it clear of the demo ranges
# (90000001xx and 90000002xx), whatever the prefix becomes later.
fake_phone() {
  local p
  while :; do
    p=$(printf '98765%05d' $((RANDOM % 100000)))
    case "$p" in 90000001* | 90000002*) continue ;; esac
    printf '%s' "$p"
    return
  done
}
# Prints "<status> <retry-after or ->" for a request-code call; $1 is an optional X-Forwarded-For.
ask() {
  local out
  out=$(curl ${FAM[@]+"${FAM[@]}"} -s -m 60 -o /dev/null -D - -X POST "$B/auth/otp/request" -H "$J" \
    ${1:+-H "X-Forwarded-For: $1"} -d "{\"phone\":\"$(fake_phone)\"}")
  printf '%s %s' "$(printf '%s' "$out" | head -1 | awk '{print $2}')" \
    "$(printf '%s' "$out" | tr -d '\r' | awk -F': ' 'tolower($1)=="retry-after"{print $2}' | head -1)"
}
report() { # name ok detail
  if [ "$2" = 1 ]; then echo "PASS  $1  ($3)"; else echo "FAIL  $1  ($3)"; fail=1; fi
}

run_checks() {
  # 1. A non-demo number asks for a code; the inbox must not show it.
  read -r first_status _ <<<"$(ask)"
  if [ "$first_status" = 429 ]; then
    echo "This machine already used its sign-in budget in the last 10 minutes. Wait 10 minutes and run again."
    return 2
  fi
  phone=$(fake_phone)
  curl ${FAM[@]+"${FAM[@]}"} -s -m 60 -o /dev/null -X POST "$B/auth/otp/request" -H "$J" -d "{\"phone\":\"$phone\"}"
  inbox=$(curl ${FAM[@]+"${FAM[@]}"} -s -m 60 -o /dev/null -w '%{http_code}' "$B/dev/otp-inbox?phone=$phone")
  report "1 inbox for a non-demo number is 404" "$([ "$inbox" = 404 ] && echo 1 || echo 0)" "request $first_status, inbox $inbox"

  # 2. Eleven requests with different numbers: the limit is 10 per IP per 10 minutes. Check 1 used two
  # of them, so the 429s start at the 9th here and the 11th must be one.
  codes=""; last=""; ra=""
  for i in $(seq 1 11); do
    read -r last ra <<<"$(ask)"
    codes="$codes $last"
  done
  report "2 the 11th request is 429 with Retry-After" \
    "$([ "$last" = 429 ] && [ -n "$ra" ] && [ "$ra" != "-" ] && echo 1 || echo 0)" "statuses:$codes, retry-after ${ra:-none}"

  # 3. Spoofing must not reset the limit. First spend whatever budget is left with plain requests (up
  # to 40, until the first 429), so this check does not depend on how check 2 went or on what the
  # limit is; then eleven requests, each claiming a different client in X-Forwarded-For, must all be
  # 429. (Wrong trust-proxy hops: with 2, a spoofed address got its own bucket and every one was 403.)
  plain=0; blocked=0
  for i in $(seq 1 40); do
    read -r s _ <<<"$(ask)"
    plain=$i
    [ "$s" = 429 ] && { blocked=1; break; }
  done
  codes=""; allblocked=$blocked
  if [ "$blocked" = 1 ]; then
    for i in $(seq 1 11); do
      read -r s _ <<<"$(ask "198.51.100.$i")"
      codes="$codes $s"
      [ "$s" = 429 ] || allblocked=0
    done
  fi
  report "3 spoofed X-Forwarded-For still gets 429" "$allblocked" \
    "$([ "$blocked" = 1 ] && echo "first 429 after $plain plain requests; spoofed statuses:$codes" || echo "no 429 in $plain plain requests")"

  # 4. Admin routes answer 404 without a token and with a wrong one.
  none=$(curl ${FAM[@]+"${FAM[@]}"} -s -m 60 -o /dev/null -w '%{http_code}' "$B/admin/ai/stats")
  wrong=$(curl ${FAM[@]+"${FAM[@]}"} -s -m 60 -o /dev/null -w '%{http_code}' "$B/admin/ai/stats" \
    -H "authorization: Bearer $(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')")
  report "4 admin route is 404 with no token and a wrong token" \
    "$([ "$none" = 404 ] && [ "$wrong" = 404 ] && echo 1 || echo 0)" "no token $none, wrong token $wrong"

  return 0
}

wake() {
  echo "Waking $B (the free instance sleeps)..."
  for _ in 1 2 3 4 5 6; do
    [ "$(curl ${FAM[@]+"${FAM[@]}"} -s -m 30 -o /dev/null -w '%{http_code}' "$B/health")" = 200 ] && return 0
  done
  return 1
}

run_all() { # label
  echo "== $1 =="
  if ! wake; then
    # Nothing was checked: never let that look like a pass.
    echo "SKIP  $1: $B did not answer /health over this family"
    skipped=1
    return 0
  fi
  run_checks
  local rc=$?
  [ "$rc" = 2 ] && skipped=1
  return 0
}

skipped=0
case "$mode" in
  both)
    FAM=(-4); run_all "IPv4"
    FAM=(-6); run_all "IPv6"
    ;;
  ipv4) FAM=(-4); run_all "IPv4 only" ;;
  ipv6) FAM=(-6); run_all "IPv6 only" ;;
  *) FAM=(); run_all "curl's choice of family" ;;
esac
# A skipped family means something was not checked: exit 2 unless a check already failed.
[ "$fail" = 0 ] && [ "$skipped" = 1 ] && exit 2
exit $fail
