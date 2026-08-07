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
// to Save The Day).
//
// 2026-08-07 — FIX: 熱門商戶 "邀請查詢" bug.
//
//   Before this patch, handleClaim called openInquiry + sendMessage
//   (the chat-inquiry path) for uninvited vendors, then optimistically
//   flipped the button to "已傳送邀請". But that path only creates an
//   empty inquiry doc — it never invites the vendor to sign up. Worse,
//   the email modal that the screenshots revealed (with "註冊連結
//   (有效期 14 日)" + email field) belongs to VendorInviteLinkModal,
//   which is admin-only (activateSeededVendor / sendVendorInviteEmail
//   throw "Admin only." for couples). So the UI was promising an
//   invite that never landed AND hiding the actual shareable link.
//
//   Fix: route the uninvited path through NotOnboardedEmailModal,
//   which is the existing couple-side pattern —
//     1. addDoc(/vendors/{slug}/pendingInvites, ...) — Firestore
//        rules let any signed-in user create this (no admin gate).
//     2. Show a copyable signup link + WhatsApp share button so the
//        couple can ping the vendor themselves right away.
//   For claimed vendors we still call onOpenChat (existing flow).
//
//   Why not call VendorInviteLinkModal? That modal needs an admin
//   auth context — couples hit permission-denied before the link
//   even renders. NotOnboardedEmailModal is the only couple-safe
//   path the codebase already has.

import { Flame, ArrowRight, MessageCircle, TrendingUp } from 'lucide-react';
import { VENDOR_CATEGORIES } from '../lib/config';

export function TrendingVendors({
  vendors,
  onSelect,
  onGoDiscover,
  user,
  // 2026-08-07 — couple-side "invite this not-yet-onboarded vendor"
  // callback. Parent opens NotOnboardedEmailModal. Required for the
  // uninvited-vendor path; uninvited buttons hide if it's missing
  // so we never silently fall back to the broken chat path again.
  onVendorNotOnboarded,
  onOpenChat,
}) {
  const top = pickTrending(vendors, 6);
  if (top.length === 0) return null;

  function handleClaimClick(vendor, e) {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (!user || !vendor) return;
    // 2026-08-07 — route by signupStatus. claimed → existing live
    // chat. Otherwise → NotOnboardedEmailModal (parent owns state).
    if (vendor.signupStatus === 'claimed') {
      if (onOpenChat) onOpenChat(vendor);
      return;
    }
    if (onVendorNotOnboarded) {
      onVendorNotOnboarded(vendor);
    }
    // If the parent didn't wire up the not-onboarded callback, the
    // card hides its CTA below — we never reach this branch.
  }

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
          const isVendorOnboarded = vendor.signupStatus === 'claimed';
          // 2026-08-07 — only render the CTA when we can actually do
          // something. Claimed → onOpenChat path. Unclaimed → onVendorNotOnboarded.
          // If neither callback is wired up, hide the button entirely
          // (better than a no-op that lies with "已傳送邀請").
          const showCTA = user?.uid && (isVendorOnboarded ? !!onOpenChat : !!onVendorNotOnboarded);
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
              {/* 2026-08-07 — claim CTA.
                  • claimed → "💬 查詢" → live chat (onOpenChat)
                  • unclaimed → "📩 邀請查詢" → NotOnboardedEmailModal
                    (onVendorNotOnboarded), which gives the couple a
                    copyable signup link + WhatsApp share button.
                  Hidden when the matching callback is missing so we
                  never show a button that does nothing. */}
              {showCTA && (
                <button
                  type="button"
                  onClick={(e) => handleClaimClick(vendor, e)}
                  className="w-full text-[10px] font-bold px-2 py-1.5 border-t border-slate-100 transition-colors flex items-center justify-center gap-1 bg-rose-50 text-rose-700 hover:bg-rose-100"
                >
                  {isVendorOnboarded ? (
                    <>
                      <MessageCircle className="w-3 h-3" /> 查詢
                    </>
                  ) : (
                    <>
                      <span>📩</span> 邀請查詢
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

// Pick the top N trending vendors by viewCount (already attached
// on each vendor at App.jsx subscription layer).
function pickTrending(vendors, n = 6) {
  const ranked = vendors
    .filter((v) => (v.viewCount || 0) > 0)
    .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));
  return ranked.slice(0, n);
}