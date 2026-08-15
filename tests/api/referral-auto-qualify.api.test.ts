// 2026-08-15 — Playwright integration test for the auto-qualify
// referral trigger (commit fe8da63). Skipped unless GCLOUD_SA_KEY
// is available, since we hit Firestore as a service-account admin
// to set up + verify the test docs.
//
// What it does:
//   1. Create referrer doc + referred doc via Firestore REST.
//   2. Create a first event under referredUid — this fires
//      onEventCreated.
//   3. Poll the referrer doc for qualifiedReferralCount == 1
//      and verify storage-500mb + watermark-removed unlocks were
//      written.
//   4. Clean up all created docs.
//
// Why a separate test file (not extending the existing api/ suite):
// the auto-qualify trigger is a Firestore event handler, not an
// HTTP endpoint. It has no URL to hit. We exercise it by writing
// the upstream Firestore events and observing the side effects —
// same pattern as the CSP integration tests, but driven entirely
// from the client side (no savetheday.io HTTP route involved).

import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const HAS_SA = !!process.env.GCLOUD_SA_KEY;
const PROJECT = 'savetheday-2377a';
const APP_ID = 'savetheday-production';

// Mint a Bearer token directly from the SA JSON using Node
// stdlib (crypto + fetch). Cached for ~50min to avoid one
// round-trip per Firestore call.
let cachedToken: { value: string; expiry: number } | null = null;

async function saToken(): Promise<string> {
  if (cachedToken && cachedToken.expiry > Date.now() + 60_000) {
    return cachedToken.value;
  }
  const raw = process.env.GCLOUD_SA_KEY || '';
  let sa: any;
  if (raw.startsWith('{')) {
    sa = JSON.parse(raw);
  } else if (raw) {
    sa = JSON.parse(fs.readFileSync(raw, 'utf8'));
  } else {
    const home = os.homedir();
    const candidate = path.join(home, '.firebase-keys', `${PROJECT}.json`);
    sa = JSON.parse(fs.readFileSync(candidate, 'utf8'));
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const enc = (o: object) =>
    Buffer.from(JSON.stringify(o))
      .toString('base64')
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  const input = `${enc(header)}.${enc(payload)}`;

  const crypto = await import('node:crypto');
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(input);
  signer.end();
  const signature = signer
    .sign(sa.private_key)
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${input}.${signature}`,
    }),
  });
  if (!resp.ok) {
    throw new Error(`token mint failed: ${resp.status}: ${await resp.text()}`);
  }
  const body = await resp.json();
  cachedToken = {
    value: body.access_token,
    expiry: now + body.expires_in,
  };
  return cachedToken.value;
}

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

async function fCreate(parentPath: string, docId: string, fields: Record<string, any>): Promise<any> {
  const tok = await saToken();
  const url = `${BASE}/${parentPath}?documentId=${docId}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!resp.ok) {
    throw new Error(`create ${parentPath}/${docId} → ${resp.status}: ${await resp.text()}`);
  }
  return resp.json();
}

