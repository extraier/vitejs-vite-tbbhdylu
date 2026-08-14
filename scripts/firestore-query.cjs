#!/usr/bin/env node
/**
 * firestore-query.js — helper for Playwright integration tests.
 *
 * Reads a marker from argv, queries the cspReports collection,
 * and prints matching docs as JSON (one per line).
 *
 * Usage: node firestore-query.js <marker>
 *   GCLOUD_SA_KEY   optional — service account JSON content (preferred
 *                   in CI; the entire key JSON as a string). Also accepts
 *                   a path to a SA key JSON file for local dev.
 *   GCR_AUTH_TOKEN  optional — gcloud access token (not used; reserved
 *                   for a future REST path if needed)
 *
 * 2026-08-14 — first version. Uses the Node SDK because the
 * Python gcloud CLI auth was broken by Python 3.9 deprecation
 * on this machine.
 *
 * 2026-08-14 — second version: GCLOUD_SA_KEY can now be either a
 * file path (local dev) or the raw JSON content (CI secret).
 * Auto-detected by whether the value starts with '{'.
 */

const { Firestore } = require('@google-cloud/firestore');
const path = require('path');
const os = require('os');

async function main() {
  const marker = process.argv[2];
  if (!marker) {
    console.error('Usage: node firestore-query.js <marker>');
    process.exit(2);
  }

  const projectId = process.env.FIRESTORE_PROJECT || 'savetheday-2377a';
  const appId = process.env.APP_ID || 'savetheday-production';
  const collection = `artifacts/${appId}/admin/cspReports/reports`;

  // Resolve credentials. GCLOUD_SA_KEY can be either:
  //   1. A file path (local dev with ~/.firebase-keys/*.json)
  //   2. Raw JSON content (GitHub Actions secret — the entire SA key JSON)
  // We detect which by trying JSON.parse first; if it parses, treat as content.
  let credentials;
  let saKey = process.env.GCLOUD_SA_KEY ||
    path.join(os.homedir(), '.firebase-keys', 'savetheday-2377a.json');

  if (saKey && saKey.trim().startsWith('{')) {
    // Looks like raw JSON content (GitHub secret).
    try {
      credentials = JSON.parse(saKey);
    } catch (e) {
      console.error('GCLOUD_SA_KEY looks like JSON but failed to parse:', e.message);
      process.exit(2);
    }
  }
  // Else: it's a file path — pass through to keyFilename.

  const db = new Firestore(
    credentials
      ? { projectId, credentials }
      : { projectId, keyFilename: saKey }
  );

  // 2026-08-14 — second version: use a where filter on documentUri
  // so we get docs for this marker regardless of how many docs
  // are in the collection. The previous version fetched the first
  // 50 docs and filtered client-side; that worked when the
  // collection had <50 docs but became flaky once we crossed that
  // threshold (78 docs as of the CSP fix rollout). Firestore
  // eventual consistency means the writer side commits
  // immediately but reads may lag by 1-3 seconds.
  //
  // We retry up to MAX_RETRIES times with exponential backoff.
  // Retry loop: Firestore eventual consistency means writes are
  // visible on the next read after a brief propagation delay
  // (~100-300ms typically; can spike to 1-3s under load). We
  // give it up to ~5s total to land.
  const MAX_RETRIES = 8;
  const BASE_DELAY_MS = 300;
  const matches = [];
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const snap = await db
      .collection(collection)
      .where('documentUri', '>=', `https://savetheday.io/p/${marker}`)
      .where('documentUri', '<', `https://savetheday.io/p/${marker}~`)
      .get();
    snap.forEach(d => {
      matches.push({ id: d.id, ...d.data() });
    });
    if (matches.length > 0) break;
    await new Promise((r) => setTimeout(r, BASE_DELAY_MS * Math.pow(1.4, attempt)));
  }
  console.log(JSON.stringify(matches, null, 2));
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
