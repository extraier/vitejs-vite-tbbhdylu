import { useEffect, useState } from 'react';

// The create form does not ask for a date, and 婚禮設定 used to have
// no date field, so new events were stamped 2027-01-01. This editor
// writes only a date the couple picks. Clearing it stores an empty
// string rather than another invented date.

export function EventDateEditor({ date, onSave, onToast }) {
  const stored = date || '';
  const [value, setValue] = useState(stored);
  const [busy, setBusy] = useState(false);
  const dirty = value !== stored;

  useEffect(() => {
    setValue(date || '');
  }, [date]);

  const save = async () => {
    if (!dirty || busy) return;
    setBusy(true);
    try {
      await onSave(value);
      onToast?.('✅ 已儲存預定日期');
    } catch {
      onToast?.('❌ 預定日期儲存失敗，請稍後再試');
    } finally {
      setBusy(false);
    }
  };

  let status = '未設定。請選擇日期，或者留空。';
  if (value && dirty) status = '選擇日期後按儲存';
  else if (!dirty && stored) status = '已儲存';
  else if (!dirty && !stored && value === '') status = '未設定。請選擇日期，或者留空。';

  return (
    <section className="mb-6 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <h3 className="text-sm font-bold text-slate-700 mb-3">預定日期</h3>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <input
          type="date"
          aria-label="預定日期"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="p-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-rose-300"
        />
        <button
          type="button"
          onClick={save}
          disabled={!dirty || busy}
          className="bg-rose-500 text-white text-sm font-bold px-4 py-2 rounded-lg hover:bg-rose-600 disabled:bg-slate-300 disabled:cursor-not-allowed"
        >
          {!dirty && stored ? '已儲存' : '儲存日期'}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-slate-400">{status}</p>
    </section>
  );
}
