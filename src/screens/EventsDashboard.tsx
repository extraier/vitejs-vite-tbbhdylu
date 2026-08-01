import { Heart, Calendar, ArrowRight, Plus, Crown, MoreVertical, Pencil, Trash2, Users } from 'lucide-react';
import { TrendingVendors } from '../components/TrendingVendors';
import { RewardsBanner } from '../components/RewardsBanner';

import { ReferralModal } from '../components/modals/ReferralModal';
import { SocialProofModal } from '../components/modals/SocialProofModal';
import { EventRenameModal } from '../components/modals/EventRenameModal';
import { EventDeleteModal } from '../components/modals/EventDeleteModal';
import { useUserProfile } from '../hooks/useUserProfile';
import { useState, useEffect, useRef } from 'react';

// 2026-07-21 — Three premium features unlockable via social proof
// or payment:
//   custom-template   — 1 IG/FB story OR post with @savetheday.hk tag
//   storage-500mb     — 1 friend referral who creates an event
//   permanent-archive — 1 Instagram Reels featuring Save The Day
export type UnlockType = 'custom-template' | 'storage-500mb' | 'permanent-archive';

interface EventsDashboardProps {
  events: any[];
  newEventName: string;
  onNewEventNameChange: (name: string) => void;
  onCreate: (e: React.FormEvent) => void;
  onSelectEvent: (ev: any) => void;
  vendors?: any[];
  onSelectVendor?: (v: any) => void;
  onGoDiscover?: () => void;
  user?: { uid: string } | null;
  currentEvent?: any;
  onOpenChat?: (v: any) => void;
  // 2026-07-30 — purchaseModalOpen state lifted to App.jsx. The
  // dashboard triggers the shared modal through this callback.
  onPurchaseModalOpen?: () => void;
  // 2026-07-31 — If the user deletes the event they're currently
  // inside, we need App.jsx to clear `currentEvent` so the lobby
  // reappears (App.jsx's !currentEvent branch renders this
  // dashboard in the first place). Lifted to App so the state
  // owner stays consistent with the create path (handleCreateEvent
  // also lives in App.jsx).
  onClearCurrentEvent?: () => void;
  // 2026-08-01 (pivot) — owner-names editor moved to a per-event
  // EventSettingsModal. The lobby card's ⋯ menu item "新人名稱"
  // opens it, scoped to the clicked event. App.jsx owns the
  // modal state + visibility (so the modal can mount on top of
  // any current view, not just the dashboard).
  onOpenEventSettings?: (ev: any) => void;
  // 2026-07-31 — Optional toast callback so the rename/delete
  // modals can show a confirmation message after a successful
  // write. The dashboard doesn't own its own toast hook; we
  // delegate to the parent's `showToast`.
  onToast?: (msg: string) => void;
}

