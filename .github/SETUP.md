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

This single token authorizes the workflow to:
- Deploy `firestore.rules`
- Deploy `functions/` (the issueGuestLink / redeemGuestLink Cloud Functions)
- Optionally deploy Firebase Hosting

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

# Firestore rules (requires Java 17 + firebase-tools):
npm install -g firebase-tools
firebase emulators:exec --only firestore "node scripts/test-firestore-rules.js"
```