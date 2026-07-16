#!/usr/bin/env node
// Fetch the current valid Firebase web apiKey for the savetheday-2377a
// project. Writes to .env.local (replaces the existing VITE_FIREBASE_API_KEY
// line). Falls back to the Firebase Config REST endpoint if gcloud token
// is available.
const { readFileSync, writeFileSync } = require('node:fs');
const { execSync } = require('node:child_process');

const ENV = `${__dirname}/../.env.local`;

(async () => {
  // Try gcloud token first
  const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();

  const res = await fetch(
    'https://firebase.googleapis.com/v1beta1/projects/savetheday-2377a/webApps/-/config',
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const cfg = await res.json();
  if (!cfg.apiKey) {
    console.error('No apiKey in config response:', JSON.stringify(cfg).slice(0, 200));
    process.exit(1);
  }
  console.log('Fetched apiKey. Validating...');

  // Verify against identitytoolkit
  const val = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${cfg.apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
  );
  const valBody = await val.json();
  if (valBody.error && valBody.error.message === 'MISSING_ID_TOKEN') {
    console.log('apiKey valid (MISSING_ID_TOKEN is expected for empty POST).');
  } else if (valBody.error && valBody.error.message === 'API_KEY_INVALID') {
    console.error('apiKey REVOKED:', JSON.stringify(valBody.error));
    process.exit(2);
  } else {
    console.log('API key accepted:', JSON.stringify(valBody).slice(0, 200));
  }

  // Inject into .env.local
  const env = readFileSync(ENV, 'utf8');
  const updated = env.replace(
    /VITE_FIREBASE_API_KEY=.*/,
    `VITE_FIREBASE_API_KEY=${cfg.apiKey}`,
  );
  writeFileSync(ENV, updated);
  console.log('Wrote apiKey to', ENV);
})();
