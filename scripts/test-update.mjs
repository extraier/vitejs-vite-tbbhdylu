import admin from '../functions/node_modules/firebase-admin/lib/index.js';
admin.initializeApp({ credential: admin.credential.cert('/Users/roger/Downloads/savetheday-2377a-firebase-adminsdk-fbsvc-fa7e0b76db.json') });
const db = admin.firestore();
// Reset v0001 to its original canonical subcategory
const ref = db.collection('vendors').doc('v0001_visionary_capture');
const snap = await ref.get();
console.log('BEFORE:', JSON.stringify(snap.data(), null, 2));
process.exit(0);
