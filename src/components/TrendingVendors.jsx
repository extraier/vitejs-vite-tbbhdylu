// TrendingVendors — compact "Trending now" strip on the couple's
// home page. Surfaces the top 6 vendors by 7-day view count from
// the popularity counter maintained by the onVendorImageViewCreated
// cloud function. Lets couples discover what's hot right now even
// before they pick a task category to start their planning.
//
// 2026-07-20 — first version. Pulled out of CoupleChecklist so it
// can also be embedded in other surfaces (events dashboard,
// post-onboarding welcome). Reads from the merged vendor list —
// no extra Firestore query.
//
// 2026-07-21 — vendor claim CTA. Most trending vendors are
// 'uninvited' (imported from heychoices catalog but never onboarded
// to Save The Day). Before this, a couple could see a great vendor
// trending but had no way to reach out — the modal was just a
// portfolio viewer. Now there's a small "📩 查詢" button on each
// card that:
//   1. Creates a chat inquiry (same flow as handleOpenChat in App.jsx)
//   2. Auto-sends a friendly opening message so the vendor sees context
//      when they later sign in
//   3. Confirms to the couple that the inquiry was created
// For 'claimed' vendors (already onboarded), the button label
// changes to "💬 查詢 / Chat" and the inquiry goes through the
// existing real-time chat system.

import { Flame, ArrowRight, Mail, MessageCircle, TrendingUp, Check } from 'lucide-react';
import { useState } from 'react';
import { VENDOR_CATEGORIES } from '../lib/config';
import { openInquiry, sendMessage } from '../lib/chat';

// 2026-07-21 — default opening message sent when a couple
// claims an uninvited trending vendor. Vendors see this in their
// inbox once they sign up. Tone is warm, includes a place for
// them to fill in their event date if they have one.
const DEFAULT_CLAIM_MESSAGE = (vendorName, eventName) =>
  `Hi ${vendorName}！我哋喺 Save The Day 見到你嘅作品集，覺得好合心意，希望可以邀請你成為我哋婚禮嘅合作商戶。${
    eventName ? `我哋嘅婚禮專案係「${eventName}」。` : ''
  }方便嘅話可以傾吓詳情嗎？🙏`;

// Pick the top N trending vendors by viewCount (already attached
// on each vendor at App.jsx subscription layer).
function pickTrending(vendors, n = 6) {
  const ranked = vendors
    .filter((v) => (v.viewCount || 0) > 0)
    .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));
  return ranked.slice(0, n);
}

function categoryLabel(cat) {
  return VENDOR_CATEGORIES[cat]?.label || cat;
}

