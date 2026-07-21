// Bulk seed 686 vendor docs from the full heychoices catalog to
// Firestore /vendors/{slug}. Skips the 30 already-seeded venues.
// Maps product_type → savetheday category. Uses direct Shopify CDN
// URLs for portfolio (no Storage re-upload).
//
// 2026-07-20 — wrote after paging /products.json?limit=250 three
// times and getting 722 unique products (716 with product_type).
// Of the 321 Venue products, 30 are already seeded — handled by
// handle-skip against _catalog.json.

const admin = require('/Users/roger/projects/vitejs-vite-tbbhdylu/functions/node_modules/firebase-admin/lib');
const fs = require('fs');

const sa = JSON.parse(
  fs.readFileSync(
    '/Users/roger/.config/gcloud/legacy_credentials/firebase-adminsdk-fbsvc@savetheday-2377a.iam.gserviceaccount.com/adc.json',
    'utf8',
  ),
);
sa.project_id = sa.project_id || 'savetheday-2377a';
admin.initializeApp({
  credential: admin.credential.cert(sa),
  projectId: 'savetheday-2377a',
});
const db = admin.firestore();

// Map HeyChoices product_type → savetheday category.
// 2026-07-20 — based on Phase 2 mapping done in conversation.
// Falls back to a generic "accessories" bucket if unrecognized.
const TYPE_MAP = {
  'Venue': { category: 'venue' },
  'Big Day Photography': { category: 'photo_video', subcategory: 'photographer' },
  'Prewedding': { category: 'photo_video', subcategory: 'pre_wedding' },
  'Bridal Wear': { category: 'styling', subcategory: 'bridal_wear' },
  'Makeup': { category: 'styling', subcategory: 'mua' },
  'Decoration': { category: 'floral_deco', subcategory: 'venue_deco' },
  'MC': { category: 'ceremony_staff', subcategory: 'mc' },
  'Music': { category: 'music' },
  'Wedding Jewellery': { category: 'accessories', subcategory: 'rings' },
  'Bride\'s Chaperone': { category: 'ceremony_staff', subcategory: 'chaperone' },
  'Lawyer': { category: 'ceremony_staff', subcategory: 'celebrant' },
};

function slugifyHandle(handle) {
  // Shopify handle keeps CJK + dashes. We strip CJK-locale prefixes
  // and replace unsafe chars so the slug is also a safe Storage path.
  return handle
    .toLowerCase()
    .replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]+/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || ('vendor-' + Math.random().toString(36).slice(2, 10));
}

function pickCategory(productType) {
  return TYPE_MAP[productType] || { category: 'accessories' };
}

function stripUndefined(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const k of Object.keys(obj)) {
    if (obj[k] === undefined) continue;
    out[k] = obj[k];
  }
  return out;
}

async function buildDoc(p, slug) {
  const { category, subcategory } = pickCategory(p.product_type);
  const portfolioUrls = (p.images || [])
    .slice(0, 24)
    .map((img) => img.src)
    .filter(Boolean);

  // Extract the visible Chinese name from the title. Shopify titles
  // often look like "中文名字 English Name" — we keep the full title.
  const name = (p.title || slug).trim();

  // Description: prefer vendor-provided body_html, strip tags.
  let description = '';
  if (typeof p.body_html === 'string') {
    description = p.body_html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1000);
  }

  // Tags: dedupe + lowercase + max 10.
  const tags = Array.from(new Set((p.tags || []).map((t) => t.trim()).filter(Boolean))).slice(0, 10);

  return {
    name,
    category,
    subcategory,
    description,
    tags,
    portfolio: portfolioUrls,
    portfolioCount: portfolioUrls.length,
    rating: 0,
    status: 'approved',
    source: {
      importedFrom: 'heychoices.com',
      heyChoicesHandle: p.handle,
      heyChoicesUrl: 'https://www.heychoices.com/products/' + p.handle,
      heyChoicesVendorId: p.vendor ? String(p.vendor) : null,
      importedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    signupStatus: 'uninvited',
  };
}

async function main() {
  const products = JSON.parse(fs.readFileSync('/tmp/heychoices-all-products-full.json', 'utf8'));
  const existing = JSON.parse(fs.readFileSync('/Users/roger/Downloads/heychoices-photos/_catalog.json', 'utf8'));
  const existingHandles = new Set(existing.map((e) => e.handle));

  // Filter: real vendors, not already seeded
  const candidates = products.filter((p) => p.product_type && !existingHandles.has(p.handle));
  console.log('Total candidates to seed:', candidates.length);

  // De-dupe by handle (Shopify handles are unique, but if the catalog
  // somehow includes repeats, keep first).
  const seenHandles = new Set();
  const deduped = candidates.filter((p) => {
    if (seenHandles.has(p.handle)) return false;
    seenHandles.add(p.handle);
    return true;
  });
  console.log('After dedupe by handle:', deduped.length);

  // Use handle as slug, falling back to slugifyHandle for non-Latin ones.
  const items = [];
  for (const p of deduped) {
    const slug = p.handle && /^[a-z0-9-]+$/i.test(p.handle) && !/[\u4e00-\u9fff]/.test(p.handle)
      ? p.handle.toLowerCase()
      : slugifyHandle(p.handle || p.title);
    if (!slug) continue;
    items.push({ slug, product: p });
  }
  console.log('After slug generation:', items.length);

  // Sort by category so writes are grouped for readability when inspecting
  // later (and we get a category break down)
  items.sort((a, b) =>
    a.product.product_type.localeCompare(b.product.product_type) ||
    a.slug.localeCompare(b.slug),
  );

  // Firestore batch limit = 500 ops. Use 400 to be safe.
  const BATCH_SIZE = 400;
  let written = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const slice = items.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const { slug, product } of slice) {
      const doc = stripUndefined(await buildDoc(product, slug));
      const ref = db.collection('vendors').doc(slug);
      batch.set(ref, doc, { merge: true });
    }
    try {
      await batch.commit();
      written += slice.length;
      console.log(`✓ batch ${Math.floor(i / BATCH_SIZE) + 1}: wrote ${slice.length} (total ${written}/${items.length})`);
    } catch (e) {
      failed += slice.length;
      console.error(`✗ batch ${Math.floor(i / BATCH_SIZE) + 1}: ${e.message}`);
    }
  }

  // Save a list of seeded slugs so we can verify later
  const seededSlugs = items.map((x) => x.slug);
  fs.writeFileSync('/tmp/seeded-slugs.json', JSON.stringify(seededSlugs, null, 2));

  // Category breakdown
  const byType = {};
  for (const x of items) {
    byType[x.product.product_type] = (byType[x.product.product_type] || 0) + 1;
  }
  console.log('\nBreakdown by HeyChoices product_type:');
  Object.entries(byType).forEach(([k, v]) => console.log('  ' + v + '\t' + k));

  console.log(`\nDone. ${written} written, ${failed} failed.`);
  process.exit(0);
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});
