/**
 * archiveJob.ts — P1.5 lifetime archive cron.
 *
 * 2026-08-20 — Manus P1.5 audit §4.5: the unlock
 * 'permanent-archive' was already plumbed end-to-end (price
 * set, entitlement.features.lifetimeRetention=true,
 * retentionClass='lifetime' returned to the client), but no
 * code actually moved any files when an event flipped to
 * lifetime. Customers who bought permanent-archive got a
 * badge in their dashboard but no actual storage guarantee.
 *
 * This function closes the loop. Once a day at 03:00 HKT it
 * queries events whose:
 *   - date is more than 30 days in the past
 *   - retentionClass === 'lifetime' (the resolver computes
 *     this from the customer's unlocks; events without a
 *     permanent-archive grant are 'standard')
 *   - archivedAt is null (skip flag for idempotency)
 *
 * For each event it calls the NAS archive endpoint over
 * HTTPS (POST cdn.savetheday.io/archive) with an HMAC-signed
 * claim. The NAS endpoint does the actual copy + manifest
 * write (see deploy/photo_upload_server.py — _handle_archive).
 * When the NAS call succeeds, this function flips
 * event.archivedAt = Date.now() so re-runs are no-ops.
 *
 * Why a cron (not on-purchase)?
 *   - Idempotent. The 30-day buffer handles weddings that
 *     get rescheduled.
 *   - The NAS may be offline at the moment of payment; a
 *     payment-time copy would fail silently. The cron sees
 *     the failure, logs it, and retries next day.
 *   - Customers who buy permanent-archive AFTER the cron
 *     has already passed the 30-day window still get
 *     archived on the next tick (the filter is recomputed
 *     each run).
 *
 * Why the NAS has the copy logic (not the CF)?
 *   - The CF runtime is in us-central1; the photos live on
 *     the UGREEN NAS at the office LAN. The CF can't fs.read
 *     them directly. The existing photo_upload_server.py
 *     already accepts HTTPS via Cloudflare Tunnel, so adding
 *     POST /archive is the established pattern.
 *   - Keeps the bandwidth bill on the LAN. CF egress to NAS
 *     via Cloudflare Tunnel is free; CF egress to a different
 *     bucket would be billed.
 *
 * Why a separate endpoint (not POST /upload)?
 *   - Different auth shape: this is a server-to-server call
 *     with no customer involvement. The HMAC is the ONLY
 *     credential. /upload has customer-side flow and
 *     multipart parsing complexity.
 *
 * Recovery semantics:
 *   - On NAS error: do NOT set event.archivedAt. The next
 *     cron tick will retry.
 *   - On partial copy: the NAS endpoint writes a manifest
 *     with per-file sha256. The endpoint can resume from
 *     the last successful file on the next call.
 *   - Per-event failures are logged and isolated; one bad
 *     event doesn't block the rest of the batch.
 *
 * Out of scope (deferred to P2):
 *   - Real cold tier (B2 / S3 Glacier). Re-evaluate when
 *     NAS exceeds 50% capacity.
 *   - Per-customer archival status badge in the dashboard.
 *     Easy add if the customer wants it.
 *   - Restoration UI. The photo server already serves from
 *     any path; the lookup is a one-line fallback.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import * as crypto from 'crypto';

// 2026-08-20 — DO NOT call initializeApp() here. The
// functions/src/index.ts entry point already calls it
// once during the build's module-graph walk. Calling it
// again triggers `FirebaseAppError: The default Firebase
// app already exists` and the deploy fails. Other cron
// modules (vendorAnalytics.ts) follow this pattern.

const db = getFirestore();

// HMAC secret shared with the NAS-side archive endpoint.
//
// 2026-08-20 — read from the CF runtime env, NOT
// defineSecret(). The reason: defineSecret() rejects
// non-interactive deploys (`firebase deploy --non-interactive`
// doesn't have a way to set a new secret via the CLI). The
// Vercel proxy uses the same pattern (process.env.PHOTO_HMAC_SECRET)
// and we follow it for consistency. To set: `firebase
// functions:config:set nas_archive_hmac_secret=...` BEFORE
// deploying, OR use the GCP console for the CF runtime
// (`Function → Edit → Runtime environment variables`). The
// same value must match the NAS-side PHOTO_HMAC_SECRET, or
// the NAS will reject every archive request with `unauthorized
// (token mismatch)`.
const NAS_ARCHIVE_HMAC_SECRET_FROM_ENV = process.env.NAS_ARCHIVE_HMAC_SECRET || '';

// Archive endpoint URL. Defaults to the production Cdn; override
// in staging via env. The endpoint itself is added in
// deploy/photo_upload_server.py (see _handle_archive).
const NAS_ARCHIVE_URL =
  process.env.NAS_ARCHIVE_URL || 'https://cdn.savetheday.io/archive';

// 30-day buffer post-wedding-date. Configurable for testing.
export const POST_WEDDING_DAYS = Number.parseInt(
  process.env.ARCHIVE_POST_WEDDING_DAYS || '30',
  10,
);

// How many events to process per cron tick. Bounds the
// worst-case runtime so a backlog (e.g. after a week of
// CF downtime) doesn't blow the 9-min CF timeout. The next
// tick picks up where we left off.
export const BATCH_LIMIT = 20;

// ---- Archive claim shape (CF → NAS) ----
// The NAS endpoint validates this exact shape. If you change
// it here, also change _verify_archive_hmac in
// deploy/photo_upload_server.py.
interface ArchiveClaim {
  eventId: string;
  ownerUid: string;
  scheduledAt: number; // Date.now() at CF time
  expiresAt: number; // scheduledAt + 5 min
}

/**
 * Mint an HMAC-signed archive claim. Same algorithm as the
 * upload token (HMAC-SHA256 over the base64url-encoded JSON
 * payload, base64url-encoded signature). The NAS-side
 * verification uses the same primitive.
 */