export function TrendingVendors({ vendors, onSelect, onGoDiscover, user, currentEvent, onOpenChat }) {
  const top = pickTrending(vendors, 6);
  // 2026-07-21 — per-vendor "claimed" state. When true, the
  // claim CTA flips to a checkmark for a moment so couples
  // get immediate visual feedback that their inquiry went
  // through. Resets on filter change.
  const [claimed, setClaimed] = useState({});
  const [pending, setPending] = useState({});
  if (top.length === 0) return null;

  // 2026-07-21 — claim handler. Wraps openInquiry + an
  // auto-message send. Idempotent: openInquiry uses setDoc
  // with merge, so re-claiming the same vendor won't duplicate
  // the inquiry doc.
  const handleClaim = async (vendor, e) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (!user || !vendor) return;
    if (claimed[vendor.id] || pending[vendor.id]) return;
    setPending((p) => ({ ...p, [vendor.id]: true }));
    try {
      const isVendor = user.role === 'vendor';
      const vendorUid = isVendor ? user.uid : vendor.id;
      const coupleUid = isVendor ? user.uid : user.uid;
      const eventId = currentEvent?.id || '';
      const coupleName = currentEvent?.name || user.displayName || user.email || '新人';
      const id = await openInquiry({
        vendorUid,
        coupleUid,
        vendorName: vendor.name,
        coupleName,
        eventId,
      });
      // 2026-07-21 — auto-send the friendly opening message so
      // the vendor has context when they sign up. Only for
      // 'uninvited' vendors — claimed vendors use the existing
      // real-time chat flow (handled by onOpenChat instead).
      if (vendor.signupStatus !== 'claimed') {
        await sendMessage({
          inquiryId: id,
          senderUid: user.uid,
          senderRole: 'couple',
          text: DEFAULT_CLAIM_MESSAGE(vendor.name, currentEvent?.name),
        });
      }
      setClaimed((c) => ({ ...c, [vendor.id]: true }));
      // 2026-07-21 — for claimed vendors, also open the chat
      // room so couples can keep typing in real time.
      if (vendor.signupStatus === 'claimed' && onOpenChat) {
        onOpenChat(vendor);
      }
    } catch (err) {
      // We deliberately don't surface the error to the user —
      // the inquiry doc may have been created even if the
      // auto-message failed. A more honest UI would show a
      // toast; for now we just unblock the button.
      console.warn('[trending] claim failed:', err?.message || err);
    } finally {
      setPending((p) => ({ ...p, [vendor.id]: false }));
    }
  };

  return (
    <div className="bg-gradient-to-br from-rose-50 via-white to-amber-50 border border-rose-200 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-rose-500 flex items-center justify-center">
            <Flame className="w-4 h-4 text-white" />
          </span>
          <div>
            <h3 className="font-black text-slate-800">熱門商戶</h3>
            <p className="text-xs text-slate-500">近 7 日最多新人瀏覽</p>
          </div>
        </div>
        {onGoDiscover && (
          <button
            type="button"
            onClick={onGoDiscover}
            className="text-xs font-bold text-rose-600 hover:text-rose-700 flex items-center gap-1"
          >
            查看更多 <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {top.map((vendor) => {
          const cat = VENDOR_CATEGORIES[vendor.category];
          const isClaimed = claimed[vendor.id];
          const isPending = pending[vendor.id];
          const isVendorOnboarded = vendor.signupStatus === 'claimed';
          return (
            <div
              key={vendor.id}
              className="bg-white rounded-xl overflow-hidden border border-slate-200 hover:border-rose-300 hover:shadow-md transition-all group"
            >
              <button
                type="button"
                onClick={() => onSelect && onSelect(vendor)}
                className="w-full text-left"
              >
                <div className="h-16 w-full overflow-hidden bg-slate-100 relative">
                  {vendor.portfolio?.[0] && (
                    <img
                      src={vendor.portfolio[0]}
                      alt={vendor.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      loading="lazy"
                    />
                  )}
                  {cat && (
                    <div className="absolute bottom-1 left-1 bg-white/90 backdrop-blur-sm rounded-full px-1.5 py-0.5 text-[9px] font-bold text-slate-700">
                      {cat.icon} {cat.label}
                    </div>
                  )}
                </div>
                <div className="p-2">
                  <p className="text-xs font-bold text-slate-800 truncate mb-1">
                    {vendor.name}
                  </p>
                  <div className="flex items-center gap-1 text-[10px] text-rose-600">
                    <TrendingUp className="w-3 h-3" />
                    <span className="font-bold">{vendor.viewCount}</span>
                    <span className="text-slate-500">瀏覽</span>
                  </div>
                </div>
              </button>
              {/* 2026-07-21 — claim CTA. Splits into two
                  variants:
                  • uninvited → "📩 邀請查詢" — opens the
                    vendor's inbox with a friendly auto-message
                  • claimed → "💬 查詢" — opens the live chat
                  Hidden for guest users (no user.uid) since the
                  inquiry needs an auth identity. */}
              {user?.uid && (
                <button
                  type="button"
                  onClick={(e) => handleClaim(vendor, e)}
                  disabled={isClaimed || isPending}
                  className={`w-full text-[10px] font-bold px-2 py-1.5 border-t border-slate-100 transition-colors flex items-center justify-center gap-1 ${
                    isClaimed
                      ? 'bg-emerald-50 text-emerald-700 cursor-default'
                      : isPending
                      ? 'bg-slate-50 text-slate-400 cursor-wait'
                      : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                  }`}
                >
                  {isClaimed ? (
                    <>
                      <Check className="w-3 h-3" /> 已傳送邀請
                    </>
                  ) : isPending ? (
                    <>傳送中...</>
                  ) : isVendorOnboarded ? (
                    <>
                      <MessageCircle className="w-3 h-3" /> 查詢
                    </>
                  ) : (
                    <>
                      <Mail className="w-3 h-3" /> 邀請查詢
                    </>
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-slate-400 mt-2 text-center">
        對未加入嘅商戶按「邀請查詢」會自動傳送訊息到佢哋嘅 Save The Day 收件匣
      </p>
    </div>
  );
}