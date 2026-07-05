#!/usr/bin/env node
/**
 * Seed the 6 default invitation template SVGs into Firebase Storage + Firestore.
 *
 * Why this script exists
 * ----------------------
 * Before this script runs, the 6 stock templates live as static files in
 * `public/templates/*.svg` (bundled into Vercel). After updateTemplate ships,
 * the client reads templates from Firestore + Storage. We need to backfill
 * the 6 stock templates into the new storage layout so the picker shows the
 * same visuals on day-one — without forcing every existing owner to upload
 * the original SVGs again.
 *
 * What it does
 * ------------
 *   1. Reads each public/templates/{id}.svg from the repo
 *   2. Uploads it to gs://savetheday-2377a.firebasestorage.app/invitation-templates/{id}.svg
 *   3. Calls file.makePublic() so unauthenticated preview tiles can fetch it
 *   4. Writes/updates the matching artifacts/{appId}/templates/{id} Firestore doc
 *      with the same metadata the in-app updateTemplate callable would write
 *   5. Bumps the templates/{appId}/meta/templates "cache-buster" doc
 *
 * Usage
 * -----
 *   # Use the production project (default):
 *   node functions/scripts/seed-default-templates.js
 *
 *   # Or against the emulator suite (firestore + storage):
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 \
 *   FIREBASE_STORAGE_EMULATOR_HOST=localhost:9199 \
 *   STORAGE_BUCKET=demo-savetheday-2377a.appspot.com \
 *     node functions/scripts/seed-default-templates.js
 *
 * Idempotent
 * ----------
 * Re-running won't duplicate anything. It just overwrites the Storage object
 * and merges the Firestore doc. Safe to run as a CI smoke test.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Lazy-load firebase-admin so the script works even before `npm install`.
// (The functions/ workspace has firebase-admin as a dep — that's where we'll
// resolve it from. If you run this from the project root, you may need to
// `cd functions && npm install` first.)
let admin;
try {
  admin = require('firebase-admin');
} catch {
  try {
    admin = require(path.join(__dirname, '..', 'node_modules', 'firebase-admin'));
  } catch {
    console.error('firebase-admin not found. Run `npm install` in functions/ first.');
    process.exit(1);
  }
}

const APP_ID = 'savetheday-production';
const PROJECT_ID = process.env.GCLOUD_PROJECT || 'savetheday-2377a';
const BUCKET_NAME =
  process.env.STORAGE_BUCKET ||
  (process.env.FIREBASE_STORAGE_EMULATOR_HOST
    ? `${PROJECT_ID}.appspot.com`
    : `${PROJECT_ID}.appspot.com`);

// If GOOGLE_APPLICATION_CREDENTIALS is set but the JSON file is missing
// `project_id` (common with gcloud's legacy_credentials ADC files), patch
// it inline before handing to firebase-admin. This is the same trick
// scripts/mint-token.cjs uses.
function loadServiceAccount() {
  const adcPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!adcPath) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(adcPath, 'utf8'));
    if (!raw.project_id) raw.project_id = PROJECT_ID;
    return raw;
  } catch (e) {
    console.error('Could not read GOOGLE_APPLICATION_CREDENTIALS:', e.message);
    return null;
  }
}

// The 6 stock templates — keep in sync with src/components/invitation/templates.js.
// When you add a 7th slot, add a row here AND a matching SVG in public/templates/.
const TEMPLATES = [
  {
    id: 'plain',
    label: '簡約純白',
    file: 'plain.svg',
    palette: { bg: '#ffffff', text: '#1e293b', accent: '#e11d48', muted: '#64748b' },
    layout: 'centered',
  },
  {
    id: 'tpl-rose',
    label: '玫瑰金邊',
    file: 'rose.svg',
    palette: { bg: '#fff1f2', text: '#881337', accent: '#e11d48', muted: '#9f1239' },
    layout: 'ornate',
  },
  {
    id: 'tpl-jade',
    label: '翡翠中式',
    file: 'jade.svg',
    palette: { bg: '#ecfdf5', text: '#064e3b', accent: '#047857', muted: '#065f46' },
    layout: 'stacked',
  },
  {
    id: 'tpl-midnight',
    label: '深藍星夜',
    file: 'midnight.svg',
    palette: { bg: '#0f172a', text: '#f8fafc', accent: '#fbbf24', muted: '#cbd5e1' },
    layout: 'centered',
  },
  {
    id: 'tpl-blush',
    label: '裸粉花卉',
    file: 'blush.svg',
    palette: { bg: '#fdf2f8', text: '#500724', accent: '#db2777', muted: '#831843' },
    layout: 'ornate',
  },
  {
    id: 'tpl-sage',
    label: '鼠尾草綠',
    file: 'sage.svg',
    palette: { bg: '#f0fdf4', text: '#14532d', accent: '#16a34a', muted: '#166534' },
    layout: 'stacked',
  },
];

async function main() {
  // Initialize the Admin SDK against the right project. When running against
  // emulators we point at localhost so getFirestore()/getStorage() pick up
  // FIRESTORE_EMULATOR_HOST / FIREBASE_STORAGE_EMULATOR_HOST automatically.
  if (!admin.apps.length) {
    const credential = loadServiceAccount();
    const initOpts = { projectId: PROJECT_ID, storageBucket: BUCKET_NAME };
    if (credential) initOpts.credential = admin.credential.cert(credential);
    admin.initializeApp(initOpts);
  }

  const db = admin.firestore();
  const bucket = admin.storage().bucket();

  const repoRoot = path.resolve(__dirname, '..', '..');
  const sourceDir = path.join(repoRoot, 'public', 'templates');

  console.log(`[seed] project=${PROJECT_ID} bucket=${BUCKET_NAME} source=${sourceDir}`);
  console.log(`[seed] appId=${APP_ID}`);

  let uploaded = 0;
  let skipped = 0;

  for (const tpl of TEMPLATES) {
    const localPath = path.join(sourceDir, tpl.file);
    if (!fs.existsSync(localPath)) {
      console.warn(`[seed]   ⚠️  ${tpl.id}: source file missing — ${localPath}`);
      skipped++;
      continue;
    }

    const buf = fs.readFileSync(localPath);
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const storagePath = `invitation-templates/${tpl.id}.svg`;
    const file = bucket.file(storagePath);

    console.log(`[seed]   ${tpl.id} (${tpl.label}) — ${buf.length} bytes → ${storagePath}`);

    // 1. Upload to Storage (overwrite if exists — idempotent).
    await file.save(buf, {
      contentType: 'image/svg+xml',
      metadata: {
        contentType: 'image/svg+xml',
        cacheControl: 'public, max-age=300',
        metadata: {
          uploadedBy: 'seed-script',
          uploadedAt: String(Date.now()),
          sha256,
          templateId: tpl.id,
        },
      },
      resumable: false,
    });

    // 2. Make public so unauth preview tiles can fetch it.
    try {
      await file.makePublic();
    } catch (e) {
      console.warn(`[seed]   ⚠️  ${tpl.id}: makePublic failed (emulator or rules deny):`, e.message);
    }

    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

    // 3. Write the matching Firestore doc.
    const docRef = db
      .collection('artifacts').doc(APP_ID)
      .collection('templates').doc(tpl.id);
    await docRef.set(
      {
        label: tpl.label,
        palette: tpl.palette,
        layout: tpl.layout,
        storagePath,
        publicUrl,
        bytes: buf.length,
        sha256,
        isPremium: false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: 'seed-script',
      },
      { merge: true },
    );

    uploaded++;
  }

  // 4. Bump the cache-buster so the client invalidates any cached templates.
  await db
    .collection('artifacts').doc(APP_ID)
    .collection('meta').doc('templates')
    .set(
      { updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true },
    );

  console.log(`[seed] ✅ done. uploaded=${uploaded} skipped=${skipped}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed] ❌ failed:', err);
  process.exit(1);
});