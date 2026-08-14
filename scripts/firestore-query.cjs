#!/usr/bin/env node
/**
 * firestore-query.js — helper for Playwright integration tests.
 *
 * Reads a marker from argv, queries the cspReports collection,
 * and prints matching docs as JSON (one per line).
 *
 * Usage: node firestore-query.js <marker>
 *   GCR_AUTH_TOKEN  optional — gcloud access token (preferred)
 *   GCLOUD_SA_KEY   optional — service account JSON path (fallback)
 *
 * 2026-08-14 — first version. We use the REST API path here
 * because gcloud's Python 3.9 deprecation broke the CLI auth
 * on this machine. The REST API is more portable.
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

  // Resolve credentials. Prefer SA key (most portable).
  const saKey = process.env.GCLOUD_SA_KEY ||
    path.join(os.homedir(), '.firebase-keys', 'savetheday-2377a.json');

  const db = new Firestore({ projectId, keyFilename: saKey });
  const snap = await db.collection(collection).limit(50).get();
  const matches = [];
  snap.forEach(d => {
    const data = d.data();
    const uri = (data.documentUri || '') + ' ' + (data.blockedUri || '');
    if (uri.includes(marker)) {
      matches.push({ id: d.id, ...data });
    }
  });
  console.log(JSON.stringify(matches, null, 2));
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
