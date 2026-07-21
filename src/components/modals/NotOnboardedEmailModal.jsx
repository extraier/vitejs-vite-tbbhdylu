// NotOnboardedEmailModal — shown when a couple taps "索取報價" on a
// vendor who hasn't signed up to Save The Day yet.
//
// 2026-07-21 — initial release.
// 2026-07-21 (later) — switched from setDoc on /vendors/{slug} to
//   addDoc on /vendors/{slug}/pendingInvites subcollection. Cleaner:
//     • each invite is its own doc → admin can see history
//     • no risk of overwriting any vendor field
//     • couple doesn't need write access to /vendors/{slug}
//
// Flow:
//   1. Couple enters the vendor's email address.
//   2. We add a pendingInvite doc under /vendors/{slug}/pendingInvites.
//      Admin dashboard can listen for new docs and email the vendor
//      a signup link (or auto-send via the existing
//      sendVendorInviteEmail Cloud Function).
//   3. After save, show a confirmation + a copy-pasteable signup
//      link so the couple can share via WhatsApp / IG / email
//      themselves (faster than waiting for admin).
//   4. Also show the vendor's public contact channels (phone,
//      IG, email) if they exist in the catalog — couple can
//      reach out directly in parallel.

import { useState } from 'react';
import {
  X,
  Mail,
  Check,
  AlertCircle,
  Loader2,
  Copy,
  MessageCircle,
  Instagram,
  Phone,
  Share2,
  ExternalLink,
} from 'lucide-react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Invite message that the couple can send to the vendor via WhatsApp.
// Includes the actual signup URL so the vendor can register directly.
function buildInviteText(vendorName, signupUrl) {
  return [
    `你好！`,
    ``,
    `我係 Save The Day 嘅新人，我哋想邀請你加入我哋嘅平台。`,
    `喺平台你可以：`,
    `• 收到全港新人嘅查詢`,
    `• 展示你嘅作品集同評價`,
    `• 用平台訊息直接同新人溝通`,
    ``,
    `📋 商戶註冊連結：${signupUrl}`,
    ``,
    `期待你嘅回覆！`,
  ].join('\n');
}