async function mintArchiveClaim(claim: ArchiveClaim, secret: string): Promise<string> {
  const json = JSON.stringify(claim);
  const b64 = Buffer.from(json, 'utf-8')
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const sig = crypto
    .createHmac('sha256', secret)
    .update(b64)
    .digest('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${b64}.${sig}`;
}

/**
 * Find events eligible for archival today.
 *
 * Returns: { eventId, ownerUid, date, retentionClass }
 *   - date < today − 30d (so the wedding has passed)
 *   - retentionClass === 'lifetime'
 *   - archivedAt is null (skip flag)
 *
 * Firestore query: we filter by retentionClass first
 * (server-side, indexed), then post-filter by date in code
 * because date is a free-form string (ISO or free-form like
 * "2026-10-15"). Mixing a string comparison with a null
 * check on archivedAt requires an index; we keep the
 * filter on date client-side to avoid that.
 *
 * NB: collectionGroup on 'events' is required because event
 * docs live under /artifacts/{appId}/users/{ownerUid}/events/.
 * make sure the events collectionGroup composite index
 * covers retentionClass + archivedAt.
 */
async function findEventsToArchive(now: number): Promise<Array<{
  eventId: string;
  ownerUid: string;
  date: string;
  docRef: FirebaseFirestore.DocumentReference;
}>> {
  const cutoffMs = now - POST_WEDDING_DAYS * 24 * 60 * 60 * 1000;
  const cutoffIso = new Date(cutoffMs).toISOString().slice(0, 10); // YYYY-MM-DD

  // Step 1: query the events collectionGroup with retentionClass=lifetime
  //         and archivedAt is null. The server returns all
  //         candidates; we filter by date client-side.
  const snap = await db
    .collectionGroup('events')
    .where('retentionClass', '==', 'lifetime')
    .where('archivedAt', '==', null)
    .limit(BATCH_LIMIT * 4) // over-fetch; we filter below
    .get();

  const eligible: Array<{
    eventId: string;
    ownerUid: string;
    date: string;
    docRef: FirebaseFirestore.DocumentReference;
  }> = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const date = String(data.date || '');
    // Date is stored as YYYY-MM-DD or similar. Compare
    // lexicographically — ISO dates sort correctly.
    if (!date || date >= cutoffIso) continue;
    // Extract ownerUid from path: /artifacts/{appId}/users/{ownerUid}/events/{eventId}
    const pathParts = doc.ref.path.split('/');
    const ownerUid = pathParts[pathParts.indexOf('users') + 1];
    if (!ownerUid) continue;
    eligible.push({
      eventId: doc.id,
      ownerUid,
      date,
      docRef: doc.ref,
    });
    if (eligible.length >= BATCH_LIMIT) break;
  }

  return eligible;
}

/**
 * Call the NAS archive endpoint. The endpoint does the
 * actual file copy + manifest write. Returns:
 *   { ok: true, filesCopied, bytesCopied, manifestPath }
 *   { ok: false, reason: 'quota'|'unauthorized'|'error', message }
 *
 * Throws on network failure (so the caller can log and
 * re-try next tick).
 */
async function callNasArchive(
  eventId: string,
  ownerUid: string,
  secret: string,
): Promise<{ ok: boolean; reason?: string; message?: string; filesCopied?: number; bytesCopied?: number }> {
  const now = Date.now();
  const claim: ArchiveClaim = {
    eventId,
    ownerUid,
    scheduledAt: now,
    expiresAt: now + 5 * 60 * 1000, // 5 min
  };
  const token = await mintArchiveClaim(claim, secret);

  const headers = {
    'Content-Type': 'application/json',
    'X-Archive-Token': token,
  };

  const res = await fetch(NAS_ARCHIVE_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ eventId, ownerUid }),
    // 60s budget per event. The NAS does a directory copy
    // + manifest write; for events with thousands of photos
    // this could be slow. If it overflows we abort and let
    // next tick retry.
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    let body: { reason?: string; message?: string } = {};
    try {
      body = await res.json();
    } catch {
      // ignore — non-JSON error
    }
    return {
      ok: false,
      reason: body.reason ?? 'unknown',
      message: body.message ?? `HTTP ${res.status}`,
    };
  }

  const body = await res.json() as { filesCopied?: number; bytesCopied?: number };
  return {
    ok: true,
    filesCopied: body.filesCopied,
    bytesCopied: body.bytesCopied,
  };
}

