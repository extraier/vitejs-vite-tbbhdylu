/**
 * RewardsBanner — subtle banner shown on EventsDashboard.
 *
 * Four unlock actions for premium features (all admin-verified):
 *   • 1 IG/FB story OR post with @savetheday.hk → custom invite template
 *   • 1 friend referral who creates an event     → +500MB storage
 *   • 1 Instagram Reels featuring Save The Day → permanent archive
 *   • Pay per-feature (or the same referral also unlocks this):
 *                                                  → watermark removal
 *
 * Each action also has a paid alternative ($49 / $29 / $39 / $29).
 *
 * Three states:
 *   1. Has all unlocks: hidden (don't nag)
 *   2. Has some unlocks: shows locked list + CTA to earn OR pay
 *   3. Has none: invite them to start
 *
 * On click → opens SocialProofModal via onUploadClick
 * On pay click → opens PurchaseModal via onPayClick
 *
 * 2026-07-21 — initial release.
 * 2026-08-02 — added `watermark-removed`. Previously the banner
 * advertised "推介 1 位朋友 → +500MB + 移除浮水印" as if a single
 * referral unlocked both, but only the storage half actually
 * worked. The watermark side required a backend CF + NAS-side
 * Pillow integration that didn't exist. As of this commit both
 * halves are real and granted atomically (one referral = two
 * unlocks). The banner now shows them as separate rows so the
 * couple can see each unlock independently.
 */

import { Sparkles, Instagram, Users, Video, CreditCard, ExternalLink, Crown, Stamp } from 'lucide-react';
import type { UnlockType } from '../screens/EventsDashboard';

const ALL_UNLOCKS: UnlockType[] = ['custom-template', 'storage-500mb', 'permanent-archive', 'watermark-removed'];

const UNLOCK_INFO: Record<UnlockType, {
  label: string;
  emoji: string;
  emojiBig: string;
  howToEarn: string;
  icon: typeof Instagram;
  priceHKD: number;
}> = {
  'custom-template': {
    label: '上傳自訂電子喜帖設計',
    emoji: '🎨',
    emojiBig: '📸',
    howToEarn: 'IG/FB Story 或 Post 標記 @savetheday.hk',
    icon: Instagram,
    priceHKD: 49,
  },
  // 2026-08-02 — storage-500mb is now JUST storage. The
  // "+ 移除浮水印" suffix was bundled into this label because
  // both were promised by a single referral, but the
  // watermark half was a lie (no backend code applied it).
  // Now `watermark-removed` is its own unlock row below; this
  // row reads cleanly on its own.
  'storage-500mb': {
    label: '+500MB 相簿容量',
    emoji: '💾',
    emojiBig: '👥',
    howToEarn: '推介 1 位朋友建立婚禮',
    icon: Users,
    priceHKD: 29,
  },
  'permanent-archive': {
    label: '永久保存婚禮檔案',
    emoji: '🏛️',
    emojiBig: '🎬',
    howToEarn: '拍 1 段 IG Reels 用 Save The Day',
    icon: Video,
    priceHKD: 39,
  },
  // 2026-08-02 — Watermark removal as its own unlock. Each
  // referral approval grants this alongside `storage-500mb`,
  // so a single social-share action unlocks BOTH rows.
  // Couples can also pay $29 to skip the social proof. The
  // upload pipeline checks for this unlock via the owner's
  // HMAC-signed upload-preferences token; when present, the
  // NAS skips the Pillow corner-watermark step on every
  // upload (owner's + guests').
  'watermark-removed': {
    label: '移除相簿浮水印',
    emoji: '✨',
    emojiBig: '🎁',
    howToEarn: '推介 1 位朋友建立婚禮',
    icon: Stamp,
    priceHKD: 29,
  },
};

interface RewardsBannerProps {
  unlocks: UnlockType[];
  onUploadClick: () => void;
  onPayClick: () => void;
  // 2026-07-29 — referral path. Only relevant when storage-500mb
  // is among the locked unlocks; opening the modal in other cases
  // would be confusing. We still accept the prop unconditionally so
  // the parent can wire it once.
  onReferralClick: () => void;
}

