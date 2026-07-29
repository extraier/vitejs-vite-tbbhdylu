// 2026-07-29 — Social proof submission modal.
//
// Replaces the `alert()` TODO at EventsDashboard.tsx:106. Owner opens
// this from the RewardsBanner "分享" button. Two tabs:
//
//   1. 提交   — form to submit a new IG/FB proof. Choose unlock type
//                (custom-template or permanent-archive), paste the
//                post URL, optional caption. Calls submitSocialProof
//                which writes a /socialProofs/{proofId} doc with
//                status='pending'. Admin verifies within 24h.
//
//   2. 進度   — list of all proofs the user has submitted, with
//                their status (pending / approved / rejected). Helps
//                the user avoid re-submitting and shows ETA.
//
// Social proof is for non-storage unlocks only — storage-500mb uses
// the referral path (Phase 2). The submitSocialProof CF rejects
// storage-500mb at the server, and we don't offer it as a choice
// here either.
//
// Styling mirrors ReferralModal / the existing modal family.

import { useEffect, useState } from 'react';
import { X, Send, Check, Clock, RefreshCw, Instagram, AlertCircle } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';

// 2026-07-29 — UnlockType lives in EventsDashboard.tsx today but the
// modal needs to be reachable from screens that don't import the
// dashboard. Mirror the 3-union here; if the canonical type ever
// diverges (e.g. a 4th unlock), update both places. Server-side CF
// validation is the real safety net.
type UnlockType = 'custom-template' | 'storage-500mb' | 'permanent-archive';

interface SocialProofModalProps {
  isOpen: boolean;
  onClose: () => void;
  ownerUid: string;
}

type Tab = 'submit' | 'history';

type ProofStatus = 'pending' | 'approved' | 'rejected';

interface ProofRow {
  id: string;
  unlockType: UnlockType;
  postUrl: string;
  status: ProofStatus;
  createdAt: number | null;
  verifiedAt: number | null;
  rejectionReason: string | null;
}

interface ProofList {
  ok: boolean;
  rows: ProofRow[];
}

const ALLOWED_UNLOCK_TYPES: { id: Exclude<UnlockType, 'storage-500mb'>; label: string; hint: string; emoji: string }[] = [
  {
    id: 'custom-template',
    label: '🎨 上傳自訂電子喜帖設計',
    hint: 'IG/FB Story 或 Post 標記 @savetheday.hk',
    emoji: '🎨',
  },
  {
    id: 'permanent-archive',
    label: '🏛️ 永久保存婚禮檔案',
    hint: '拍 1 段 IG Reels 用 Save The Day',
    emoji: '🏛️',
  },
];

