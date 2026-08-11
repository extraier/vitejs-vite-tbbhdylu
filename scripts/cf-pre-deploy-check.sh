#!/usr/bin/env bash
# cf-pre-deploy-check.sh — dry-run audit that runs WITHOUT deploying.
#                      Catches the class of bugs these incidents exposed:
#
#   1. Source code mentions a new CF name that isn't re-exported from
#      functions/src/index.ts (the `firebase deploy` won't include it).
#   2. Proxy allowlist references a CF that doesn't exist in source
#      (typo, removed function, etc.).
#   3. Proxy allowlist is missing a CF that was added in source
#      (Trap 15 — proxy 403 at runtime).
#   4. Local functions/lib/ is out of date with functions/src/ — would
#      ship stale code (the 2026-08-10 root cause: lib/ had new code
#      but the deploy didn't run, so the next deploy shipped old code).
#   5. Uncommitted changes in functions/ or api/ (deploy would ship
#      working tree state, not committed state).
#
# Usage:
#   ./scripts/cf-pre-deploy-check.sh
#   # exit 0 = ready to deploy, exit 1 = fixes needed
#
# Pairs with cf-deploy-6-step.sh (the actual deploy ritual).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { printf "${GREEN}✓${NC} %s\n" "$*"; }
fail() { printf "${RED}✗${NC} %s\n" "$*" >&2; FAILED=1; }
warn() { printf "${YELLOW}⚠${NC} %s\n" "$*"; }

FAILED=0
echo "=========================================="
echo "  CF pre-deploy audit"
echo "=========================================="
echo

# --- 1. onCall CFs re-exported from index.ts -------------------------
echo "[1] Re-export audit (firebase deploy only ships re-exported onCall CFs)"
python3 - <<'PY' || FAILED=1
import re, sys
src_files = []
import glob
for f in glob.glob('functions/src/*.ts'):
    with open(f) as fh: src_files.append((f, fh.read()))

# onCall exports in any source file
callables = set()
for f, content in src_files:
    for m in re.finditer(r'^export const ([A-Za-z0-9_]+) = onCall\(', content, re.MULTILINE):
        callables.add(m.group(1))

# Re-exports from index.ts. Three forms:
#   1. `export { a, b, c } from '...';` (named re-export)
#   2. `export * from '...';` (wildcard re-export — pulls in all
#      `export const`/`export function` from that file)
#   3. `export const/function x = ...` (inline re-export at the top level)
with open('functions/src/index.ts') as f: idx = f.read()
exported = set()
# (1) Named re-export blocks
for m in re.finditer(r'export\s*\{([^}]*)\}\s*from\s*[\'"][^\'"]+[\'"]\s*;?', idx):
    for name in m.group(1).split(','):
        name = name.strip()
        if name and not name.startswith('//') and not name.startswith('/*'):
            name = re.sub(r'\s+as\s+\w+', '', name)
            if re.match(r'^[A-Za-z0-9_]+$', name):
                exported.add(name)
# (2) Wildcard re-exports — resolve by reading the target file
import os
for m in re.finditer(r'export\s*\*\s*from\s*[\'"]([^\'"]+)[\'"]\s*;?', idx):
    target = m.group(1)
    if not target.startswith('.'):
        continue
    target_path = os.path.join('functions/src', target)
    if target.endswith('.ts'):
        target_path = target_path[:-3] + '.ts'
    elif not target.endswith(('.ts', '.js')):
        target_path = target_path + '.ts'
    if not os.path.exists(target_path):
        continue
    with open(target_path) as f: target_content = f.read()
    for n in re.findall(r'^export\s+(?:const|function)\s+([A-Za-z0-9_]+)\b', target_content, re.MULTILINE):
        exported.add(n)
# (3) Inline re-exports
for m in re.finditer(r'^export\s+(const|function)\s+([A-Za-z0-9_]+)\b', idx, re.MULTILINE):
    exported.add(m.group(2))

missing = callables - exported
if not missing:
    print('  (all %d onCall CFs are re-exported)' % len(callables))
else:
    for fn in sorted(missing):
        print(f'  MISSING: {fn}', file=sys.stderr)
    sys.exit(1)
PY
[[ $? -eq 0 ]] && ok "all onCall CFs re-exported from index.ts" || fail "some onCall CFs are NOT re-exported (see above)"
echo

# --- 2. Proxy allowlist references real CFs --------------------------
echo "[2] Proxy allowlist vs source reality (Trap 15)"
python3 - <<'PY' || FAILED=1
import re, sys, glob

