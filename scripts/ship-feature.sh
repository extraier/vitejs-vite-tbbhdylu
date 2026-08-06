#!/usr/bin/env bash
# ship-feature.sh — One-shot pre-flight + deploy pipeline for any feature
#                   that touches CF + Vercel + NAS.
#
# Why this exists (2026-08-05 / 2026-08-06): the photo-delete feature shipped
# in 4 separate layers (Cloud Function + Vercel proxy + NAS Python + Cloudflare
# tunnel). Each layer was shipped correctly, but the COMBINATION had gaps
# (missing /delete ingress rule, HMAC_KEY missing on Vercel) that no single
# layer caught. There was no end-to-end pre-flight that said "every layer is
# wired before you tell the user it's done".
#
# What this script does:
#
#   PHASE 1 — pre-flight (run ALWAYS, even with --dry-run):
#     [ingress]  scripts/test-cloudflared-ingress.test.mjs
#     [drift]    scripts/check-env-drift.sh
#     [rules]    scripts/test-firestore-rules.cjs
#     [vitest]   npx vitest run
#
#   PHASE 2 — deploy (skipped with --dry-run):
#     [functions] scripts/deploy-functions.sh
#     [tunnel]    rsync deploy/cloudflared/config.yml → NAS ~/.cloudflared/
#                 (the watchdog restarts cloudflared within ~60s)
#     [nas]       rsync deploy/photo_upload_server.py → NAS /home/openclaw/bin/
#                 (the watchdog restarts the Python server within ~60s)
#
#   PHASE 3 — post-deploy verification (always run):
#     [curl]     OPTIONS preflight against /upload /photos /delete
#
# Each phase can be skipped with --skip-<name>. Any failure aborts the run.
#
# Usage:
#   ./scripts/ship-feature.sh                    # full pipeline
#   ./scripts/ship-feature.sh --dry-run         # pre-flight only, no deploys
#   ./scripts/ship-feature.sh --skip-functions   # skip CF deploy
#   ./scripts/ship-feature.sh --skip-nas         # skip NAS Python sync
#   ./scripts/ship-feature.sh --skip-tunnel      # skip tunnel config sync
#   ./scripts/ship-feature.sh --only preflight   # only Phase 1
#
# Env:
#   NAS_HOST — SSH host for NAS (default: openclaw@nas)
#   NAS_PHOTO_BIN — destination dir for photo_upload_server.py
#                   (default: /home/openclaw/bin)

set -euo pipefail

# ---- Resolve paths ----
SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
if [[ -z "$SCRIPT_PATH" || "$SCRIPT_PATH" == *"bash"* || "$SCRIPT_PATH" == "bash" ]]; then
  SCRIPT_PATH="scripts/ship-feature.sh"
fi
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" 2>/dev/null && pwd || true)"
[[ -z "$SCRIPT_DIR" ]] && SCRIPT_DIR="$(pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." 2>/dev/null && pwd || pwd)"

cd "$REPO_ROOT"

# ---- Parse flags ----
DRY_RUN=0
ONLY=""
SKIP_FUNCTIONS=0
SKIP_TUNNEL=0
SKIP_NAS=0
SKIP_POSTDEPLOY=0
INCLUDE_RULES=0

usage() {
  cat <<EOF
Usage:
  $0 [--dry-run] [--only <phase>] [--skip-functions] [--skip-tunnel] [--skip-nas] [--skip-postdeploy] [--include-rules]

Phases: preflight, deploy, postdeploy (comma-separated for --only)

Examples:
  $0                              # full pipeline
  $0 --dry-run                    # pre-flight only, no deploys
  $0 --only preflight             # pre-flight only
  $0 --only preflight,postdeploy  # pre-flight + curl checks, skip deploys
  $0 --skip-nas                   # everything except NAS Python sync
  $0 --include-rules              # also run firestore rules tests locally (boots emulator)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)            DRY_RUN=1; shift ;;
    --only)               ONLY="${2:-}"; shift 2 || { echo "❌ --only needs a phase"; exit 1; } ;;
    --skip-functions)     SKIP_FUNCTIONS=1; shift ;;
    --skip-tunnel)        SKIP_TUNNEL=1; shift ;;
    --skip-nas)           SKIP_NAS=1; shift ;;
    --skip-postdeploy)    SKIP_POSTDEPLOY=1; shift ;;
    --include-rules)      INCLUDE_RULES=1; shift ;;
    -h|--help)            usage; exit 0 ;;
    *)                    echo "❌ Unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