export function SocialProofModal({ isOpen, onClose, ownerUid }: SocialProofModalProps) {
  const [tab, setTab] = useState<Tab>('submit');

  // Submit form state
  const [unlockType, setUnlockType] = useState<Exclude<UnlockType, 'storage-500mb'>>(
    'custom-template',
  );
  const [postUrl, setPostUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<
    | null
    | { kind: 'success'; proofId: string; estimatedReviewTime: string }
    | { kind: 'error'; message: string }
  >(null);

  // History state
  const [history, setHistory] = useState<ProofRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Reset on open/close.
  useEffect(() => {
    if (!isOpen) {
      setSubmitResult(null);
      setPostUrl('');
      setCaption('');
    }
  }, [isOpen]);

  // Load history when switching to history tab (or on first open).
  useEffect(() => {
    if (!isOpen || tab !== 'history' || !ownerUid) return;
    let cancelled = false;
    setHistoryLoading(true);
    const fn = httpsCallable<void, ProofList>(functions, 'listSocialProofs');
    fn()
      .then((res) => {
        if (cancelled) return;
        setHistory(Array.isArray(res.data?.rows) ? res.data.rows : []);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[SocialProofModal] listSocialProofs failed:', err?.code, err?.message);
        if (cancelled) return;
        setHistory([]);
      })
      .finally(() => {
        if (cancelled) return;
        setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, tab, ownerUid]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!postUrl.trim()) return;
    setSubmitting(true);
    setSubmitResult(null);
    try {
      const fn = httpsCallable<
        { unlockType: string; postUrl: string; caption?: string },
        { proofId: string; estimatedReviewTime: string }
      >(functions, 'submitSocialProof');
      const res = await fn({
        unlockType,
        postUrl: postUrl.trim(),
        caption: caption.trim() || undefined,
      });
      setSubmitResult({
        kind: 'success',
        proofId: res.data.proofId,
        estimatedReviewTime: res.data.estimatedReviewTime,
      });
      setPostUrl('');
      setCaption('');
      // Refresh history if it's already loaded
      if (tab === 'history' && ownerUid) {
        const fn2 = httpsCallable<void, ProofList>(functions, 'listSocialProofs');
        fn2()
          .then((r) => setHistory(Array.isArray(r.data?.rows) ? r.data.rows : []))
          .catch(() => {});
      }
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn('[SocialProofModal] submitSocialProof failed:', err?.code, err?.message);
      setSubmitResult({
        kind: 'error',
        message: friendlySubmitError(err?.code, err?.message),
      });
    } finally {
      setSubmitting(false);
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
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-rose-50 via-white to-amber-50 border-b border-slate-200 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Instagram className="w-5 h-5 text-rose-500" />
            <h2 className="text-lg font-bold text-slate-800">社交分享解鎖</h2>
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
        <div className="flex border-b border-slate-200 px-6 flex-shrink-0">
          {(
            [
              { id: 'submit', label: '提交', icon: Send },
              { id: 'history', label: '進度', icon: Clock },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
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
        <div className="p-6 overflow-y-auto flex-1">
          {tab === 'submit' && (
            <form onSubmit={submit}>
              <p className="text-sm text-slate-600 mb-4">
                用 IG/FB Story 或 Post 標記 <span className="font-bold">@savetheday.hk</span>
                ，然後貼上連結俾我哋人手核實。核實後自動解鎖。
              </p>

              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                想解鎖咩功能？
              </label>
              <div className="space-y-2 mb-4">
                {ALLOWED_UNLOCK_TYPES.map((opt) => (
                  <label
                    key={opt.id}
                    className={`flex items-start gap-3 p-3 border-2 rounded-xl cursor-pointer transition-colors ${
                      unlockType === opt.id
                        ? 'border-rose-400 bg-rose-50'
                        : 'border-slate-200 hover:border-rose-200'
                    }`}
                  >
                    <input
                      type="radio"
                      name="unlockType"
                      value={opt.id}
                      checked={unlockType === opt.id}
                      onChange={() => setUnlockType(opt.id)}
                      className="mt-1 accent-rose-600"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-slate-800">{opt.label}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{opt.hint}</div>
                    </div>
                  </label>
                ))}
              </div>

              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                IG/FB 連結 <span className="text-rose-500">*</span>
              </label>
              <input
                type="url"
                required
                value={postUrl}
                onChange={(e) => setPostUrl(e.target.value)}
                placeholder="https://www.instagram.com/p/..."
                disabled={submitting}
                className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:border-rose-400 focus:ring-2 focus:ring-rose-100 outline-none disabled:opacity-50 mb-3"
              />

              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                備註（可選）
              </label>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="例：標記咗你哋個 account 想用自訂設計"
                maxLength={500}
                rows={2}
                disabled={submitting}
                className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:border-rose-400 focus:ring-2 focus:ring-rose-100 outline-none disabled:opacity-50 mb-4 resize-none"
              />

              <button
                type="submit"
                disabled={submitting || !postUrl.trim()}
                className="w-full bg-rose-600 text-white font-bold py-2.5 rounded-xl hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? '提交中…' : '🚀 提交社交證明'}
              </button>

              {submitResult && (
                <div
                  className={`mt-4 p-3 rounded-xl text-sm ${
                    submitResult.kind === 'success'
                      ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                      : 'bg-rose-50 border border-rose-200 text-rose-800'
                  }`}
                >
                  {submitResult.kind === 'success' ? (
                    <>
                      <div className="font-bold mb-1 flex items-center gap-1.5">
                        <Check className="w-4 h-4" />
                        已提交！等待管理員核實
                      </div>
                      <div className="text-xs">
                        {submitResult.estimatedReviewTime} · Proof ID: {submitResult.proofId.substring(0, 16)}…
                      </div>
                    </>
                  ) : (
                    <div className="font-bold flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4" />
                      {submitResult.message}
                    </div>
                  )}
                </div>
              )}
            </form>
          )}

          {tab === 'history' && (
            <div>
              {historyLoading ? (
                <div className="text-center py-8 text-slate-500 text-sm">讀取中…</div>
              ) : history.length === 0 ? (
                <div className="text-center py-8">
                  <div className="text-4xl mb-2">📭</div>
                  <p className="text-sm text-slate-600">尚未提交任何社交證明</p>
                  <p className="text-xs text-slate-400 mt-1">
                    去「提交」tab 提交第一個 IG/FB 連結啦
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {history.map((row) => (
                    <li
                      key={row.id}
                      className="border border-slate-200 rounded-xl p-3 bg-slate-50"
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="text-sm font-bold text-slate-800">
                          {unlockLabel(row.unlockType)}
                        </div>
                        <StatusBadge status={row.status} />
                      </div>
                      <a
                        href={row.postUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-xs text-rose-600 hover:text-rose-700 break-all underline"
                      >
                        {row.postUrl}
                      </a>
                      {row.status === 'rejected' && row.rejectionReason && (
                        <div className="mt-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">
                          原因：{row.rejectionReason}
                        </div>
                      )}
                      <div className="mt-1.5 text-[10px] text-slate-400">
                        提交：{formatDate(row.createdAt)}
                        {row.verifiedAt && ` · 核實：${formatDate(row.verifiedAt)}`}
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {history.length > 0 && (
                <button
                  onClick={() => {
                    setHistoryLoading(true);
                    const fn = httpsCallable<void, ProofList>(functions, 'listSocialProofs');
                    fn()
                      .then((r) => setHistory(Array.isArray(r.data?.rows) ? r.data.rows : []))
                      .catch(() => {})
                      .finally(() => setHistoryLoading(false));
                  }}
                  disabled={historyLoading}
                  className="w-full mt-4 flex items-center justify-center gap-1.5 text-sm font-bold text-slate-600 hover:text-slate-800 py-2 disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${historyLoading ? 'animate-spin' : ''}`} />
                  重新整理
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ProofStatus }) {
  if (status === 'pending') {
    return (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 flex items-center gap-1 flex-shrink-0">
        <Clock className="w-3 h-3" />
        核實中
      </span>
    );
  }
  if (status === 'approved') {
    return (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 flex items-center gap-1 flex-shrink-0">
        <Check className="w-3 h-3" />
        已通過
      </span>
    );
  }
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 flex items-center gap-1 flex-shrink-0">
      <X className="w-3 h-3" />
      已拒絕
    </span>
  );
}

function unlockLabel(t: UnlockType): string {
  const map: Record<UnlockType, string> = {
    'custom-template': '🎨 自訂電子喜帖',
    'storage-500mb': '📸 +500MB 相簿',
    'permanent-archive': '🏛️ 永久保存檔案',
  };
  return map[t] || t;
}

function formatDate(ts: number | null): string {
  if (!ts) return '—';
  // ts can be ms (serverTimestamp converted) or seconds (Firestore raw)
  const ms = ts > 1e12 ? ts : ts * 1000;
  return new Date(ms).toLocaleDateString('zh-HK', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function friendlySubmitError(code: string | undefined, message: string | undefined): string {
  if (code === 'functions/invalid-argument') {
    if (message?.includes('Instagram') || message?.includes('Facebook'))
      return 'URL 必須係 Instagram 或 Facebook 連結。';
    if (message?.includes('postUrl')) return '請貼上 IG/FB 連結。';
    if (message?.includes('caption')) return '備註最多 500 字。';
    if (message?.includes('referral')) return '呢個功能應該用推薦路徑解鎖，唔係社交分享。';
    return message || '提交格式有誤，請檢查後再試。';
  }
  if (code === 'functions/unauthenticated') return '請先登入。';
  return message || '提交失敗，請稍後再試。';
}