export function EventsDashboard({
  events,
  newEventName,
  onNewEventNameChange,
  onCreate,
  onSelectEvent,
  vendors = [],
  onSelectVendor,
  onGoDiscover,
  user,
  currentEvent,
  onOpenChat,
  onPurchaseModalOpen,
  onClearCurrentEvent,
  onOpenEventSettings,
  onToast,
}: EventsDashboardProps) {
  // 2026-07-30 — useUserProfile hook replaces the inline
  // unlocks + tier subscriptions added in Phases 2-4. The hook
  // handles real-time updates and cleanup. EventsDashboard only
  // needs tier + unlocks here; createdAt/promotedAt are used by
  // MyProfile for the membership card.
  const { tier: userTier, unlocks } = useUserProfile(user);
  const [referralModalOpen, setReferralModalOpen] = useState(false);
  // 2026-07-29 — SocialProofModal visibility (Phase 3 of premium build).
  // Replaces the alert() TODO that lived in RewardsBanner's onUploadClick.
  const [socialProofModalOpen, setSocialProofModalOpen] = useState(false);
  // 2026-07-31 — Per-card rename / delete modal state. We hold
  // the target event by ref (rather than id) so the modal renders
  // with a stable snapshot of the event including its name.
  const [renameTarget, setRenameTarget] = useState<any | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);



  return (
    <div className="max-w-4xl mx-auto mt-12 p-4 animate-in fade-in zoom-in duration-300">
      <div className="text-center mb-12">
        <Heart className="w-16 h-16 text-rose-500 mx-auto mb-4 fill-rose-100" />
        <h1 className="text-4xl font-black text-slate-800 mb-2">Save The Day · 總大堂</h1>
        <p className="text-slate-500">建立或選擇你想管理的婚禮專案</p>
        {/* 2026-07-29 — Premium-user lobby badge. Visible to the user
            AND anyone visiting their public profile/links. Reflects
            user-level tier (granted by any unlock from Phase 2/3).
            Falls back to per-event tier for already-paid individual
            weddings when user-tier is unset. */}
        {userTier === 'premium' ? (
          <div className="mt-4 inline-flex items-center gap-1.5 bg-gradient-to-r from-amber-400 to-amber-500 text-white text-sm font-bold px-4 py-1.5 rounded-full shadow-md">
            <Crown className="w-4 h-4" />
            👑 Premium User · 解鎖咗所有功能
          </div>
        ) : (
          // 2026-07-30 — "升級 Premium" CTA in the lobby. Always
          // visible (not just when something is locked) so the user
          // has a direct path to "I want premium, I'll pay" without
          // having to find the RewardsBanner below. Clicking opens
          // PurchaseModal with the premium option pre-selected.
          <button
            type="button"
            onClick={() => onPurchaseModalOpen?.()}
            className="mt-4 inline-flex items-center gap-2 bg-gradient-to-r from-amber-500 to-rose-500 text-white text-sm font-bold px-5 py-2.5 rounded-full shadow-lg hover:shadow-xl hover:scale-105 transition-all"
          >
            <Crown className="w-4 h-4" />
            升級 Premium · HK$99
          </button>
        )}
      </div>

      {/* 2026-07-22 — Reordered per user request. Existing projects
          (the user's actual weddings they're managing) come FIRST,
          so the primary CTA of "open my wedding" is at the top.
          The RewardsBanner moves below so couples see their projects
          immediately before the marketing layer. */}
      <section className="mb-8">
        <h2 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
          📂 你的婚禮專案
          <span className="text-xs font-bold text-slate-400">
            ({events.length})
          </span>
        </h2>
        {events.length === 0 ? (
          <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-6 text-center">
            <div className="text-2xl mb-1">💌</div>
            <p className="text-sm text-slate-500">你仲未有婚禮專案，喺下面建立一個啦。</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {events.map((ev) => (
              <EventCard
                key={ev.id}
                event={ev}
                onSelect={onSelectEvent}
                // 2026-07-31 — Open the rename/delete modals via
                // local state. The Firestore writes happen inside
                // the modal components themselves (so the modal
                // owns the loading/error state and stays
                // self-contained). The useFirestoreCollection hook
                // at App.jsx:719 picks up the change and the
                // dashboard reflects the new state automatically.
                onRename={(target) => setRenameTarget(target)}
                onDelete={(target) => setDeleteTarget(target)}
                // 2026-08-01 (pivot) — owner-names editor lives in
                // EventSettingsModal (per-event). The ⋯ menu item
                // surfaces it for owner + co-owner (CF accepts
                // either as long as they own / co-own the event).
                onOpenSettings={(target) => onOpenEventSettings?.(target)}
              />
            ))}
          </div>
        )}
      </section>

      {/* 2026-07-21 — rewards banner. Shows social-proof unlocks
          (IG/FB post → custom template, refer friend → +500MB,
          reels → permanent archive) and a pay-as-alternative CTA.
          Sits BELOW the existing-projects section so couples see
          their actual work first, not the marketing banner. */}
      <RewardsBanner
        unlocks={unlocks}
        onUploadClick={() => setSocialProofModalOpen(true)}
        onPayClick={() => onPurchaseModalOpen?.()}
        // 2026-07-29 — referral path. Opens ReferralModal which lets
        // the user share their code, claim a friend's referral, and
        // auto-grant the storage-500mb unlock (no admin step).
        onReferralClick={() => setReferralModalOpen(true)}
      />

      {/* 2026-07-20 — "熱門商戶" preview on the events dashboard. */}
      <div className="mb-8 mt-8">
        <TrendingVendors
          vendors={vendors}
          onSelect={onSelectVendor}
          onGoDiscover={onGoDiscover}
          user={user}
          currentEvent={currentEvent}
          onOpenChat={onOpenChat}
        />
      </div>

      {/* 2026-07-22 — 建立新婚禮 sits at the bottom now. We don't
          want a giant pink CTA at the top fighting for attention
          with the existing projects; this is the "add another one"
          action which is secondary. */}
      <section>
        <div className="bg-rose-50 p-6 rounded-2xl border-2 border-dashed border-rose-200 hover:border-rose-400 transition-all flex flex-col items-center justify-center text-center">
          <form onSubmit={onCreate} className="w-full flex flex-col items-center max-w-xs">
            <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center mb-2 shadow-sm">
              <Plus className="w-5 h-5 text-rose-500" />
            </div>
            <h3 className="text-base font-bold text-slate-800 mb-2">➕ 再建立一個婚禮</h3>
            <input
              type="text"
              required
              placeholder="例如: 志明 & 春嬌"
              className="w-full p-2 text-center border border-rose-200 rounded-lg outline-none focus:ring-2 focus:ring-rose-400 mb-2 bg-white text-sm"
              value={newEventName}
              onChange={(e) => onNewEventNameChange(e.target.value)}
            />
            <button
              type="submit"
              className="bg-rose-500 text-white text-xs font-bold px-4 py-2 rounded-full hover:bg-rose-600"
            >
              立即建立
            </button>
          </form>
        </div>
      </section>

      {/* 2026-07-21 — purchase modal. Opened when user clicks
          "或直接付款解鎖" link inside RewardsBanner. */}


      {/* 2026-07-29 — Referral modal. Opened from RewardsBanner's
          "推薦朋友" button. The modal handles share / claim / track
          tabs and calls requestReferralClaim for auto-grant. */}
      <ReferralModal
        isOpen={referralModalOpen}
        onClose={() => setReferralModalOpen(false)}
      />

      {/* 2026-07-29 — Social proof modal. Replaces the alert() TODO
          that lived in RewardsBanner's onUploadClick. Submits IG/FB
          URLs for admin verification and shows submission status. */}
      <SocialProofModal
        isOpen={socialProofModalOpen}
        onClose={() => setSocialProofModalOpen(false)}
        ownerUid={user?.uid || ''}
      />

      {/* 2026-07-31 — Per-card rename modal. Self-contained: opens
          on the click of "改名" in the card's action menu, performs
          the setDoc({merge:true}) internally, then closes. The
          showToast comes from the dashboard's parent (App.jsx) via
          a callback prop OR is duplicated here in a follow-up if
          we decide to lift it. For now, keep the modal quiet so
          it doesn't fight with the lobby's existing toasts. */}
      {renameTarget && (
        <EventRenameModal
          event={renameTarget}
          onClose={() => setRenameTarget(null)}
          onSaved={(newName) => onToast?.(`✏️ 已改名為「${newName}」`)}
        />
      )}

      {/* 2026-07-31 — Per-card delete confirmation modal. Requires
          the user to type `DELETE` (literal, case-sensitive) to
          enable the submit button. */}
      {deleteTarget && (
        <EventDeleteModal
          event={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          // 2026-07-31 — If the user is currently inside this
          // event, kick them back to the lobby (App.jsx owns
          // currentEvent). The dashboard re-renders via the
          // !currentEvent branch.
          onDeleted={() => {
            const wasCurrent =
              currentEvent && currentEvent.id === deleteTarget.id;
            if (wasCurrent) {
              onClearCurrentEvent?.();
            }
            onToast?.(
              wasCurrent
                ? '🗑️ 婚禮專案已移到垃圾桶，已返回總大堂。'
                : '🗑️ 婚禮專案已移到垃圾桶。',
            );
          }}
        />
      )}
    </div>
  );
}