export function NotOnboardedEmailModal({ vendor, onClose }) {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null); // null | { signupUrl, inviteText }

  if (!vendor) return null;

  const vendorName = vendor.name || '呢個商戶';
  // 2026-07-21 — The signup link. We encode the vendor slug so
  // signup flow can pre-fill the vendor profile (if the vendor
  // clicks the link, they get a pre-filled signup form). The
  // /signup-as-vendor hash route is the entry point.
  const signupUrl =
    `${window.location.origin}/#signup-as-vendor?slug=${encodeURIComponent(vendor.id)}`;

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
      // Add to subcollection so we don't touch the vendor doc itself.
      // Admin dashboard listens to /vendors/{slug}/pendingInvites.
      // (We deliberately don't try to bump interestCount on the
      // vendor doc — Firestore rules only allow admin/vendorUid to
      // write that field, and couples don't have either. The
      // subcollection count is the source of truth for "how many
      // couples asked for this vendor to join".)
      const ref = collection(db, 'vendors', vendor.id, 'pendingInvites');
      await addDoc(ref, {
        email: trimmed,
        // We deliberately don't include requestorUid — vendor doc
        // is public-readable, subcollection is admin-only readable
        // so we CAN include private fields here if needed later.
        requestedAt: serverTimestamp(),
        // Status lifecycle: pending → admin can mark as 'invited'
        // or 'linked' (if they find the matching claim).
        status: 'pending',
      });

      const inviteText = buildInviteText(vendorName, signupUrl);
      setSuccess({ signupUrl, inviteText });
    } catch (e) {
      console.error('NotOnboardedEmailModal failed:', e);
      setError(`提交失敗：${e?.message || '請稍後再試'}`);
    } finally {
      setSubmitting(false);
    }
  }

  function copyToClipboard(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(
        () => {
          setError('✓ 已複製到剪貼簿');
          setTimeout(() => setError(null), 2000);
        },
        () => setError('複製失敗，請手動複製'),
      );
    } else {
      // Fallback for older browsers
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setError('✓ 已複製到剪貼簿');
        setTimeout(() => setError(null), 2000);
      } catch {
        setError('請手動複製');
      }
      document.body.removeChild(ta);
    }
  }

  function shareToWhatsApp(phone) {
    const url = phone
      ? `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(success?.inviteText || '')}`
      : `https://wa.me/?text=${encodeURIComponent(success?.inviteText || '')}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={(e) => e.target === e.currentTarget && !submitting && onClose()}
    >
      <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl animate-in slide-in-from-bottom-4 duration-200 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-5 border-b border-slate-200 flex justify-between items-center sticky top-0 bg-white z-10">
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

        {!success ? (
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
          </form>
        ) : (
          /* Success state — show share options */
          <div className="p-5 space-y-4">
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-2">
                <Check className="w-7 h-7 text-emerald-600" />
              </div>
              <h4 className="text-base font-black text-slate-800 mb-1">
                已記錄！我哋會盡快聯絡「{vendorName}」
              </h4>
              <p className="text-xs text-slate-500">
                管理員會透過電郵 <strong>{email}</strong> 邀請對方加入。
              </p>
            </div>

            {/* Invitation link section */}
            <div className="bg-gradient-to-br from-rose-50 to-amber-50 border-2 border-rose-200 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Share2 className="w-4 h-4 text-rose-600" />
                <h5 className="text-sm font-black text-slate-800">
                  🚀 想快啲？自己分享邀請連結
                </h5>
              </div>
              <p className="text-[11px] text-slate-600 mb-3 leading-relaxed">
                複製下面嘅連結，經 WhatsApp / Instagram DM 發俾商戶。佢哋註冊後你就可以用平台訊息直接聯絡。
              </p>

              {/* Signup link with copy button */}
              <div className="bg-white border border-slate-200 rounded-lg p-2.5 mb-2">
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-[10px] text-slate-700 break-all font-mono">
                    {success.signupUrl}
                  </code>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(success.signupUrl)}
                    className="flex-shrink-0 p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                    title="複製連結"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Share buttons */}
              <div className="grid grid-cols-2 gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => shareToWhatsApp()}
                  className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-2 rounded-lg text-xs flex items-center justify-center gap-1"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  WhatsApp
                </button>
                <button
                  type="button"
                  onClick={() => copyToClipboard(success.inviteText)}
                  className="bg-white border border-slate-300 text-slate-700 font-bold py-2 rounded-lg text-xs hover:bg-slate-50 flex items-center justify-center gap-1"
                >
                  <Copy className="w-3.5 h-3.5" />
                  複製邀請訊息
                </button>
              </div>

              {/* Optional: IG DM (no pre-filled text, just open profile) */}
              {vendor.publicInstagram && (
                <a
                  href={`https://instagram.com/${vendor.publicInstagram}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block w-full mt-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold py-2 rounded-lg text-xs hover:opacity-90 flex items-center justify-center gap-1"
                >
                  <Instagram className="w-3.5 h-3.5" />
                  IG DM @{vendor.publicInstagram}
                </a>
              )}
            </div>

            {/* Direct contact fallback */}
            {(vendor.publicPhone || vendor.publicEmail) && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                <p className="text-[11px] font-bold text-slate-700 mb-2">
                  💡 或者直接打電話／Email 商戶（唔等平台）：
                </p>
                <div className="grid grid-cols-1 gap-2">
                  {vendor.publicPhone && (
                    <a
                      href={`tel:${vendor.publicPhone}`}
                      className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg p-2 text-xs text-slate-700 hover:bg-slate-50"
                    >
                      <Phone className="w-3.5 h-3.5 text-rose-500" />
                      <span className="font-bold">{vendor.publicPhone}</span>
                      <span className="ml-auto text-slate-400">致電 →</span>
                    </a>
                  )}
                  {vendor.publicEmail && (
                    <a
                      href={`mailto:${vendor.publicEmail}?subject=${encodeURIComponent('婚禮查詢')}`}
                      className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg p-2 text-xs text-slate-700 hover:bg-slate-50"
                    >
                      <Mail className="w-3.5 h-3.5 text-rose-500" />
                      <span className="font-bold truncate">{vendor.publicEmail}</span>
                      <span className="ml-auto text-slate-400">電郵 →</span>
                    </a>
                  )}
                </div>
              </div>
            )}

            {error && (
              <p className="text-[10px] text-emerald-600 text-center">
                {error}
              </p>
            )}

            <button
              onClick={onClose}
              className="block w-full mt-2 bg-slate-100 text-slate-700 font-bold py-2.5 rounded-xl hover:bg-slate-200 text-sm"
            >
              完成
            </button>
          </div>
        )}
      </div>
    </div>
  );
}