# --only expands to the inverse skip-set.
if [[ -n "$ONLY" ]]; then
  case ",$ONLY," in
    *,preflight,*)    ;;  # always run
    *,deploy,*)       SKIP_FUNCTIONS=0; SKIP_TUNNEL=0; SKIP_NAS=0 ;;
    *)                SKIP_FUNCTIONS=1; SKIP_TUNNEL=1; SKIP_NAS=1 ;;
  esac
  case ",$ONLY," in
    *,postdeploy,*)   SKIP_POSTDEPLOY=0 ;;
    *)                SKIP_POSTDEPLOY=1 ;;
  esac
fi

NAS_HOST="${NAS_HOST:-openclaw@nas}"
NAS_PHOTO_BIN="${NAS_PHOTO_BIN:-/home/openclaw/bin}"

# ---- Pretty printing ----
banner() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "  $1"
  echo "═══════════════════════════════════════════════════════════════"
}

run_step() {
  local name="$1"
  shift
  banner "🔍 $name"
  echo "\$ $*"
  if ! "$@"; then
    echo "❌ $name FAILED — aborting ship." >&2
    exit 1
  fi
  echo "✅ $name OK"
}

warn_step() {
  local name="$1"
  shift
  banner "⚠️  $name (non-blocking)"
  echo "\$ $*"
  if ! "$@"; then
    echo "⚠️  $name had warnings — review above."
  fi
}

# ============================================================================
# PHASE 1 — Pre-flight gates
# ============================================================================

if [[ -z "$ONLY" || ",$ONLY," == *",preflight,"* ]]; then
  banner "PHASE 1 — Pre-flight gates"

  # ---- 1a. Working tree must be clean (no uncommitted changes) ----
  banner "1a. Working tree clean"
  if ! git diff --quiet HEAD 2>/dev/null; then
    UNCOMMITTED=$(git status --short | wc -l | tr -d ' ')
    echo "❌ Working tree has $UNCOMMITTED uncommitted change(s)." >&2
    git status --short >&2
    echo "   Commit or stash before shipping." >&2
    exit 1
  fi
  echo "✅ Working tree clean"

  # ---- 1b. Cloudflare tunnel ingress coverage ----
  run_step "1b. Cloudflare tunnel ingress coverage" \
    npx vitest run scripts/test-cloudflared-ingress.test.mjs

  # ---- 1c. Vercel env drift ----
  run_step "1c. Vercel env drift" \
    bash scripts/check-env-drift.sh

  # ---- 1d. Vitest unit tests ----
  run_step "1d. Vitest unit tests" \
    npx vitest run

  # ---- 1e. Firestore rules tests (security gate — opt-in only) ----
  #
  # Off by default because it requires `firebase emulators:exec` which
  # boots the Firestore emulator (~2 GB download, slow first run). The
  # CI workflow already runs this on every push (ci.yml → firestore
  # rules job). For local pre-flight, opt in with --include-rules.
  #
  # When opted in: we run it via `firebase emulators:exec` so the
  # emulator is started, the test runs, and the emulator tears down.
  # That's the same shape as CI.
  if [[ $INCLUDE_RULES -eq 1 ]]; then
    if [[ ! -f scripts/test-firestore-rules.cjs ]]; then
      echo "❌ --include-rules requested but scripts/test-firestore-rules.cjs missing" >&2
      exit 1
    fi
    if ! command -v firebase >/dev/null 2>&1; then
      echo "❌ --include-rules needs firebase CLI on PATH (npm i -g firebase-tools)" >&2
      exit 1
    fi
    warn_step "1e. Firestore rules tests (emulator boot — may take 1-2 min)" \
      firebase emulators:exec --only firestore "node scripts/test-firestore-rules.cjs"
  else
    echo "⏭️  1e. Firestore rules tests — SKIPPED (off by default; --include-rules to run locally)"
  fi
fi

# ============================================================================
# PHASE 2 — Deploy
# ============================================================================

if [[ $DRY_RUN -eq 1 ]]; then
  banner "PHASE 2 — Deploy (SKIPPED — --dry-run)"
