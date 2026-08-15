// 2026-07-29 — Referral modal.
// 2026-08-15 — drop the manual email-claim tab. Auto-qualify trigger
// (referralCodes.ts:onEventCreated) now grants the unlock the moment
// a referred friend creates their first event — no email lookup
// required. The Track tab now surfaces the pending/qualified state
// directly.
//
// Owner opens this from the RewardsBanner "Earn via referral" button.
// Two tabs:
//
//   1. Share   — show my referralCode + share URL + a copy-to-clipboard
//                button. Native share + QR generation deferred.
//
//   2. Track   — show referredCount (signed up) + qualifiedReferralCount
//                (created their first event → you got the unlock). Each
//                qualified friend shows as 🎉 Premium unlocked.
//
// The Track tab auto-refreshes via Firestore listener on the user's
// own doc so the couple sees their reward land in real time.
//
// Styling mirrors InvitePartnerModal / the existing modal family
// (rounded-2xl, slate-50 header, primary button).

import { useEffect, useRef, useState } from 'react';
import { X, Copy, Check, Share2, Users, RefreshCw, PartyPopper, Sparkles } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { doc, onSnapshot } from 'firebase/firestore';
import { functions, db, appId } from '../../lib/firebase';

// 2026-08-15 — qualifiedReferralCount replaces the old claimedCount
// field name in our wire. The server keeps claimedCount for
// backwards compat with anything still reading it.
interface ReferralInfo {
  code: string;
  shareUrl: string;
  referredCount: number;
  qualifiedReferralCount: number;
  claimedCount?: number; // legacy alias
}

interface ReferralModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Used for a "you got premium!" celebration toast on the caller side.
  // Receives the qualifiedReferralCount so the parent can decide how
  // loudly to celebrate (first unlock is more delightful than the Nth).
  onQualifiedIncrease?: (newQualified: number) => void;
}

type Tab = 'share' | 'track';

