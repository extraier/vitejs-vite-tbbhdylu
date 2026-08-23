#!/usr/bin/env bash
# deployment-gate.sh — Pre-deploy audit gate for savetheday.io.
#
# Run this in a clean checkout BEFORE deploying anything
# (Firebase rules, Cloud Functions, Vercel functions, frontend).
# A green frontend build does NOT replace Firestore emulator tests.
#
# Implements PDF §6.4 (Manus "Post-Hermes Critical & High-Severity
# Remediation" — PDF Patch 4 / §6.4 "Deployment gate"). The four
# phases match the spec exactly:
#
#   1. Rules emulator: firestore.rules + guestExperience rules tests.
#      Skipped if no JRE (logs a warning, exit 0 — matches the
#      rules.test.ts skipIf(skipEmulator) behaviour).
#   2. Functions unit: pure tests (unlocks, entitlement resolver).
#   3. Functions build: tsc.
#   4. Frontend tests + build: vitest for the four role/purchase/
#      cards tests + vite build.
#
# Exit codes:
#   0 — all selected phases green
#   1 — at least one phase failed (logs which one)
#   2 — usage error (unknown flag)
#
# Usage:
#   ./scripts/deployment-gate.sh                  # full gate
#   ./scripts/deployment-gate.sh --rules-only     # just phase 1
#   ./scripts/deployment-gate.sh --functions-only # phases 2 + 3
#   ./scripts/deployment-gate.sh --frontend-only  # phase 4
#   ./scripts/deployment-gate.sh --skip-rules     # skip phase 1 (faster local)
#
# Prerequisites:
#   - node 20 (functions runtime)
#   - java 11+ on PATH for the rules emulator (or use --skip-rules)
#   - firebase-tools (npm i -g firebase-tools) for the emulator
#
# Author: Hermes (Manus P5)
# Date:   2026-08-23

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
FAILED=0
PASS_COUNT=0
TOTAL_COUNT=0

ok()     { printf "${GREEN}✓${NC} %s\n" "$*"; PASS_COUNT=$((PASS_COUNT+1)); TOTAL_COUNT=$((TOTAL_COUNT+1)); }
fail()   { printf "${RED}✗${NC} %s\n" "$*" >&2; FAILED=1; TOTAL_COUNT=$((TOTAL_COUNT+1)); }
section(){ printf "\n${BOLD}${YELLOW}== %s ==${NC}\n" "$*"; }
banner() { printf "\n${BOLD}%-60s${NC}\n" "============================================================"; printf "${BOLD}  %s${NC}\n" "$*"; printf "${BOLD}%-60s${NC}\n" "============================================================"; }

usage() {
  cat <<'EOF'
Usage: scripts/deployment-gate.sh [flags]

  (no flags)             Run all four phases (rules + functions + frontend).
  --rules-only           Run phase 1 only (rules emulator).
  --functions-only       Run phases 2 + 3 (functions unit + build).
  --frontend-only        Run phase 4 (frontend tests + build).
  --skip-rules           Skip phase 1 (no JRE / fast local loop).

Exit codes:
  0  All selected phases green
  1  At least one phase failed (see RED ✗ above)
  2  Usage error
EOF
}

# -------------------------------------------------------------- args
SKIP_RULES=0
RULES_ONLY=0
FUNCTIONS_ONLY=0
FRONTEND_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --rules-only)     RULES_ONLY=1 ;;
    --functions-only) FUNCTIONS_ONLY=1 ;;
    --frontend-only)  FRONTEND_ONLY=1 ;;
    --skip-rules)     SKIP_RULES=1 ;;
    -h|--help)        usage; exit 0 ;;
    *)
      echo "Unknown flag: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

# Translate exclusivity flags into what to run
RUN_RULES=1
RUN_FUNCTIONS=1
RUN_FRONTEND=1
if [[ "$RULES_ONLY" -eq 1 ]];     then RUN_FUNCTIONS=0; RUN_FRONTEND=0; fi
if [[ "$FUNCTIONS_ONLY" -eq 1 ]]; then RUN_RULES=0;     RUN_FRONTEND=0; fi
if [[ "$FRONTEND_ONLY" -eq 1 ]];  then RUN_RULES=0;     RUN_FUNCTIONS=0; fi
[[ "$SKIP_RULES" -eq 1 ]] && RUN_RULES=0

# -------------------------------------------------------------- preflight
banner "Deployment Gate — savetheday.io"
echo "Repo root: $REPO_ROOT"
echo "Phases:    rules=$([ "$RUN_RULES" -eq 1 ] && echo ON || echo OFF)" \
              "functions=$([ "$RUN_FUNCTIONS" -eq 1 ] && echo ON || echo OFF)" \
              "frontend=$([ "$RUN_FRONTEND" -eq 1 ] && echo ON || echo OFF)"

command -v node  >/dev/null 2>&1 || { echo "node not on PATH" >&2; exit 1; }
command -v npm   >/dev/null 2>&1 || { echo "npm not on PATH"  >&2; exit 1; }
if [[ "$RUN_RULES" -eq 1 ]]; then
  # Java is required for the Firestore emulator. On macOS dev
  # machines, firebase emulators:exec shells out to `java`
  # directly and respects JAVA_HOME. If JAVA_HOME is unset but
  # homebrew's openjdk@21 is installed, prime it. If neither
  # is true, the emulator will fail with a clear message and
  # the user can re-run with --skip-rules or install JDK.
  if [[ -z "${JAVA_HOME:-}" ]] && [[ -d "/opt/homebrew/opt/openjdk@21" ]]; then
    export JAVA_HOME="/opt/homebrew/opt/openjdk@21"
    export PATH="$JAVA_HOME/bin:$PATH"
    echo "Primed JAVA_HOME=$JAVA_HOME from homebrew openjdk@21"
  fi
  if ! command -v java >/dev/null 2>&1; then
    echo "java not on PATH — required for rules emulator."
    echo "Re-run with --skip-rules, or install JDK 11+ (e.g. brew install openjdk@21)."
    exit 1
  fi
