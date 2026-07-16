// ChatRoom — single conversation view between a couple and a vendor.
//
// 2026-07-15 — new screen. Lists messages from /vendorInquiries/{id}/
// messages subcollection (real-time via onSnapshot), with a text
// input at the bottom. Sender bubbles on the right, recipient on
// the left. Auto-scrolls to the newest message on send / receive.
//
// Props:
//   - inquiry: { id, vendorUid, coupleUid, vendorName, coupleName,
//                coupleUnread, vendorUnread, ... }
//   - userUid: current user's uid (used to detect own messages)
//   - userRole: 'couple' | 'vendor' (current user's role)
//   - onBack: callback to return to inbox
//
// The parent (App.jsx) handles markInquiryRead on mount so the
// unread badge clears as soon as the user opens the chat.

import { useEffect, useRef, useState } from 'react';
import { Send, ArrowLeft, User } from 'lucide-react';
import { subscribeToMessages, sendMessage } from '../lib/chat';

export function ChatRoom({ inquiry, userUid, userRole, onBack }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  // Live messages
  useEffect(() => {
    if (!inquiry?.id) return undefined;
    const unsub = subscribeToMessages(inquiry.id, setMessages);
    return unsub;
  }, [inquiry?.id]);

  // Auto-scroll to bottom whenever messages update
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const otherName = userRole === 'couple'
    ? inquiry?.vendorName || '商戶'
    : inquiry?.coupleName || '新人';

  async function handleSend(e) {
    e?.preventDefault?.();
    if (!draft.trim() || sending || !inquiry?.id) return;
    setSending(true);
    try {
      await sendMessage({
        inquiryId: inquiry.id,
        senderUid: userUid,
        senderRole: userRole,
        text: draft,
      });
      setDraft('');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('sendMessage failed:', err);
    } finally {
      setSending(false);
    }
  }

  function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return d.toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleString('zh-HK', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return (
    <div className="max-w-2xl mx-auto mt-6 px-2 animate-in fade-in duration-300 flex flex-col" style={{ height: 'calc(100vh - 180px)' }}>
      {/* Header bar */}
      <div className="bg-white rounded-t-2xl border border-slate-200 border-b-0 px-4 py-3 flex items-center gap-3 shadow-sm">
        <button
          onClick={onBack}
          className="text-slate-500 hover:text-slate-700 p-1"
          title="返回"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-rose-400 to-rose-600 flex items-center justify-center text-white flex-shrink-0">
          <User className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-black text-slate-800 truncate">
            {otherName}
          </div>
          <div className="text-xs text-slate-500">
            {userRole === 'couple' ? '商戶' : '新人'}
          </div>
        </div>
      </div>

      {/* Messages area */}
      <div
        ref={scrollRef}
        className="flex-1 bg-slate-50 border-x border-slate-200 overflow-y-auto p-4 space-y-3"
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm gap-2 py-12">
            <div className="text-4xl">👋</div>
            <div>開始對話吧！問吓對方問題、查吓詳情。</div>
          </div>
        ) : (
          messages.map((m) => {
            const own = m.senderUid === userUid;
            return (
              <div
                key={m.id}
                className={`flex ${own ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-2 ${
                    own
                      ? 'bg-rose-500 text-white rounded-br-sm'
                      : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm'
                  }`}
                >
                  <div className="text-sm whitespace-pre-wrap break-words">
                    {m.text}
                  </div>
                  <div
                    className={`text-[10px] mt-1 ${
                      own ? 'text-rose-100' : 'text-slate-400'
                    }`}
                  >
                    {formatTime(m.createdAt)}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Composer */}
      <form
        onSubmit={handleSend}
        className="bg-white rounded-b-2xl border border-slate-200 border-t-0 p-3 flex items-end gap-2 shadow-sm"
      >
        <textarea
          rows={1}
          placeholder="輸入訊息..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          className="flex-1 resize-none p-2 border border-slate-200 rounded-xl text-sm outline-none focus:border-rose-400 max-h-32"
        />
        <button
          type="submit"
          disabled={!draft.trim() || sending}
          className="bg-rose-500 text-white p-3 rounded-xl hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
          title="發送"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}