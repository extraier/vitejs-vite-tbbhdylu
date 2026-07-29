# Premium User Build — Plan

**Goal:** Make a user become premium (user-scoped, not event-scoped) via referral
or social proof. Premium status is visible in 3 places:

1. **Main lobby** (`EventsDashboard.tsx`) — premium badge visible to others
2. **Photo album** (`PhotoDrop.jsx`) — unlocks unlimited storage + watermark-off
3. **Invitation card** (`InvitationEditor.jsx`) — unlocks custom invite template upload

## Current state

| Layer | Status |
|---|---|
| Cloud Functions in `unlocks.ts` | 6 callables + `grantUnlock` (idempotent writer) — built |
| `firestore.rules` for /unlocks, /socialProofs, /referralClaims, /paymentReceipts | defined — built |
| `EventsDashboard` reads `event.tier === 'premium'` | built but **event-scoped**, not user-scoped |
| `PhotoDrop` reads `isPremium` prop (from App.jsx `currentEvent?.tier`) | built but **event-scoped** |
| `InvitationEditor` reads `ownerTier` prop | built but **event-scoped** |
| `RewardsBanner` UI (earn-vs-pay copy) | built |
| `submitPaymentReceipt` front-end caller | works (only live CF caller) |
| Front-end callers for `claimReferral` / `submitSocialProof` | **missing — 0 references** |
| `SocialProofModal` / `ReferralModal` components | **missing — TODO stubs** |
| `referralCode` auto-mint on signup | **missing** |
| `referredByCode` write on signup | **missing** |
| Share UI (copy referral link, QR) | **missing** |
| Admin queue UI | **missing — backend only** |

**Net effect today:** payment path works (with admin verification); referral and
social-proof paths have no UI, no attribution, and no auto-grant. Premium user
exists conceptually but cannot be earned.

## Architectural decision

The current code gates on `event.tier`. The user's spec is **user-scoped** —
becoming premium via referral should unlock across ALL of that user's events,
not just one. We will:

- Introduce `users/{uid}.tier` as the canonical premium flag (independent of events)
- Keep `event.tier` as a per-event override (e.g. "this wedding is premium-tied")
- Default user gating to user-scope tier; fall back to event-scope for legacy
- Phase 4 migration writes `tier: 'premium'` onto `users/{uid}` whenever any
  unlock is granted — auto-promotion

## Build order — 4 phases, each end-to-end verifiable

### Phase 1 — Referral attribution plumbing (no UI change)

**1a. `onUserCreate` Auth trigger** (new file `functions/src/referralCodes.ts`)
- On user signup → write `users/{uid}.referralCode = 'STD-' + nanoid(5)`
- Idempotent (only writes if missing)
- Backfill script for existing users: `scripts/backfill-referral-codes.mjs`

**1b. Sign-up attribution** (modify `useAuth.js` or signup handler in `App.jsx`)
- Read `?ref=STD-XXXXX` from URL on app boot, stash in sessionStorage
- During `createUserWithEmailAndPassword` / sign-up → pass to a new CF
  `applyReferralAttribution({ code })`
- CF validates: code exists; rejects self; writes `referredByCode` on new user doc

**1c. Firestore rules**
- Allow server-only writes to `users/{uid}.referralCode` and `referredByCode`
  (already implicit via `match /users/{ownerUid}` — verify + add explicit
  write restriction)

**Tests:** emulator unit test for the onUserCreate trigger + applyReferralAttribution
attribution path. End-to-end: signup user A → signup user B with `?ref=A's code`
→ confirm `B.referredByCode === A.referralCode`.

---

### Phase 2 — Referral auto-grant + share/claim UI

**2a. New CF `requestReferralClaim({ friendEmail })`** (in `unlocks.ts`)
- Resolve email → uid via Auth admin API
- Check `friend.referredByCode === caller.referralCode`
- Check friend has ≥1 event
- **Auto-grant** `storage-500mb` unlock with source `'referral'` (no admin step —
  this is the moment the user becomes premium)
- Idempotency: don't double-grant
- Returns `{ ok: true, unlockId }`

**2b. New CF `getMyReferralInfo`** (in `referralCodes.ts`)
- Returns `{ code: 'STD-XXXXX', shareUrl, referredCount, claimedCount }`
- Used by the share UI to show "X friends signed up, Y became active"

**2c. New UI `ReferralModal.tsx`** (under `src/components/modals/`)
- Tab 1 "Share": copy-link button + QR code (using existing qrcode lib)
- Tab 2 "Claim a friend": paste friend's email → calls `requestReferralClaim`
- Tab 3 "Track": shows referrals from `getMyReferralInfo`
- Triggered from `RewardsBanner` "Earn via referral" button (replaces TODO)

