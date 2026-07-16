// VendorInviteModal — shown when a 主理新人 taps 💬 on a vendor
// contact that hasn't formally signed up to the platform yet.
//
// 2026-07-15 — new component. Provides two paths to get the vendor
// onboarded:
//
//   1. Email path: if the contact has an email, generate a
//      pre-filled signup link. The couple can copy the link and
//      paste it anywhere (IG DM, WhatsApp, email). When the
//      vendor signs up using that link, they land on a Create
//      Account screen with name + email pre-filled.
//
//   2. Manual path: a copyable invitation message they can paste
//      into Instagram DM, WhatsApp, etc.
//
// Once the vendor signs up, an auto-link (next iteration) connects
// the contact record to the vendor's uid so chat unlocks.
//
// For now this version ships without backend email — the
// invitation is purely a sharable link + message text.

import { useState } from 'react';
import { X, Copy, Check, Mail, MessageSquare, Instagram } from 'lucide-react';

export function VendorInviteModal({ contact, onClose }) {
  const [copied, setCopied] = useState(null);

  const signupUrl =
    contact.vendorEmail
      ? `${window.location.origin}/?signup&name=${encodeURIComponent(
          contact.vendorName,
        )}&email=${encodeURIComponent(contact.vendorEmail)}`
      : `${window.location.origin}/?signup`;

  const whatsappMsg =
    contact.vendorPhone
      ? `https://wa.me/${contact.vendorPhone.replace(/\D/g, '')}?text=${encodeURIComponent(inviteMessage())}`
      : null;

  const igUrl = contact.vendorInstagram
    ? `https://instagram.com/${contact.vendorInstagram}`
    : null;

  function inviteMessage() {
    return (
      `Hi ${contact.vendorName || '你好'}！👋\n\n` +
      `我哋正籌備緊婚禮，想邀請你加入「囍程 Save The Day」婚禮平台，方便日後一齊跟進工作進度同報價。\n\n` +
      `免費註冊連結：${signupUrl}\n\n` +
      `註冊後我哋就可以直接喺 app 內傾偈！謝謝 🙏`
    );
  }

  async function copy(text, key) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      // fallback — open a prompt
      window.prompt('複製呢段文字：', text);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-3xl max-w-md w-full shadow-2xl animate-in slide-in-from-bottom-4 duration-200 max-h-[90vh] overflow-y-auto"
      >
        <div className="p-5 border-b border-slate-200 flex justify-between items-center">
          <h3 className="font-black text-slate-800 flex items-center gap-2 text-lg">
            <MessageSquare className="w-5 h-5 text-rose-500" />
            邀請 {contact.vendorName} 加入
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-sm text-slate-700">
          <p className="leading-relaxed">
            呢位商戶仲未加入「囍程」，所以 app 內即時通訊暫時用唔到。
            <br />
            用以下任何一個方式邀請對方註冊，註冊後你哋就可以直接喺 app 內傾偈：
          </p>

          {/* Path 1: Signup link */}
          {contact.vendorEmail && (
            <InviteRow
              icon={<Mail className="w-4 h-4 text-indigo-500" />}
              title="註冊連結"
              subtitle="經電郵或私訊傳送"
              preview={signupUrl}
              copied={copied === 'url'}
              onCopy={() => copy(signupUrl, 'url')}
            />
          )}

          {/* Path 2: WhatsApp */}
          {whatsappMsg && (
            <InviteRow
              icon={<MessageSquare className="w-4 h-4 text-emerald-500" />}
              title="WhatsApp 直接傳送"
              subtitle={`傳送到 ${contact.vendorPhone}`}
              onClick={() => window.open(whatsappMsg, '_blank')}
              actionLabel={copied === 'wa' ? '✓ 已開啟' : '傳送'}
            />
          )}

          {/* Path 3: Instagram */}
          {igUrl && (
            <InviteRow
              icon={<Instagram className="w-4 h-4 text-pink-500" />}
              title="Instagram 個人檔案"
              subtitle={`@${contact.vendorInstagram}`}
              onClick={() => window.open(igUrl, '_blank')}
              actionLabel="開啟 IG"
            />
          )}

          {/* Path 4: Copy full invitation message */}
          <button
            onClick={() => copy(inviteMessage(), 'msg')}
            className="w-full mt-4 p-3 border-2 border-dashed border-slate-300 rounded-xl text-slate-600 hover:border-rose-400 hover:text-rose-600 transition-colors flex items-center justify-center gap-2 font-bold"
          >
            {copied === 'msg' ? (
              <>
                <Check className="w-4 h-4" /> 已複製邀請訊息
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" /> 複製完整邀請訊息
              </>
            )}
          </button>

          <p className="text-xs text-slate-400 leading-relaxed pt-2 border-t border-slate-100">
            💡 提示：商戶註冊後，你需要重新喺呢個 contact 入面填返佢嘅電郵，app
            就會自動連結兩個帳號，然後喺「訊息」收件匣直接傾偈。
          </p>
        </div>
      </div>
    </div>
  );
}

function InviteRow({ icon, title, subtitle, preview, onClick, onCopy, actionLabel, copied }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <div className="font-bold text-slate-800">{title}</div>
      </div>
      <div className="text-xs text-slate-500 mb-2">{subtitle}</div>
      {preview && (
        <div className="text-xs text-slate-700 bg-white border border-slate-200 rounded-lg p-2 font-mono break-all mb-2">
          {preview}
        </div>
      )}
      <button
        onClick={onCopy || onClick}
        className="text-sm bg-white border border-slate-300 hover:border-rose-400 text-slate-700 hover:text-rose-600 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5"
      >
        {copied || actionLabel || (
          <>
            <Copy className="w-3.5 h-3.5" /> 複製
          </>
        )}
      </button>
    </div>
  );
}
