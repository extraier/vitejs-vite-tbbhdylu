// Vendor analytics — fire-and-forget event tracking.
//
// Two event types:
//   view   — when a vendor card renders in the DiscoverDirectory list
//   click  — when a user clicks a card to open the profile / portfolio
//
// Storage: Firestore collection `vendor_events` (flat, single-level
// documents). One document per event. Indexing by `vendorId` and
// `monthBucket` keeps admin queries cheap for monthly membership reports.
//
// Why flat (not per-vendor subcollection): Firestore subcollection writes
// are slower in aggregate and harder to query across vendors. Flat
// documents with `vendorId` field + composite index let us do per-vendor
// monthly aggregation in one query.
//
// Privacy: stores `userId` (Firebase uid, not PII) and `sessionId`
// (random per-browser). No PII, no email, no display name.

import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

// Get or create a session id for this browser. Persists in localStorage
// so refreshes within the same browser count as one "session" but
// anonymous → explicit login upgrades get a new session.
function getSessionId() {
  try {
    const key = '__va_session_id';
    let sid = localStorage.getItem(key);
    if (!sid) {
      sid = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(key, sid);
    }
    return sid;
  } catch {
    return `s_${Date.now().toString(36)}`;
  }
}

// YYYY-MM bucket for monthly aggregation.
function monthBucket(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Track one event. Errors are swallowed — analytics should never break
// the user-facing flow.
export async function trackVendorEvent({ type, vendor, user }) {
  if (!vendor || !vendor.id) return;
  try {
    await addDoc(collection(db, 'vendor_events'), {
      type, // 'view' | 'click'
      vendorId: String(vendor.id),
      vendorName: vendor.name || '',
      vendorCategory: vendor.category || '',
      userId: user?.uid || null,
      sessionId: getSessionId(),
      monthBucket: monthBucket(),
      timestamp: serverTimestamp(),
      // Snapshot the userAgent once for high-level device split.
      ua: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : '',
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[vendorAnalytics] track failed:', err?.message || err);
  }
}

export const trackVendorView = (vendor, user) =>
  trackVendorEvent({ type: 'view', vendor, user });

export const trackVendorClick = (vendor, user) =>
  trackVendorEvent({ type: 'click', vendor, user });

// Build a CSV string from aggregated rows.
//   rows: [{ vendorId, vendorName, vendorCategory, monthBucket, views, clicks }]
// Returns a CSV body string ready for download.
export function rowsToCsv(rows) {
  const header = ['vendorId', 'vendorName', 'vendorCategory', 'monthBucket', 'views', 'clicks'];
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(header.map((h) => escape(r[h])).join(','));
  }
  return lines.join('\n');
}