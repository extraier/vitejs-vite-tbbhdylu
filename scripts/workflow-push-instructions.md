# Workflow push instructions (saved from 2026-07-30)

The loud-fail patch for `.github/workflows/ci.yml` cannot be pushed via API
(OAuth `gho_…` lacks workflow scope; only fine-grained PAT on disk is 401-dead).

## File content

Full patched `.github/workflows/ci.yml` (with the loud-fail FIREBASE_TOKEN gate)
is published as a public gist:
  https://gist.github.com/extraier/7ee560400b19d7507378f01d31e7532b

Raw URL (for paste):
  https://gist.githubusercontent.com/extraier/7ee560400b19d7507378f01d31e7532b/raw/12ee7defc0d7e8170491e144a1326841747e0ccb/ci.yml

## Step-by-step (apply via GitHub web UI)

1. Open https://github.com/extraier/vitejs-vite-tbbhdylu/edit/fix/ci-loud-fail-deploy/.github/workflows/ci.yml
2. In another tab, open the gist (or raw URL), select all, copy
3. Back in the GitHub editor: select all (Cmd+A), delete, paste the gist content
4. Commit message: `fix(ci): loud-fail when FIREBASE_TOKEN is missing`
5. Extended description: see /tmp/workflow-push-instructions.md
6. Choose: Commit directly to `fix/ci-loud-fail-deploy`
7. Visit https://github.com/extraier/vitejs-vite-tbbhdylu/compare/main...fix/ci-loud-fail-deploy
8. Open PR with title + body from /tmp/workflow-push-instructions.md

## Local state

- Branch: fix/ci-loud-fail-deploy
- Local commit: f755c42 (loud-fail patch only)
- Origin HEAD: f4d2199 (= SETUP.md diagnostic reverts from earlier session)

After the web-UI commit, origin will have the loud-fail change, and the user can
merge via PR.

## If user wants to skip

The bug class is already mitigated by scripts/deploy-functions.sh on main (PR #2).
Leaving the workflow change as local-only is a defensible status quo.