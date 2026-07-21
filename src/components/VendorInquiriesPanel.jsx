// VendorInquiriesPanel — vendor's overview of incoming chat inquiries
// from couples. Subscribes to /artifacts/{appId}/vendorInquiries
// where vendorUid == user.uid. Shows unread badge + recent inquiries
// list. Click an inquiry → App.jsx routes to ChatRoom.
//
// 2026-07-20 — first version. Pairs with the inquiry form inside
// VendorModal (which writes to the same collection). Vendors who
// haven't been contacted yet see a friendly empty state.

import { useEffect, useState } from 'react';
import { Inbox, MessageSquare, ArrowRight, User } from 'lucide-react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db, appId } from '../lib/firebase';

const COL = `artifacts/${appId}/vendorInquiries`;

function relTime(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const s = Math.floor(diff / 1000);
  if (s < 60) return s + ' 秒前';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' 分鐘前';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' 小時前';
  const dd = Math.floor(h / 24);
  if (dd < 30) return dd + ' 日前';
  return Math.floor(dd / 30) + ' 個月前';
}

export function VendorInquiriesPanel({ user, onOpenInquiry }) {
  const [inquiries, setInquiries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid) return undefined;
    const q = query(collection(db, COL), where('vendorUid', '==', user.uid));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
        createdAt: d.data().createdAt?.toMillis?.() || 0,
        lastMessageAt: d.data().lastMessageAt?.toMillis?.() || 0,
      }));
      list.sort((a, b) => (b.lastMessageAt || b.createdAt) - (a.lastMessageAt || a.createdAt));
      setInquiries(list);
      setLoading(false);
    }, (err) => {
      console.warn('[VendorInquiriesPanel] subscribe failed:', err?.message || err);
      setLoading(false);
    });
    return unsub;
  }, [user?.uid]);

  const totalUnread = inquiries.reduce((acc, i) => acc + (i.vendorUnread || 0), 0);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-rose-50 flex items-center justify-center relative">
            <Inbox className="w-4 h-4 text-rose-600" />
            {totalUnread > 0 && (
              <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[10px] font-black rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                {totalUnread > 99 ? '99+' : totalUnread}
              </span>
            )}
          </span>
          <span>
            <span className="font-black text-slate-800">客戶查詢收件箱</span>
            <span className="text-xs text-slate-500 ml-2">
              客人透過你嘅專頁直接傳嚟嘅訊息
            </span>
          </span>
        </div>
        {inquiries.length > 0 && (
          <button
            type="button"
            onClick={() => {
              // Open the most recent inquiry via the parent's callback
              // (App.jsx wires it to setCurrentView('chat-room'))
              if (onOpenInquiry && inquiries[0]) {
                onOpenInquiry(inquiries[0]);
              }
            }}
            className="text-xs font-bold text-rose-600 hover:text-rose-700 flex items-center gap-1"
          >
            開啟收件箱
            <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>

      {loading ? (
        <div className="py-6 text-center text-sm text-slate-400">載入中...</div>
      ) : inquiries.length === 0 ? (
        <div className="py-8 text-center">
          <MessageSquare className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500 mb-1">未有客戶查詢</p>
          <p className="text-xs text-slate-400 max-w-xs mx-auto">
            完成啟動後，當有客人透過你嘅專頁傳訊息，你就會喺度見到。
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {inquiries.slice(0, 4).map((inq) => {
            const isUnread = (inq.vendorUnread || 0) > 0;
            return (
              <li key={inq.id}>
                <button
                  type="button"
                  onClick={() => onOpenInquiry ? onOpenInquiry(inq) : undefined}
                  className="w-full text-left flex items-start gap-3 py-3 px-2 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                      isUnread ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    <User className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2 mb-0.5">
                      <p
                        className={`text-sm truncate ${
                          isUnread ? 'font-black text-slate-900' : 'font-bold text-slate-700'
                        }`}
                      >
                        {inq.coupleName || '客人'}
                      </p>
                      <p className="text-xs text-slate-400 flex-shrink-0">
                        {relTime(inq.lastMessageAt || inq.createdAt)}
                      </p>
                    </div>
                    <p
                      className={`text-xs truncate ${
                        isUnread ? 'text-slate-700 font-bold' : 'text-slate-500'
                      }`}
                    >
                      {inq.lastMessagePreview || '(無訊息)'}
                    </p>
                  </div>
                  {isUnread && (
                    <span className="bg-rose-500 text-white text-[10px] font-black rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 mt-1 flex-shrink-0">
                      {inq.vendorUnread > 99 ? '99+' : inq.vendorUnread}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {inquiries.length > 4 && (
            <li className="pt-2 text-center">
              <button
                type="button"
                onClick={() => onOpenInquiry ? onOpenInquiry(inquiries[0]) : undefined}
                className="text-xs text-slate-500 hover:text-slate-700 font-bold"
              >
                + 另外 {inquiries.length - 4} 個查詢
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
