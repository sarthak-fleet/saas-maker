#!/usr/bin/env bash
# check-domains.sh — availability probe via RDAP + DNS (no API keys)
# Usage:
#   check-domains.sh sld1 sld2 ... --tlds com,io
#   printf '%s\n' phytoproof evidcite | check-domains.sh --tlds com,io
# Output TSV: domain<TAB>status<TAB>source<TAB>note
set -euo pipefail

TLDS="com"
SLDS=()
MAX_PARALLEL=10
TMPDIR_RESULTS=""
PRINT_HEADER=0

usage() {
  cat <<'EOF'
Usage: check-domains.sh [sld ...] [--tlds com,io,co]

Reads SLDs from args or stdin (one per line). Prints TSV:
  domain  status  source  note

status: likely_available | likely_taken | unknown
source: rdap | dns | rdap+dns
EOF
}

tolower() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

cleanup() {
  [[ -n "$TMPDIR_RESULTS" && -d "$TMPDIR_RESULTS" ]] && rm -rf "$TMPDIR_RESULTS"
}
trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tlds)
      TLDS="${2//,/ }"
      shift 2
      ;;
    --header)
      PRINT_HEADER=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      while [[ $# -gt 0 ]]; do SLDS+=("$1"); shift; done
      ;;
    *)
      SLDS+=("$1")
      shift
      ;;
  esac
done

if [[ ${#SLDS[@]} -eq 0 ]] && [[ ! -t 0 ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"
    line="$(printf '%s' "$line" | tr -d '[:space:]')"
    [[ -n "$line" ]] && SLDS+=("$(tolower "$line")")
  done
fi

if [[ ${#SLDS[@]} -eq 0 ]]; then
  usage >&2
  exit 1
fi

TMPDIR_RESULTS="$(mktemp -d)"

DNS_FIRST_TLDS="io co dev app"

rdap_url() {
  local domain="$1"
  local tld="${domain##*.}"
  case "$tld" in
    com) echo "https://rdap.verisign.com/com/v1/domain/$domain" ;;
    net) echo "https://rdap.verisign.com/net/v1/domain/$domain" ;;
    org) echo "https://rdap.org/domain/$domain" ;;
    io)  echo "https://rdap.nic.io/domain/$domain" ;;
    co)  echo "https://rdap.nic.co/domain/$domain" ;;
    dev|app) echo "https://rdap.nic.google/domain/$domain" ;;
    *) echo "" ;;
  esac
}

check_rdap() {
  local domain="$1"
  local url
  url="$(rdap_url "$domain")"
  [[ -n "$url" ]] || { echo "unknown"; return; }
  local code
  code="$(curl -sS -o /dev/null -w "%{http_code}" --max-time 6 "$url" 2>/dev/null || echo "err")"
  case "$code" in
    404) echo "likely_available" ;;
    200) echo "likely_taken" ;;
    *) echo "unknown" ;;
  esac
}

dns_query() {
  local domain="$1"
  local rtype="$2"
  curl -sS -H "Accept: application/dns-json" --max-time 6 \
    "https://cloudflare-dns.com/dns-query?name=${domain}&type=${rtype}" 2>/dev/null || echo '{}'
}

check_dns() {
  local domain="$1"
  local payload dns_status has_answer
  payload="$(dns_query "$domain" "A")"
  dns_status="$(printf '%s' "$payload" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('Status',''))" 2>/dev/null || echo "")"
  has_answer="$(printf '%s' "$payload" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d.get('Answer') else 'no')" 2>/dev/null || echo "no")"
  case "$dns_status" in
    3)
      # NXDOMAIN on A — also check NS (some TLDs park without A)
      local ns_payload ns_status ns_answer
      ns_payload="$(dns_query "$domain" "NS")"
      ns_status="$(printf '%s' "$ns_payload" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('Status',''))" 2>/dev/null || echo "")"
      ns_answer="$(printf '%s' "$ns_payload" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d.get('Answer') else 'no')" 2>/dev/null || echo "no")"
      if [[ "$ns_status" == "0" && "$ns_answer" == "yes" ]]; then
        echo "likely_taken"
      else
        echo "likely_available"
      fi
      ;;
    0)
      if [[ "$has_answer" == "yes" ]]; then
        echo "likely_taken"
      else
        local ns_payload ns_answer
        ns_payload="$(dns_query "$domain" "NS")"
        ns_answer="$(printf '%s' "$ns_payload" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d.get('Answer') else 'no')" 2>/dev/null || echo "no")"
        if [[ "$ns_answer" == "yes" ]]; then
          echo "likely_taken"
        else
          echo "unknown"
        fi
      fi
      ;;
    *) echo "unknown" ;;
  esac
}

tld_prefers_dns_first() {
  local tld="$1"
  [[ " $DNS_FIRST_TLDS " == *" $tld "* ]]
}

probe_domain() {
  local sld="$1"
  local tld="$2"
  local domain="${sld}.${tld}"
  local result="" source="" note=""
  local outfile="$TMPDIR_RESULTS/$(tolower "$domain").tsv"

  if tld_prefers_dns_first "$tld"; then
    result="$(check_dns "$domain")"
    source="dns"
    if [[ "$result" == "unknown" ]]; then
      local rdap_result
      rdap_result="$(check_rdap "$domain")"
      if [[ "$rdap_result" != "unknown" ]]; then
        result="$rdap_result"
        source="rdap+dns"
      fi
    fi
  else
    result="$(check_rdap "$domain")"
    source="rdap"
    if [[ "$result" == "unknown" ]]; then
      local dns_result
      dns_result="$(check_dns "$domain")"
      if [[ "$dns_result" != "unknown" ]]; then
        result="$dns_result"
        source="rdap+dns"
      fi
    fi
  fi

  if [[ "$result" == "likely_taken" && "$source" == *dns* ]]; then
    note="may_be_parked_or_reserved"
  elif [[ "$result" == "likely_available" && "$source" == *dns* ]]; then
    note="nxdomain_only_verify_at_registrar"
  elif [[ "$result" == "unknown" ]]; then
    note="check_manually"
  fi

  printf '%s\t%s\t%s\t%s\n' "$domain" "$result" "$source" "$note" > "$outfile"
}

running=0
for raw in "${SLDS[@]}"; do
  sld="$(tolower "$raw")"
  sld="${sld%%.*}"
  [[ -n "$sld" ]] || continue
  for tld in $TLDS; do
    probe_domain "$sld" "$tld" &
    running=$((running + 1))
    if (( running >= MAX_PARALLEL )); then
      wait -n 2>/dev/null || wait
      running=$((running - 1))
    fi
  done
done
wait

if [[ "$PRINT_HEADER" == "1" ]]; then
  printf '%s\n' "domain	status	source	note"
fi
for f in "$TMPDIR_RESULTS"/*.tsv; do
  [[ -e "$f" ]] || continue
  cat "$f"
done | sort