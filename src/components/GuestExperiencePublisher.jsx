// GuestExperiencePublisher.jsx
// =============================
//
// 2026-08-23 — Manus P2c: owner-facing section that calls the
// publishGuestExperience callable. Lives in EventSettingsModal as a
// new <section>, alongside OwnerNamesEditor.
//
// Why this exists (PDF §3.3 data model):
//   The guest portal reads from
//   artifacts/{appId}/users/{ownerUid}/events/{eventId}/guestExperience/public
//   not the canonical /events/{eventId} doc. The public doc is
//   privacy-filtered (no guest list, no PII, no admin fields) and
//   is owned entirely by the publishGuestExperience callable. This
//   component is the manual trigger for that callable from the
//   owner's UI.
//
//   Until the owner publishes at least once, the guest portal
//   falls through to the legacy event doc read (P2b fallback). After
//   publish, the projection takes over and the privacy boundary
//   holds.
//
// Props (all required):
//   currentUser  — Firebase Auth user (for ownerUid check on callable)
//   eventId      — string
//   onToast      — (msg, kind?) => void
//   currentEvent — { id, ... } — passed through for parity with
//                  OwnerNamesEditor (which uses eventId + currentUser)

import { useEffect, useState } from 'react';
import {
  doc,
  getDoc,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, appId, functions } from '../lib/firebase';
import { Send, CheckCircle2, RefreshCw, Loader2, AlertCircle } from 'lucide-react';

export function GuestExperiencePublisher({
  currentUser,
  eventId,
  currentEvent,
  onToast,
}) {
  const [publishedAt, setPublishedAt] = useState(null);
  const [loadingPublished, setLoadingPublished] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // Read the existing public doc's publishedAt so we can show
  // "Last published: X". This is a metadata-only read (just the
  // timestamp) — the privacy boundary is on the doc body, not the
  // owner-readable metadata.
  useEffect(() => {
    if (!eventId || !currentUser?.uid) return undefined;
    let cancelled = false;
    setLoadingPublished(true);
    (async () => {
      try {
        const snap = await getDoc(
          doc(
            db,
            'artifacts',
            appId,
            'users',
            currentUser.uid,
            'events',
            eventId,
            'guestExperience',
            'public',
          ),
        );
        if (cancelled) return;
        const ts = snap.exists() ? snap.data()?.publishedAt : null;
        setPublishedAt(ts);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[guestExperiencePublisher] read publishedAt failed', e);
      } finally {
        if (!cancelled) setLoadingPublished(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, currentUser?.uid]);

  const handlePublish = async () => {
    if (!eventId || !currentUser?.uid) return;
    setPublishing(true);
    try {
      const publish = httpsCallable(functions, 'publishGuestExperience');
      await publish({ ownerUid: currentUser.uid, eventId });
      // Refresh the publishedAt indicator
      const snap = await getDoc(
        doc(
          db,
          'artifacts',
          appId,
          'users',
          currentUser.uid,
          'events',
          eventId,
          'guestExperience',
          'public',
        ),
      );
      setPublishedAt(snap.exists() ? snap.data()?.publishedAt : null);
      onToast?.('✅ 嘉賓專屬頁已更新', 'success');
    } catch (e) {
      const msg = e?.message || '發佈失敗，請稍後再試';
      onToast?.(`✗ ${msg}`, 'error');
    } finally {
      setPublishing(false);
    }
  };

  // Format a Firestore Timestamp or null. Defensive against
  // undefined / null / Date / {seconds,nanoseconds} / string.
  const formatPublishedAt = () => {
    if (!publishedAt) return null;
    try {
      // Firestore Timestamp has toDate()
      const d =
        typeof publishedAt.toDate === 'function'
          ? publishedAt.toDate()
          : publishedAt instanceof Date
          ? publishedAt
          : null;
      if (!d) return null;
      return d.toLocaleString('zh-HK', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return null;
    }
  };

  const last = formatPublishedAt();

  return (
    <section>
      <h3 className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-1.5">
        <Send className="w-4 h-4" />
        嘉賓專屬頁發佈
      </h3>
      <p className="text-xs text-slate-500 mb-3 leading-relaxed">
        發佈後，嘉賓打開連結會看到你揀過嘅場地、時間、訊息同心意貼圖。
        未發佈嘅活動會繼續用舊版資料顯示。
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handlePublish}
          disabled={publishing || loadingPublished}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {publishing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              發佈中…
            </>
          ) : last ? (
            <>
              <RefreshCw className="w-4 h-4" />
              重新發佈
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              立即發佈
            </>
          )}
        </button>
        {loadingPublished ? (
          <span className="text-xs text-slate-400 inline-flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            檢查狀態…
          </span>
        ) : last ? (
          <span className="text-xs text-emerald-700 inline-flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            上次發佈：{last}
          </span>
        ) : (
          <span className="text-xs text-slate-500 inline-flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5" />
            尚未發佈
          </span>
        )}
      </div>
    </section>
  );
}
