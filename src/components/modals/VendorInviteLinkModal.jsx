// VendorInviteLinkModal — admin-side modal for sending the
// "claim seeded vendor" invitation link.
//
// 2026-07-20 — new component. Triggered from AdminVendors.jsx when
// admin clicks "發邀請" / "重發邀請". Opens after activateSeededVendor
// has minted a token and returns the deep link.
//
// Two paths:
//   1. Copy link: pre-populated URL, copy-to-clipboard, fall back to
//      a window.prompt if clipboard is blocked (private mode etc.).
//   2. Send email: optional email field, calls sendVendorInviteEmail
//      which mints a *fresh* token (so the email content + token
//      can never drift) and renders the same branded HTML body as
//      the helper-invite flow.
//
// Error path: showToast-style inline banner — we don't reach for the
// page-level toast because that hook lives one level up and would
// require lifting state through App.jsx.

import { useState, useEffect } from 'react';
import { X, Copy, Check, Mail, Send, ExternalLink, AlertCircle } from 'lucide-react';

import {
  activateSeededVendor,
  sendVendorInviteEmail,
} from '../../lib/vendorActivation';

export function VendorInviteLinkModal({ vendor, onClose }) {
  // vendor = { vendorUid, name, signupStatus, invitationExpiresAt } from AdminVendors row
  const [signupUrl, setSignupUrl] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState('');
  const [sendStatus, setSendStatus] = useState(null); // { kind:'ok'|'err', text }
  const [sendingEmail, setSendingEmail] = useState(false);

  // Auto-mint a token when modal opens. If the row already shows
  // 'invited' the user may want a fresh one — easiest to always
  // mint fresh so the URL in front of them is guaranteed valid for
  // 14d. Tradeoff: existing tokens are superseded, but that's also
  // the right behavior ("重發邀請" should re-arm the clock).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await activateSeededVendor(vendor.vendorUid);
        if (!cancelled) {
          setSignupUrl(r.signupUrl);
          setExpiresAt(r.invitationExpiresAt);
        }
      } catch (e) {
        if (!cancelled) {
          setSendStatus({
            kind: 'err',
            text:
              e?.message ||
              '生成邀請連結失敗 — 請重試或查看 console (mint token failed).',
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // vendorUid is the only dependency — re-running when other
    // fields update would mint duplicate tokens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor.vendorUid]);

  async function copyUrl() {
    if (!signupUrl) return;
    try {
      await navigator.clipboard.writeText(signupUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Private mode / very old browser — fall back to prompt() so
      // admin can still share the URL.
      window.prompt('複製呢段連結：', signupUrl);
    }
  }

  async function handleSendEmail() {
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setSendStatus({
        kind: 'err',
        text: '請輸入有效電郵 (valid email required).',
      });
      return;
    }
    setSendStatus(null);
    setSendingEmail(true);
    try {
      const r = await sendVendorInviteEmail(vendor.vendorUid, email);
      if (r.sent) {
        setSendStatus({
          kind: 'ok',
          text: `✅ 已寄出到 ${email}`,
        });
      } else {
        // sent=false means non-fatal failure (SMTP not configured,
        // etc.). Still a useful signal for admin — they can fall back
        // to the copy-link path.
        setSendStatus({
          kind: 'err',
          text: `❌ 寄信失敗：${r.reason || '未知原因'}。你可以用上面嘅「複製連結」直接傳畀對方。`,
        });
      }
    } catch (e) {
      setSendStatus({
        kind: 'err',
        text:
          e?.message ||
          '寄信失敗 — 請重試或查看 console.',
      });
    } finally {
      setSendingEmail(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-3xl max-w-lg w-full shadow-2xl animate-in slide-in-from-bottom-4 duration-200 max-h-[90vh] overflow-y-auto"
      >
        <div className="p-5 border-b border-slate-200 flex justify-between items-center">
          <h3 className="font-black text-slate-800 flex items-center gap-2 text-lg">
            <Send className="w-5 h-5 text-emerald-500" />
            邀請 {vendor.name || vendor.vendorUid}
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* SECTION 1 — copy link */}
          <div>
            <div className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
              <span>🔗</span>
              <span>註冊連結 (有效期 14 日)</span>
            </div>

            {loading && (
              <div className="text-sm text-slate-500 py-3 text-center">
                生成中…
              </div>
            )}

            {!loading && signupUrl && (
              <>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={signupUrl}
                    className="flex-1 px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg bg-slate-50 text-slate-700 select-all"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button
                    onClick={copyUrl}
                    className="inline-flex items-center gap-1 px-3 py-2 text-xs rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700"
                    title="複製連結"
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-500" /> 已複製
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" /> 複製
                      </>
                    )}
                  </button>
                </div>
                {expiresAt && (
                  <div className="text-xs text-slate-500 mt-1.5">
                    到期：{new Date(expiresAt).toLocaleString()}
                  </div>
                )}
                <a
                  href={signupUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:underline mt-2"
                >
                  <ExternalLink className="w-3 h-3" />
                  先開嚟睇睇個註冊流程
                </a>
              </>
            )}
          </div>

          {/* SECTION 2 — email */}
          <div className="pt-2 border-t border-slate-100">
            <div className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
              <Mail className="w-4 h-4 text-slate-500" />
              <span>或者用 email 寄出</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vendor@example.com"
                className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
              <button
                onClick={handleSendEmail}
                disabled={sendingEmail || !email}
                className="inline-flex items-center gap-1 px-3 py-2 text-sm rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-bold disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {sendingEmail ? (
                  '寄出中…'
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" /> 寄出
                  </>
                )}
              </button>
            </div>
          </div>

          {/* SECTION 3 — feedback banner */}
          {sendStatus && (
            <div
              className={`p-3 rounded-lg text-sm flex items-start gap-2 ${
                sendStatus.kind === 'ok'
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border border-rose-200 text-rose-800'
              }`}
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div className="whitespace-pre-line">{sendStatus.text}</div>
            </div>
          )}

          {/* SECTION 4 — explainer */}
          <div className="text-xs text-slate-500 leading-relaxed pt-2 border-t border-slate-100">
            <div className="font-bold text-slate-600 mb-1">流程：</div>
            <ol className="space-y-1 list-decimal list-inside">
              <li>對方打開連結註冊帳戶</li>
              <li>佢哋嘅個人資料、portfolio 同評分會自動繼承</li>
              <li>啟用後可以自己改價錢、同新人傾偈</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
