/**
 * RewardsBanner — subtle banner shown on EventsDashboard.
 *
 * Three unlock actions for premium features (all admin-verified):
 *   • 1 IG/FB story OR post with @savetheday.hk → custom invite template
 *   • 1 friend referral who creates an event → +500MB + watermark removal
 *   • 1 Instagram Reels featuring Save The Day → permanent archive
 *
 * Each action also has a paid alternative ($49 / $29 / $39).
 *
 * Three states:
 *   1. Has all unlocks: hidden (don't nag)
 *   2. Has some unlocks: shows locked list + CTA to earn OR pay
 *   3. Has none: invite them to start
 *
 * On click → opens SocialProofModal (TODO) via onUploadClick
 * On pay click → opens PurchaseModal via onPayClick
 *
 * 2026-07-21 — initial release.
 */

import { Sparkles, Instagram, Users, Video, CreditCard, ExternalLink } from 'lucide-react';
import type { UnlockType } from '../screens/EventsDashboard';

const ALL_UNLOCKS: UnlockType[] = ['custom-template', 'storage-500mb', 'permanent-archive'];

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
  'storage-500mb': {
    label: '+500MB 相簿容量 + 移除浮水印',
    emoji: '📸',
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
};

interface RewardsBannerProps {
  unlocks: UnlockType[];
  onUploadClick: () => void;
  onPayClick: () => void;
}

export function RewardsBanner({ unlocks, onUploadClick, onPayClick }: RewardsBannerProps) {
  const locked = ALL_UNLOCKS.filter((t) => !unlocks.includes(t));

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

      {/* Two CTAs */}
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
          <CreditCard className="w-4 h-4" />
          直接付款
        </button>
      </div>

      {/* Fine print */}
      <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
        📌 社交分享後管理員會喺 24 小時內人手核實；核實後自動解鎖
      </p>
    </div>
  );
}