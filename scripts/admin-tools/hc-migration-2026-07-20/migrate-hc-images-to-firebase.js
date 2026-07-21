// Migrate all 686 seeded vendors' portfolio photos from Shopify CDN
// to Firebase Storage. Three phases with checkpoint files so the
// script can resume after a crash.
//
// Usage:
//   node /tmp/migrate-hc-images-to-firebase.js [phase]
//   phase = 'download' | 'upload' | 'update' | 'all' (default)

const fs = require('fs');
const path = require('path');
const https = require('https');
const sa = JSON.parse(
  fs.readFileSync(
    '/Users/roger/.config/gcloud/legacy_credentials/firebase-adminsdk-fbsvc@savetheday-2377a.iam.gserviceaccount.com/adc.json',
    'utf8',
  ),
);
sa.project_id = sa.project_id || 'savetheday-2377a';

const { getAccessToken } = require('/Users/roger/Downloads/heychoices-photos/.sign-sa-jwt.cjs');

const BUCKET = 'savetheday-2377a.firebasestorage.app';
const LOCAL_ROOT = '/tmp/hc-images';
const CHECKPOINT_FILE = '/tmp/migrate-progress.json';

// ---------- slug helpers ----------
function slugifyHandle(handle) {
  return handle
    .toLowerCase()
    .replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]+/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || ('vendor-' + Math.random().toString(36).slice(2, 10));
}

function deriveSlug(p) {
  if (p.handle && /^[a-z0-9-]+$/i.test(p.handle) && !/[\u4e00-\u9fff]/.test(p.handle)) {
    return p.handle.toLowerCase();
  }
  return slugifyHandle(p.handle || p.title);
}

// ---------- HTTP helpers ----------
function httpGet(url, destPath, redirectChain = 0) {
  return new Promise((resolve) => {
    if (redirectChain > 5) return resolve({ ok: false, error: 'too many redirects' });
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const tmp = destPath + '.part';
    const file = fs.createWriteStream(tmp);
    const req = https.get(
      url,
      { agent: false, headers: { 'User-Agent': 'savetheday-migrate/1.0', Connection: 'close' } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          try { fs.unlinkSync(tmp); } catch {}
          return resolve(httpGet(res.headers.location, destPath, redirectChain + 1));
        }
        if (res.statusCode !== 200) {
          file.close();
          try { fs.unlinkSync(tmp); } catch {}
          return resolve({ ok: false, status: res.statusCode, error: 'http ' + res.statusCode });
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          fs.renameSync(tmp, destPath);
          resolve({ ok: true, bytes: fs.statSync(destPath).size });
        });
      },
    );
    req.on('error', (e) => {
      try { fs.unlinkSync(tmp); } catch {}
      resolve({ ok: false, error: e.message });
    });
  });
}

function httpUpload(token, url, body, contentType) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request(
      {
        host: u.host,
        path: u.pathname + u.search,
        method: 'POST',
        agent: false,
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': contentType,
          'Content-Length': body.length,
          Connection: 'close',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              body: data ? JSON.parse(data) : {},
            });
          } catch {
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: data });
          }
        });
      },
    );
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.write(body);
    req.end();
  });
}

