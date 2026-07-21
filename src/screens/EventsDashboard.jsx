import { Heart, Calendar, ArrowRight, Plus, Crown, Flame, TrendingUp } from 'lucide-react';
import { TrendingVendors } from '../components/TrendingVendors';
import { VENDOR_CATEGORIES } from '../lib/config';

// `isAdmin` and `user` used to be passed in here so the page could embed
// the admin KPI strip + users table below the event cards. As of 2026-07-01
// admin tools live in the dark role-switcher bar at the top of the screen
// (RoleSimulator.jsx), so this screen is back to its pre-admin-embed shape.
// We intentionally do NOT accept those props anymore — leaving them in
// would invite future engineers to re-add the embed.

export function EventsDashboard({
  events,
  newEventName,
  onNewEventNameChange,
  onCreate,
  onSelectEvent,
  vendors = [],
  onSelectVendor,
  onGoDiscover,
  // 2026-07-21 — passed through to <TrendingVendors> so the
  // claim CTA can create inquiries with the couple's identity.
  user,
  currentEvent,
  onOpenChat,
}) {
  return (
    <div className="max-w-4xl mx-auto mt-12 p-4 animate-in fade-in zoom-in duration-300">
      <div className="text-center mb-12">
        <Heart className="w-16 h-16 text-rose-500 mx-auto mb-4 fill-rose-100" />
        <h1 className="text-4xl font-black text-slate-800 mb-2">Save The Day · 總大堂</h1>
        <p className="text-slate-500">建立或選擇你想管理的婚禮專案</p>
      </div>

      {/* 2026-07-20 — "熱門商戶" preview on the events dashboard.
          Couples who haven't picked an event yet see what's hot
          in the catalog so the home page never feels empty. Click
          → onSelectVendor opens the modal. Hidden when there's no
          trending data (early launch, no views yet). */}
      <div className="mb-8">
        <TrendingVendors
          vendors={vendors}
          onSelect={onSelectVendor}
          onGoDiscover={onGoDiscover}
          user={user}
          currentEvent={currentEvent}
          onOpenChat={onOpenChat}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {events.map((ev) => (
          <EventCard key={ev.id} event={ev} onSelect={onSelectEvent} />
        ))}

        <div className="bg-rose-50 p-6 rounded-2xl border-2 border-dashed border-rose-200 hover:border-rose-400 transition-all flex flex-col items-center justify-center text-center min-h-[200px]">
          <form onSubmit={onCreate} className="w-full flex flex-col items-center">
            <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mb-3 shadow-sm">
              <Plus className="w-6 h-6 text-rose-500" />
            </div>
            <h3 className="text-lg font-bold text-slate-800 mb-2">建立新婚禮</h3>
            <input
              type="text"
              required
              placeholder="例如: 志明 & 春嬌"
              className="w-full max-w-[200px] p-2 text-center border border-rose-200 rounded-lg outline-none focus:ring-2 focus:ring-rose-400 mb-3 bg-white"
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
      </div>
    </div>
  );
}

function EventCard({ event, onSelect }) {
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