export function RewardsBanner({ unlocks, onUploadClick, onPayClick, onReferralClick }: RewardsBannerProps) {
  const locked = ALL_UNLOCKS.filter((t) => !unlocks.includes(t));
  // 2026-07-29 — referral is only valid for storage-500mb. Hide the
  // referral button if that's already unlocked (the user has 0 incentive
  // to claim more referrals for a feature they already have).
  // 2026-08-02 — referrals now unlock BOTH storage-500mb AND
  // watermark-removed in one go. So the referral CTA is also
  // relevant when watermark-removed is locked (because claiming
  // one referral gives them both). The check now uses
  // `locked.includes(...)` for either type to mirror the
  // grant flow. Couples who already have storage but not
  // watermark still see the button — they're still earning
  // something via referral.
  const showReferral = locked.includes('storage-500mb') || locked.includes('watermark-removed');

  // Hide if user has everything (don't nag)
  if (locked.length === 0) return null;

  return (
    <div className="bg-gradient-to-r from-rose-50 via-white to-amber-50 border border-rose-200 rounded-2xl p-4 mb-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-rose-500 flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold text-slate-800">
            仲有 {locked.length} 個功能等你解鎖 🎁
          </p>
          <p className="text-xs text-slate-500">
            用社交分享免費拎 · 或者直接付款解鎖
          </p>
        </div>
      </div>

      {/* Locked features list */}
      <div className="space-y-2 mb-3">
        {locked.map((t) => {
          const info = UNLOCK_INFO[t];
          const Icon = info.icon;
          return (
            <div
              key={t}
              className="flex items-center gap-3 bg-white/60 rounded-xl p-3 border border-rose-100"
            >
              <div className="w-8 h-8 rounded-lg bg-rose-100 flex items-center justify-center flex-shrink-0">
                <Icon className="w-4 h-4 text-rose-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-slate-800">
                  {info.emoji} {info.label}
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  ✨ {info.howToEarn} (免費) · 或 HK${info.priceHKD}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* 2026-07-29 — three CTAs when referral is relevant, two otherwise */}
      {showReferral ? (
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={onUploadClick}
            className="flex items-center justify-center gap-1 px-2 py-2.5 bg-rose-600 text-white font-bold rounded-xl hover:bg-rose-700 shadow-sm text-xs"
          >
            <Instagram className="w-3.5 h-3.5" />
            分享
          </button>
          <button
            type="button"
            onClick={onReferralClick}
            className="flex items-center justify-center gap-1 px-2 py-2.5 bg-amber-500 text-white font-bold rounded-xl hover:bg-amber-600 shadow-sm text-xs"
          >
            <Users className="w-3.5 h-3.5" />
            推薦朋友
          </button>
          <button
            type="button"
            onClick={onPayClick}
            className="flex items-center justify-center gap-1 px-2 py-2.5 bg-white border-2 border-rose-600 text-rose-600 font-bold rounded-xl hover:bg-rose-50 text-xs"
          >
            <CreditCard className="w-3.5 h-3.5" />
            升級 Premium
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onUploadClick}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 bg-rose-600 text-white font-bold rounded-xl hover:bg-rose-700 shadow-sm text-sm"
          >
            <Instagram className="w-4 h-4" />
            分享解鎖
            <ExternalLink className="w-3 h-3 opacity-70" />
          </button>
          <button
            type="button"
            onClick={onPayClick}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 bg-white border-2 border-rose-600 text-rose-600 font-bold rounded-xl hover:bg-rose-50 text-sm"
          >
            <Crown className="w-4 h-4" />
            升級 Premium
          </button>
        </div>
      )}

      {/* Fine print */}
      <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
        📌 社交分享後管理員會喺 24 小時內人手核實；核實後自動解鎖 · 推薦朋友即刻解鎖
      </p>
    </div>
  );
}