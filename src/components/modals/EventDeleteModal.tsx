// EventDeleteModal — destructive confirmation for deleting a wedding
// event from the main lobby (📂 你的婚禮專案 section of
// EventsDashboard).
//
// 2026-07-31 — Initial release. User request:
//   'before delete the event, ask user to type DELETE to confirm
//    the action'
//
// UX pattern: type-to-confirm (similar to GitHub / Vercel / AWS
// console destructive flows). The literal string `DELETE` (English,
// all caps, no spaces) is the global destructive-confirm convention;
// it's familiar to anyone who's ever deleted a production resource.
//
// Why this matters for a wedding product:
//   - A wedding event is the root of EVERYTHING (guests, tasks,
//     photos, vendors, budget). A wrong click takes a year of
//     planning with it.
//   - Co-owners see each other's events (events list merges own +
//     co-owned). A destructive action must be impossible to trigger
//     by accident.
//   - On mobile, a single thumb-tap on "Delete" in a popover is
//     far too easy; the explicit-typing gate is the right level
//     of friction.
//
// What's deleted:
//   - The event document itself at /users/{ownerUid}/events/{id}.
//   - The real-time `useFirestoreCollection` hook picks up the
//     removal and the UI updates immediately.
//
// What's NOT deleted (out of scope for this iteration):
//   - Subcollection data under the event (tasks, guests, photos,
//     vendors). Firestore's `recursiveDelete` from
//     'firebase/firestore' handles this on the client side, but
//     it's slow and runs on a single document-path query. A
//     Cloud Function triggered on event deletion is the right
//     long-term path — TBD with the user.
//
// Props:
//   event      — { id, name, _ownerUid }
//   onClose    — close handler
//   onDeleted  — () => void; called after Firestore write succeeds
//
// The actual Firestore write is performed here; parent's
// `onDeleted` callback lets it clear local state and toast.

import { useEffect, useState } from 'react';
import { X, Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { doc, deleteDoc } from 'firebase/firestore';
import { db, appId } from '../../lib/firebase';

interface EventDeleteModalProps {
  event: {
    id: string;
    name: string;
    _ownerUid?: string | null;
  };
  onClose: () => void;
  onDeleted?: () => void;
}

const CONFIRM_WORD = 'DELETE';

function mapError(err: any): string {
  const code = err?.code || '';
  if (code === 'permission-denied') return '沒有權限刪除呢個專案。';
  if (code === 'not-found') return '搵唔到呢個專案，可能已經被刪除。';
  if (code === 'unavailable') return '網絡連線失敗，請稍後再試。';
  return '刪除失敗，請稍後再試。';
}

export function EventDeleteModal({ event, onClose, onDeleted }: EventDeleteModalProps) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset every time the modal opens / event changes.
  useEffect(() => {
    setInput('');
    setError(null);
    setBusy(false);
  }, [event.id]);

  // 2026-07-31 — exact-match gate. Case-sensitive on purpose so
  // users actually have to type the word (not paste `delete `
  // with a trailing space).
  const matches = input === CONFIRM_WORD;
  const canSubmit = matches && !busy;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const ownerUid = event._ownerUid;
    if (!ownerUid) {
      setError('搵唔到呢個專案的擁有者，請重新整理後再試。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ref = doc(db, 'artifacts', appId, 'users', ownerUid, 'events', event.id);
      await deleteDoc(ref);
      onDeleted?.();
      onClose();
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn('[EventDeleteModal] deleteDoc failed:', err?.code, err?.message);
      setError(mapError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header — red to signal destructive action */}
        <div className="bg-rose-50 px-6 py-4 border-b border-rose-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-rose-600" />
            <h2 className="text-lg font-bold text-rose-700">刪除婚禮專案</h2>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="text-rose-400 hover:text-rose-600 p-1 rounded disabled:opacity-40"
            aria-label="關閉"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="p-6">
            {/* Warning block — show what's about to happen */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800 leading-relaxed">
                <div className="font-bold mb-1">呢個動作無法復原。</div>
                婚禮專案「
                <span className="font-bold">{event.name}</span>
                」刪除後，列表會即時更新。
              </div>
            </div>

            <label
              htmlFor="event-delete-confirm"
              className="block text-sm font-bold text-slate-700 mb-2"
            >
              請輸入 <span className="font-mono text-rose-600">DELETE</span> 以確認刪除
            </label>
            <input
              id="event-delete-confirm"
              type="text"
              autoFocus
              required
              autoComplete="off"
              spellCheck={false}
              placeholder="DELETE"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                if (error) setError(null);
              }}
              className="w-full p-3 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-rose-400 font-mono text-sm tracking-widest"
              disabled={busy}
            />

            {/* Live confirmation indicator — gives feedback the user
                has typed the right thing without making them submit
                just to find out. */}
            {input.length > 0 && !matches && (
              <div className="mt-2 text-xs text-slate-500">
                大小寫需完全一致
              </div>
            )}
            {matches && (
              <div className="mt-2 text-xs text-rose-600 font-bold">
                ✓ 已確認，請按「確認刪除」執行
              </div>
            )}

            {error && (
              <div className="mt-4 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-sm text-rose-700">
                {error}
              </div>
            )}
          </div>

          {/* Footer — destructive button is disabled until typed */}
          <div className="bg-slate-50 px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-4 py-2 text-sm font-bold text-slate-600 hover:text-slate-800 disabled:opacity-40"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="px-5 py-2 bg-rose-600 text-white text-sm font-bold rounded-lg hover:bg-rose-700 disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  刪除中...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4" />
                  確認刪除
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}