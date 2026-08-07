#!/usr/bin/env node
// scripts/demote-accidental-premium.js
//
// One-shot cleanup for the 2026-08-07 UpgradeModal bug.
//
// The bug: src/App.jsx's upgradeToPremium() (since removed) wrote
// tier:'premium' directly to /events/{eventId} on button tap, with NO
// payment. Couples who tapped "立即付款 HK$99 解鎖" in UpgradeModal
// got Premium for free. Anyone who hit that button between deploy
// dates X and Y needs their event.tier reset.
//
// This script identifies "accidentally upgraded" events:
//   - For every event where fields.tier == 'premium'
//   - Walk the owner's /users/{ownerUid}/paymentReceipts subcollection
//   - If EMPTY → the upgrade came from the bug. Clear event.tier.
//   - If NON-EMPTY → the upgrade came from a real PayMe/FPS flow
//     (submitPaymentReceipt → adminVerifyPayment → grantUnlock
//     also writes user.tier, but event.tier can be an admin override).
//     Leave alone.
//
// Usage:
//   # Dry-run: list what would be changed, no writes
//   DRY_RUN=1 node scripts/demote-accidental-premium.js
//
//   # Real run: clear event.tier for affected events
//   node scripts/demote-accidental-premium.js
//
// Required env:
//   GCP_PROJECT        — defaults to savetheday-2377a
//   APP_ID             — defaults to 'savetheday-prod' (matches
//                        /Users/roger/code/vitejs-vite-tbbhdylu/src/lib/firebase.ts)
//   GCLOUD_ACCESS_TOKEN OR run via `gcloud auth print-access-token`
//
// Auth: gcloud is broken on Python 3.9 on this machine, so we
// explicitly set CLOUDSDK_PYTHON=/opt/homebrew/bin/python3.14 in the
// shell. This script takes the access token from the GCLOUD_ACCESS_TOKEN
// env var so we never shell out from Node.

const PROJECT = process.env.GCP_PROJECT || 'savetheday-2377a';
// Firestore root path uses appId, NOT the Firebase web app id.
// Read from src/lib/firebase.ts:resolveAppId() — the default is
//   injected || 'savetheday-production'
// (NOT the web app id "1:1076306848030:..." which is only used
// for Firebase init, never for collection paths.)
// Override with APP_ID env var only if you've changed the default.
const APP_ID = process.env.APP_ID || 'savetheday-production';
const DRY_RUN = process.env.DRY_RUN === '1';

// Read access token. Accept either env var or fail loudly.
function readAccessToken() {
  const t = process.env.GCLOUD_ACCESS_TOKEN;
  if (!t) {
    console.error('Missing GCLOUD_ACCESS_TOKEN. Run:');
    console.error(
      '  CLOUDSDK_PYTHON=/opt/homebrew/bin/python3.14 gcloud auth print-access-token',
    );
    process.exit(2);
  }
  return t.trim();
}

const TOKEN = readAccessToken();

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

// Convert a Firestore REST API "Value" object to plain JS.
function val(v) {
  if (v === undefined || v === null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return parseInt(v.integerValue, 10);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('referenceValue' in v) return v.referenceValue;
  if ('mapValue' in v) return map(v.mapValue);
  if ('arrayValue' in v) {
    return (v.arrayValue.values || []).map(val);
  }
  return null;
}

function map(m) {
  const out = {};
  for (const [k, v] of Object.entries(m.fields || {})) {
    out[k] = val(v);
  }
  return out;
}

// GET a document. Returns null if not found.
async function getDoc(path) {
  const url = `${BASE}/${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${path} → ${res.status}: ${text}`);
  }
  const body = await res.json();
  return map(body);
}

// PATCH a document with an update mask. Returns the response.
async function patchDoc(path, fields, updateMask) {
  // Firestore REST expects fields as { "field": {stringValue: "..."} }
  function toFirestoreValue(v) {
    if (typeof v === 'string') return { stringValue: v };
    if (typeof v === 'number') {
      // Firestore REST: integer if integral, otherwise double.
      if (Number.isInteger(v)) return { integerValue: String(v) };
      return { doubleValue: v };
    }
    if (typeof v === 'boolean') return { booleanValue: v };
    if (v === null) return { nullValue: null };
    if (v && v._delete === true) return { nullValue: null };
    throw new Error(`Unsupported field type for ${JSON.stringify(v)}`);
  }
  const fsFields = {};
  for (const [k, v] of Object.entries(fields)) {
    fsFields[k] = toFirestoreValue(v);
  }
  const url = `${BASE}/${path}?` + updateMask.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields: fsFields }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PATCH ${path} → ${res.status}: ${text}`);
  }
  return await res.json();
}

// List documents in a collection. Handles pagination.
async function listCollection(collPath, pageSize = 300) {
  const out = [];
  let pageToken = null;
  do {
    const url = new URL(`${BASE}/${collPath}`);
    url.searchParams.set('pageSize', String(pageSize));
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (res.status === 404) return out;
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LIST ${collPath} → ${res.status}: ${text}`);
    }
    const body = await res.json();
    for (const doc of body.documents || []) {
      // doc.name is "projects/.../databases/(default)/documents/{path}"
      const id = doc.name.split('/').pop();
      out.push({ id, fields: map(doc) });
    }
    pageToken = body.nextPageToken;
  } while (pageToken);
  return out;
}

