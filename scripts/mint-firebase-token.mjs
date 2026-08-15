#!/usr/bin/env node
// 2026-08-15 — mint a Firebase CLI access token from a GCP service
// account JSON. Used by ci.yml as a replacement for the
// `firebase login:ci` flow that required a separate FIREBASE_TOKEN
// secret.
//
// Usage (CI):
//   GCP_SA_KEY='{"type":"service_account",...}' node scripts/mint-firebase-token.mjs
//
// Usage (local dev):
//   GCP_SA_KEY=/path/to/sa.json node scripts/mint-firebase-token.mjs
//
// Output: prints the access token to stdout. CI captures it into
// $GITHUB_OUTPUT via the `mint` step in ci.yml.
//
// The token has scope `https://www.googleapis.com/auth/cloud-platform`
// (the broadest Firebase-CLI-compatible scope). The Firebase CLI
// accepts user-OAuth tokens with a deprecation notice that is
// informational only.

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';

const raw = process.env.GCP_SA_KEY;
if (!raw) {
  console.error('GCP_SA_KEY env var is required (raw JSON content or path to a SA key JSON).');
  process.exit(1);
}

// Accept either raw JSON content or a file path.
let sa;
if (raw.trim().startsWith('{')) {
  sa = JSON.parse(raw);
} else {
  sa = JSON.parse(fs.readFileSync(raw, 'utf8'));
}

const now = Math.floor(Date.now() / 1000);
const header = { alg: 'RS256', typ: 'JWT' };
const payload = {
  iss: sa.client_email,
  scope: 'https://www.googleapis.com/auth/cloud-platform',
  aud: 'https://oauth2.googleapis.com/token',
  iat: now,
  exp: now + 3600,
};

const b64u = (buf) =>
  Buffer.from(buf)
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;

const signer = crypto.createSign('RSA-SHA256');
signer.update(input);
signer.end();
const signature = signer
  .sign(sa.private_key)
  .toString('base64')
  .replace(/=+$/, '')
  .replace(/\+/g, '-')
  .replace(/\//g, '_');

const jwt = `${input}.${signature}`;

const resp = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  }),
});

if (!resp.ok) {
  const errBody = await resp.text();
  console.error(`token mint failed: ${resp.status} ${errBody}`);
  process.exit(1);
}

const body = await resp.json();
// Print ONLY the token to stdout. CI captures it via `$(...)`.
process.stdout.write(body.access_token);