interface EventCardProps {
  event: any;
  onSelect?: (ev: any) => void;
  onRename?: (ev: any) => void;
  onDelete?: (ev: any) => void;
  // 2026-08-01 (pivot) — owner-names ⋯ menu item. Surfaced for
  // both owner and co-owner cards; the CF accepts either caller.
  onOpenSettings?: (ev: any) => void;
}

// 2026-07-31 — Per-card "⋯" menu. Reveals 改名 / 刪除 actions.
// Click-outside-to-close, Escape-to-close. Mobile-friendly: the
// button is always visible (≥md: opacity bumps to 100 on hover,
// defaults to 30% so it doesn't crowd the card at rest).
function EventCard({ event, onSelect, onRename, onDelete, onOpenSettings }: EventCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 2026-07-31 — click-outside + Escape handlers. Both run only
  // while the menu is open (saves a render-path during normal
  // use). Cleanup function is crucial because the dashboard
  // unmounts/remounts across navigations.
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect?.(event)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect?.(event);
        }
      }}
      className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-lg hover:border-rose-300 transition-all cursor-pointer group relative overflow-hidden"
    >
      {event.tier === 'premium' && (
        <div className="absolute top-0 right-0 bg-amber-400 text-white text-[10px] font-bold px-3 py-1 rounded-bl-xl flex items-center gap-1">
          <Crown className="w-3 h-3" /> PREMIUM
        </div>
      )}
      <h3 className="text-xl font-bold text-slate-800 mb-1 group-hover:text-rose-600 transition-colors">
        {event.name}
      </h3>
      <p className="text-sm text-slate-500 flex items-center gap-1 mb-4">
        <Calendar className="w-4 h-4" /> 預定日期: {event.date}
      </p>
      <div className="flex justify-between items-center border-t border-slate-100 pt-4 mt-4">
        <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded">
          專案 ID: {event.id?.substring(0, 6)}
        </span>
        <ArrowRight className="w-5 h-5 text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity translate-x-[-10px] group-hover:translate-x-0" />
      </div>

      {/* 2026-07-31 — per-card action menu (⋯ button + popover).
          Positioned top-right to avoid covering the event name on
          the left (the previous top-left placement overlapped the
          first character of every card title). On mobile, the top
          right stays clear of the title because we set the menu
          z-index above the premium ribbon. */}
      {(onRename || onDelete || onOpenSettings) && (
        <div
          ref={menuRef}
          className="absolute top-3 right-3 z-20"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            aria-label="專案操作"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <MoreVertical className="w-5 h-5" />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute top-full mt-1 right-0 bg-white shadow-lg rounded-xl border border-slate-200 py-1 min-w-[140px] z-10 animate-in fade-in zoom-in-95 duration-150"
            >
              {onRename && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onRename(event);
                  }}
                  className="w-full text-left px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                >
                  <Pencil className="w-4 h-4" />
                  改名
                </button>
              )}
              {onOpenSettings && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenSettings(event);
                  }}
                  className="w-full text-left px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                >
                  <Users className="w-4 h-4" />
                  新人名稱
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete(event);
                  }}
                  className="w-full text-left px-4 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  刪除
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}