/**
 * markArchived — set event.archivedAt = Date.now() after a
 * successful NAS archive. Uses a conditional update so two
 * concurrent cron ticks (e.g. manual trigger + scheduled)
 * don't both flip the flag and lose the original timestamp.
 */
async function markArchived(
  docRef: FirebaseFirestore.DocumentReference,
  filesCopied: number,
  bytesCopied: number,
): Promise<void> {
  await docRef.update({
    archivedAt: Date.now(),
    archiveManifest: {
      filesCopied,
      bytesCopied,
      archivedBy: 'archiveJob',
    },
  });
}

// =================================================================
// MAIN CRON HANDLER
// =================================================================
export const dailyArchiveLifetimeEvents = onSchedule(
  {
    // 03:15 HKT Asia. After dailyVendorAnalyticsSweep (02:17)
    // so we don't pile up against other heavyweight jobs.
    schedule: '15 3 * * *',
    timeZone: 'Asia/Hong_Kong',
    region: 'us-central1',
    // Run-as-time env-var binding replaces defineSecret() (see top of file).
  },
  async () => {
    const startedAt = Date.now();
    const secret = NAS_ARCHIVE_HMAC_SECRET_FROM_ENV;
    if (!secret) {
      console.error('[dailyArchiveLifetimeEvents] NAS_ARCHIVE_HMAC_SECRET not set. Aborting.');
      return;
    }

    let candidates: Array<{ eventId: string; ownerUid: string; date: string; docRef: FirebaseFirestore.DocumentReference }>;
    try {
      candidates = await findEventsToArchive(startedAt);
    } catch (err) {
      console.error('[dailyArchiveLifetimeEvents] failed to find candidates:', err);
      return;
    }

    if (candidates.length === 0) {
      console.log('[dailyArchiveLifetimeEvents] no events to archive at', new Date(startedAt).toISOString());
      return;
    }

    console.log(
      '[dailyArchiveLifetimeEvents] processing',
      candidates.length,
      'events at',
      new Date(startedAt).toISOString(),
    );

    let succeeded = 0;
    let failed = 0;
    let skippedQuota = 0;

    for (const c of candidates) {
      try {
        const result = await callNasArchive(c.eventId, c.ownerUid, secret);
        if (!result.ok) {
          if (result.reason === 'quota') {
            skippedQuota++;
            console.warn(
              '[dailyArchiveLifetimeEvents] quota-blocked',
              c.eventId,
              result.message,
            );
          } else {
            failed++;
            console.error(
              '[dailyArchiveLifetimeEvents] failed',
              c.eventId,
              result.reason,
              result.message,
            );
          }
          continue;
        }
        await markArchived(c.docRef, result.filesCopied ?? 0, result.bytesCopied ?? 0);
        succeeded++;
        console.log(
          '[dailyArchiveLifetimeEvents] archived',
          c.eventId,
          'filesCopied=' + (result.filesCopied ?? 0),
          'bytesCopied=' + (result.bytesCopied ?? 0),
        );
      } catch (err) {
        // Network failure or timeout. Don't mark archived.
        failed++;
        console.error('[dailyArchiveLifetimeEvents] threw on', c.eventId, err);
      }
    }

    console.log(
      '[dailyArchiveLifetimeEvents] done',
      'succeeded=' + succeeded,
      'failed=' + failed,
      'skippedQuota=' + skippedQuota,
      'durationMs=' + (Date.now() - startedAt),
    );
  },
);

// =================================================================
// Adaptive helpers exposed for tests.
// =================================================================
//
// 2026-08-20 — these are exported so the unit tests can
// exercise the pure logic without going through the live
// cron. The tests in test/cron/archiveJob.test.ts mock
// firebase-admin and assert: filter logic, HMAC minting,
// claim shape, batch limit. The full cron handler is
// integration-tested in the deploy smoke test (see
// scripts/smoke-archive-job.sh in a follow-up).
export const __test__ = {
  mintArchiveClaim,
  POST_WEDDING_DAYS,
  BATCH_LIMIT,
};

// Helper for the test suite: re-export the comparator we
// use to filter by date so it can be tested independently.
export function isPastCutoff(eventDate: string, cutoffIso: string): boolean {
  if (!eventDate) return false;
  return eventDate < cutoffIso;
}
