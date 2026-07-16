// Single-endpoint POST :5183/signin — emits a 302 to the full ?__herotoken= URL.
// Hermes built-in browser_navigate doesn't echo multi-token URL strings,
// so we instead GET this endpoint. It reads .env.local + service-account
// and emits a redirect carrying the fresh custom token. Browser then
// auto-signs-in via the dev-only useAuth bypass.
const http = require('http');
const { cert, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const SA = `${process.env.HOME}/.config/gcloud/legacy_credentials/firebase-adminsdk-fbsvc@savetheday-2377a.iam.gserviceaccount.com/adc.json`;
const sa = JSON.parse(require('fs').readFileSync(SA, 'utf8'));
sa.project_id = 'savetheday-2377a';
const app = initializeApp({ credential: cert(sa), projectId: 'savetheday-2377a' });
const auth = getAuth(app);

const OWNER_UID = '4Hu0UQ1zyJbzKiTP30jMpWDUDz12';
const TARGET = 'http://localhost:5180/';

http.createServer(async (req, res) => {
  try {
    const tok = await auth.createCustomToken(OWNER_UID);
    const url = `${TARGET}?__herotoken=${encodeURIComponent(tok)}`;
    res.writeHead(302, {
      Location: url,
      'Cache-Control': 'no-store',
    });
    res.end();
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('ERR ' + e.message);
  }
}).listen(5183, () => console.log('hero-proxy on http://localhost:5183/signin'));