# Extract allowed names from the proxy
with open('api/firebase-proxy.js') as f: proxy = f.read()
m = re.search(r'const ALLOWED = new Set\(\[([\s\S]*?)\]\);', proxy)
if not m:
    print('  ERR: could not find ALLOWED set in api/firebase-proxy.js', file=sys.stderr)
    sys.exit(1)
allowed = set()
for n in re.findall(r"'([A-Za-z0-9_]+)'", m.group(1)):
    allowed.add(n)

# Build set of ALL exported names from functions/src/ (any form)
all_src = set()
for f in glob.glob('functions/src/*.ts'):
    with open(f) as fh: content = fh.read()
    for n in re.findall(r'^export\s+(?:const|function)\s+([A-Za-z0-9_]+)\b', content, re.MULTILINE):
        all_src.add(n)

phantom = allowed - all_src
if phantom:
    for p in sorted(phantom):
        print(f'  PHANTOM: {p} in proxy allowlist but not exported from functions/src/', file=sys.stderr)
    sys.exit(1)
print('  (all %d allowlist entries exist in source)' % len(allowed))
PY
[[ $? -eq 0 ]] && ok "all proxy allowlist entries are real CFs" || fail "phantom allowlist entries (see above)"
echo

# --- 3. New onCall CFs since last commit (advisory) ------------------
echo "[3] New onCall CFs in last commit (advisory)"
if [[ -d .git ]]; then
  python3 - <<'PY' || true
import re, subprocess
out = subprocess.run(['git', 'diff', '--unified=0', 'HEAD~1', 'HEAD', '--', 'functions/src/'],
                     capture_output=True, text=True)
if not out.stdout: 
    print('  (no diff to check)'); raise SystemExit
new_cfs = set()
for m in re.finditer(r'^\+export const ([A-Za-z0-9_]+) = onCall\(', out.stdout, re.MULTILINE):
    new_cfs.add(m.group(1))
removed_cfs = set()
for m in re.finditer(r'^-export const ([A-Za-z0-9_]+) = onCall\(', out.stdout, re.MULTILINE):
    removed_cfs.add(m.group(1))
# Check current allowlist
with open('api/firebase-proxy.js') as f: proxy = f.read()
m = re.search(r'const ALLOWED = new Set\(\[([\s\S]*?)\]\);', proxy)
allowed = set(re.findall(r"'([A-Za-z0-9_]+)'", m.group(1))) if m else set()
if not new_cfs and not removed_cfs:
    print('  (no onCall CF changes in last commit)')
for fn in sorted(new_cfs):
    status = 'in allowlist' if fn in allowed else 'NOT in allowlist — Trap 15 risk'
    print(f'  + {fn} ({status})')
for fn in sorted(removed_cfs):
    print(f'  - {fn} (consider removing from allowlist)')
PY
fi
echo

# --- 4. lib/ freshness (the 2026-08-10 root cause) -------------------
echo "[4] lib/ freshness"
if [[ -d functions/lib ]]; then
  STALE=0
  for src in functions/src/*.ts; do
    base=$(basename "$src" .ts)
    if [[ -f "functions/lib/$base.js" ]]; then
      if [[ "$src" -nt "functions/lib/$base.js" ]]; then
        fail "$src is newer than functions/lib/$base.js — run 'cd functions && npm run build' first"
        STALE=$((STALE + 1))
      fi
    fi
  done
  if [[ "$STALE" -eq 0 ]]; then
    ok "all lib/ files are up to date with src/"
  fi
else
  warn "functions/lib/ not found — first-time build will run as part of firebase deploy"
fi
echo

# --- 5. Uncommitted changes in functions/ or api/ --------------------
echo "[5] Uncommitted changes"
if ! git diff --quiet HEAD -- functions/ api/ 2>/dev/null; then
  warn "uncommitted changes in functions/ or api/ — review before deploy"
  git status --short -- functions/ api/ 2>/dev/null | head -10
else
  ok "no uncommitted changes in functions/ or api/"
fi
echo

# --- Summary ---------------------------------------------------------
echo "=========================================="
if [[ "$FAILED" -eq 0 ]]; then
  printf "${GREEN}✓ Pre-deploy audit passed — ready to deploy${NC}\n"
  echo "Next: ./scripts/cf-deploy-6-step.sh <function-name>"
  exit 0
else
  printf "${RED}✗ Pre-deploy audit failed — fix the above before deploying${NC}\n"
  echo "Most issues are 1-line fixes in functions/src/index.ts or api/firebase-proxy.js"
  exit 1
fi
