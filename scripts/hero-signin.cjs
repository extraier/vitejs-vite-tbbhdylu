// Tiny CGI server that signs in owner and returns success.
// Hermes 2026-07-03 — dev-only auth bypass to debug blank /couple-guests.
const http = require('http');
const { cert, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const SA = `${process.env.HOME}/.config/gcloud/legacy_credentials/firebase-adminsdk-fbsvc@savetheday-2377a.iam.gserviceaccount.com/adc.json`;
const sa = JSON.parse(require('fs').readFileSync(SA, 'utf8'));
sa.project_id = 'savetheday-2377a';
const app = initializeApp({ credential: cert(sa), projectId: 'savetheday-2377a' });
const auth = getAuth(app);

const OWNER_UID = '4Hu0UQ1zyJbzKiTP30jMpWDUDz12';
const ENV = `${__dirname}/../.env.local`;
const API_KEY = Object.fromEntries(
  require('fs').readFileSync(ENV, 'utf8').split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split('=', 2)),
).VITE_FIREBASE_API_KEY;

http.createServer(async (req, res) => {
  try {
    const tok = await auth.createCustomToken(OWNER_UID);
    if (req.url === '/__custok.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(tok);
      return;
    }
    if (req.url === '/' || req.url === '/signin') {
      const html = `<!doctype html><html><body>
<p id="s">Loading…</p>
<script>
(async () => {
  const tok = ${JSON.stringify(tok)};
  const apiKey = ${JSON.stringify(API_KEY)};
  const r = await (await fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=' + apiKey,
    { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ token: tok, returnSecureToken: true }) }
  )).json();
  if (r.error) {
    document.getElementById('s').innerText = 'ERR ' + JSON.stringify(r.error);
    return;
  }
  document.getElementById('s').innerText = 'EXCHANGED uid=' + r.localId + ' — redirecting…';
  // Ride idToken + refreshToken via URL fragment so main app can pick them up.
  setTimeout(() => {
    const u = new URL('http://localhost:5180/');
    u.searchParams.set('__savetheday_idtoken', r.idToken);
    u.searchParams.set('__savetheday_refreshtoken', r.refreshToken);
    u.searchParams.set('__savetheday_uid', r.localId);
    location.replace(u.toString());
  }, 800);
})();
</script></body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    res.writeHead(404); res.end();
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('ERR ' + e.message);
  }
}).listen(5182, () => console.log('hero-signin on http://localhost:5182/'));

