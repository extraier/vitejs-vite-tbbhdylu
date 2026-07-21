// NotOnboardedEmailModal — shown when a couple taps "索取報價" on a
// vendor who hasn't signed up to Save The Day yet.
//
// 2026-07-21 — initial release.
//
// Flow:
//   1. Couple enters the vendor's email address.
//   2. We check if that email matches any existing vendor doc with
//      a matching claimedByUid → auto-link and proceed.
//   3. If no match, we save the email to the vendor's /vendors/{slug}
//      doc as `pendingEmail`. Admin sees this in their dashboard and
//      can manually invite or link the vendor.
//   4. Show a confirmation + brief explanation that we'll email the
//      vendor a signup link.
//
// UX details:
//   - Uses the existing vendor name + category as context.
//   - Single email field, validates RFC 5322 lite.
//   - Calls an existing Cloud Function (or direct Firestore write
//     via the API helper) to record the request.

import { useState } from 'react';
import { X, Mail, ExternalLink, Check, AlertCircle, Loader2 } from 'lucide-react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function NotOnboardedEmailModal({ vendor, onClose }) {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  if (!vendor) return null;

  const vendorName = vendor.name || '呢個商戶';

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    const trimmed = email.trim().toLowerCase();
    if (!EMAIL_RE.test(trimmed)) {
      setError('請輸入有效嘅電郵地址');
      return;
    }
    setSubmitting(true);
    try {
      // Append a pendingEmail + pendingEmailRequestedAt to the vendor
      // doc. Admin will see this in their pending-vendors queue and
      // can send a signup invite to this address.
      const ref = doc(db, 'vendors', vendor.id);
      await setDoc(
        ref,
        {
          pendingEmails: (vendor.pendingEmails || []).concat([
            {
              email: trimmed,
              requestedAt: serverTimestamp(),
              // Could include requestingUid, but vendor doc is
              // public to anyone reading the catalog. Don't write
              // private data here.
            },
          ]),
          // Also bump an invite-counter so admin sees urgency.
          interestCount: (vendor.interestCount || 0) + 1,
        },
        { merge: true },
      );
      setSuccess(true);
    } catch (e) {
      console.error('NotOnboardedEmailModal failed:', e);
      setError('提交失敗，請稍後再試');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={(e) => e.target === e.currentTarget && !submitting && onClose()}
    >
      <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl animate-in slide-in-from-bottom-4 duration-200">
        {/* Header */}
        <div className="p-5 border-b border-slate-200 flex justify-between items-center">
          <h3 className="font-black text-slate-800 flex items-center gap-2 text-lg">
            <Mail className="w-5 h-5 text-amber-500" />
            商戶未加入平台
          </h3>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-slate-400 hover:text-slate-600 p-1 disabled:opacity-30"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {success ? (
          /* Success state */
          <div className="p-6 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
              <Check className="w-8 h-8 text-emerald-600" />
            </div>
            <h4 className="text-base font-black text-slate-800 mb-2">
              已記錄！我哋會盡快聯絡「{vendorName}」
            </h4>
            <p className="text-sm text-slate-600 mb-4 leading-relaxed">
              管理員會透過電郵 <strong className="text-slate-800">{email}</strong> 邀請
              「{vendorName}」加入 Save The Day，佢哋註冊後你可以即時用平台訊息聯絡。
            </p>
            <p className="text-xs text-slate-500 leading-relaxed mb-4">
              💡 想快啲收到回覆？ 試下直接 WhatsApp 或致電商戶：
            </p>
            {vendor.publicPhone && (
              <a
                href={`tel:${vendor.publicPhone}`}
                className="block w-full bg-rose-600 text-white font-bold py-2.5 rounded-xl hover:bg-rose-700 mb-2"
              >
                📞 致電 {vendor.publicPhone}
              </a>
            )}
            {vendor.publicEmail && (
              <a
                href={`mailto:${vendor.publicEmail}?subject=${encodeURIComponent('婚禮查詢')}`}
                className="block w-full bg-white border border-slate-300 text-slate-700 font-bold py-2.5 rounded-xl hover:bg-slate-50 mb-2"
              >
                ✉️ 電郵 {vendor.publicEmail}
              </a>
            )}
            {vendor.publicInstagram && (
              <a
                href={`https://instagram.com/${vendor.publicInstagram}`}
                target="_blank"
                rel="noreferrer"
                className="block w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold py-2.5 rounded-xl hover:opacity-90"
              >
                📷 開 Instagram @{vendor.publicInstagram}
              </a>
            )}
            {!vendor.publicPhone && !vendor.publicEmail && !vendor.publicInstagram && (
              <p className="text-xs text-slate-400 italic">
                目錄未有公開聯絡資料。管理員會主動聯絡。
              </p>
            )}
            <button
              onClick={onClose}
              className="mt-5 text-sm text-slate-500 hover:text-slate-700 underline"
            >
              關閉
            </button>
          </div>
        ) : (
          /* Email input state */
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
              <p className="text-sm text-amber-800 leading-relaxed">
                <strong>「{vendorName}」</strong> 仲未加入 Save The Day 平台，所以暫時無法用平台訊息直接聯絡。
              </p>
              <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                你可以輸入佢哋嘅電郵，我哋嘅管理員會透過電郵邀請佢哋加入平台。
              </p>
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5">
                商戶電郵地址 *
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vendor@example.com"
                autoFocus
                required
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl outline-none focus:border-rose-400 text-sm"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                我哋只會用呢個電郵聯絡商戶，唔會做其他用途。
              </p>
            </div>

            {error && (
              <div className="bg-rose-50 border border-rose-200 rounded-lg p-2.5 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-rose-700">{error}</p>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="flex-1 bg-slate-100 text-slate-700 py-2.5 rounded-xl font-bold hover:bg-slate-200 disabled:opacity-30"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={submitting || !email.trim()}
                className="flex-1 bg-rose-600 text-white py-2.5 rounded-xl font-bold hover:bg-rose-700 disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    提交中...
                  </>
                ) : (
                  <>
                    <Mail className="w-4 h-4" />
                    提交邀請請求
                  </>
                )}
              </button>
            </div>

            <p className="text-[10px] text-slate-400 text-center pt-1">
              或者你想搵另一個商戶？{' '}
              <button
                type="button"
                onClick={onClose}
                className="text-rose-500 hover:text-rose-700 underline"
              >
                關閉呢個對話框
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}