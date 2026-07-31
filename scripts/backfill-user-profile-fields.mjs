#!/usr/bin/env node
// 2026-07-31 — one-off backfill for user profile fields.
//
// Problem: `onUserCreate` (beforeUserCreated trigger) writes
// referralCode + referralCodeCreatedAt on signup, but NOT createdAt,
// and it only fires for NEW signups. Existing users whose docs were
// created before the trigger shipped (or before this fix) have neither
// referralCode nor createdAt — so the profile screen shows 推薦碼: （載入中)
// and 註冊時間: —.
//
// This script:
//   1. Lists all Firebase Auth users (via IdentityToolkit REST).
//   2. For each user, reads their Firestore doc at
//      /artifacts/savetheday-production/users/{uid}.
//   3. If the doc is missing referralCode, mints one (same alphabet
//      + length as the CF). If missing createdAt, stamps it from
//      Auth user metadata.creationTime.
//
// Idempotent: re-running the script is a no-op for users who already
// have both fields.
//
// Requires: ADMIN reach (gcloud access token works fine via REST).
//
// Run:
//   gcloud auth login
//   gcloud config set project savetheday-2377a
//   node scripts/backfill-user-profile-fields.mjs [--dry-run]

import crypto from 'node:crypto';

const PROJECT = 'savetheday-2377a';
const APP_ID  = 'savetheday-production';

const REFERRAL_PREFIX = 'STD';
const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
const REFERRAL_CODE_LEN = 5;

function generateReferralCode() {
  const bytes = crypto.randomBytes(REFERRAL_CODE_LEN);
  let out = '';
  for (let i = 0; i < REFERRAL_CODE_LEN; i++) {
    out += REFERRAL_ALPHABET[bytes[i] % REFERRAL_ALPHABET.length];
  }
  return `${REFERRAL_PREFIX}-${out}`;
}

async function getAccessToken() {
  const { execSync } = await import('node:child_process');
  return execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
}

async function firestoreGET(path, token) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${path}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET ${path} → ${r.status} ${await r.text()}`);
  return r.json();
}

async function firestorePATCH(path, fields, token) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${path}`;
  const body = { fields };
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`PATCH ${path} → ${r.status} ${await r.text()}`);
  return r.json();
}

// Fetch every Auth user via Identity Toolkit REST API.
async function listAllAuthUsers(token) {
  const all = [];
  let nextPageToken = null;
  let pageNum = 0;
  do {
    const body = {
      maxResults: 100,
      ...(nextPageToken ? { nextPageToken } : {}),
    };
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:query`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (!r.ok) throw new Error(`accounts:query → ${r.status} ${await r.text()}`);
    const data = await r.json();
    all.push(...(data.userInfo ?? []));
    pageNum++;
    nextPageToken = data.nextPageToken || null;
    // Safety cap so we don't infinite-loop on a broken response
    if (pageNum > 200) {
      console.warn(`hit 200-page cap with nextPageToken still set; stopping pagination`);
      break;
    }
  } while (nextPageToken);
  return all;
}

function firestoreTimestampValue(authCreationTime) {
  // Auth metadata.creationTime comes as a number (unix millis) — see
  // https://firebase.google.com/docs/auth/admin/manage-users for the
  // Identity Toolkit REST shapes (createdAt/lastLoginAt are stringified
  // millis). Convert to ISO 8601 then to a Firestore timestampValue.
  if (authCreationTime == null) return null;
  const d = new Date(typeof authCreationTime === 'number'
    ? authCreationTime
    : Number(authCreationTime));
  if (isNaN(d.getTime())) return null;
  return { timestampValue: d.toISOString() };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const token = await getAccessToken();
  console.log(`mode: ${dryRun ? 'DRY-RUN' : 'WRITE'}`);

  const authUsers = await listAllAuthUsers(token);
  console.log(`found ${authUsers.length} Auth users in project ${PROJECT}`);

  let updated = 0;
  let skipped = 0;
  let missing = 0;
  let errors = 0;
  const summary = [];

  for (const u of authUsers) {
    const uid = u.localId;
    if (!uid) { skipped++; continue; }
    const meta = {
      email: u.email || null,
      creationTime: u.createdAt || null, // "YYYY-MM-DDTHH:MM:SSZ"
      lastSignInTime: u.lastLoginAt || null,
    };

    const path = `artifacts/${APP_ID}/users/${uid}`;
    let doc;
    try {
      doc = await firestoreGET(path, token);
    } catch (e) {
      errors++;
      console.warn(`! error reading ${uid}: ${e.message}`);
      continue;
    }

    const fields = doc?.fields || {};
    const haveReferral = !!fields.referralCode?.stringValue;
    const haveCreatedAt = !!fields.createdAt?.timestampValue;

    const needReferral = !haveReferral;
    const needCreatedAt = !haveCreatedAt;

    if (!needReferral && !needCreatedAt) {
      skipped++;
      continue;
    }

    const updates = {};
    if (needReferral) updates.referralCode = { stringValue: generateReferralCode() };
    if (needCreatedAt) {
      const ts = firestoreTimestampValue(meta.creationTime);
      if (ts) updates.createdAt = ts;
      else missing++;
    }

    if (Object.keys(updates).length === 0) {
      skipped++;
      continue;
    }

    summary.push({
      uid,
      email: meta.email,
      authCreatedAt: meta.creationTime,
      addingReferral: needReferral,
      addingCreatedAt: needCreatedAt && !!updates.createdAt,
      referralValue: updates.referralCode?.stringValue ?? null,
    });

    if (!dryRun) {
      try {
        await firestorePATCH(path, updates, token);
        updated++;
      } catch (e) {
        errors++;
        console.warn(`! error writing ${uid}: ${e.message}`);
      }
    } else {
      updated++; // count planned writes
    }
  }

  console.log();
  console.log(`=== summary ===`);
  console.log(`total auth users: ${authUsers.length}`);
  console.log(`updated (or would update): ${updated}`);
  console.log(`already had both fields (skipped): ${skipped}`);
  console.log(`missing creationTime on auth (couldn't backfill createdAt): ${missing}`);
  console.log(`errors: ${errors}`);
  console.log();

  if (summary.length > 0) {
    console.log(`=== first ${Math.min(20, summary.length)} planned updates ===`);
    for (const s of summary.slice(0, 20)) {
      console.log(
        `  ${s.uid}  ${s.email ?? '(no email)'}  ` +
        `createdAuth=${s.authCreatedAt ?? '—'}  ` +
        `addRef=${s.addingReferral}  addCreatedAt=${s.addingCreatedAt}` +
        (s.referralValue ? `  → referral=${s.referralValue}` : ''),
      );
    }
    if (summary.length > 20) console.log(`  …and ${summary.length - 20} more`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
