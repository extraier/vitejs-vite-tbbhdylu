// 2026-07-26 — "Invite Partner" modal.
//
// Owner opens this from the wedding dashboard. They enter the
// partner's email, we call sendPartnerInvite, the partner gets
// a magic link, and on accept they're added to the event's
// coOwners array.
//
// The modal handles both the "SMTP is configured" path
// (server sends the email) and the "SMTP not configured"
// dryRun path (returns the magic link; we show a copy-to-
// clipboard UI so the owner can send it themselves).
//
// Styling mirrors the existing modals (rounded-xl, slate-50
// header, primary button). Reuses the project's own icon set.

import { useState, useEffect } from 'react';
import { X, Mail, Copy, Check, Users, Clock, CheckCircle2, XCircle, Inbox } from 'lucide-react';
import {
  partnerInviteApi,
  type SendPartnerInviteResult,
  type PartnerInviteHistoryRow,
  type PartnerInviteStatus,
} from '../../lib/partnerInvite';

interface InvitePartnerModalProps {
  isOpen: boolean;
  onClose: () => void;
  ownerUid: string;
  eventId: string;
  eventName: string;
  // We pass showToast up so the dashboard can show a friendly
  // confirmation. The modal could manage its own toast but
  // we already have a global showToast pattern in App.jsx.
  showToast?: (msg: string) => void;
}

