#!/usr/bin/env bash
# favicon-and-canonical-check.sh — Post-deploy smoke test for
# the canonical host + favicon asset set on savetheday.io.
#
# Implements PDF §6.6 post-deploy checks (Manus "Vercel
# Canonical Host and Google Favicon" — PDF Patch 6):
#
#   1. Every favicon asset URL returns 200 with the right content-type
#      (favicon.svg, favicon.ico, favicon-48.png, favicon-192.png,
#       apple-touch-icon.png, site.webmanifest).
#   2. www.savetheday.io returns a PERMANENT redirect (308 or 301)
#      with a Location header pointing at the apex.
#   3. The apex root exposes ONE canonical link to
#      https://savetheday.io/ (no leftover vitejs-vite-tbbhdylu URLs).
#
# Usage:
#   ./scripts/favicon-and-canonical-check.sh                # default apex
#   ./scripts/favicon-and-canonical-check.sh https://preview-xxx.vercel.app
#
# Exit codes:
#   0  All checks passed
#   1  One or more checks failed (see red ✗ above)
#   2  Usage / network error
#
# Author: Hermes (Manus P6)
# Date:   2026-08-23

set -euo pipefail

APEX="${1:-https://savetheday.io}"
HOST="$(printf '%s' "$APEX" | sed -E 's#^https?://##' | cut -d/ -f1)"
# Derive the www variant of the apex for Check 2. Bash 3.2 has no
# associative arrays and macOS sed is BSD-flavored, so keep this
# simple: strip any leading "www." from the host and re-add it. If
# the host is the apex itself (not the www), use it; otherwise the
# script is operating on an explicit override and we probe the same
# host's www sibling.
WWW_HOST="$(printf '%s' "$HOST" | sed -E 's/^www\.//')"
WWW_HOST="www.${WWW_HOST}"
WWW_URL="https://${WWW_HOST}/"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
FAILED=0

ok()   { printf "${GREEN}✓${NC} %s\n" "$*"; }
fail() { printf "${RED}✗${NC} %s\n" "$*" >&2; FAILED=1; }
info() { printf "${BOLD}${YELLOW}== %s ==${NC}\n" "$*"; }

usage() {
  cat <<EOF
Usage: $0 [apex-url]

  apex-url  The canonical host to verify (default: https://savetheday.io)

Exit codes:
  0  All checks passed
  1  At least one check failed
  2  Usage / network error
EOF
}

# -------------------------------------------------------------- args
case "${1:-}" in
  -h|--help) usage; exit 0 ;;
esac

# -------------------------------------------------------------- preflight
info "Target apex: $APEX"
if ! command -v curl >/dev/null 2>&1; then
  echo "curl not on PATH" >&2
  exit 2
fi

# ============================================================
# Check 1 — All favicon assets return 200 with the right content-type
# ============================================================
info "Check 1 — favicon asset set"
# Two parallel arrays (Bash 3.2 has no associative arrays on macOS;
# the macOS system bash is still 3.2.x. Index must stay aligned.)
ASSETS=(
  "favicon.svg"
  "favicon.ico"
  "favicon-48.png"
  "favicon-192.png"
  "apple-touch-icon.png"
  "site.webmanifest"
)
EXPECT_TYPES=(
  "image/svg"
  "image/"
  "image/png"
  "image/png"
  "image/png"
  "application/manifest+json"
)
for i in "${!ASSETS[@]}"; do
  path="${ASSETS[$i]}"
  want="${EXPECT_TYPES[$i]}"
  set +e
  hdr="$(curl -sS -o /dev/null -w '%{http_code} %{content_type}' --max-time 10 "$APEX/$path" 2>&1)"
  rc=$?
  set -e
  if [[ "$rc" -ne 0 ]]; then
    fail "$path — curl error (exit $rc)"
    continue
  fi
  code="$(printf '%s' "$hdr" | awk '{print $1}')"
  ctype="$(printf '%s' "$hdr" | awk '{print $2}')"
  if [[ "$code" == "200" ]] && [[ "$ctype" == "${want}"* ]]; then
    ok "$path — $code $ctype"
  else
    fail "$path — got $code $ctype, wanted 200 ${want}*"
  fi
done

# ============================================================
# Check 2 — www returns a PERMANENT redirect to apex
# ============================================================
info "Check 2 — $WWW_HOST → $HOST permanent redirect"
# Use curl's --head but follow once so we see the final status
# AND the redirect Location header.
set +e
hdr="$(curl -sSI --max-time 5 "$WWW_URL" 2>&1)"
rc=$?
set -e
if [[ "$rc" -ne 0 ]]; then
  fail "$WWW_HOST fetch — curl error (exit $rc)"
else
  status_line="$(printf '%s' "$hdr" | head -1 | tr -d '\r')"
  location="$(printf '%s' "$hdr" | grep -i '^location:' | head -1 | awk '{print $2}' | tr -d '\r\n')"
  # Disable -e here: the if/elif comparisons can legitimately
  # evaluate false (the whole point is to detect a non-308
  # status and print a fail message). Without set +e, the
  # first false [[ ]] exits before we reach the fail branch.
  set +e
  if [[ "$status_line" == *" 301"* ]] || [[ "$status_line" == *" 308"* ]]; then
    if [[ "$location" == "${APEX}"* ]] || [[ "$location" == "${APEX%/}/"* ]]; then
      ok "$WWW_HOST redirect — $status_line → $location"
    else
      fail "$WWW_HOST redirect — $status_line but Location is '$location', expected to start with $APEX"
    fi
  else
    fail "$WWW_HOST redirect — got '$status_line', wanted 301/308"
  fi
  set -e
fi

# ============================================================
# Check 3 — apex root has exactly one canonical link
# ============================================================
info "Check 3 — apex canonical link"
set +e
html="$(curl -sS --max-time 10 "$APEX/" 2>&1)"
rc=$?
set -e
if [[ "$rc" -ne 0 ]]; then
  fail "apex fetch — curl error (exit $rc)"
else
  # Extract every rel="canonical" link and check:
  #   - exactly one exists
  #   - it points at the apex
  canonicals="$(printf '%s' "$html" | grep -oE '<link[^>]+rel="canonical"[^>]*>' || true)"
  count="$(printf '%s\n' "$canonicals" | grep -c '^' || true)"
  if [[ "$count" -ne 1 ]]; then
    fail "canonical — found $count canonical tags, wanted exactly 1"
    printf '%s\n' "$canonicals"
  else
    href="$(printf '%s' "$canonicals" | grep -oE 'href="[^"]*"' | head -1 | sed 's/href="//; s/"//')"
    if [[ "$href" == "${APEX}"* ]]; then
      ok "canonical — 1 tag, href=$href"
    else
      fail "canonical — href='$href', expected to start with $APEX"
    fi
  fi

  # Negative: must NOT reference the old Vercel deployment hostname.
  if printf '%s' "$html" | grep -qF 'vitejs-vite-tbbhdylu.vercel.app'; then
    fail "apex HTML still references vitejs-vite-tbbhdylu.vercel.app"
  else
    ok "apex HTML — no legacy Vercel deployment hostname"
  fi
fi

# ============================================================
# Result
# ============================================================
echo ""
if [[ "$FAILED" -ne 0 ]]; then
  printf "${RED}${BOLD}✗ POST-DEPLOY CHECK FAILED${NC}\n"
  exit 1
fi
printf "${GREEN}${BOLD}✓ ALL CHECKS PASSED${NC}\n"
exit 0