async function fGet(path: string): Promise<any | null> {
  const tok = await saToken();
  const resp = await fetch(`${BASE}/${path}`, {
    headers: { 'Authorization': `Bearer ${tok}` },
  });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`get ${path} → ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

async function fListCollection(path: string): Promise<any[]> {
  const tok = await saToken();
  const resp = await fetch(`${BASE}/${path}`, {
    headers: { 'Authorization': `Bearer ${tok}` },
  });
  if (!resp.ok) throw new Error(`list ${path} → ${resp.status}: ${await resp.text()}`);
  const body = await resp.json();
  return body.documents || [];
}

async function fDelete(path: string): Promise<void> {
  const tok = await saToken();
  const resp = await fetch(`${BASE}/${path}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${tok}` },
  });
  if (!resp.ok && resp.status !== 404) {
    throw new Error(`delete ${path} → ${resp.status}: ${await resp.text()}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test.describe('Auto-qualify referral trigger (cloud function)', () => {
  test.skip(!HAS_SA, 'GCLOUD_SA_KEY not configured — skipping integration test');

  let referrerUid: string;
  let referredUid: string;
  let eventId: string;

  test.beforeEach(() => {
    // UIDs use a unique suffix so reruns don't collide
    const tag = randomUUID().slice(0, 8);
    referrerUid = `pw-referrer-${tag}`;
    referredUid = `pw-referred-${tag}`;
    eventId = `pw-event-${tag}`;
  });

  test.afterEach(async () => {
    // Best-effort cleanup
    const paths = [
      `artifacts/${APP_ID}/users/${referrerUid}/unlocks`,
      `artifacts/${APP_ID}/users/${referrerUid}/referralQualifications/${referredUid}`,
      `artifacts/${APP_ID}/users/${referrerUid}`,
      `artifacts/${APP_ID}/users/${referredUid}/events/${eventId}`,
      `artifacts/${APP_ID}/users/${referredUid}`,
    ];
    // For unlocks: list then delete each
    try {
      const unlocks = await fListCollection(paths[0]);
      for (const u of unlocks) {
        const p = u.name.split('/documents/')[1];
        await fDelete(p);
      }
    } catch {}
    for (const p of paths.slice(1)) {
      try { await fDelete(p); } catch {}
    }
  });

  test('first event under referred user auto-grants referrer unlocks', async () => {
    // 1. Set up: referrer doc + referred doc with referredByUid
    await fCreate(
      `artifacts/${APP_ID}/users`,
      referrerUid,
      {
        uid: { stringValue: referrerUid },
        email: { stringValue: `${referrerUid}@playwright.test` },
        referralCode: { stringValue: `PW${referrerUid.slice(-6).toUpperCase()}` },
        qualifiedReferralCount: { integerValue: '0' },
        tier: { stringValue: 'free' },
      },
    );

    await fCreate(
      `artifacts/${APP_ID}/users`,
      referredUid,
      {
        uid: { stringValue: referredUid },
        email: { stringValue: `${referredUid}@playwright.test` },
        referredByUid: { stringValue: referrerUid },
        tier: { stringValue: 'free' },
      },
    );

    // 2. Create the first event — fires onEventCreated
    await fCreate(
      `artifacts/${APP_ID}/users/${referredUid}/events`,
      eventId,
      {
        name: { stringValue: 'PW Wedding' },
        ownerUid: { stringValue: referredUid },
      },
    );

    // 3. Poll the referrer doc for the FULL set of side effects:
    //    qualifiedReferralCount === 1, tier === premium, AND
    //    both unlocks present. The trigger bumps qrc in step 4
    //    and tier in step 5, so we have to wait for both to land.
    //    budget ~30s for cold-start + write propagation.
    let finalDoc: any = null;
    let unlocksReady = false;
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      const doc = await fGet(`artifacts/${APP_ID}/users/${referrerUid}`);
      if (!doc) continue;
      const qrc = doc.fields?.qualifiedReferralCount?.integerValue;
      const tier = doc.fields?.tier?.stringValue;
      if (qrc === '1' && tier === 'premium') {
        // Check unlocks separately (last step in trigger).
        const unlocks = await fListCollection(
          `artifacts/${APP_ID}/users/${referrerUid}/unlocks`,
        );
        const types = unlocks
          .map((u: any) => u.fields?.type?.stringValue)
          .filter(Boolean);
        if (types.includes('storage-500mb') && types.includes('watermark-removed')) {
          finalDoc = doc;
          unlocksReady = true;
          break;
        }
      }
    }

    expect(finalDoc, 'qualifiedReferralCount=1 + tier=premium should both be set').not.toBeNull();
    expect(unlocksReady, 'both unlocks should be present').toBe(true);
    expect(finalDoc.fields.qualifiedReferralCount.integerValue).toBe('1');
    expect(finalDoc.fields.tier.stringValue).toBe('premium');

    // 4. Verify unlocks were written
    const unlocks = await fListCollection(
      `artifacts/${APP_ID}/users/${referrerUid}/unlocks`,
    );
    const types = unlocks
      .map((u: any) => u.fields?.type?.stringValue)
      .filter(Boolean);
    expect(types).toContain('storage-500mb');
    expect(types).toContain('watermark-removed');

    // 5. Verify qualification record
    const qual = await fGet(
      `artifacts/${APP_ID}/users/${referrerUid}/referralQualifications/${referredUid}`,
    );
    expect(qual, 'qualification record should exist').not.toBeNull();
    expect(qual.fields.referredUid.stringValue).toBe(referredUid);
  });

  test('idempotent: re-firing on a second event does not double-count', async () => {
    // Set up
    await fCreate(`artifacts/${APP_ID}/users`, referrerUid, {
      uid: { stringValue: referrerUid },
      qualifiedReferralCount: { integerValue: '0' },
      tier: { stringValue: 'free' },
    });
    await fCreate(`artifacts/${APP_ID}/users`, referredUid, {
      uid: { stringValue: referredUid },
      referredByUid: { stringValue: referrerUid },
    });

    // First event — bumps the count
    await fCreate(
      `artifacts/${APP_ID}/users/${referredUid}/events`,
      eventId,
      { name: { stringValue: 'First event' } },
    );
    // Wait for first trigger
    let firstBump = false;
    for (let i = 0; i < 30 && !firstBump; i++) {
      await sleep(500);
      const doc = await fGet(`artifacts/${APP_ID}/users/${referrerUid}`);
      if (doc?.fields?.qualifiedReferralCount?.integerValue === '1') firstBump = true;
    }
    expect(firstBump, 'first event should bump count to 1').toBe(true);

    // Second event — should NOT bump (already qualified)
    const secondEventId = `${eventId}-2`;
    await fCreate(
      `artifacts/${APP_ID}/users/${referredUid}/events`,
      secondEventId,
      { name: { stringValue: 'Second event' } },
    );
    // Give the trigger time to attempt the second event
    await sleep(5000);

    const after = await fGet(`artifacts/${APP_ID}/users/${referrerUid}`);
    expect(
      after?.fields?.qualifiedReferralCount?.integerValue,
      'count should still be 1 after second event (idempotent)',
    ).toBe('1');
    expect(
      after?.fields?.tier?.stringValue,
      'tier should remain premium (no regression on second event)',
    ).toBe('premium');
  });
});