// 2026-08-09 — VendorPicker
//
// Companion to <HelperPicker/> for assigning a SINGLE vendor to a
// rundown entry or resource item. Couples use it in 大日流程 / 物資
//分配 editors to tag which vendor (e.g. photographer, florist)
// owns that line item — once tagged, the vendor can see the item
// in <VendorDashboard/> and post comments via <ItemComments/>.
//
// Single-vendor (not multi) because most rundown/resource items
// have one owner (e.g. photographer for the photo-session slot).
// Multi-vendor would be a future extension.
//
// Source data: the owner's `inquiries` list (vendors they've
// already started chatting with). Each inquiry doc carries
// { vendorUid, vendorName } — exactly the (uid, name) pair we need
// for the picker's value. Couples without inquiries yet see an
// empty dropdown + the hint to message a vendor first.
//
// Props:
//   vendors    — array of { uid, name, lastMessageAt? } from inquiries
//   value      — { uid, name } | null — currently assigned vendor
//   onChange   — (vendor | null) => void
//
// Why a separate component from HelperPicker:
//   HelperPicker handles an ARRAY of helpers (with uid-keyed dedupe
//   + free-typed names + 新人自己 optgroup). A vendor is a single
//   uid-keyed entity, not an array — different UX (clear button +
//   dropdown instead of pill stack). Reusing HelperPicker would have
//   required a `mode` flag and lots of dead branches.

import { useState } from 'react';

export function VendorPicker({ vendors = [], value, onChange }) {
  const [showCustom, setShowCustom] = useState(false);

  // Sort vendors by name for stable dropdown ordering. Drop
  // entries without a uid — those are vendor-name strings that
  // somehow ended up in inquiries without a real account (shouldn't
  // happen, but defensive).
  const list = [...vendors]
    .filter((v) => v && v.uid)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const handleSelect = (e) => {
    const uid = e.target.value;
    if (!uid) return;
    const v = list.find((x) => x.uid === uid);
    if (v) {
      onChange({ uid: v.uid, name: v.name || '' });
    }
  };

  return (
    <div>
      <label className="text-xs font-bold text-slate-600 mb-1 block">
        負責商戶
      </label>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {value ? (
          <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full border bg-amber-100 text-amber-700 border-amber-200">
            <span>🏪 {value.name}</span>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="leading-none opacity-70 hover:opacity-100"
              aria-label="移除商戶"
            >
              ✕
            </button>
          </span>
        ) : (
          <span className="text-xs text-slate-400">未分配商戶</span>
        )}
      </div>
      <select
        value=""
        onChange={handleSelect}
        disabled={list.length === 0}
        className="w-full p-2 rounded-lg border border-slate-300 text-xs bg-white disabled:bg-slate-50 disabled:text-slate-400"
      >
        {list.length > 0 ? (
          <>
            <option value="">+ 揀選商戶...</option>
            {list.map((v) => (
              <option key={v.uid} value={v.uid}>
                {v.name}
              </option>
            ))}
          </>
        ) : (
          <option value="">未有對話過嘅商戶</option>
        )}
      </select>
      {list.length === 0 && (
        <p className="text-[11px] text-slate-500 mt-1">
          先同商戶對話先可以喺度揀
        </p>
      )}
      {/* 2026-08-09 — free-text fallback for vendors that haven't
          chatted yet. Stored as `assignedVendorName` only (no uid)
          so the firestore rule will reject the comment-author check
          until the vendor actually signs up. Couples can type a
          placeholder name and replace it later. */}
      <button
        type="button"
        onClick={() => setShowCustom(!showCustom)}
        className="text-[11px] text-slate-500 hover:text-slate-700 mt-1.5"
      >
        {showCustom ? '－ 收起自訂名' : '＋ 自訂商戶名'}
      </button>
      {showCustom && (
        <input
          type="text"
          placeholder="商戶名稱"
          value={value?.name || ''}
          onChange={(e) => {
            // If the user types into the custom field while there's
            // a real vendor selected, treat that as a custom
            // placeholder (no uid) so the rule can still gate.
            const typed = e.target.value;
            if (!value || value.uid) {
              onChange({ uid: null, name: typed });
            } else {
              onChange({ uid: null, name: typed });
            }
          }}
          className="w-full mt-1.5 p-2 rounded-lg border border-slate-300 text-xs bg-white"
        />
      )}
    </div>
  );
}