fi
ok "Preflight (node + npm + java)"

# ============================================================
# Phase 1 — Rules emulator
# ============================================================
phase_rules() {
  section "Phase 1/4 — Rules emulator (firestore.rules + guestExperience)"
  cd "$REPO_ROOT/functions"

  # Per the §6.4 spec, this single command runs BOTH
  # firestore.rules.test.ts AND guestExperience.pure.test.ts
  # against the Firestore emulator. The p1-1 unlock + entitlement
  # tests run in phase 2 (pure node, no emulator).
  #
  # We invoke via firebase emulators:exec so JRE + emulator
  # lifecycle are managed for us. On macOS dev laptops,
  # firebase-tools picks up `firebase.json` from the repo root.
  if ! command -v firebase >/dev/null 2>&1; then
    fail "firebase CLI not on PATH — install with: npm i -g firebase-tools"
    return 1
  fi

  set +e
  FIRESTORE_RULES_TEST=1 firebase emulators:exec --only firestore \
    "npx vitest run --no-coverage \
       test/firestore.rules.test.ts \
       test/guestExperience.pure.test.ts" \
    2>&1 | tail -30
  rc=${PIPESTATUS[0]}
  set -e

  if [[ "$rc" -eq 0 ]]; then
    ok "firestore.rules + guestExperience rules tests"
  else
    fail "firestore.rules / guestExperience rules tests (exit $rc)"
  fi
}

# ============================================================
# Phase 2 — Functions unit (pure node)
# ============================================================
phase_functions_unit() {
  section "Phase 2/4 — Functions unit (vitest, no emulator)"
  cd "$REPO_ROOT/functions"
  set +e
  npx vitest run --no-coverage \
    test/unlocksPricing.p1-1.test.ts \
    test/entitlementResolver.test.ts \
    2>&1 | tail -20
  rc=${PIPESTATUS[0]}
  set -e
  if [[ "$rc" -eq 0 ]]; then
    ok "Functions unit tests (unlocksPricing, entitlementResolver)"
  else
    fail "Functions unit tests (exit $rc)"
  fi
}

# ============================================================
# Phase 3 — Functions build (tsc)
# ============================================================
phase_functions_build() {
  section "Phase 3/4 — Functions build (tsc)"
  cd "$REPO_ROOT/functions"
  set +e
  npm run build 2>&1 | tail -10
  rc=$?
  set -e
  if [[ "$rc" -eq 0 ]]; then
    ok "tsc (functions build)"
  else
    fail "tsc (functions build) — exit $rc"
  fi
}

# ============================================================
# Phase 4 — Frontend tests + build
# ============================================================
phase_frontend() {
  section "Phase 4/4 — Frontend tests + build"
  cd "$REPO_ROOT"

  # --- 4a. Tests (the four role/purchase/cards specs) ----
  set +e
  npm test -- --run \
    src/components/BellNotifications.role.test.jsx \
    src/components/NotificationsCenter.role.test.jsx \
    src/screens/InvitationEditor.purchase.test.jsx \
    src/screens/PersonalGuestPortal.cards.test.jsx \
    2>&1 | tail -20
  rc=${PIPESTATUS[0]}
  set -e
  if [[ "$rc" -eq 0 ]]; then
    ok "Frontend role/purchase/cards tests"
  else
    fail "Frontend tests — exit $rc"
    return 1
  fi

  # --- 4b. Build (vite build) ---------------------------
  set +e
  npm run build 2>&1 | tail -8
  rc=$?
  set -e
  if [[ "$rc" -eq 0 ]]; then
    ok "Frontend build (vite)"
  else
    fail "Frontend build — exit $rc"
  fi
}

# ============================================================
# Run
# ============================================================
START_TS=$(date +%s)
[[ "$RUN_RULES"     -eq 1 ]] && phase_rules
[[ "$RUN_FUNCTIONS" -eq 1 ]] && phase_functions_unit
[[ "$RUN_FUNCTIONS" -eq 1 ]] && phase_functions_build
[[ "$RUN_FRONTEND"  -eq 1 ]] && phase_frontend
END_TS=$(date +%s)
ELAPSED=$((END_TS - START_TS))

# ============================================================
# Result
# ============================================================
banner "Result"
printf "Passed: ${GREEN}%d${NC} / %d phases\n" "$PASS_COUNT" "$TOTAL_COUNT"
printf "Elapsed: %ss\n" "$ELAPSED"

if [[ "$FAILED" -ne 0 ]]; then
  printf "\n${RED}${BOLD}✗ DEPLOYMENT GATE FAILED${NC}\n"
  printf "Do NOT deploy. Fix the red phases above, then re-run.\n\n"
  exit 1
fi

printf "\n${GREEN}${BOLD}✓ DEPLOYMENT GATE PASSED${NC}\n"
printf "Safe to deploy.\n\n"
exit 0
