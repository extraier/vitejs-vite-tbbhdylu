import { useState } from 'react';
import { X, Star, ImageIcon, Mail, MessageCircle, Send, Lock, Clock, AlertCircle, CheckCircle2 } from 'lucide-react';
import { ReviewsPanel } from '../ReviewsPanel';
import { PortfolioLightbox } from './PortfolioLightbox';
// 2026-07-20 — switch to the existing chat infrastructure
// (lib/chat.js) which writes to /artifacts/{appId}/vendorInquiries.
// Couples + vendors share a real-time inbox, and the vendor's
// dashboard already has a panel ready to surface them.
import { openInquiry, sendMessage } from '../../lib/chat';

// 2026-07-20 — VendorInquiryForm. Inline contact form rendered
// inside VendorModal when the vendor is onboarded (signupStatus ===
// 'claimed'). Couples fill in their name + brief, submit → row goes
// to /vendorInquiries/{auto}. The vendor will see these in their
// future inbox. We deliberately keep this small (no real-time chat)
// — the original UX path is the job-request marketplace flow, this
// is the direct-link CTA from the vendor's profile.
//
// Anonymous viewers (not signed in) get a SignUpPromptModal-style
// gate instead.
function VendorInquiryForm({ vendor, currentUser, onClose }) {
  const [name, setName] = useState(currentUser?.displayName || '');
  const [contact, setContact] = useState(currentUser?.email || '');
  const [brief, setBrief] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!brief.trim()) {
      setError('請輸入查詢內容 (brief required).');
      return;
    }
    if (!contact.trim()) {
      setError('請留聯絡方法 (email or phone required).');
      return;
    }
    setSending(true);
    setError(null);
    try {
      // The vendor's user uid becomes the doc id, NOT the seeded
      // slug — once the vendor claims their slot, their auth uid is
      // the canonical id. During onboarding (signupStatus ===
      // 'claimed' but the vendor hasn't yet edited their profile),
      // vendor.vendorUid may still equal the slug. Fall back to that.
      // chat.js's openInquiry handles the deterministic id format.
      const vendorUid = vendor.id || vendor.vendorUid || vendor.slug;
      if (!vendorUid) {
        throw new Error('Vendor id missing — cannot open chat thread.');
      }
      const coupleUid = currentUser?.uid || `anonymous__${contact.replace(/[^a-z0-9]/gi, '_').slice(0, 32)}`;
      const id = await openInquiry({
        vendorUid,
        coupleUid,
        vendorName: vendor.name,
        coupleName: name || '匿名客人',
      });
      // The couple's brief becomes the first message in the thread.
      // ChatRoom renders this immediately for both parties.
      const composedText = [
        name ? `${name}：` : '',
        brief.trim(),
        contact ? `\n\n聯絡方法：${contact}` : '',
      ].join('');
      await sendMessage({
        inquiryId: id,
        senderUid: coupleUid,
        senderRole: 'couple',
        text: composedText,
      });
      setSent(true);
    } catch (e) {
      setError(e?.message || '發送失敗，請重試。');
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <p className="font-black text-emerald-900 mb-1">已發送查詢！</p>
            <p className="text-sm text-emerald-800 mb-3">
              {vendor.name} 會喺 24 小時內透過你留嘅聯絡方法回覆你。
            </p>
            <button
              type="button"
              onClick={onClose}
              className="text-sm font-bold text-emerald-700 hover:text-emerald-900 underline"
            >
              關閉
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <MessageCircle className="w-5 h-5 text-rose-500" />
        <p className="font-black text-slate-900">直接聯絡 {vendor.name}</p>
      </div>
      <p className="text-xs text-slate-500">
        填寫以下資料，商戶會直接回覆你。建議簡介你嘅婚禮日期、地點、預算範圍。
      </p>
      <input
        type="text"
        placeholder="你嘅稱呼"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-rose-400 focus:ring-2 focus:ring-rose-100 outline-none"
      />
      <input
        type="text"
        placeholder="聯絡方法 (email 或 WhatsApp)"
        value={contact}
        onChange={(e) => setContact(e.target.value)}
        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-rose-400 focus:ring-2 focus:ring-rose-100 outline-none"
      />
      <textarea
        placeholder="簡單講下你嘅需要 (例：2027 年 5 月擺酒，150 人，需要場地 + 攝影)"
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        rows={3}
        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-rose-400 focus:ring-2 focus:ring-rose-100 outline-none resize-none"
      />
      {error && (
        <p className="text-xs text-rose-600 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={sending}
        className="w-full bg-rose-500 hover:bg-rose-600 disabled:bg-slate-300 text-white font-bold py-2.5 px-4 rounded-xl text-sm flex items-center justify-center gap-2"
      >
        <Send className="w-4 h-4" />
        {sending ? '發送中...' : '發送查詢'}
      </button>
    </form>
  );
}

// 2026-07-20 — BrowseOnlyNotice. Shown in place of the contact CTA
// when the vendor hasn't been onboarded yet (signupStatus !==
// 'claimed'). Couples can still see the gallery + price +
// description, just can't send a message. Explains why in CJK so
// they understand the constraint.
function BrowseOnlyNotice({ vendor }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
          <Lock className="w-5 h-5 text-slate-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-black text-slate-800 mb-1 flex items-center gap-2">
            暫時未能直接聯絡
            <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 text-xs font-bold px-2 py-0.5 rounded-full">
              <Clock className="w-3 h-3" />
              尚未啟動
            </span>
          </p>
          <p className="text-sm text-slate-600 leading-relaxed">
            {vendor.name} 嘅商戶帳戶仲未完成啟動。你仍然可以瀏覽佢嘅作品集同參考價錢，但傳訊息功能要等商戶登入後先會開通。
          </p>
          <p className="text-xs text-slate-400 mt-2">
            想盡早接觸呢間商戶？試下喺「接單大堂」發佈明確嘅查詢，商戶一上線就會睇到。
          </p>
        </div>
      </div>
    </div>
  );
}

