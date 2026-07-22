// AddVendorPicker — entry modal for "新增商戶" button on MyVendorsPanel.
//
// 2026-07-21 — Two-path flow:
//   • Pick from existing catalog (677 onboarded vendors we already
//     have data on — fast, just adds the vendor to MyVendors with
//     linkedVendorUid set so chat opens immediately).
//   • Add custom vendor (the existing VendorContactForm flow) for
//     off-platform vendors the couple knows from Instagram / word
//     of mouth.
//
// Shown right after the user taps "+ 新增商戶" on MyVendorsPanel.

import { useState } from 'react';
import { X, Search, UserPlus, Building2 } from 'lucide-react';
import { PickExistingVendor } from './PickExistingVendor';

export function AddVendorPicker({
  onPickExisting,
  onAddCustom,
  onClose,
  // 2026-07-22 — TrendingVendors props forwarded to PickExistingVendor.
  // When set, PickExistingVendor mounts the trending strip at the
  // top of the catalog picker. When unset, the strip is hidden and
  // the modal works in compact dropdown-only browse mode.
  catalog,
  onSelectVendor,
  onGoDiscover,
  user,
  currentEvent,
  onOpenChat,
}) {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
        onClick={onClose}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-3xl max-w-md w-full shadow-2xl animate-in slide-in-from-bottom-4 duration-200"
        >
          {/* Header */}
          <div className="p-5 border-b border-slate-200 flex justify-between items-center">
            <h3 className="font-black text-slate-800 flex items-center gap-2 text-lg">
              <UserPlus className="w-5 h-5 text-rose-500" />
              新增商戶
            </h3>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body: two big path buttons */}
          <div className="p-5 space-y-3">
            <p className="text-sm text-slate-600 leading-relaxed">
              你想加入邊個商戶？
            </p>

            {/* Path A: from catalog */}
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="w-full text-left bg-gradient-to-br from-emerald-50 to-emerald-100 hover:from-emerald-100 hover:to-emerald-200 border-2 border-emerald-200 hover:border-emerald-400 rounded-2xl p-4 transition-all group"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                  <Search className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-black text-slate-800 text-base">
                    🔍 從 Save The Day 商戶目錄搵
                  </div>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    直接連結到已加入平台嘅 677 個商戶。可以即時用平台訊息聯絡。
                  </p>
                  <span className="inline-block mt-2 text-[10px] font-bold bg-emerald-600 text-white px-2 py-0.5 rounded-full">
                    推薦 · 即時可用
                  </span>
                </div>
              </div>
            </button>

            {/* Path B: custom vendor */}
            <button
              type="button"
              onClick={onAddCustom}
              className="w-full text-left bg-gradient-to-br from-amber-50 to-amber-100 hover:from-amber-100 hover:to-amber-200 border-2 border-amber-200 hover:border-amber-400 rounded-2xl p-4 transition-all group"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                  <Building2 className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-black text-slate-800 text-base">
                    ✏️ 自己新增一個商戶
                  </div>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    從 Instagram、朋友介紹搵到嘅商戶，自己輸入資料保存到地址簿。
                  </p>
                  <span className="inline-block mt-2 text-[10px] font-bold bg-amber-600 text-white px-2 py-0.5 rounded-full">
                    平台未有 · 你嘅私人記錄
                  </span>
                </div>
              </div>
            </button>

            {/* Helper text */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mt-4">
              <p className="text-[11px] text-slate-600 leading-relaxed">
                💡 <strong>提示：</strong> 如果商戶之後加入 Save The Day，你用「目錄搵」加入嘅商戶會自動連結，可以即時用平台訊息；自訂商戶需要管理員人手連結。
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Search modal (nested) */}
      {searchOpen && (
        <PickExistingVendor
          catalog={catalog}
          onSelectVendor={onSelectVendor}
          onGoDiscover={onGoDiscover}
          user={user}
          currentEvent={currentEvent}
          onOpenChat={onOpenChat}
          onPick={(vendor) => {
            setSearchOpen(false);
            onPickExisting(vendor);
          }}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </>
  );
}