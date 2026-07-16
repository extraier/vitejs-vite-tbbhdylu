// Inbox — list of all conversations for the current user (couple or
// vendor). Powers both the couple's "💬 訊息" view and the vendor's
// inbox. Real-time via Firestore onSnapshot.
//
// 2026-07-15 — new screen. Sorted by lastMessageAt desc so the most
// recent conversation is on top. Each row shows the OTHER party's
// name, last message preview, timestamp, and unread badge (red dot +
// count) if there are unread messages.
//
// Props:
//   - userUid, userRole (same shape as ChatRoom)
//   - inquiries: list of inquiry objects (subscribed by App.jsx)
//   - loading: boolean
//   - onSelectInquiry: callback when a conversation row is clicked
//   - onBack: optional back button (hides on standalone views)

import { Inbox as InboxIcon, MessageCircle } from 'lucide-react';

export function Inbox({
  inquiries = [],
  loading,
  userUid,
  userRole,
  onSelectInquiry,
  onBack,
}) {
  if (loading) {
    return (
      <div className="max-w-2xl mx-auto mt-10 px-4 text-center text-slate-500 py-12">
        載入中...
      </div>
    );
  }

  if (inquiries.length === 0) {
    return (
      <div className="max-w-2xl mx-auto mt-10 px-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-sm">
          <InboxIcon className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-slate-700 mb-1">
            暫時未有對話
          </h3>
          <p className="text-sm text-slate-500">
            {userRole === 'couple'
              ? '從「智能配對推薦」點擊商戶卡片嘅「訊息」按鈕開始對話。'
              : '等候新人查詢。你嘅商戶專頁曝光越多，查詢就越多。'}
          </p>
        </div>
      </div>
    );
  }

  function unreadCount(inq) {
    return userRole === 'couple' ? inq.coupleUnread || 0 : inq.vendorUnread || 0;
  }

  function otherName(inq) {
    return userRole === 'couple' ? inq.vendorName || '商戶' : inq.coupleName || '新人';
  }

  function otherLabel() {
    return userRole === 'couple' ? '商戶' : '新人';
  }

  return (
    <div className="max-w-2xl mx-auto mt-6 px-4 animate-in fade-in duration-300">
      <h2 className="text-2xl font-black text-slate-800 mb-4 flex items-center gap-2">
        <MessageCircle className="w-6 h-6 text-rose-500" />
        訊息收件匣
      </h2>
      <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 shadow-sm overflow-hidden">
        {inquiries.map((inq) => {
          const unread = unreadCount(inq);
          return (
            <button
              key={inq.id}
              onClick={() => onSelectInquiry?.(inq)}
              className={`w-full text-left p-4 hover:bg-slate-50 active:bg-slate-100 transition-colors flex items-center gap-3 ${
                unread > 0 ? 'bg-rose-50/50' : ''
              }`}
            >
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-rose-400 to-rose-600 flex items-center justify-center text-white font-black text-lg flex-shrink-0">
                {otherName(inq).charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-baseline gap-2 mb-0.5">
                  <span
                    className={`truncate ${
                      unread > 0 ? 'font-black text-slate-900' : 'font-bold text-slate-700'
                    }`}
                  >
                    {otherName(inq)}
                  </span>
                  <span className="text-xs text-slate-400 flex-shrink-0">
                    {formatTime(inq.lastMessageAt)}
                  </span>
                </div>
                <div className="flex justify-between items-center gap-2">
                  <span
                    className={`text-sm truncate ${
                      unread > 0 ? 'text-slate-700 font-bold' : 'text-slate-500'
                    }`}
                  >
                    {inq.lastMessagePreview || (
                      <span className="italic text-slate-400">
                        開始對話...
                      </span>
                    )}
                  </span>
                  {unread > 0 && (
                    <span className="flex-shrink-0 bg-rose-500 text-white text-xs font-black rounded-full px-2 py-0.5 min-w-[20px] text-center">
                      {unread > 9 ? '9+' : unread}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 uppercase tracking-wide">
                  {otherLabel()}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit' });
  }
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays < 7) {
    return `${diffDays}天前`;
  }
  return d.toLocaleDateString('zh-HK', { month: 'numeric', day: 'numeric' });
}