export function ReferralModal({ isOpen, onClose, onQualifiedIncrease }: ReferralModalProps) {
  const [tab, setTab] = useState<Tab>('share');
  const [info, setInfo] = useState<ReferralInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // 2026-08-15 — Track the previous qualifiedReferralCount so we can
  // detect a fresh unlock and fire the celebration toast. The auto-
  // qualify trigger is asynchronous; this is how the modal notices.
  //
  // We use a REF (not state) for the comparison baseline because
  // the onSnapshot handler closes over the value at effect-run time.
  // If we used state, every setLastQualified() would re-trigger the
  // effect, creating a new listener whose closure still has the OLD
  // value — leading to spurious celebrations or missed bumps.
  // The state mirrors the ref for UI re-renders.
  const [lastQualified, setLastQualified] = useState(0);
  const lastQualifiedRef = useRef(0);
  // Whether we've already seeded lastQualified from the initial
  // snapshot. Avoids spurious toasts on mount for users who already
  // have qualifiedReferralCount > 0.
  const seededRef = useRef(false);

  // Load referral info when the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setInfoLoading(true);
    setInfoError(null);
    const fn = httpsCallable<
      void,
      {
        code: string;
        shareUrl: string;
        referredCount: number;
        qualifiedReferralCount: number;
        claimedCount?: number;
      }
    >(functions, 'getMyReferralInfo');
    fn()
      .then((res) => {
        if (cancelled) return;
        setInfo(res.data);
        // Initialize lastQualified on first read; the onSnapshot
        // below will pick up future changes.
        if (typeof res.data.qualifiedReferralCount === 'number') {
          setLastQualified(res.data.qualifiedReferralCount);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.warn('[ReferralModal] getMyReferralInfo failed:', err?.code, err?.message);
        setInfoError(
          err?.code === 'functions/unauthenticated'
            ? '請先登入。'
            : '讀唔到推薦資料，請稍後再試。',
        );
      })
      .finally(() => {
        if (!cancelled) setInfoLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // 2026-08-15 — Live listener on our own user doc so the Track
  // tab updates the moment a friend is auto-qualified (the trigger
  // writes qualifiedReferralCount via FieldValue.increment). This
  // is what makes the experience feel real-time instead of
  // requiring a manual refresh.
  //
  // We use the userDoc from the auth listener, not a separate auth
  // subscription, so we don't double-bind auth state. If the user
  // isn't signed in yet, the listener simply isn't attached.
  useEffect(() => {
    if (!isOpen) return;
    let unsub: (() => void) | null = null;
    (async () => {
      // Lazy-import the auth instance so we don't pull the firebase
      // auth SDK into the module bundle twice.
      const { auth } = await import('../../lib/firebase');
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      const userDocRef = doc(db, 'artifacts', appId, 'users', uid);
      unsub = onSnapshot(
        userDocRef,
        (snap) => {
          const data = snap.data() || {};
          const newQualified =
            typeof data.qualifiedReferralCount === 'number'
              ? data.qualifiedReferralCount
              : 0;
          // Use the ref for comparison (always-current), not the
          // closure variable. See comment above on the ref vs state
          // decision.
          if (seededRef.current) {
            if (newQualified > lastQualifiedRef.current && onQualifiedIncrease) {
              onQualifiedIncrease(newQualified);
            }
          } else {
            seededRef.current = true;
          }
          lastQualifiedRef.current = newQualified;
          setLastQualified(newQualified);
        },
        (err) => {
          // eslint-disable-next-line no-console
          console.warn('[ReferralModal] userDoc listener failed:', err?.code, err?.message);
        },
      );
    })();
    return () => {
      if (unsub) unsub();
    };
  }, [isOpen, onQualifiedIncrease]);
  // Reset the seeded flag when the modal closes so the next open
  // re-seeds from the current snapshot. Also reset the ref baseline.
  useEffect(() => {
    if (!isOpen) {
      seededRef.current = false;
      lastQualifiedRef.current = 0;
    }
  }, [isOpen]);

  const copyShareUrl = async () => {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[ReferralModal] clipboard write failed:', e);
    }
  };

  const refreshInfo = async () => {
    setInfoLoading(true);
    setInfoError(null);
    try {
      const fn = httpsCallable<
        void,
        { code: string; shareUrl: string; referredCount: number; claimedCount: number }
      >(functions, 'getMyReferralInfo');
      const res = await fn();
      setInfo(res.data);
    } catch (err: any) {
      setInfoError(err?.message || '重新讀取失敗。');
    } finally {
      setInfoLoading(false);
    }
  };

  // 2026-08-15 — submitClaim removed. The auto-qualify trigger
  // (referralCodes.ts:onEventCreated) handles qualification
  // server-side; the couple no longer types a friend's email.
  // requestReferralClaim is kept on the server for backwards
  // compat with deep-linked browser sessions but is no longer
  // surfaced in the UI.
  void httpsCallable; // keep import live for the getMyReferralInfo call above

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-rose-50 via-white to-amber-50 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-rose-500" />
            <h2 className="text-lg font-bold text-slate-800">推薦朋友 · 解鎖 Premium</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1"
            aria-label="關閉"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 px-6">
          {(
            [
              { id: 'share', label: '分享', icon: Share2 },
              { id: 'track', label: '追蹤', icon: Users },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id);
              }}
              className={`flex items-center gap-1.5 px-3 py-3 text-sm font-bold border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-rose-500 text-rose-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="p-6">
          {infoLoading && !info ? (
            <div className="text-center py-8 text-slate-500 text-sm">讀取中…</div>
          ) : infoError && !info ? (
            <div className="text-center py-6">
              <p className="text-rose-600 text-sm mb-3">{infoError}</p>
              <button
                onClick={refreshInfo}
                className="text-sm font-bold text-rose-600 hover:text-rose-700 underline"
              >
                重試
              </button>
            </div>
          ) : info ? (
            <>
              {tab === 'share' && (
                <div>
                  <p className="text-sm text-slate-600 mb-4">
                    分享你嘅推薦連結，等朋友用呢條連結註冊並建立婚禮，你就可以解鎖{' '}
                    <span className="font-bold text-amber-600">+500MB</span> 儲存空間同移除浮水印。
                  </p>

                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                    你嘅推薦碼
                  </label>
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4 text-center">
                    <div className="text-2xl font-black text-amber-700 tracking-widest">
                      {info.code}
                    </div>
                  </div>

                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                    分享連結
                  </label>
                  <div className="flex items-stretch gap-2 mb-3">
                    <input
                      type="text"
                      readOnly
                      value={info.shareUrl}
                      className="flex-1 px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg font-mono text-slate-700 select-all"
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                    <button
                      onClick={copyShareUrl}
                      className={`flex items-center gap-1 px-3 py-2 rounded-lg font-bold text-sm transition-colors ${
                        copied
                          ? 'bg-emerald-500 text-white'
                          : 'bg-rose-600 text-white hover:bg-rose-700'
                      }`}
                    >
                      {copied ? (
                        <>
                          <Check className="w-4 h-4" /> 已複製
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" /> 複製
                        </>
                      )}
                    </button>
                  </div>

                  <p className="text-xs text-slate-500">
                    朋友用呢條連結註冊並建立婚禮後，你會自動收到{' '}
                    <span className="font-bold text-amber-600">+500MB</span> 同移除浮水印嘅解鎖，唔使再人手 claim。
                  </p>
                </div>
              )}

              {tab === 'track' && (
                <div>
                  {/* 2026-08-15 — celebration banner when at least one
                      friend has been auto-qualified. The auto-trigger
                      grants the unlock the moment they create their
                      first event; this banner just makes that visible. */}
                  {info.qualifiedReferralCount > 0 && (
                    <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-800 flex items-start gap-2">
                      <PartyPopper className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-bold">🎉 你已經係 Premium 用戶！</div>
                        <div className="text-xs mt-0.5">
                          {info.qualifiedReferralCount} 位朋友用咗你嘅推薦碼並建立婚禮，
                          你嘅 +500MB 同移除浮水印已經自動解鎖。
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-center">
                      <div className="text-3xl font-black text-rose-600">
                        {info.referredCount}
                      </div>
                      <div className="text-xs font-bold text-slate-600 mt-1">已註冊朋友</div>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
                      <div className="text-3xl font-black text-amber-600">
                        {info.qualifiedReferralCount}
                      </div>
                      <div className="text-xs font-bold text-slate-600 mt-1">已解鎖推薦</div>
                    </div>
                  </div>

                  <p className="text-xs text-slate-500 mb-3">
                    朋友用你嘅連結註冊後，<strong>建立第一個婚禮</strong>就會自動幫你解鎖，
                    唔使再做任何嘢。
                  </p>

                  <button
                    onClick={refreshInfo}
                    disabled={infoLoading}
                    className="w-full flex items-center justify-center gap-1.5 text-sm font-bold text-slate-600 hover:text-slate-800 py-2 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-4 h-4 ${infoLoading ? 'animate-spin' : ''}`} />
                    重新整理
                  </button>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// 2026-08-15 — friendlyClaimError removed. The auto-qualify
// trigger replaces the manual email-claim flow entirely; the
// client no longer surfaces any error messages of that shape.