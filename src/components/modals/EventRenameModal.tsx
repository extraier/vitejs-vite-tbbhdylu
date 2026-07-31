// EventRenameModal — let users rename one of their wedding events
// from the main lobby (📂 你的婚禮專案 section of EventsDashboard).
//
// 2026-07-31 — Initial release. User request:
//   'I want to add a feature on the main lobby, 你的婚禮專案,
//    i want to enable user can rename and delete the event'
//
// UX choices (decided in the brainstorm):
//   - Single text field, pre-populated with the current name
//   - Submit button disabled when name is empty OR equal to the
//     current name (so the user gets feedback that there's
//     nothing to save) OR when there's a network call in flight
//   - Length cap: 60 chars (matches the create-event field's
//     practical limit; long names break the card layout)
//   - Error mapping for common firestore errors (permission-denied
//     comes up if a co-owner accidentally tries to rename an event
//     they don't own — surfaced as '沒有權限改名')
//
// Props:
//   event       — the event being renamed (need: id, _ownerUid, name)
//   onClose     — close handler (cancel button, X button, backdrop)
//   onSaved     — (newName) => void; called after Firestore write
//                 succeeds so the parent can toast + close the modal
//
// The actual Firestore write is performed here so the modal is
// self-contained; the parent's `onSaved` callback just gets the
// new name back to display a success toast.

import { useEffect, useState } from 'react';
import { X, Pencil, Loader2, AlertCircle } from 'lucide-react';
import { doc, setDoc } from 'firebase/firestore';
import { db, appId } from '../../lib/firebase';

interface EventRenameModalProps {
  event: {
    id: string;
    name: string;
    _ownerUid?: string | null;
  };
  onClose: () => void;
  onSaved?: (newName: string) => void;
}

const MAX_LEN = 60;

function mapError(err: any): string {
  const code = err?.code || '';
  if (code === 'permission-denied') return '沒有權限改名呢個專案。';
  if (code === 'not-found') return '搵唔到呢個專案，可能已經被刪除。';
  if (code === 'unavailable') return '網絡連線失敗，請稍後再試。';
  return '改名失敗，請稍後再試。';
}

export function EventRenameModal({ event, onClose, onSaved }: EventRenameModalProps) {
  const [name, setName] = useState(event.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset to current name when the modal opens / event changes.
  useEffect(() => {
    setName(event.name);
    setError(null);
    setBusy(false);
  }, [event.id, event.name]);

  const trimmed = name.trim();
  const isUnchanged = trimmed === event.name.trim();
  const isEmpty = trimmed.length === 0;
  const isTooLong = trimmed.length > MAX_LEN;
  const canSubmit = !isEmpty && !isUnchanged && !isTooLong && !busy;

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
      // 2026-07-31 — Use setDoc with { merge: true } so we only update
      // the name and don't accidentally clobber other fields like
      // coOwners, budget, or tier. updatedAt lets us sort the
      // events list by recency later if we want to.
      await setDoc(
        ref,
        { name: trimmed, updatedAt: Date.now() },
        { merge: true },
      );
      onSaved?.(trimmed);
      onClose();
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn('[EventRenameModal] setDoc failed:', err?.code, err?.message);
      setError(mapError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 animate-in fade-in duration-200"
      onClick={(e) => {
        // Backdrop click closes — but only if not busy
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="bg-slate-50 px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Pencil className="w-5 h-5 text-slate-700" />
            <h2 className="text-lg font-bold text-slate-800">改名婚禮專案</h2>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="text-slate-400 hover:text-slate-600 p-1 rounded disabled:opacity-40"
            aria-label="關閉"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="p-6">
            <label
              htmlFor="event-rename-input"
              className="block text-sm font-bold text-slate-700 mb-2"
            >
              新名稱
            </label>
            <input
              id="event-rename-input"
              type="text"
              autoFocus
              required
              maxLength={MAX_LEN}
              placeholder="例如: 志明 & 春嬌"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              className="w-full p-3 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-rose-400 text-sm"
              disabled={busy}
            />

            <div className="flex items-center justify-between mt-2">
              <span
                className={`text-xs ${
                  isTooLong ? 'text-rose-600 font-bold' : 'text-slate-400'
                }`}
              >
                {trimmed.length} / {MAX_LEN}
              </span>
              {isUnchanged && !isEmpty && (
                <span className="text-xs text-slate-400">名稱無變更</span>
              )}
            </div>

            {error && (
              <div className="mt-4 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-sm text-rose-700 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Footer */}
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
              className="px-5 py-2 bg-rose-500 text-white text-sm font-bold rounded-lg hover:bg-rose-600 disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  儲存中...
                </>
              ) : (
                '儲存'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}