**Tests:** emulator test that A's referral → B signs up with `?ref=A` → B creates
event → A calls `requestReferralClaim({ friendEmail: B.email })` → unlock granted.
Front-end smoke test for ReferralModal render + click flow.

---

### Phase 3 — Social proof flow

**3a. New UI `SocialProofModal.tsx`** (replaces TODO in `RewardsBanner.tsx:16`)
- For `custom-template` and `permanent-archive` unlock types
- Paste IG/FB URL + select unlock type → calls existing `submitSocialProof`
- Shows status (`pending` / `approved` / `rejected`) for own submissions
- Reads from `/users/{uid}/socialProofs` subcollection (existing rule)

**3b. Wire RewardsBanner "上傳" button** to open this modal

**Tests:** smoke test for SocialProofModal render + submission. Manual verification
of admin verification path (existing `adminVerifySocialProof`).

---

### Phase 4 — Tier promotion + admin queue + lobby badge

**4a. Auto-promote user to tier='premium'** on any unlock grant
- Modify `grantUnlock()` in `unlocks.ts` — after successful write, set
  `users/{uid}.tier = 'premium'` if not already
- Backfill: one-shot script `scripts/promote-unlocked-users.mjs` to write tier
  for any user who already has unlocks but tier !== 'premium'

**4b. Front-end: read user-scope tier**
- `App.jsx`: introduce `userTier` (read from `users/{uid}` doc), make
  `isPremium = userTier === 'premium' || currentEvent?.tier === 'premium'`
  (preserves per-event override)
- Pass `userTier` down through PhotoDrop, InvitationEditor

**4c. Lobby badge** — `EventsDashboard.tsx` shows the OWNER's premium status
above their event list (separate from per-event badge). Already partially exists
in the existing per-event badge — add a top-level "👑 Premium Member" strip
for the current user.

**4d. Admin queue page** (new `src/screens/AdminQueue.tsx`)
- List pending `socialProofs` + `referralClaims` + `paymentReceipts`
- Click row → inline approve/reject with reason → calls existing
  `adminVerifySocialProof` / `adminVerifyReferral` / `adminVerifyPayment`
- Mounted conditionally on `user.isAdmin === true`

**Tests:** verify auto-promotion on each grant path. Verify lobby badge shows
for premium users. Verify admin queue renders for admin only.

---

## Cross-cutting concerns

- **Firestore rules** — verified for all 4 phases; no rule changes needed beyond
  Phase 1c (explicit server-write allowlist for `referralCode` / `referredByCode`)
- **Indexes** — collectionGroup queries on `socialProofs` + `referralClaims` may
  need new single-field indexes; add to `firestore.indexes.json` if so
- **Backwards compatibility** — `event.tier` continues to work; user-scope tier
  is additive (free → premium on first unlock grant)
- **Idempotency** — every grant path is already idempotent via `grantUnlock()`
  checking for existing unlock before write

## Verification plan (post-build)

1. `cd functions && firebase emulators:exec --only firestore,firestore,auth 'FIRESTORE_RULES_TEST=1 npx vitest run'` — all CF + rules tests pass
2. `npm test` (top-level) — all 85+ front-end tests pass, including new smoke tests for ReferralModal + SocialProofModal
3. End-to-end manual flow on staging:
   - User A signs up → gets referral code
   - User B signs up with `?ref=A` → attributed
   - B creates an event
   - A calls ReferralModal claim → A becomes premium
   - A's PhotoDrop shows no storage limit + no "升級 Premium" button
   - A's InvitationEditor enables custom-template upload
   - A's EventsDashboard shows premium badge above their event list
4. Smoke round-trip via Firestore REST write (mirror of the chat.js pattern we used earlier)

## Estimated scope

- 4 new files (referralCodes.ts, ReferralModal.tsx, SocialProofModal.tsx, AdminQueue.tsx)
- 5 modified files (useAuth.js / App.jsx signup, unlocks.ts grantUnlock, App.jsx tier wiring,
  EventsDashboard.tsx badge, InvitationEditor.jsx tier prop)
- 2 backfill scripts
- ~600 LOC of new code, ~80 LOC modified

## Out of scope (deliberate)

- Stripe / PayMe automated payment verification (current PayMe/FPS screenshot
  verification is manual — admin queue handles it)
- Mobile app (web only)
- Multi-language UI for the new modals (will use the same zh-HK strings already
  in the codebase)
- Anti-abuse: rate-limiting on `requestReferralClaim` (could be a Phase 5 if
  abuse is observed in production)