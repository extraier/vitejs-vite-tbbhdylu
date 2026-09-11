// 2026-09-11 — P12.3 vendor delay-report Modal.
//
// Lightweight Modal opened from <VendorDashboard/> when the
// vendor clicks 報告延誤 on an assigned rundown snapshot row.
// Holds the delayMinutes input + note textarea locally;
// submission delegates to the parent's onSubmit, which calls
// the reportVendorDelay callable (see src/lib/vendorDelayReport.js).
//
// Why a separate component?
//   * Keeps the VendorDashboard itself presentation-only
//     (the task brief is explicit about this — dashboard does
//     NOT call httpsCallable directly).
//   * The Modal state (input values) is local to this
//     component so re-opening the Modal starts from a clean
//     form, even when previous submissions failed.
//   * Easier to test in isolation — the test suite only needs
//     to render this component, not the whole App.

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

export function VendorDelayReportModal({
  initial = 0,
  onCancel,
  onSubmit,
}) {
  const [delayMinutes, setDelayMinutes] = useState(
    typeof initial === 'number' ? String(initial) : '0',
  );
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // Reset state whenever the Modal is freshly mounted. The
  // parent unmounts us via the `delayReportModal && (...)`
  // gating in App.jsx, so a "fresh mount" corresponds to a
  // fresh open.
  useEffect(() => {
    setDelayMinutes(typeof initial === 'number' ? String(initial) : '0');
    setNote('');
    setBusy(false);
  }, [initial]);

  const handleSubmit = async (e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (busy) return;
    const minutes = Number.parseInt(delayMinutes, 10);
    if (!Number.isFinite(minutes) || minutes < 0) {
      return; // basic client-side guard; server is the gate.
    }
    setBusy(true);
    try {
      if (typeof onSubmit === 'function') {
        await onSubmit({ delayMinutes: minutes, note: note.trim() || null });
      }
    } finally {
      // Parent decides whether to close (success) or keep open
      // (failure + toast). We reset busy here for both paths.
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="vendor-delay-report-title"
      data-testid="vendor-delay-report-modal"
    >
      <form
        className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="flex items-center justify-between mb-4">
          <h3
            id="vendor-delay-report-title"
            className="text-lg font-black text-slate-800"
          >
            提交延誤報告
          </h3>
          <button
            type="button"
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-600"
            aria-label="關閉"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-slate-600 mb-4">
          通知新人你嘅工作將會延遲幾多分鐘，佢哋會收到確認請求。
        </p>
        <label className="block mb-3">
          <span className="text-xs font-bold text-slate-700">
            延遲分鐘數
          </span>
          <input
            type="number"
            min="0"
            step="5"
            value={delayMinutes}
            onChange={(e) => setDelayMinutes(e.target.value)}
            data-testid="vendor-delay-report-minutes"
            className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#14B8A6]"
            disabled={busy}
          />
        </label>
        <label className="block mb-4">
          <span className="text-xs font-bold text-slate-700">
            備註 (可選)
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            data-testid="vendor-delay-report-note"
            placeholder="例：交通擠塞 / 場地設備延遲"
            className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#14B8A6]"
            disabled={busy}
          />
        </label>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={busy}
            data-testid="vendor-delay-report-submit"
            className="px-4 py-2 rounded-lg text-sm font-bold bg-[#0F766E] text-white hover:bg-[#14B8A6] disabled:opacity-50"
          >
            {busy ? '提交中…' : '提交延誤報告'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default VendorDelayReportModal;
