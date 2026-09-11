// 2026-09-11 — P12.3 client wrapper for the vendor delay-report
// callables (reportVendorDelay + approveVendorDelay).
//
// These are callable cloud functions shipped as part of P12
// server-agent. From the client we just want a thin wrapper that:
//   1. Hides the `httpsCallable(getFunctions(), ...)` machinery
//      behind a named export, so callers don't repeat the boilerplate.
//   2. Normalizes the error shape — server returns the message
//      inside `err.message` (httpsCallable surfaces it that way
//      already) but a friendly zh-HK fallback keeps the vendor
//      UI from leaking raw server strings.
//
// We deliberately do NOT throw on failure — the caller (UI
// handlers in App.jsx + VendorDashboard.jsx) is responsible for
// showing the toast / inline error. The wrapper returns
// `{ ok: false, message }` on failure so the caller can branch
// without try/catch noise.
//
// Why not add this to taskUpdates.js? taskUpdates.js is about
// Firestore writes (recordTaskStatusUpdate writes an audit-trail
// doc). reportVendorDelay + approveVendorDelay are callable
// invocations, a different surface. Keeping them in their own
// module keeps the import graph clean.

import { getFunctions, httpsCallable } from 'firebase/functions';

/**
 * Report a delay on a rundown entry that is assigned to the
 * calling vendor. Server creates a pending approval for the
 * couple to confirm.
 *
 * @param {object} args
 * @param {string} args.ownerUid
 * @param {string} args.eventId
 * @param {string} args.entryId
 * @param {number} args.delayMinutes
 * @param {string} [args.note]
 * @returns {Promise<{ ok: boolean, message?: string, data?: any }>}
 */
export async function reportVendorDelay({
  ownerUid,
  eventId,
  entryId,
  delayMinutes,
  note,
}) {
  if (!ownerUid || !eventId || !entryId) {
    return {
      ok: false,
      message: '缺少必要資料，請重新整理後再試。',
    };
  }
  if (typeof delayMinutes !== 'number' || delayMinutes < 0) {
    return {
      ok: false,
      message: '延誤分鐘數必須係正數。',
    };
  }
  try {
    const fn = httpsCallable(getFunctions(), 'reportVendorDelay');
    const result = await fn({ ownerUid, eventId, entryId, delayMinutes, note });
    return { ok: true, data: result?.data ?? null };
  } catch (err) {
    // httpsCallable surfaces the server message in err.message.
    const message = err?.message || '提交延誤報告失敗，請稍後再試。';
    return { ok: false, message };
  }
}

/**
 * Couple-side approval of a pending delay report. Out of scope
 * for the vendor dashboard but kept here so a future
 * co-owner/helper dashboard can call the same wrapper without
 * duplicating the httpsCallable boilerplate.
 *
 * @param {object} args
 * @param {string} args.ownerUid
 * @param {string} args.eventId
 * @param {string} args.entryId
 * @param {string} args.reportId
 * @param {boolean} [args.approve]
 * @returns {Promise<{ ok: boolean, message?: string, data?: any }>}
 */
export async function approveVendorDelay({
  ownerUid,
  eventId,
  entryId,
  reportId,
  approve = true,
}) {
  if (!ownerUid || !eventId || !entryId || !reportId) {
    return {
      ok: false,
      message: '缺少必要資料，請重新整理後再試。',
    };
  }
  try {
    const fn = httpsCallable(getFunctions(), 'approveVendorDelay');
    const result = await fn({ ownerUid, eventId, entryId, reportId, approve });
    return { ok: true, data: result?.data ?? null };
  } catch (err) {
    const message = err?.message || '確認延誤失敗，請稍後再試。';
    return { ok: false, message };
  }
}
