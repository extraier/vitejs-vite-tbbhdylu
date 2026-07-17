// One-shot seed script — populates /vendors/{placeholderUid} with the four
// showcase vendors from src/lib/config.ts DEFAULT_VENDORS so admins can see
// populated data in the 🛍️ 商戶控制台 screen.
//
// IMPORTANT:
//   - Runs LOCALLY only. Not deployed with the app.
//   - Uses the Firebase Admin SDK via your service account at
//     ~/.hermes/secrets/savetheday-firebase-sa.json (sourced via env).
//   - Admin SDK bypasses security rules — fine for seeding.
//   - Vendor UIDs are placeholders (v0001...v0004). The rules require the
//     vendor to own their doc for writes, but reads are public. The admin
//     listVendors function joins by Firebase Auth user → so the seed docs
//     will appear with email=null and authDisabled=false. That's expected.
//
// Idempotent: re-running will overwrite the same 4 docs.

// firebase-admin lives in the Cloud Functions workspace at
// functions/node_modules. Use an absolute path so the script is
// runnable from the project root without symlinking.
import admin from '../functions/node_modules/firebase-admin/lib/index.js';
import fs from 'fs';

const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!saPath || !fs.existsSync(saPath)) {
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS to the service account JSON.');
  process.exit(1);
}

const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(sa),
});

const db = admin.firestore();

const EXAMPLES = [
  {
    placeholderUid: 'v0001_visionary_capture',
    name: 'Visionary Capture',
    category: 'photo_video',
    subcategory: 'photographer',
    rating: 4.9,
    price: '$18,000+',
    tags: ['伯大尼', 'Ritz Carlton', '紀實唯美'],
    description: '超過10年頂級酒店及教堂拍攝經驗，擅長捕捉自然流露的情感與光影。',
    portfolio: [
      'https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=400&q=80',
      'https://images.unsplash.com/photo-1606800052052-a08af7148866?auto=format&fit=crop&w=400&q=80',
    ],
  },
  {
    placeholderUid: 'v0002_light_and_shadow',
    name: 'Light & Shadow Studio',
    category: 'photo_video',
    subcategory: 'photographer',
    rating: 4.7,
    price: '$15,000+',
    tags: ['伯大尼', '自然唯美'],
    description: '自然唯美風格，專注海外及本地特色教堂拍攝。',
    portfolio: [
      'https://images.unsplash.com/photo-1537368910025-700350fe46c7?auto=format&fit=crop&w=400&q=80',
    ],
  },
  {
    placeholderUid: 'v0003_fairytale_floral',
    name: 'FairyTale Floral',
    category: 'floral_deco',
    subcategory: 'wedding_floral',
    rating: 4.8,
    price: '$25,000+',
    tags: ['Ritz Carlton', '奢華花藝'],
    description: '專為五星級酒店設計的頂尖佈置團隊，提供全方位 3D 模擬圖。',
    portfolio: [
      'https://images.unsplash.com/photo-1469334031218-e382a71b716b?auto=format&fit=crop&w=400&q=80',
    ],
  },
  {
    placeholderUid: 'v0004_bethanie_charm',
    name: 'Bethanie Charm Deco',
    category: 'floral_deco',
    subcategory: 'venue_deco',
    rating: 4.6,
    price: '$8,000+',
    tags: ['伯大尼', '小清新'],
    description: '專為伯大尼教堂設計的佈置套餐。',
    portfolio: [
      'https://images.unsplash.com/photo-1519225421980-715cb0215aed?auto=format&fit=crop&w=400&q=80',
    ],
  },
];

async function main() {
  console.log(`[seed] project: ${sa.project_id}`);
  const batch = db.batch();
  for (const v of EXAMPLES) {
    const ref = db.collection('vendors').doc(v.placeholderUid);
    batch.set(
      ref,
      {
        name: v.name,
        category: v.category,
        subcategory: v.subcategory || null,
        rating: v.rating,
        price: v.price,
        tags: v.tags,
        description: v.description,
        portfolio: v.portfolio,
        status: 'approved',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: 'seed-script',
      },
      { merge: true },
    );
  }
  await batch.commit();
  console.log(`[seed] wrote ${EXAMPLES.length} vendor docs to /vendors/{placeholderUid}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exit(1);
  });