// 2026-07-29 — Referral modal.
//
// Owner opens this from the RewardsBanner "Earn via referral" button.
// Three tabs:
//
//   1. Share   — show my referralCode + share URL + a copy-to-clipboard
//                button. (QR generation deferred — too much code for
//                Phase 2. We'll add in Phase 4 polish if needed.)
//
//   2. Claim   — paste a friend's email. We resolve it, verify they
//                signed up via my code, verify they have ≥1 event, and
//                auto-grant storage-500mb. This is the moment the user
//                becomes premium via referral.
//
//   3. Track   — show referredCount + claimedCount so the user can see
//                who's in their pipeline. Read-only.
//
// All three tabs share one mount effect that calls
// getMyReferralInfo once (cached in state). Claim is best-effort with
// a clear success/failure message.
//
// Styling mirrors InvitePartnerModal / the existing modal family
// (rounded-2xl, slate-50 header, primary button).

import { useEffect, useState } from 'react';
import { X, Copy, Check, Share2, Mail, Sparkles, Users, RefreshCw } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';

interface ReferralInfo {
  code: string;
  shareUrl: string;
  referredCount: number;
  claimedCount: number;
}

interface ReferralModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Used for a "you got premium!" celebration toast on the caller side.
  onClaimSuccess?: (friendName: string) => void;
}

type Tab = 'share' | 'claim' | 'track';

export function ReferralModal({ isOpen, onClose, onClaimSuccess }: ReferralModalProps) {
  const [tab, setTab] = useState<Tab>('share');
  const [info, setInfo] = useState<ReferralInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [infoError, setInfoError] = useState<string | null>(null);

  const [copied, setCopied] = useState(false);
  const [claimEmail, setClaimEmail] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [claimResult, setClaimResult] = useState<
    | null
    | { kind: 'success'; friendName: string; alreadyGranted: boolean }
    | { kind: 'error'; message: string }
  >(null);

  // Load referral info when the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setInfoLoading(true);
    setInfoError(null);
    setClaimResult(null);
    const fn = httpsCallable<
      void,
      { code: string; shareUrl: string; referredCount: number; claimedCount: number }
    >(functions, 'getMyReferralInfo');
    fn()
      .then((res) => {
        if (cancelled) return;
        setInfo(res.data);
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
        if (cancelled) return;
        setInfoLoading(false);
      });
    return () => {
      cancelled = true;
    };
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

  const submitClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!claimEmail.trim()) return;
    setClaiming(true);
    setClaimResult(null);
    try {
      const fn = httpsCallable<
        { friendEmail: string },
        { ok: boolean; unlockId: string; alreadyGranted: boolean; friendName: string }
      >(functions, 'requestReferralClaim');
      const res = await fn({ friendEmail: claimEmail.trim() });
      setClaimResult({
        kind: 'success',
        friendName: res.data.friendName,
        alreadyGranted: res.data.alreadyGranted,
      });
      setClaimEmail('');
      // Refresh so the track tab shows the new claimedCount
      refreshInfo();
      if (onClaimSuccess) onClaimSuccess(res.data.friendName);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn('[ReferralModal] requestReferralClaim failed:', err?.code, err?.message);
      setClaimResult({
        kind: 'error',
        message: friendlyClaimError(err?.code, err?.message),
      });
    } finally {
      setClaiming(false);
    }
  };

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
              { id: 'claim', label: '領取', icon: Mail },
              { id: 'track', label: '追蹤', icon: Users },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id);
                setClaimResult(null);
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
                    朋友打開連結註冊後，等佢哋建立第一個婚禮，你就可以去「領取」tab claim 解鎖。
                  </p>
                </div>
              )}

              {tab === 'claim' && (
                <div>
                  <p className="text-sm text-slate-600 mb-4">
                    輸入你朋友註冊時用嘅 email。確認係用你嘅推薦碼註冊 + 已建立婚禮之後，會即時解鎖{' '}
                    <span className="font-bold text-amber-600">+500MB</span>。
                  </p>

                  <form onSubmit={submitClaim}>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                      朋友 email
                    </label>
                    <input
                      type="email"
                      required
                      value={claimEmail}
                      onChange={(e) => setClaimEmail(e.target.value)}
                      placeholder="friend@example.com"
                      disabled={claiming}
                      className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:border-rose-400 focus:ring-2 focus:ring-rose-100 outline-none disabled:opacity-50 mb-3"
                    />
                    <button
                      type="submit"
                      disabled={claiming || !claimEmail.trim()}
                      className="w-full bg-amber-500 text-white font-bold py-2.5 rounded-xl hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {claiming ? '處理中…' : '🎁 領取 +500MB 解鎖'}
                    </button>
                  </form>

                  {claimResult && (
                    <div
                      className={`mt-4 p-3 rounded-xl text-sm ${
                        claimResult.kind === 'success'
                          ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                          : 'bg-rose-50 border border-rose-200 text-rose-800'
                      }`}
                    >
                      {claimResult.kind === 'success' ? (
                        <>
                          {claimResult.alreadyGranted ? (
                            <>
                              <div className="font-bold mb-1">✓ 你之前已經領取過呢個 unlock</div>
                              <div className="text-xs">
                                {claimResult.friendName
                                  ? `${claimResult.friendName} 嘅推薦已經有效。`
                                  : '推薦解鎖仲喺度。'}
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="font-bold mb-1">
                                🎉 解鎖成功！你已經係 Premium 用戶！
                              </div>
                              <div className="text-xs">
                                {claimResult.friendName
                                  ? `感謝 ${claimResult.friendName} 用咗你嘅推薦。`
                                  : '感謝你朋友用咗你嘅推薦。'}
                                {' '}500MB 儲存空間已經加咗 + 浮水印已經移除。
                              </div>
                            </>
                          )}
                        </>
                      ) : (
                        <div className="font-bold">✗ {claimResult.message}</div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {tab === 'track' && (
                <div>
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-center">
                      <div className="text-3xl font-black text-rose-600">
                        {info.referredCount}
                      </div>
                      <div className="text-xs font-bold text-slate-600 mt-1">已註冊朋友</div>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
                      <div className="text-3xl font-black text-amber-600">
                        {info.claimedCount}
                      </div>
                      <div className="text-xs font-bold text-slate-600 mt-1">已建立婚禮</div>
                    </div>
                  </div>

                  <p className="text-xs text-slate-500 mb-3">
                    「已建立婚禮」嘅朋友先可以喺「領取」tab 解鎖。
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

function friendlyClaimError(code: string | undefined, message: string | undefined): string {
  if (code === 'functions/not-found') return '搵唔到呢個 email 嘅帳戶。請確認你朋友用咗呢個 email。';
  if (code === 'functions/failed-precondition') {
    if (message?.includes('推薦自己')) return '你不能推薦自己。';
    if (message?.includes('推薦碼註冊')) return '呢位朋友唔係用你嘅推薦碼註冊嘅，請確認佢哋用咗你分享嘅連結。';
    if (message?.includes('婚禮')) return '你嘅朋友仲未建立任何婚禮，請等佢哋建立之後再嚟 claim。';
    if (message?.includes('未有推薦碼')) return '你未有推薦碼，請聯絡管理員。';
    return message || '領取失敗，請稍後再試。';
  }
  if (code === 'functions/unauthenticated') return '請先登入。';
  return message || '領取失敗，請稍後再試。';
}