async function withRetry(fn, label, attempts = 2) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fn();
      if (r && r.ok === false) throw new Error(r.error || JSON.stringify(r).slice(0, 200));
      return r;
    } catch (e) {
      lastErr = e;
      if (i + 1 >= attempts) break;
      const wait = 400 * Math.pow(2, i) + Math.random() * 200;
      console.warn(`[${label}] attempt ${i + 1} failed: ${e.message} — retrying in ${Math.round(wait)}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// ---------- candidate enumeration ----------
function getCandidates() {
  const products = JSON.parse(fs.readFileSync('/tmp/heychoices-all-products-full.json', 'utf8'));
  const existing = JSON.parse(fs.readFileSync('/Users/roger/Downloads/heychoices-photos/_catalog.json', 'utf8'));
  const existingHandles = new Set(existing.map((e) => e.handle));
  const cands = products.filter((p) => p.product_type && !existingHandles.has(p.handle));
  const seenSlugs = new Set();
  const out = [];
  for (const p of cands) {
    const slug = deriveSlug(p);
    if (!slug || seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);
    const images = (p.images || []).slice(0, 24);
    if (!images.length) continue;
    out.push({ slug, product: p, images });
  }
  return out;
}

// ---------- checkpoint ----------
function loadCheckpoint() {
  try {
    return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8'));
  } catch {
    return { downloaded: {}, uploaded: {}, updated: {} };
  }
}
function saveCheckpoint(cp) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

// ---------- Phase A: download ----------
async function phaseDownload(candidates) {
  console.log(`\n=== Phase A: DOWNLOAD ===  (${candidates.length} vendors, parallel=8)`);
  const cp = loadCheckpoint();
  const queue = [];
  for (const c of candidates) {
    for (let i = 0; i < c.images.length; i++) {
      const key = `${c.slug}/${i}`;
      const localPath = path.join(LOCAL_ROOT, c.slug, `${c.slug}-${String(i + 1).padStart(2, '0')}.jpg`);
      if (cp.downloaded[key] && fs.existsSync(localPath)) continue;
      queue.push({ slug: c.slug, idx: i, url: c.images[i].src, localPath, key });
    }
  }
  console.log(`work queue: ${queue.length} files (skipped ${Object.keys(cp.downloaded).length} done)`);
  let done = 0, failed = 0;
  const workers = Array.from({ length: 8 }, () => worker());
  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      const r = await withRetry(() => httpGet(item.url, item.localPath), `dl ${item.key}`);
      if (r.ok) { cp.downloaded[item.key] = r.bytes; done++; }
      else { failed++; console.error(`✗ dl ${item.key}: ${r.error || r.status}`); }
      if ((done + failed) % 50 === 0) saveCheckpoint(cp);
    }
  }
  await Promise.all(workers);
  saveCheckpoint(cp);
  console.log(`Download: ${done} ok, ${failed} failed`);
  return { done, failed };
}

// ---------- Phase B: upload ----------
async function phaseUpload(candidates) {
  console.log(`\n=== Phase B: UPLOAD ===  (storage.googleapis.com)`);
  const cp = loadCheckpoint();
  const queue = [];
  for (const c of candidates) {
    for (let i = 0; i < c.images.length; i++) {
      const key = `${c.slug}/${i}`;
      const localPath = path.join(LOCAL_ROOT, c.slug, `${c.slug}-${String(i + 1).padStart(2, '0')}.jpg`);
      if (!fs.existsSync(localPath)) continue;
      if (cp.uploaded[key]) continue;
      queue.push({ slug: c.slug, idx: i, localPath, key });
    }
  }
  console.log(`work queue: ${queue.length} files (skipped ${Object.keys(cp.uploaded).length} done)`);
  let done = 0, failed = 0;
  const tokenCache = { token: null, exp: 0 };
  async function getToken() {
    const now = Math.floor(Date.now() / 1000);
    if (!tokenCache.token || tokenCache.exp - 120 < now) {
      tokenCache.token = await getAccessToken(sa, 'https://www.googleapis.com/auth/devstorage.read_write');
      tokenCache.exp = now + 3500;
    }
    return tokenCache.token;
  }
  const workers = Array.from({ length: 16 }, () => worker());
  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      const buf = fs.readFileSync(item.localPath);
      const objPath = `vendors/${item.slug}/portfolio/${item.slug}-${String(item.idx + 1).padStart(2, '0')}.jpg`;
      const url = `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(objPath)}`;
      try {
        const token = await getToken();
        const r = await withRetry(() => httpUpload(token, url, buf, 'image/jpeg'), `ul ${item.key}`);
        if (r.ok) {
          const publicUrl = `https://storage.googleapis.com/${BUCKET}/${objPath}`;
          cp.uploaded[item.key] = publicUrl;
          done++;
        } else throw new Error(JSON.stringify(r.body).slice(0, 200));
      } catch (e) {
        failed++;
        console.error(`✗ ul ${item.key}: ${e.message}`);
      }
      if ((done + failed) % 30 === 0) saveCheckpoint(cp);
    }
  }
  await Promise.all(workers);
  saveCheckpoint(cp);
  console.log(`Upload: ${done} ok, ${failed} failed`);
  return { done, failed };
}

// ---------- Phase C: update Firestore ----------
async function phaseUpdate(candidates) {
  console.log(`\n=== Phase C: FIRESTORE UPDATE ===`);
  const admin = require('/Users/roger/projects/vitejs-vite-tbbhdylu/functions/node_modules/firebase-admin/lib');
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(sa), projectId: 'savetheday-2377a' });
  }
  const db = admin.firestore();
  const cp = loadCheckpoint();
  let done = 0, failed = 0;
  for (const c of candidates) {
    if (cp.updated[c.slug]) continue;
    const portfolio = [];
    for (let i = 0; i < c.images.length; i++) {
      const key = `${c.slug}/${i}`;
      if (cp.uploaded[key]) portfolio.push(cp.uploaded[key]);
    }
    if (portfolio.length === 0) {
      console.warn(`skip ${c.slug}: no uploaded images`);
      continue;
    }
    try {
      await db.collection('vendors').doc(c.slug).set(
        {
          portfolio,
          portfolioCount: portfolio.length,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      cp.updated[c.slug] = Date.now();
      done++;
      if (done % 50 === 0) {
        saveCheckpoint(cp);
        console.log(`  ...updated ${done}/${candidates.length}`);
      }
    } catch (e) {
      failed++;
      console.error(`✗ update ${c.slug}: ${e.message}`);
    }
  }
  saveCheckpoint(cp);
  console.log(`Firestore update: ${done} ok, ${failed} failed`);
  return { done, failed };
}

// ---------- main ----------
async function main() {
  const phase = process.argv[2] || 'all';
  const candidates = getCandidates();
  console.log(`candidates: ${candidates.length} vendors, ${candidates.reduce((s, c) => s + c.images.length, 0)} images total`);

  if (phase === 'download' || phase === 'all') await phaseDownload(candidates);
  if (phase === 'upload' || phase === 'all') await phaseUpload(candidates);
  if (phase === 'update' || phase === 'all') await phaseUpdate(candidates);
  console.log('\n✓ done');
  process.exit(0);
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});
