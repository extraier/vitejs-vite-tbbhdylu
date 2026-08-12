// End-to-end test: simulate the fixed path extraction and post a vendor comment.
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const fs = require('node:fs');
const { execSync } = require('node:child_process');

const sa = require('/Users/roger/.firebase-keys/savetheday-2377a.json');
const app = initializeApp({ credential: cert(sa) }, 'sim-' + Date.now());

// Use the actual wedding owner's uid (the couple's tree). Vendor
// can write because rules + CF allow it.
const ownerUid = 'G0Twjl9wKdfmfrkR9asj4PApTot2';
const eventId = 'gIF9yBcLxFyYUDumlgyi';
const rundownId = 'rd-1785560001887';

(async () => {
  const token = await getAuth(app).createCustomToken(ownerUid, { vendor: true });

  // Write the custom token + API key to a tmpfile for the bash step.
  const src = fs.readFileSync('/Users/roger/projects/vitejs-vite-tbbhdylu/src/lib/firebase.ts', 'utf8');
  const apiKey = src.match(/apiKey:\s*'([^']+)'/)[1];
  fs.writeFileSync('/tmp/e2e_tokens.json', JSON.stringify({ token, apiKey }));

  console.log('Custom token minted. ownerUid=' + ownerUid + ' eventId=' + eventId);
  process.exit(0);
})();