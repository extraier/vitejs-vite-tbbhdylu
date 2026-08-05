#!/usr/bin/env bash
# check-env-drift.sh — Verify that every env var the Vercel
#                      proxies read via `process.env.X` actually
#                      exists in Vercel's production env.
#
# Why this exists (2026-08-05): HMAC_KEY was a Firebase secret used
# by functions/src/photoDeleteToken.ts. The Vercel proxies
# /api/photo-upload.js and /api/photo-delete.js read it via
# `process.env.HMAC_KEY`. The Vercel env var was never set, so the
# watermark feature was silently broken for weeks. There was no
# automated check to catch this drift.
#
# What this script checks:
#   - Scan api/*.js for every `process.env.X` reference
#   - List what Vercel has in production
#   - For each env var read by a proxy, verify it's set on Vercel
#   - Exit 1 if any drift detected
#
# What this script does NOT check:
#   - Firebase secret bindings (use `firebase functions:secrets:access`)
#   - Whether the values are CORRECT (just present)
#   - Alias chains — if a proxy reads `process.env.A || process.env.B`,
#     only `A` needs to be on Vercel. The script checks the FIRST
#     reference to handle this.
#
# Usage:
#   ./scripts/check-env-drift.sh                 # strict mode (exit 1 on drift)
#   ./scripts/check-env-drift.sh --report-only   # don't exit 1, just print
#
# Env:
#   VERCEL_BIN — path to vercel CLI. Default: /Users/roger/.local/bin/vercel

set -uo pipefail

REPORT_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --report-only) REPORT_ONLY=1 ;;
    *)             echo "❌ Unknown arg: $arg" >&2; exit 1 ;;
  esac
done

VERCEL_BIN="${VERCEL_BIN:-/Users/roger/.local/bin/vercel}"
if [[ ! -x "$VERCEL_BIN" ]]; then
  echo "❌ vercel CLI not found at $VERCEL_BIN" >&2
  exit 1
fi

# ---- Step 1: extract env vars referenced by Vercel proxies ----

echo "==> Scanning api/*.js for 'process.env.X' references ..."
if [[ ! -d api ]]; then
  echo "❌ api/ directory not found. Run from repo root." >&2
  exit 1
fi

# Alias chains span multiple lines: `process.env.A ||\n#   process.env.B ||\n#   process.env.C || ''`. The first member is the primary; the
# rest are fallbacks. We want only the primary.
#
# Strategy: join consecutive `process.env.X`-only lines (each
# ending in `||`) into single chains, then take the first member
# of each chain. Lines NOT ending in `||` are themselves the
# primary reference.
PROXY_REFS=""
while IFS= read -r f; do
  [[ -f "$f" ]] || continue
  # Use awk to walk the file line by line, joining chain lines
  # and emitting the first `process.env.X` per chain.
  awk '
    # A chain is a sequence of `process.env.X` lines that all end
    # with `||`. The chain ends when a line does NOT end with `||`
    # (either a non-`process.env.` line, or a single `process.env.X`
    # reference like `const X = process.env.Y;`). The PRIMARY of the
    # chain is the FIRST member.
    /process\.env\./ {
      pos = index($0, "process.env.")
      name = substr($0, pos + 12)
      sub(/[^A-Z0-9_].*$/, "", name)
      # Line ends with `||` (possibly followed by whitespace or
      # a line-continuation backslash, or a `//` comment)?
      ends_with_or = ($0 ~ /\|\| *(\\\\ *)?$/) || ($0 ~ /\|\| +\/\//)
      if (ends_with_or) {
        # Chain member. If no chain is in progress, this is the first.
        if (buf == 0) {
          chain_start = name
        }
        buf = 1
        next
      }
      # Standalone reference (no `||` ending). If a chain was in
      # progress, close it first.
      if (buf == 1) {
        print chain_start
        buf = 0
        chain_start = ""
      }
      print name
      next
    }
    # Non-matching line. If a chain was in progress, close it.
    {
      if (buf == 1) {
        print chain_start
        buf = 0
        chain_start = ""
      }
    }
    END {
      if (buf == 1) {
        print chain_start
      }
    }
  ' "$f"
done < <(find api -type f -name "*.js" ! -name "*.test.js" 2>/dev/null | sort) | sort -u | sed '/^$/d' > /tmp/proxy-refs-raw.txt
PROXY_REFS=$(cat /tmp/proxy-refs-raw.txt)
rm -f /tmp/proxy-refs-raw.txt

if [[ -z "$PROXY_REFS" ]]; then
  echo "  (no process.env reads in api/)"
fi

for v in $PROXY_REFS; do echo "  - $v"; done
echo ""

# ---- Step 2: list Vercel production env var names ----

echo "==> Reading Vercel production env var names ..."
VERCEL_OUTPUT=$("$VERCEL_BIN" env ls production 2>&1 || echo "")
if [[ -z "$VERCEL_OUTPUT" ]]; then
  echo "❌ Could not read Vercel env (vercel CLI may need login)" >&2
  exit 1
fi

# Skip header rows. Lines look like:
#   NAME   Encrypted   Production   ...
# Header has 3+ lines of setup messages.
VERCEL_NAMES=$(echo "$VERCEL_OUTPUT" \
                | awk 'NR>3 && $1 != "" && $1 != "name" {print $1}' \
                | sort -u)

echo "Found these Vercel env vars:"
for v in $VERCEL_NAMES; do echo "  - $v"; done
echo ""

# ---- Step 3: cross-check ----

echo "==> Drift analysis:"
echo ""
echo "  proxy reads    | on Vercel?"
echo "  ---------------|------------"
DRIFT=0
for v in $PROXY_REFS; do
  if echo "$VERCEL_NAMES" | grep -qx "$v"; then
    echo "  $v | ✓"
  else
    echo "  $v | ❌ MISSING"
    DRIFT=$((DRIFT + 1))
  fi
done

echo ""
if [[ $DRIFT -eq 0 ]]; then
  echo "✅ All $(echo "$PROXY_REFS" | wc -l | tr -d ' ') env var(s) read by proxies are set on Vercel."
  exit 0
fi

echo "❌ $DRIFT env var(s) referenced by Vercel proxies are NOT set in production."
echo "   Fix with: ./scripts/vercel-env-sync.sh <NAME> <value>"
echo "   Or read from keychain:"
echo "     security find-generic-password -ws '<keychain-name>' | ./scripts/vercel-env-sync.sh <NAME> -"
if [[ $REPORT_ONLY -eq 1 ]]; then
  exit 0
fi
exit 1