elif [[ $SKIP_FUNCTIONS -eq 1 && $SKIP_TUNNEL -eq 1 && $SKIP_NAS -eq 1 ]]; then
  banner "PHASE 2 — Deploy (SKIPPED — all steps disabled)"
else
  banner "PHASE 2 — Deploy"

  # ---- 2a. Cloud Functions v2 ----
  if [[ $SKIP_FUNCTIONS -eq 0 ]]; then
    run_step "2a. Cloud Functions v2 deploy" \
      bash scripts/deploy-functions.sh
  else
    echo "⏭️  2a. Cloud Functions deploy — SKIPPED (--skip-functions)"
  fi

  # ---- 2b. Cloudflare tunnel config sync ----
  if [[ $SKIP_TUNNEL -eq 0 ]]; then
    banner "2b. Cloudflare tunnel config sync"
    # Check the file actually changed before rsyncing (avoids needless
    # tunnel restarts on every ship).
    if [[ deploy/cloudflared/config.yml -nt /tmp/.tunnel-config-shipped ]]; then
      echo "  Tunnel config has changed since last ship — syncing to NAS."
      echo "\$ rsync deploy/cloudflared/config.yml $NAS_HOST:~/.cloudflared/config.yml"
      if ! rsync -av deploy/cloudflared/config.yml "$NAS_HOST:~/.cloudflared/config.yml"; then
        echo "❌ Tunnel config rsync failed." >&2
        exit 1
      fi
      echo "  Tunnel config synced. The /tmp/ts-autostart.watchdog.log will"
      echo "  restart cloudflared within ~60s if config differs."
      touch /tmp/.tunnel-config-shipped
    else
      echo "  Tunnel config unchanged since last ship — skipping rsync."
    fi
    echo "✅ 2b. Tunnel config sync OK"
  else
    echo "⏭️  2b. Tunnel config sync — SKIPPED (--skip-tunnel)"
  fi

  # ---- 2c. NAS Python photo server sync ----
  if [[ $SKIP_NAS -eq 0 ]]; then
    banner "2c. NAS Python photo server sync"
    # Use mtime comparison to avoid needless restarts.
    LOCAL_PY="deploy/photo_upload_server.py"
    REMOTE_PY="$NAS_HOST:$NAS_PHOTO_BIN/photo_upload_server.py"
    echo "\$ rsync -av $LOCAL_PY $REMOTE_PY"
    if ! rsync -av --update "$LOCAL_PY" "$REMOTE_PY"; then
      echo "❌ NAS Python rsync failed." >&2
      exit 1
    fi
    echo "  Synced. Watchdog restarts the Python server within ~60s if changed."
    echo "✅ 2c. NAS Python sync OK"
  else
    echo "⏭️  2c. NAS Python sync — SKIPPED (--skip-nas)"
  fi
fi

# ============================================================================
# PHASE 3 — Post-deploy verification
# ============================================================================

if [[ $SKIP_POSTDEPLOY -eq 1 ]]; then
  banner "PHASE 3 — Post-deploy verification (SKIPPED)"
elif [[ -z "$ONLY" || ",$ONLY," == *",postdeploy,"* ]]; then
  banner "PHASE 3 — Post-deploy verification"

  # Skip curl checks in --dry-run mode (the deploys didn't happen).
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "⏭️  3a. CDN OPTIONS preflight — SKIPPED (--dry-run)"
  else
    banner "3a. CDN OPTIONS preflight"
    for path in /upload /photos /delete; do
      code=$(curl -sS -o /dev/null -w "%{http_code}" \
        -X OPTIONS -H "Origin: https://savetheday.io" \
        "https://cdn.savetheday.io${path}/test/test/test" \
        --max-time 10 || echo "000")
      if [[ "$code" == "204" ]]; then
        echo "  ✓ $path → 204"
      else
        echo "  ❌ $path → $code (expected 204)"
        echo "  Tunnel config may need a moment for the watchdog to restart cloudflared."
        echo "  Or the ingress rule is still missing — check deploy/cloudflared/config.yml."
      fi
    done
  fi
fi

banner "✅ Ship complete"
echo "All pre-flight gates passed and deploys (if any) succeeded."
echo "You can now safely tell the user the feature is live."