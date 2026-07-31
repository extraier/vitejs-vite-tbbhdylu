# Save The Day (香港婚禮 SaaS)

[![CI](https://github.com/extraier/vitejs-vite-tbbhdylu/actions/workflows/ci.yml/badge.svg)](https://github.com/extraier/vitejs-vite-tbbhdylu/actions/workflows/ci.yml)
[![CodeQL](https://github.com/extraier/vitejs-vite-tbbhdylu/actions/workflows/codeql.yml/badge.svg)](https://github.com/extraier/vitejs-vite-tbbhdylu/actions/workflows/codeql.yml)

A wedding planning web app for Hong Kong + Taiwan couples — guest list, photo drops, vendor directory, QR-code check-in, real-time reception coordination.

## Stack

- Frontend: React + TypeScript + Vite
- Backend: Firebase Auth + Firestore + Cloud Functions (Gen 2, Node 20, us-central1)
- Email: SendGrid v3 (custom branded transactional email)
- Hosting: Vercel (front-end, CDN + edge cache)

## Codebase

```
src/
  screens/       route-level screens (WeddingDay, VendorDashboard, etc.)
  components/    shared UI (modals/, design-system helpers)
  hooks/         client-side data hooks (useAuth, useUserProfile, ...)
  lib/           pure modules + Firebase wrappers (firebase.ts, config.ts)
  assets/        co-located static images
public/
  favicon.svg    branded Save The Day heart (rose #f43f5e)
  og-image.svg   Open Graph preview card (1200×630)
  templates/     invitation design templates (rose, blush, sage, jade, midnight, plain)
functions/src/   Cloud Functions
  brandedEmail.ts        Firebase Auth verification email (CF v2)
  partnerInvite.ts       bride ↔ partner invite flow
  vendorInviteTrigger.ts vendor onboarding emails
  ...
```

## Conventions

- Bilingual UI (繁體中文 primary, English fallback)
- Cantonese copy preferred for end-user-facing labels
- Money: integer cents (HKD). Never floats.
- Time: `HH:MM` strings for wedding-day scheduling; `Date.now()` for ordering.
- Phone numbers: E.164 (e.g. `+85291234567`). Strip before display.

## CI / Deploy

- PRs go to `main` (the project is single-branch; merge fast-forward).
- Vercel auto-deploys on push to `main`.
- Cloud Functions deploy manually via `npx firebase deploy --only functions:<name> --project savetheday-2377a --force` after a `touch` on the function file (forces re-upload).
