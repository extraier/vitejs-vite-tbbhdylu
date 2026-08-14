# CI / CD Setup
# =============

This repo has 3 GitHub Actions workflows. To activate them, you need
to configure the following **repository secrets** (Settings → Secrets
and variables → Actions).

## Required Secrets

### For Firestore rules + Cloud Functions deploy (`ci.yml`)

| Secret | Where to get it |
|---|---|
| `FIREBASE_TOKEN` | `firebase login:ci` — paste the token it prints |
| `GCLOUD_SA_KEY` | Service account JSON **file contents** (raw JSON, not base64). Used by the Playwright job's Firestore-integration tests (3 of 9 tests). |

The `GCLOUD_SA_KEY` is optional — the integration tests auto-skip when missing. Only the 6 HTTP-smoke tests run on PRs without secrets. To enable the full integration suite on pushes to main:

```bash
# Get the SA key file (one-time, on a machine that has it):
ls ~/.firebase-keys/savetheday-2377a.json

# Add to GitHub via the CLI (raw JSON, not base64):
gh secret set GCLOUD_SA_KEY < ~/.firebase-keys/savetheday-2377a.json --repo extraier/vitejs-vite-tbbhdylu
```

The Playwright helper (`scripts/firestore-query.cjs`) auto-detects whether `GCLOUD_SA_KEY` is a file path (local dev) or raw JSON content (CI secret) by checking whether the value starts with `{`. Both forms are supported.

This single token authorizes the workflow to:
- Deploy `firestore.rules`
- Deploy `functions/` (the issueGuestLink / redeemGuestLink Cloud Functions)
- Optionally deploy Firebase Hosting
- Run the Playwright Firestore-integration tests on push to main

### For Vercel deploy (`deploy-vercel.yml`)

| Secret | Where to get it |
|---|---|
| `VERCEL_TOKEN` | https://vercel.com/account/tokens → Create Token |
| `VERCEL_ORG_ID` | Vercel project Settings → General → "Project ID" section |
| `VERCEL_PROJECT_ID` | Vercel project Settings → General → "Project ID" section |

## What each workflow does

### `ci.yml` — runs on every push + PR to `main`

| Job | What it does | Blocks merge? |
|---|---|---|
| `app` | lint + test + build | ✅ Yes |
| `rules` | Firestore rules unit tests + functions type-check | ✅ Yes |
| `playwright` | End-to-end tests for `/api/csp-report` (HTTP smoke always; Firestore integration only when `GCLOUD_SA_KEY` is set, on push to main) | ✅ Yes (2026-08-14) |
| `deploy-functions` | Deploy rules + functions to Firebase (main only) | n/a |

### `deploy-vercel.yml` — runs on push to `main`

Builds and deploys the Vercel production site. Also auto-creates preview
URLs for PRs (handled by the Vercel GitHub App, configured separately).

### `codeql.yml` — weekly + on main push

GitHub's free security scanner. Results appear in the Security tab.
Currently configured for JavaScript/TypeScript only.

## Optional but recommended

### Branch protection (Settings → Branches → main)

Require these checks before merge:
- ✅ `App (lint + test + build)`
- ✅ `Firestore Rules (security gate)`

### Status badge (add to top of README.md)

```markdown
[![CI](https://github.com/extraier/vitejs-vite-tbbhdylu/actions/workflows/ci.yml/badge.svg)](https://github.com/extraier/vitejs-vite-tbbhdylu/actions/workflows/ci.yml)
```

### Vercel GitHub App (alternative to `deploy-vercel.yml`)

The official Vercel GitHub App handles builds + deploys more efficiently
than this workflow. Install at https://vercel.com/docs/git/vercel-for-github
and you can delete `deploy-vercel.yml`.

## Local parity

Run the same checks CI runs:

```bash
npm ci --legacy-peer-deps
npm run lint
npm test
npm run build

# Firestore rules (requires Java 11+ + firebase-tools):
npm install -g firebase-tools
firebase emulators:exec --only firestore "node scripts/test-firestore-rules.cjs"
```

## Local prerequisites

Some checks (Firestore emulator) need a JDK on your `PATH`. The
rules-test step is a no-op if Java is missing, but installing it lets
you catch rules regressions before pushing.

| Tool | Why | Install (macOS) |
|---|---|---|
| **Java 11+** | Firestore emulator runtime | `brew install openjdk@11` then `sudo ln -sfn $(brew --prefix openjdk@11)/libexec/openjdk.jdk /Library/Java/JavaVirtualMachines/openjdk-11.jdk` |
| **firebase-tools** | `firebase emulators:exec` + `firebase deploy` | `npm install -g firebase-tools` then `firebase login` |

Verify with:

```bash
java -version       # → openjdk version "11.x" or newer
firebase --version  # → 13.x or newer
```

If `firebase emulators:exec` fails with `Process java -version has
exited with code 1`, the JDK is missing or not on `PATH`. CI runs
the same check on Linux where Java is preinstalled, so this is a
local-only gotcha.

## FIREBASE_TOKEN deploy gate (2026-07-30)

The CI `deploy-functions` step now **hard-fails** when this secret is missing —
previously it silently `exit 0` with a warning, which hid a real production
bug where PR fixes landed but the Cloud Function binary never deployed.

To deliberately skip the deploy for one run (e.g. after a manual CLI deploy
already happened, or for a docs-only PR), set the secret value to the
literal string `SKIP` and the step will exit `0` with a `::notice::`.

The matching workflow change lives on `fix/ci-loud-fail-deploy` (local only
at time of writing — needs a workflow-scope PAT to push). Once it lands,
a merge to main without `FIREBASE_TOKEN` configured will turn CI red and
fail the merge.

### Manual deploy fallback

If `FIREBASE_TOKEN` is unset but you need the Cloud Functions to ship,
`scripts/deploy-functions.sh` does the equivalent deploy from your laptop
using the `firebase-adminsdk-fbsvc@…` SA + a gcloud-minted token.
