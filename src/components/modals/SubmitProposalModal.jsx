// SubmitProposalModal — vendor-side composer for a proposal.
//
// 2026-08-08 — new component. The vendor clicks "立即發送報價單"
// on a job card → this modal opens. Optional price field + message
// textarea. Submits via the submitProposal Cloud Function (which
// writes to /proposals and increments the job's proposalsCount
// atomically). The caller's vendor doc is the source of truth for
// vendorName + rating — the CF reads /vendors/{auth.uid}.
//
// UX:
//   - price is optional (some vendors price per-package later)
//   - message is required (a placeholder is pre-filled so the
//     happy-path 1-click → "send" still works for a vendor who
//     just wants to claim the job)
//   - validates non-empty before calling the CF
//   - shows the live toast via the showToast prop on success
//   - on failure surfaces the CF error message verbatim
//
// The modal is intentionally minimal: a single textarea, a single
// optional price field, and a send button. No styling matches
// larger modals — this is a quick "let's go" composer.

import { useState } from 'react';
import { MessageSquare, X, Loader2, Send } from 'lucide-react';
import { callFirebaseFn } from '../../lib/firebaseFn';

export function SubmitProposalModal({ job, vendorName, onClose, onSubmitted, showToast }) {
  if (!job) return null;
  const [price, setPrice] = useState('');
  const [message, setMessage] = useState(
    `${vendorName || '商戶'} 已經睇到你嘅要求，想同你傾下細節，歡迎聯絡我哋了解更多。`,
  );
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    if (e) e.preventDefault();
    if (submitting) return;
    const trimmed = message.trim();
    if (!trimmed) {
      showToast?.('請先填寫訊息內容。');
      return;
    }
    setSubmitting(true);
    try {
      await callFirebaseFn('submitProposal', {
        jobId: job.id,
        price: price.trim(),
        message: trimmed,
      });
      showToast?.('✅ 報價已發送畀新人！');
      onSubmitted?.();
      onClose?.();
    } catch (err) {
      console.error('[SubmitProposalModal] submitProposal failed:', err);
      const msg = err?.message || '發送失敗，請重試。';
      showToast?.(`❌ ${msg}`);
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl p-6 max-w-xl w-full shadow-xl flex flex-col relative">
        <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-4">
          <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-emerald-500" />
            發送報價單
          </h3>
          <button
            onClick={onClose}
            disabled={submitting}
            className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-40"
            aria-label="關閉"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="mb-4 p-4 bg-slate-50 rounded-xl border border-slate-100">
          <div className="text-xs text-slate-500 mb-1">新人的需求</div>
          <div className="font-bold text-slate-800 mb-1">{job.serviceNeeded}</div>
          <div className="text-sm text-slate-600">
            預算 {job.budget || '面議'} • 婚期 {job.weddingDate || '未定'}
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">
              報價 <span className="text-slate-400 font-normal">（選填）</span>
            </label>
            <input
              type="text"
              placeholder="例如: $25,000 或 面議"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              disabled={submitting}
              maxLength={100}
              className="w-full p-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-300 outline-none disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">
              訊息 <span className="text-rose-500">*</span>
            </label>
            <textarea
              rows={5}
              required
              placeholder="簡單介紹自己，或者話畀新人知你嘅服務特色。"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={submitting}
              maxLength={1000}
              className="w-full p-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-300 outline-none resize-none disabled:bg-slate-50"
            />
            <div className="text-xs text-slate-400 mt-1 text-right">
              {message.length} / 1000
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 rounded-xl disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting || !message.trim()}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  發送中...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  發送報價
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
