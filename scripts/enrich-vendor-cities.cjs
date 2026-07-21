// Enrich vendors with serviceAreaCity + serviceAreaDistrict derived
// from their name, description, and address. Idempotent — only writes
// when the city has changed.
//
// Run:
//   node scripts/enrich-vendor-cities.js
//
// Reads:  /vendors/{id}
// Writes: /vendors/{id}.serviceAreaCity    — one of "香港島","九龍","新界","其他"
//         /vendors/{id}.serviceAreaDistrict — first matched district
//                                            (or existing serviceArea)
//
// We deliberately don't overwrite if the field already exists and
// matches, to keep manual edits untouched.

const admin = require('/Users/roger/projects/vitejs-vite-tbbhdylu/functions/node_modules/firebase-admin/lib');
const fs = require('fs');

const sa = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
sa.project_id = sa.project_id || 'savetheday-2377a';
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: 'savetheday-2377a' });
const db = admin.firestore();

const DISTRICTS = [
  // Hong Kong Island
  { name: '中環', city: '香港島' },
  { name: '金鐘', city: '香港島' },
  { name: '灣仔', city: '香港島' },
  { name: '銅鑼灣', city: '香港島' },
  { name: '上環', city: '香港島' },
  { name: '西環', city: '香港島' },
  { name: '薄扶林', city: '香港島' },
  { name: '香港仔', city: '香港島' },
  { name: '黃竹坑', city: '香港島' },
  { name: '淺水灣', city: '香港島' },
  { name: '赤柱', city: '香港島' },
  { name: '太古', city: '香港島' },
  { name: '康怡', city: '香港島' },
  { name: '鰂魚涌', city: '香港島' },
  { name: '北角', city: '香港島' },
  { name: '筲箕灣', city: '香港島' },
  { name: '柴灣', city: '香港島' },
  { name: '跑馬地', city: '香港島' },
  // Kowloon
  { name: '尖沙咀', city: '九龍' },
  { name: '佐敦', city: '九龍' },
  { name: '油麻地', city: '九龍' },
  { name: '旺角', city: '九龍' },
  { name: '太子', city: '九龍' },
  { name: '深水埗', city: '九龍' },
  { name: '長沙灣', city: '九龍' },
  { name: '九龍灣', city: '九龍' },
  { name: '觀塘', city: '九龍' },
  { name: '牛頭角', city: '九龍' },
  { name: '黃大仙', city: '九龍' },
  { name: '鑽石山', city: '九龍' },
  { name: '九龍塘', city: '九龍' },
  { name: '何文田', city: '九龍' },
  { name: '紅磡', city: '九龍' },
  { name: '土瓜灣', city: '九龍' },
  { name: '新蒲崗', city: '九龍' },
  // New Territories
  { name: '荃灣', city: '新界' },
  { name: '葵涌', city: '新界' },
  { name: '葵興', city: '新界' },
  { name: '沙田', city: '新界' },
  { name: '大圍', city: '新界' },
  { name: '屯門', city: '新界' },
  { name: '元朗', city: '新界' },
  { name: '天水圍', city: '新界' },
  { name: '大埔', city: '新界' },
  { name: '粉嶺', city: '新界' },
  { name: '上水', city: '新界' },
  { name: '將軍澳', city: '新界' },
  { name: '西貢', city: '新界' },
  { name: '科學園', city: '新界' },
  { name: '馬鞍山', city: '新界' },
  { name: '東涌', city: '新界' },
];

function deriveCity(v) {
  const haystack = [
    v.name || '',
    v.description || '',
    v.address || '',
    Array.isArray(v.serviceArea) ? v.serviceArea.join(' ') : (v.serviceArea || ''),
  ].join(' ');

  for (const { name, city } of DISTRICTS) {
    if (haystack.includes(name)) {
      return { district: name, city };
    }
  }
  return null;
}

(async () => {
  const snap = await db.collection('vendors').get();
  console.log(`scanning ${snap.size} vendors...`);
  let enriched = 0;
  let skipped = 0;
  let batch = db.batch();
  let writes = 0;
  const BATCH_LIMIT = 400;

  for (const d of snap.docs) {
    const v = d.data();
    const result = deriveCity(v);
    if (!result) {
      skipped++;
      continue;
    }
    // Skip if already matches
    if (v.serviceAreaCity === result.city && v.serviceAreaDistrict === result.district) {
      skipped++;
      continue;
    }
    batch.update(d.ref, {
      serviceAreaCity: result.city,
      serviceAreaDistrict: result.district,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    writes++;
    enriched++;
    if (writes >= BATCH_LIMIT) {
      await batch.commit();
      console.log(`  committed ${writes} updates...`);
      batch = db.batch();
      writes = 0;
    }
  }
  if (writes > 0) {
    await batch.commit();
  }
  console.log(`✓ done. enriched=${enriched}, skipped=${skipped}`);
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });