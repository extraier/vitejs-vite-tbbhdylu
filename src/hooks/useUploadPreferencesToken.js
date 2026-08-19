/**
 * useUploadPreferencesToken — owner-side upload preferences.
 *
 * 2026-08-02 — Watermark (Option 1).
 *
 * Background. Every photo upload (owner's + guests') goes
 * through Vercel /api/photo-upload → NAS photo_upload_server.py.
 * Until this commit the NAS had no way to know whether the
 * wedding owner had the `watermark-removed` unlock, so the
 * default-on Pillow watermark applied to every photo regardless
 * of premium status — the banner's
 *   "推介 1 位朋友 → +500MB + 移除浮水印"
 * promise was a lie.
 *
 * What this hook does. Watches the owner's unlocks via the
 * shared useUserProfile hook (already wired into the dashboard
 * + PhotoDrop). When `watermark-removed` is present, fetches a
 * short-lived HMAC-signed token from the
 * `getUploadPreferencesToken` CF and caches it for the active
 * event. Returns `{ prefsToken, watermarkDisabled }` so the
 * upload path (App.jsx → uploadToNas.ts) can attach the token
 * to every multipart upload.
 *
 * Why fetch + cache instead of read-on-demand. The CF call is
 * a single round-trip to Firebase (~150 ms on warm path); a
 * guest who uploads 10 photos shouldn't pay 10 round-trips.
 * Caching for 50 minutes (10 min below the 1-hour server TTL)
 * means a typical wedding upload burst hits the network once.
 *
 * Failure mode. If the CF call fails (network blip, CF cold
 * start, deploy), `prefsToken` stays null and the upload still
 * succeeds — Vercel proxy logs "bad prefs token" and falls
 * through to default-on watermark. The hook never throws.
 *
 * 2026-08-02 — initial release.
 */

import { useEffect, useState, useRef } from 'react';
import { callFirebaseFn } from '../lib/firebaseFn';

// Server mints tokens with 1-hour TTL. We refresh 10 minutes
// before expiry so we never hand out an expired token.
const REFRESH_BUFFER_MS = 10 * 60 * 1000;

export function useUploadPreferencesToken({ ownerUid, eventId, unlocks }) {
  const [prefsToken, setPrefsToken] = useState(null);
  const [watermarkDisabled, setWatermarkDisabled] = useState(false);
  // 2026-08-19 — Manus P1.4.a: also surface the storage
  // quota + current usage so the photo drop can render a
  // real "X MB / Y MB" indicator. The CF is the source of
  // truth; on first error or missing event the hook falls
  // back to defaults so legacy screen code keeps working.
  const [storageUsageBytes, setStorageUsageBytes] = useState(0);
  const [storageQuotaBytes, setStorageQuotaBytes] = useState(200 * 1024 * 1024);
  // Track which (ownerUid, eventId) tuple the cached token was
  // minted for so we re-fetch when the user switches events.
  const mintedForRef = useRef(null);
  const refreshTimerRef = useRef(null);

  useEffect(() => {
    // Cancel any pending refresh — we're about to recompute.
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    if (!ownerUid || !eventId) {
      // No event selected (owner on dashboard, not inside an
      // event). Nothing to mint. Don't clobber an existing
      // prefsToken from a previous event — the cleanup at unmount
      // handles that.
      return;
    }

    const hasUnlock = Array.isArray(unlocks) && unlocks.includes('watermark-removed');

    // Default: watermark ON, no token. Matches the NAS behavior.
    setWatermarkDisabled(false);
    setPrefsToken(null);
    mintedForRef.current = null;

    if (!hasUnlock) {
      // The owner doesn't have the unlock — no need to mint a
      // token. Every upload gets default-on watermark. Done.
      return;
    }

    // Fire-and-forget. The CF call is async; we don't await
    // here because useEffect should be sync to avoid the React
    // cascading-render warning. The CF result updates state
    // when it arrives, which triggers a re-render of any
    // component consuming this hook.
    let cancelled = false;

    const fetchToken = async () => {
      try {
        const result = await callFirebaseFn('getUploadPreferencesToken', {
          ownerUid,
          eventId,
        });
        if (cancelled) return;
        // The CF returns { token, expiresAt, watermarkDisabled }.
        // `watermarkDisabled` reflects the unlock status at mint
        // time; we already know hasUnlock===true so it should
        // be true here too. We still trust the CF's value as the
        // source of truth.
        if (result && result.token) {
          setPrefsToken(result.token);
          setWatermarkDisabled(result.watermarkDisabled === true);
          // 2026-08-19 — Manus P1.4.a: surface the quota +
          // current usage. Bytes are bytes; the UI converts
          // to MB. Missing field on the CF means we're
          // looking at a stale build (rare) — defaults hold.
          if (Number.isFinite(result.storageUsageBytes)) {
            setStorageUsageBytes(result.storageUsageBytes);
          }
          if (Number.isFinite(result.storageQuotaBytes)) {
            setStorageQuotaBytes(result.storageQuotaBytes);
          }
          mintedForRef.current = { ownerUid, eventId, expiresAt: result.expiresAt };
          // Schedule the next refresh.
          const refreshIn = Math.max(
            60_000, // minimum 1 minute, even if buffer is weird
            (result.expiresAt || Date.now() + 60 * 60 * 1000) - Date.now() - REFRESH_BUFFER_MS,
          );
          refreshTimerRef.current = setTimeout(fetchToken, refreshIn);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[prefs-token] fetch failed, watermark on:', err && err.message);
        if (cancelled) return;
        // Leave prefsToken null — uploads will succeed with the
        // default-on watermark. We don't retry inline; the user
        // can refresh by changing unlocks (which re-runs this
        // effect).
      }
    };

    fetchToken();

    return () => {
      cancelled = true;
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [ownerUid, eventId, unlocks ? unlocks.join(',') : '']);

  return {
    prefsToken,
    watermarkDisabled,
    // 2026-08-19 — Manus P1.4.a: quota + current usage.
    // The UI passes these into the photo drop instead of
    // the photo-count * 1.5 estimate. Backwards-compatible
    // — screens that don't read these still work.
    storageUsageBytes,
    storageQuotaBytes,
    remainingBytes: Math.max(storageQuotaBytes - storageUsageBytes, 0),
  };
}