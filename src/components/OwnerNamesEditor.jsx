// 2026-08-01 — OwnerNamesEditor.
//
// Lets the user set their own 新郎 / 新娘 display names. These
// names are USER-scoped (not event-scoped): a wedding planner
// who runs 50 weddings should not have to re-enter their own
// name 50 times. The names then propagate to the 大日流程
// HelperPicker so the couple can be assigned to rundown
// entries alongside the invited 兄弟姊妹.
//
// Storage: writes to /artifacts/{appId}/users/{uid} via
// useUserProfile.saveOwnerNames, which uses setDoc(merge:true).
// No migration needed — empty / missing fields are valid.
//
// UX:
//   - Two text inputs side-by-side (新郎 / 新娘)
//   - 儲存 button disabled when both empty or when nothing changed
//   - Each input has a small "✕" clear button (aria-label=清除新郎/新娘)
//   - On save, fires onSave({boyName, girlName}); on success shows
//     a success toast, on failure shows an error toast
//   - The "未設定" placeholder reminds users they can leave the
//     field blank — e.g. a same-sex couple only needs one name

import { useEffect, useState } from 'react';
import { Save, X as ClearIcon, Loader2 } from 'lucide-react';

const MAX_LEN = 30;

export function OwnerNamesEditor({ ownerNames, onSave, onToast }) {
  const [boyName, setBoyName] = useState(ownerNames?.boyName || '');
  const [girlName, setGirlName] = useState(ownerNames?.girlName || '');
  const [busy, setBusy] = useState(false);

  // Reset when the parent re-loads the doc (e.g. after a Cloud
  // Function rewrites the user doc). Without this the form would
  // keep the user's in-progress edits even after a successful save
  // bubbles back from the server.
  useEffect(() => {
    setBoyName(ownerNames?.boyName || '');
    setGirlName(ownerNames?.girlName || '');
  }, [ownerNames?.boyName, ownerNames?.girlName]);

  const boyTrim = boyName.trim();
  const girlTrim = girlName.trim();
  const boyUnchanged = boyTrim === (ownerNames?.boyName || '').trim();
  const girlUnchanged = girlTrim === (ownerNames?.girlName || '').trim();
  const boyTooLong = boyTrim.length > MAX_LEN;
  const girlTooLong = girlTrim.length > MAX_LEN;
  const bothEmpty = boyTrim.length === 0 && girlTrim.length === 0;
  // 2026-08-01 — Save is enabled when AT LEAST ONE field changed AND
  // the remaining constraints hold. Couples with one partner usually
  // only edit the relevant name; the other field is preserved as-is.
  const anyChanged = !boyUnchanged || !girlUnchanged;
  const canSave =
    !busy && anyChanged && !bothEmpty && !boyTooLong && !girlTooLong;

  const handleSave = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      await onSave({ boyName: boyTrim, girlName: girlTrim });
      onToast?.('✅ 已儲存你嘅名。');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[OwnerNamesEditor] save failed:', err?.code || err?.message);
      onToast?.('❌ 儲存失敗，請稍後再試。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-bold text-slate-700">新人名稱</h2>
        <p className="text-[11px] text-slate-400">用於 大日流程 嘅指派</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <OwnerInput
          label="新郎"
          value={boyName}
          onChange={setBoyName}
          onClear={() => setBoyName('')}
          tooLong={boyTooLong}
          maxLen={MAX_LEN}
        />
        <OwnerInput
          label="新娘"
          value={girlName}
          onChange={setGirlName}
          onClear={() => setGirlName('')}
          tooLong={girlTooLong}
          maxLen={MAX_LEN}
        />
      </div>
      <div className="mt-4 flex items-center justify-between">
        <p className="text-[11px] text-slate-400">
          {bothEmpty ? '請至少填寫其中一個名' : '儲存後可以喺大日流程指派俾自己'}
        </p>
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          className="flex items-center gap-1.5 bg-rose-500 text-white text-sm font-bold px-4 py-2 rounded-lg hover:bg-rose-600 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          儲存
        </button>
      </div>
    </div>
  );
}

function OwnerInput({ label, value, onChange, onClear, tooLong, maxLen }) {
  return (
    <div>
      <label
        htmlFor={`owner-name-${label}`}
        className="block text-xs font-bold text-slate-600 mb-1"
      >
        {label}
      </label>
      <div className="relative">
        <input
          id={`owner-name-${label}`}
          type="text"
          value={value}
          maxLength={maxLen}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`${label}名 (未設定)`}
          aria-label={label}
          className={`w-full p-2.5 pr-9 rounded-lg border text-sm outline-none focus:ring-2 ${
            tooLong
              ? 'border-rose-400 focus:ring-rose-300'
              : 'border-slate-300 focus:ring-rose-300'
          }`}
        />
        {value.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            aria-label={`清除${label}`}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100"
          >
            <ClearIcon className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {tooLong && (
        <p className="mt-1 text-[10px] text-rose-600">名稱太長 (上限 {maxLen} 字)</p>
      )}
    </div>
  );
}
