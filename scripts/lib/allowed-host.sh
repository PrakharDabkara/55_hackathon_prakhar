# Shared by scripts/demo.sh and scripts/release-check.sh (source it, do not run it).
# The admin token may only be sent to an exact host:
#   kahanmilega-api.onrender.com  https only (port 443 or none)
#   localhost, 127.0.0.1          http or https, any port
# Anything else exits 2 before a request is made. The URL may only contain letters, digits and
# ._:/- so '@', '?', '#', '\', spaces and percent-escapes cannot disguise another host.

require_allowed_base_url() {
  local url="${1:-}" scheme rest authority host port=""
  case "$url" in
    https://*) scheme=https rest="${url#https://}" ;;
    http://*) scheme=http rest="${url#http://}" ;;
    *) _deny_base_url "$url" ;;
  esac
  case "$rest" in *[!A-Za-z0-9._:/-]*) _deny_base_url "$url" ;; esac
  authority="${rest%%/*}"
  host="${authority%%:*}"
  case "$authority" in *:*) port="${authority#*:}" ;; esac
  case "$port" in *[!0-9]* | 0*) _deny_base_url "$url" ;; esac
  if [ "$authority" != "$host" ] && [ -z "$port" ]; then _deny_base_url "$url"; fi
  case "$host" in
    kahanmilega-api.onrender.com)
      [ "$scheme" = https ] && { [ -z "$port" ] || [ "$port" = 443 ]; } || _deny_base_url "$url"
      ;;
    localhost | 127.0.0.1) ;;
    *) _deny_base_url "$url" ;;
  esac
}

_deny_base_url() {
  echo "Refused: the admin token is only sent to https://kahanmilega-api.onrender.com, localhost or 127.0.0.1 (http or https, any port)." >&2
  exit 2
}
