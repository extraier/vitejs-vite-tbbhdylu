// 2026-08-08 — BellNotifications
//
// Header bell button that surfaces "new vendor proposals on your
// 徵求報價 jobs". Lifted from the per-job bell on CoupleJobBoard to
// make it visible from any header view (checklist, events dashboard,
// chat, etc).
//
// Click navigates the couple to the 徵求報價 view AND marks the
// current proposal total as "seen" so the bell hides immediately.
//
// Owners only. Vendors don't publish 徵求報價 so they don't see this.

import { Bell } from 'lucide-react';
import { useProposalBell, markProposalsSeenExact } from '../hooks/useProposalBell';

export function BellNotifications({ jobs, ownerUid, onOpenBoard }) {
  const { sum, delta } = useProposalBell(jobs, ownerUid);

  const handleClick = () => {
    // Mark as seen BEFORE navigation so when the user comes back to
    // a header view, the bell is already cleared. useProposalBell
    // reads localStorage on each render; if the user navigates
    // through views, every header re-render re-evaluates.
    markProposalsSeenExact(ownerUid, sum);
    onOpenBoard?.();
  };

  return (
    <button
      onClick={handleClick}
      className={`relative text-slate-600 hover:text-slate-800 p-2 rounded-lg hover:bg-slate-100 transition-colors flex-shrink-0 ${
        delta > 0 ? 'animate-pulse' : ''
      }`}
      title={delta > 0 ? `有 ${delta} 個新報價` : '商戶報價通知'}
      aria-label={delta > 0 ? `有 ${delta} 個新報價，點擊查看` : '商戶報價通知'}
    >
      <Bell
        className={`w-5 h-5 ${delta > 0 ? 'text-rose-500 fill-rose-200' : ''}`}
      />
      {delta > 0 && (
        <span className="absolute -top-0.5 -right-0.5 bg-rose-500 text-white text-[10px] font-black rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-tight ring-2 ring-white">
          {delta > 9 ? '9+' : delta}
        </span>
      )}
    </button>
  );
}
