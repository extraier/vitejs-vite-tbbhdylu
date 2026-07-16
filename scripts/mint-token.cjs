// Mint a Firebase custom token for owner UID 4Hu0UQ1zyJbzKiTP30jMpWDUDz12
// using the savetheday-2377a service account. Token can be exchanged
// client-side via firebase.auth().signInWithCustomToken('<token>').
//
// Run: node scripts/mint-token.cjs
//
// Hermes 2026-07-03: used to debug blank page on /couple-guests tab.
// Output: C.../E.../I.../R... blocks separated by --- markers.
//         Pipe CUSTOM_TOKEN into the browser console via browser_console
//         to sign in as that UID without needing a password.
const { readFileSync } = require('node:fs');
const { homedir } = require('node:os');
const { cert, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const SA = `${homedir()}/.config/gcloud/legacy_credentials/firebase-adminsdk-fbsvc@savetheday-2377a.iam.gserviceaccount.com/adc.json`;
const ENV_LOCAL = `${__dirname}/../.env.local`;

const envText = readFileSync(ENV_LOCAL, 'utf8');
const kv = Object.fromEntries(
  envText.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split('=', 2)),
);
const apiKey = kv.VITE_FIREBASE_API_KEY;
if (!apiKey) {
  console.error('ERROR: VITE_FIREBASE_API_KEY not set in .env.local');
  process.exit(1);
}

const saObj = JSON.parse(readFileSync(SA, 'utf8'));
saObj.project_id = saObj.project_id || 'savetheday-2377a';

const app = initializeApp({ credential: cert(saObj), projectId: 'savetheday-2377a' });
const auth = getAuth(app);

const OWNER_UID = process.argv[2] || '4Hu0UQ1zyJbzKiTP30jMpWDUDz12';

(async () => {
  const customToken = await auth.createCustomToken(OWNER_UID, {
    devBypass: 'mint-token-script',
  });
  console.log('---CUSTOM_TOKEN_START---');
  console.log(customToken);
  console.log('---CUSTOM_TOKEN_END---');

  const ex = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const body = await ex.json();
  if (body.error) {
    console.error('EXCHANGE FAILED:', JSON.stringify(body.error));
    process.exit(2);
  }
  console.log('---UID---', body.localId);
  console.log('---ID_TOKEN_START---');
  console.log(body.idToken);
  console.log('---ID_TOKEN_END---');
  console.log('---REFRESH_TOKEN---', body.refreshToken ? 'present' : 'MISSING');
})();
