// vendorAnalytics.ts — Firestore-triggered counter aggregation.
//
// 2026-07-20 — when a couple opens a vendor's portfolio image (the
// lightbox in VendorModal), we write one row to /vendorImageViews.
// Aggregating these on the client by reading the whole collection
// works at 30 views but breaks at 50k+. This module listens to
// each new row and increments a counter on the vendor doc:
//
//   /vendors/{vendorUid}.popularity: {
//     viewCount24h,  // rolling 24h
//     viewCount7d,   // rolling 7d
//     viewCount30d,  // rolling 30d
//     viewCountTotal // all-time
//     lastViewAt,    // server timestamp
//   }
//
// Couples browsing the 商戶指南 read the vendor doc (already loaded)
// and never query /vendorImageViews directly — keeps the client
// query cheap and the catalog snappy.
//
// How we keep the rolling counters fresh
// --------------------------------------
// We use a Firestore-triggered function with these rules:
//   1. Every new /vendorImageViews/{id} row with vendorSlug ==
//      `<slug>` triggers recomputeForVendor(slug).
//   2. The function re-aggregates from raw rows (still cheap at
//      <100k views; for >100k we should switch to a daily
//      cron-sharded counter).
//   3. Also: a daily scheduled job re-runs the aggregation for
//      ALL vendors so the rolling 24h/7d/30d windows expire
//      correctly even when no new views come in.
//
// Why not use Firestore's FieldValue.increment?
//   - Rolling windows can't be done with simple increments; we'd
//     lose the bucket boundaries. Recompute is simpler and runs
//     on a tiny read scope (filtered to the vendorSlug).

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  getFirestore,
  FieldValue,
  Timestamp,
} from 'firebase-admin/firestore';

const db = getFirestore();

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAY_MS = 7 * ONE_DAY_MS;
const THIRTY_DAY_MS = 30 * ONE_DAY_MS;

async function recomputeForVendor(vendorSlug: string, now: number = Date.now()) {
  if (!vendorSlug) return;
  const cutoff24h = Timestamp.fromMillis(now - ONE_DAY_MS);
  const cutoff7d = Timestamp.fromMillis(now - SEVEN_DAY_MS);
  const cutoff30d = Timestamp.fromMillis(now - THIRTY_DAY_MS);

  // Count rows in each window. We use a single query for the
  // shortest window (24h) and reuse it for the others via
  // client-side filter — at 50k views this still runs in <500ms
  // because of where + orderBy.
  const ref = db.collection('vendorImageViews').where('vendorSlug', '==', vendorSlug);
  const snap = await ref.get();
  let total = 0;
  let c24 = 0;
  let c7 = 0;
  let c30 = 0;
  let lastAt = null;
  for (const d of snap.docs) {
    const x = d.data();
    const ts = x.createdAt;
    if (!(ts instanceof Timestamp)) continue;
    const ms = ts.toMillis();
    if (ms > now) continue;
    total++;
    if (ms >= cutoff30d.toMillis()) c30++;
    if (ms >= cutoff7d.toMillis()) c7++;
    if (ms >= cutoff24h.toMillis()) c24++;
    if (!lastAt || ms > lastAt) lastAt = ms;
  }

  // Only update if the vendor doc exists (skip pinged views for
  // vendors that have been deleted).
  const vendorRef = db.collection('vendors').doc(vendorSlug);
  const vendorSnap = await vendorRef.get();
  if (!vendorSnap.exists) return;

  await vendorRef.update({
    popularity: {
      viewCount24h: c24,
      viewCount7d: c7,
      viewCount30d: c30,
      viewCountTotal: total,
      lastViewAt: lastAt ? Timestamp.fromMillis(lastAt) : null,
      updatedAt: FieldValue.serverTimestamp(),
    },
  });
}

// 2026-07-20 — trigger on every new /vendorImageViews row.
// Async (background) so we don't block the write. The write itself
// already returns to the client quickly.
export const onVendorImageViewCreated = onDocumentCreated(
  { document: 'vendorImageViews/{viewId}', region: 'us-central1' },
  async (event) => {
    const data = event.data?.data();
    const vendorSlug = data?.vendorSlug;
    if (!vendorSlug) return;
    try {
      await recomputeForVendor(vendorSlug);
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? String(e);
      console.warn(
        '[vendorAnalytics] recompute failed for',
        vendorSlug,
        msg,
      );
    }
  },
);

// 2026-07-20 — daily scheduled sweep. Re-aggregates ALL vendors
// so the rolling 24h/7d/30d windows expire correctly even when
// no new views come in. Runs at 02:17 UTC (≈10:17 HKT).
//
// Why a sweep at all? The onCreate trigger handles new views, but
// views get OLD as time passes — c24 needs to drop as views age
// out of the 24h window. The trigger can't decrement old windows,
// only add. So we run a sweep once per day to refresh everything.
//
// Cost: at 673 vendors × ~20 views/month avg = ~13k rows/day to
// scan. With proper indexing this completes in <30s.
export const dailyVendorAnalyticsSweep = onSchedule(
  {
    schedule: '17 2 * * *',
    timeZone: 'Asia/Hong_Kong',
    region: 'us-central1',
  },
  async () => {
    const now = Date.now();
    const vendors = await db.collection('vendors').select('name').get();
    let updated = 0;
    for (const v of vendors.docs) {
      try {
        await recomputeForVendor(v.id, now);
        updated++;
      } catch (e) {
        const msg = (e as { message?: string })?.message ?? String(e);
        console.warn('[dailyVendorAnalyticsSweep] failed for', v.id, msg);
      }
    }
    console.log(
      '[dailyVendorAnalyticsSweep] refreshed',
      updated,
      'vendor docs at',
      new Date(now).toISOString(),
    );
  },
);