// Helper: the Firestore REST path for a subcollection.
// listCollection takes "artifacts/{appId}/users/{uid}/events" — but
// we can't easily filter by field, so we walk all events and filter
// client-side. For 1k events this is fine; if it grows, add a
// composite index + filter expression.
async function listEvents() {
  return listCollection(`artifacts/${APP_ID}/users`);
}

// Walk /artifacts/{appId}/users — for each user, list their events.
async function findPremiumEvents() {
  const users = await listEvents();
  const premiumEvents = [];
  for (const { id: ownerUid, fields: ownerFields } of users) {
    // owner-level tier check. Skip users with NO premium anywhere.
    const events = await listCollection(`artifacts/${APP_ID}/users/${ownerUid}/events`);
    for (const ev of events) {
      if (ev.fields.tier === 'premium') {
        premiumEvents.push({
          ownerUid,
          ownerEmail: ownerFields.email || '(no email)',
          eventId: ev.id,
          eventName: ev.fields.name || '(unnamed)',
          eventTier: ev.fields.tier,
          promotedAt: ev.fields.promotedAt || ev.fields.tierPromotedAt || null,
        });
      }
    }
  }
  return premiumEvents;
}

// For a given ownerUid, list their paymentReceipts. We do this by
// querying the collectionGroup — but the REST API doesn't expose
// collectionGroup queries directly. So we walk /artifacts/{appId}/
// users/{uid}/paymentReceipts per user (only when needed).
async function hasPaymentReceipts(ownerUid) {
  const receipts = await listCollection(
    `artifacts/${APP_ID}/users/${ownerUid}/paymentReceipts`,
  );
  return receipts.length > 0;
}

async function main() {
  console.log(`Project: ${PROJECT}`);
  console.log(`App ID : ${APP_ID}`);
  console.log(`Mode   : ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE — will clear event.tier'}`);
  console.log('');

  const premiumEvents = await findPremiumEvents();
  console.log(`Found ${premiumEvents.length} event(s) with tier='premium'.`);
  console.log('');

  const toDemote = [];
  const toKeep = [];
  for (const ev of premiumEvents) {
    const has = await hasPaymentReceipts(ev.ownerUid);
    if (has) {
      toKeep.push(ev);
    } else {
      toDemote.push(ev);
    }
  }

  console.log('=== WILL DEMOTE (no paymentReceipts — bug-affected) ===');
  if (toDemote.length === 0) {
    console.log('  (none)');
  } else {
    for (const ev of toDemote) {
      console.log(`  • ${ev.ownerEmail}  →  ${ev.eventName}  (eventId=${ev.eventId})`);
    }
  }
  console.log('');
  console.log('=== WILL LEAVE ALONE (has paymentReceipts — real payment) ===');
  if (toKeep.length === 0) {
    console.log('  (none)');
  } else {
    for (const ev of toKeep) {
      console.log(`  • ${ev.ownerEmail}  →  ${ev.eventName}  (eventId=${ev.eventId})`);
    }
  }
  console.log('');

  if (DRY_RUN) {
    console.log(`Dry run complete. Re-run without DRY_RUN=1 to apply.`);
    return;
  }

  if (toDemote.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  console.log(`Clearing event.tier for ${toDemote.length} event(s)...`);
  for (const ev of toDemote) {
    const path = `artifacts/${APP_ID}/users/${ev.ownerUid}/events/${ev.eventId}`;
    await patchDoc(
      path,
      { tier: null },
      ['tier'],
    );
    console.log(`  ✓ cleared ${ev.eventId} (${ev.eventName})`);
  }

  console.log('');
  console.log(`Done. ${toDemote.length} event(s) demoted, ${toKeep.length} preserved.`);
}

main().catch((e) => {
  console.error('FATAL:', e.message || e);
  if (e.stack) console.error(e.stack);
  process.exit(1);
});