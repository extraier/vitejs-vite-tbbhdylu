import { Heart, Calendar, ArrowRight, Plus, Crown, TrendingUp } from 'lucide-react';
import { TrendingVendors } from '../components/TrendingVendors';
import { RewardsBanner } from '../components/RewardsBanner';
import { PurchaseModal } from '../components/PurchaseModal';
import { useState, useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db, appId } from '../lib/firebase';

// 2026-07-21 — Three premium features unlockable via social proof
// or payment:
//   custom-template   — 1 IG/FB story OR post with @savetheday.hk tag
//   storage-500mb     — 1 friend referral who creates an event
//   permanent-archive — 1 Instagram Reels featuring Save The Day
export type UnlockType = 'custom-template' | 'storage-500mb' | 'permanent-archive';
const ALL_UNLOCK_TYPES: UnlockType[] = ['custom-template', 'storage-500mb', 'permanent-archive'];

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
}: EventsDashboardProps) {
  // 2026-07-21 — Subscribe to user's unlocks subcollection so the
  // RewardsBanner can show which features are still locked.
  const [unlocks, setUnlocks] = useState<UnlockType[]>([]);
  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false);

  useEffect(() => {
    if (!user?.uid) return;
    const unlocksRef = collection(db, 'artifacts', appId, 'users', user.uid, 'unlocks');
    const unsub = onSnapshot(unlocksRef, (snap) => {
      const types = snap.docs
        .map((d) => d.data().type)
        .filter((t): t is UnlockType => ALL_UNLOCK_TYPES.includes(t as UnlockType));
      setUnlocks(types);
    });
    return () => unsub();
  }, [user?.uid]);

  const lockedTypes: UnlockType[] = ALL_UNLOCK_TYPES.filter((t) => !unlocks.includes(t));

  return (
    <div className="max-w-4xl mx-auto mt-12 p-4 animate-in fade-in zoom-in duration-300">
      <div className="text-center mb-12">
        <Heart className="w-16 h-16 text-rose-500 mx-auto mb-4 fill-rose-100" />
        <h1 className="text-4xl font-black text-slate-800 mb-2">Save The Day · 總大堂</h1>
        <p className="text-slate-500">建立或選擇你想管理的婚禮專案</p>
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
              <EventCard key={ev.id} event={ev} onSelect={onSelectEvent} />
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
        onUploadClick={() => {
          // Open the social proof modal (TODO).
          alert('請用 IG/FB Story 標記 @savetheday.hk 或推介朋友以解鎖功能！\n\n完整版稍後推出。');
        }}
        onPayClick={() => setPurchaseModalOpen(true)}
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
      <PurchaseModal
        isOpen={purchaseModalOpen}
        onClose={() => setPurchaseModalOpen(false)}
        ownerUid={user?.uid || ''}
        lockedTypes={lockedTypes}
        onSuccess={() => {
          // Modal closes itself on success.
        }}
      />
    </div>
  );
}

interface EventCardProps {
  event: any;
  onSelect?: (ev: any) => void;
}

function EventCard({ event, onSelect }: EventCardProps) {
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
    </div>
  );
}