export function InvitePartnerModal({
  isOpen,
  onClose,
  ownerUid,
  eventId,
  eventName,
  showToast,
}: InvitePartnerModalProps) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendPartnerInviteResult | null>(null);
  const [copied, setCopied] = useState(false);
  // 2026-07-27 — invite history. Fetched once when the modal
  // opens. Refreshed after a successful send so the new row
  // appears at the top immediately.
  const [history, setHistory] = useState<PartnerInviteHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Load history when the modal opens (or ownerUid changes).
  useEffect(() => {
    if (!isOpen || !ownerUid) return;
    let cancelled = false;
    setHistoryLoading(true);
    partnerInviteApi
      .list({ ownerUid })
      .then((res) => {
        if (cancelled) return;
        setHistory(Array.isArray(res?.rows) ? res.rows : []);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[InvitePartnerModal] history load failed:', err);
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
  }, [isOpen, ownerUid]);

  // After a successful send, prepend the new row to the history so
  // the user sees their action reflected immediately. The server
  // already created the doc — we just mirror it client-side without
  // round-tripping back to the function. (The next modal open will
  // re-fetch the canonical state from Firestore.)
  function refreshHistoryAfterSend(emailSent: string, eventIdSent: string) {
    const optimistic: PartnerInviteHistoryRow = {
      id: 'optimistic-' + Date.now(),
      email: emailSent.toLowerCase(),
      eventId: eventIdSent,
      eventName,
      status: 'pending',
      createdAt: Date.now(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    };
    setHistory((prev) => [optimistic, ...prev]);
  }

  if (!isOpen) return null;

  function reset() {
    setEmail('');
    setResult(null);
    setCopied(false);
    setSending(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!email || sending) return;
    setSending(true);
    setResult(null);
    try {
      const r = await partnerInviteApi.send({
        ownerUid,
        partnerEmail: email.trim().toLowerCase(),
        eventId,
      });
      setResult(r);
      if (r.ok && r.sent) {
        refreshHistoryAfterSend(email.trim().toLowerCase(), eventId);
        showToast?.(`✉️ 邀請信已寄到 ${email}`);
      } else if (r.ok && r.dryRun) {
        // SMTP not configured — UI shows the magic link below.
        // Still record the optimistic row so the history list
        // shows what was attempted.
        refreshHistoryAfterSend(email.trim().toLowerCase(), eventId);
      } else if (!r.ok) {
        showToast?.('❌ 邀請失敗：' + (r.error || '未知錯誤'));
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[InvitePartnerModal] send failed:', err);
      setResult({
        ok: false,
        sent: false,
        error: (err as Error).message || 'Network error',
      });
    } finally {
      setSending(false);
    }
  }

  async function handleCopyLink() {
    if (!result?.magicLinkUrl) return;
    try {
      await navigator.clipboard.writeText(result.magicLinkUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select the text in a hidden input
      const ta = document.createElement('textarea');
      ta.value = result.magicLinkUrl;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } finally {
        document.body.removeChild(ta);
      }
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-rose-500" />
            <h2 className="text-lg font-semibold text-slate-800">邀請另一半</h2>
          </div>
          <button
            onClick={handleClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {!result && (
          <form onSubmit={handleSend} className="p-6 space-y-4">
            <p className="text-sm text-slate-600">
              輸入另一半的電郵地址，他/她會收到一封邀請信，
              接受後就能一起管理「{eventName}」的所有內容。
            </p>

            {/* 2026-07-27 — Invite history. Shows which emails were
                sent (per event) and the derived accept status:
                pending (still active) / accepted (redeemed) /
                expired (passed TTL without redemption). Helps the
                owner see at a glance whether their partner
                accepted, ignored, or got an expired link. */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200">
                <Inbox className="w-4 h-4 text-slate-500" />
                <span className="text-xs font-medium text-slate-700">
                  邀請紀錄
                  {history.length > 0 && (
                    <span className="ml-1 text-slate-500">（{history.length}）</span>
                  )}
                </span>
              </div>
              {historyLoading ? (
                <div className="px-3 py-3 text-xs text-slate-500">載入中…</div>
              ) : history.length === 0 ? (
                <div className="px-3 py-3 text-xs text-slate-500">
                  尚未寄出邀請。
                </div>
              ) : (
                <ul className="divide-y divide-slate-200 max-h-44 overflow-y-auto">
                  {history.map((row) => (
                    <li
                      key={row.id}
                      className="px-3 py-2 text-xs flex items-center gap-2"
                    >
                      <InviteStatusIcon status={row.status} />
                      <span className="font-mono text-slate-700 truncate flex-1">
                        {row.email}
                      </span>
                      <InviteStatusBadge status={row.status} />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                另一半的電郵
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="partner@example.com"
                  className="w-full pl-10 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none"
                  autoFocus
                />
              </div>
              <p className="text-xs text-slate-500 mt-1">
                如果他/她還未有 Save The Day 帳戶，接受邀請時會自動引導註冊。
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={sending || !email}
                className="flex-1 px-4 py-2 bg-rose-500 text-white rounded-lg hover:bg-rose-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? '寄送中…' : '寄出邀請'}
              </button>
            </div>
          </form>
        )}

        {result && result.ok && result.sent && (
          <div className="p-6 space-y-4">
            <div className="text-center">
              <div className="w-12 h-12 mx-auto bg-green-100 rounded-full flex items-center justify-center mb-3">
                <Check className="w-6 h-6 text-green-600" />
              </div>
              <h3 className="font-semibold text-slate-800">邀請信已寄出 ✓</h3>
              <p className="text-sm text-slate-600 mt-1">
                {email} 會在幾分鐘內收到邀請連結。
              </p>
            </div>
            <button
              onClick={handleClose}
              className="w-full px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-900"
            >
              完成
            </button>
          </div>
        )}

        {result && result.ok && result.dryRun && (
          <div className="p-6 space-y-4">
            <p className="text-sm text-slate-600">
              系統尚未設定電郵伺服器。請複製以下連結，並透過 WhatsApp /
              SMS / 其他通訊軟件傳給另一半：
            </p>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 break-all text-xs font-mono text-slate-700">
              {result.magicLinkUrl}
            </div>
            <button
              onClick={handleCopyLink}
              className="w-full px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-900 flex items-center justify-center gap-2"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4" /> 已複製
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" /> 複製連結
                </>
              )}
            </button>
            <button
              onClick={handleClose}
              className="w-full px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
            >
              完成
            </button>
          </div>
        )}

        {result && !result.ok && (
          <div className="p-6 space-y-4">
            <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-sm text-rose-700">
              ❌ 邀請失敗：{result.error || '未知錯誤'}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setResult(null)}
                className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
              >
                再試一次
              </button>
              <button
                onClick={handleClose}
                className="flex-1 px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-900"
              >
                關閉
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Tiny icon + badge helpers for the history row.
// ────────────────────────────────────────────────────────────────────────────

function InviteStatusIcon({ status }: { status: PartnerInviteStatus }) {
  if (status === 'accepted') {
    return <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />;
  }
  if (status === 'expired') {
    return <XCircle className="w-4 h-4 text-slate-400 shrink-0" />;
  }
  return <Clock className="w-4 h-4 text-amber-500 shrink-0" />;
}

function InviteStatusBadge({ status }: { status: PartnerInviteStatus }) {
  const map: Record<PartnerInviteStatus, { label: string; cls: string }> = {
    pending:  { label: '等待中', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    accepted: { label: '已接受', cls: 'bg-green-50 text-green-700 border-green-200' },
    expired:  { label: '已過期', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
  };
  const m = map[status];
  return (
    <span
      className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium ${m.cls}`}
    >
      {m.label}
    </span>
  );
}
