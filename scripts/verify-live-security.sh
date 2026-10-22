#!/usr/bin/env bash
# Checks the live site's sign-in protections (ADR-0058). Reads no .env and needs no secret; it uses
# throwaway fake numbers and prints status codes only, never a phone number or a token.
# Run it from one machine, once per 10 minutes: it spends this machine's per-IP budget on purpose.
#   scripts/verify-live-security.sh [base-url]
set -u
B="${1:-https://kahanmilega-api.onrender.com}"
J='content-type: application/json'
fail=0

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
  out=$(curl -s -m 60 -o /dev/null -D - -X POST "$B/auth/otp/request" -H "$J" \
    ${1:+-H "X-Forwarded-For: $1"} -d "{\"phone\":\"$(fake_phone)\"}")
  printf '%s %s' "$(printf '%s' "$out" | head -1 | awk '{print $2}')" \
    "$(printf '%s' "$out" | tr -d '\r' | awk -F': ' 'tolower($1)=="retry-after"{print $2}' | head -1)"
}
report() { # name ok detail
  if [ "$2" = 1 ]; then echo "PASS  $1  ($3)"; else echo "FAIL  $1  ($3)"; fail=1; fi
}

echo "Waking $B (the free instance sleeps)..."
for _ in 1 2 3 4 5 6; do
  [ "$(curl -s -m 30 -o /dev/null -w '%{http_code}' "$B/health")" = 200 ] && break
done

# 1. A non-demo number asks for a code; the inbox must not show it.
read -r first_status _ <<<"$(ask)"
if [ "$first_status" = 429 ]; then
  echo "This machine already used its sign-in budget in the last 10 minutes. Wait 10 minutes and run again."
  exit 2
fi
phone=$(fake_phone)
curl -s -m 60 -o /dev/null -X POST "$B/auth/otp/request" -H "$J" -d "{\"phone\":\"$phone\"}"
inbox=$(curl -s -m 60 -o /dev/null -w '%{http_code}' "$B/dev/otp-inbox?phone=$phone")
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

# 3. Eleven more, each claiming a different client in X-Forwarded-For: spoofing must not reset it.
codes=""; allblocked=1
for i in $(seq 1 11); do
  read -r s _ <<<"$(ask "198.51.100.$i")"
  codes="$codes $s"
  [ "$s" = 429 ] || allblocked=0
done
report "3 spoofed X-Forwarded-For still gets 429" "$allblocked" "statuses:$codes"

# 4. Admin routes answer 404 without a token and with a wrong one.
none=$(curl -s -m 60 -o /dev/null -w '%{http_code}' "$B/admin/ai/stats")
wrong=$(curl -s -m 60 -o /dev/null -w '%{http_code}' "$B/admin/ai/stats" \
  -H "authorization: Bearer $(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')")
report "4 admin route is 404 with no token and a wrong token" \
  "$([ "$none" = 404 ] && [ "$wrong" = 404 ] && echo 1 || echo 0)" "no token $none, wrong token $wrong"

exit $fail
