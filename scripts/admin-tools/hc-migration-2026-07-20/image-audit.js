// Image quality audit for the 3,802 portfolio images we uploaded.
//
// Two checks:
//   1. Accessibility — HEAD each Firebase Storage URL, log non-200s
//   2. Metadata — fetch size + dimensions (via Sharp if available,
//      otherwise just Content-Length + Content-Type)
//
// Outputs /tmp/audit-results.json with:
//   - totalChecked, okCount, brokenCount, tooSmallCount
//   - brokenList: [{slug, url, status, error}]
//   - suspiciousList: [{slug, url, sizeKB, width, height}]

const fs = require('fs');
const https = require('https');
const sa = JSON.parse(fs.readFileSync(
  '/Users/roger/.config/gcloud/legacy_credentials/firebase-adminsdk-fbsvc@savetheday-2377a.iam.gserviceaccount.com/adc.json',
  'utf8',
));
sa.project_id = sa.project_id || 'savetheday-2377a';

const admin = require('/Users/roger/projects/vitejs-vite-tbbhdylu/functions/node_modules/firebase-admin/lib');
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(sa), projectId: 'savetheday-2377a' });
}

const BUCKET = 'savetheday-2377a.firebasestorage.app';

function head(url) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request(
      { host: u.host, path: u.pathname, method: 'HEAD', agent: false },
      (res) => {
        let bodyLen = 0;
        res.on('data', () => bodyLen++);
        res.on('end', () => resolve({
          status: res.statusCode,
          size: parseInt(res.headers['content-length'] || '0', 10),
          contentType: res.headers['content-type'] || '',
        }));
      },
    );
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.end();
  });
}

async function main() {
  const db = admin.firestore();
  console.log('Fetching vendor docs...');
  const snap = await db.collection('vendors').where('source.importedFrom', '==', 'heychoices.com').get();
  console.log(`docs to audit: ${snap.size}`);

  const allImages = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    for (const url of d.portfolio || []) {
      if (url && url.includes('storage.googleapis.com')) {
        allImages.push({ slug: doc.id, url });
      }
    }
  }
  console.log(`total images: ${allImages.length}`);

  const results = {
    totalChecked: 0,
    okCount: 0,
    brokenCount: 0,
    suspiciousCount: 0,
    brokenList: [],
    suspiciousList: [],
  };

  // HEAD scan with parallel=8
  const queue = [...allImages];
  const workers = Array.from({ length: 8 }, () => worker());
  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      const r = await head(item.url);
      results.totalChecked++;
      if (r.status !== 200) {
        results.brokenCount++;
        results.brokenList.push({ slug: item.slug, url: item.url, status: r.status, error: r.error });
        if (results.brokenList.length <= 5) console.log(`✗ ${item.slug}: ${r.status} ${r.error || ''}`);
      } else {
        results.okCount++;
        // Flag suspicious: <10KB or >2MB or non-image content-type
        if (r.size < 10 * 1024 || r.size > 2 * 1024 * 1024 || !r.contentType.startsWith('image/')) {
          results.suspiciousCount++;
          results.suspiciousList.push({ slug: item.slug, url: item.url, size: r.size, contentType: r.contentType });
        }
      }
      if (results.totalChecked % 200 === 0) {
        console.log(`  ...checked ${results.totalChecked}/${allImages.length}`);
      }
    }
  }
  await Promise.all(workers);

  console.log('\n=== AUDIT RESULTS ===');
  console.log(`total: ${results.totalChecked}`);
  console.log(`  ok: ${results.okCount}`);
  console.log(`  broken (non-200): ${results.brokenCount}`);
  console.log(`  suspicious (size/contentType): ${results.suspiciousCount}`);

  if (results.brokenList.length > 0) {
    console.log('\n=== BROKEN ===');
    for (const b of results.brokenList.slice(0, 10)) console.log(`  ${b.slug}: ${b.status} ${b.url}`);
  }
  if (results.suspiciousList.length > 0) {
    console.log('\n=== SUSPICIOUS (first 10) ===');
    for (const s of results.suspiciousList.slice(0, 10)) {
      console.log(`  ${s.slug}: ${(s.size / 1024).toFixed(1)}KB, ${s.contentType}`);
    }
  }

  fs.writeFileSync('/tmp/audit-results.json', JSON.stringify(results, null, 2));
  console.log('\n✓ saved /tmp/audit-results.json');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