// 2026-07-20 — AnonymousCTA. Shown when a not-signed-in user
// (couple, signed-out visitor) tries to contact. Points them to
// sign in or sign up.
function AnonymousCTA() {
  return (
    <div className="bg-rose-50 border border-rose-200 rounded-2xl p-5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center flex-shrink-0">
          <Mail className="w-5 h-5 text-rose-600" />
        </div>
        <div className="flex-1">
          <p className="font-black text-rose-900 mb-1">註冊即可發送查詢</p>
          <p className="text-sm text-rose-800 leading-relaxed">
            登入或建立 Save The Day 帳戶後即可直接聯絡商戶，獲取報價、查詢檔期、預約場地。
          </p>
        </div>
      </div>
    </div>
  );
}

export function VendorModal({ vendor, onClose, currentUser, currentUserRole }) {
  // 2026-07-20 — lightbox state. When a couple clicks a portfolio
  // thumbnail we open the fullscreen lightbox. Tracks each open to
  // /vendorImageViews for analytics.
  const [lightboxIndex, setLightboxIndex] = useState(null);
  if (!vendor) return null;
  return (
    <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-3xl max-w-4xl w-full shadow-2xl max-h-[90vh] flex flex-col overflow-hidden relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 bg-black/40 text-white p-2 rounded-full hover:bg-black/60 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="overflow-y-auto custom-scrollbar flex-grow">
          <div className="h-64 md:h-80 w-full bg-slate-200 relative">
            {vendor.portfolio?.[0] && (
              <img
                src={vendor.portfolio[0]}
                alt="cover"
                className="w-full h-full object-cover"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"></div>
            <div className="absolute bottom-0 left-0 p-8 w-full">
              <div className="flex flex-wrap gap-2 mb-3">
                {vendor.tags.map((tag) => (
                  <span
                    key={tag}
                    className="bg-white/20 backdrop-blur-md text-white text-xs font-bold px-3 py-1 rounded-full border border-white/30"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <h2 className="text-3xl md:text-4xl font-black text-white drop-shadow-md">
                {vendor.name}
              </h2>
            </div>
          </div>
          <div className="p-8">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8 bg-slate-50 p-6 rounded-2xl border border-slate-100">
              <div className="flex-1">
                <p className="text-slate-600 leading-relaxed text-sm md:text-base">
                  {vendor.description}
                </p>
              </div>
              <div className="text-left md:text-right flex-shrink-0">
                <div className="text-sm text-slate-500 font-bold mb-1">參考起步價</div>
                <div className="text-3xl font-black text-rose-600 mb-2">{vendor.price}</div>
                <div className="flex items-center gap-1.5 md:justify-end text-slate-600 font-bold">
                  <Star className="w-5 h-5 fill-amber-400 text-amber-400" /> {vendor.rating} / 5.0
                </div>
              </div>
            </div>

            {/* 2026-07-20 — Vendor contact section. Three branches:
                  1. vendor.signupStatus === 'claimed' AND signed-in
                     user → render VendorInquiryForm (couples can send
                     a message to onboarded vendors).
                  2. vendor.signupStatus !== 'claimed' → render
                     BrowseOnlyNotice (vendor imported but not
                     onboarded; couples can browse but not message).
                  3. no signed-in user → render AnonymousCTA pointing
                     to sign-in.

                This is the gating the user requested — imported
                vendors without a completed onboarding flow have no
                contact CTA, only the gallery + price + description.
                Once they claim their slot, the form replaces the
                notice automatically on next page load. */}
            <div className="mb-8">
              {vendor.signupStatus === 'claimed' ? (
                currentUser ? (
                  <VendorInquiryForm
                    vendor={vendor}
                    currentUser={currentUser}
                    onClose={onClose}
                  />
                ) : (
                  <AnonymousCTA />
                )
              ) : (
                <BrowseOnlyNotice vendor={vendor} />
              )}
            </div>

            <h3 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
              <ImageIcon className="w-6 h-6 text-rose-500" /> 作品集展示 (Portfolio)
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {vendor.portfolio?.map((img, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => setLightboxIndex(index)}
                  className="aspect-square rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow cursor-pointer relative group"
                  title="放大睇"
                >
                  <img
                    src={img}
                    alt={`portfolio-${index}`}
                    className="w-full h-full object-cover hover:scale-110 transition-transform duration-500"
                  />
                  {/* 2026-07-20 — click hint that disappears after first hover.
                      Couples discoverability: the grid looks like a static
                      gallery otherwise. */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity text-white text-xs font-bold bg-black/60 px-2 py-1 rounded">
                      放大
                    </span>
                  </div>
                </button>
              ))}
            </div>

            {/* 2026-07-17 — Couple reviews & rating composer. */}
            <h3 className="text-xl font-bold text-slate-800 mb-4 mt-10 flex items-center gap-2">
              💬 評語
              <span className="text-sm font-normal text-slate-500">
                ({vendor.ratingCount || 0} 個)
              </span>
            </h3>
            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
              <ReviewsPanel
                vendor={vendor}
                currentUser={currentUser}
                currentUserRole={currentUserRole}
              />
            </div>
          </div>
        </div>
      </div>
      {/* 2026-07-20 — lightbox opens when couple clicks a portfolio
          thumbnail. Tracks each open to /vendorImageViews. Renders
          outside the modal's overflow container so the fullscreen
          overlay actually covers the viewport. */}
      {lightboxIndex !== null && (
        <PortfolioLightbox
          photos={vendor.portfolio || []}
          initialIndex={lightboxIndex}
          vendorSlug={vendor.vendorUid || vendor.id || vendor.slug || 'unknown'}
          viewerUid={currentUser?.uid}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}
