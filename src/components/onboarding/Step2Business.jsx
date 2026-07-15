// Step2Business.jsx — Name, two-level category picker, description, etc.
//
// Category uses VENDOR_CATEGORIES (hierarchical) from src/lib/config.ts.
// Two-column picker mirrors the user's reference image: top-level
// 類別 on the left, sub-services 供應商服務 on the right.
//
// State machine: tapping a top category highlights it and reveals its
// sub-services. Tapping a sub-service fills both `category` and
// `subcategory`. Tapping a different top category resets the sub.

import { VENDOR_CATEGORIES } from '../../lib/config';

export function Step2Business({ form, update, errors }) {
  const topEntries = Object.entries(VENDOR_CATEGORIES);
  const selectedTop = VENDOR_CATEGORIES[form.category];
  const subEntries = selectedTop ? Object.entries(selectedTop.subs) : [];

  const selectTop = (topKey) => {
    // Reset subcategory when the top changes (unless it's the same one
    // and there's already a valid sub picked — that case is a no-op).
    if (form.category !== topKey) {
      update({ category: topKey, subcategory: '' });
    }
  };

  const selectSub = (subKey) => {
    update({ subcategory: subKey });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          商戶名稱 <span className="text-rose-600">*</span>
        </label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => update({ name: e.target.value })}
          placeholder="例：Visionary Capture 婚紗攝影"
          maxLength={60}
          className={`w-full px-4 py-3 rounded-lg border outline-none ${
            errors.name ? 'border-rose-400 bg-rose-50' : 'border-slate-300'
          }`}
        />
        {errors.name && (
          <div className="text-xs text-rose-600 mt-1">{errors.name}</div>
        )}
        <div className="text-xs text-slate-500 mt-1">
          會顯示在新人搜尋結果同商戶指南。{form.name.length}/60
        </div>
      </div>

      {/* Two-column hierarchical category picker */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          服務分類 <span className="text-rose-600">*</span>
        </label>
        <div className="text-xs text-slate-500 mb-2">
          先揀「類別」，再揀右邊嘅「供應商服務」。
        </div>

        <div className="grid grid-cols-2 gap-2 border border-slate-200 rounded-lg overflow-hidden">
          {/* Left column: top-level categories */}
          <div className="bg-slate-50 max-h-72 overflow-y-auto">
            {topEntries.map(([key, top]) => {
              const isActive = form.category === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => selectTop(key)}
                  className={`w-full text-left px-3 py-2.5 flex items-center gap-2 text-sm transition-colors border-l-4 ${
                    isActive
                      ? 'bg-white border-emerald-500 text-emerald-700 font-bold'
                      : 'border-transparent hover:bg-slate-100 text-slate-700'
                  }`}
                >
                  <span className="text-lg leading-none">{top.icon}</span>
                  <span className="flex-1">{top.label}</span>
                </button>
              );
            })}
          </div>

          {/* Right column: sub-services of the selected top */}
          <div className="bg-white max-h-72 overflow-y-auto">
            {!selectedTop ? (
              <div className="px-3 py-6 text-xs text-slate-400 text-center">
                ← 先揀左邊嘅類別
              </div>
            ) : subEntries.length === 0 ? (
              <div className="px-3 py-6 text-xs text-slate-400 text-center">
                呢個類別未有細項
              </div>
            ) : (
              subEntries.map(([subKey, subLabel]) => {
                const isActive = form.subcategory === subKey;
                return (
                  <button
                    key={subKey}
                    type="button"
                    onClick={() => selectSub(subKey)}
                    className={`w-full text-left px-3 py-2.5 text-sm transition-colors border-l-4 ${
                      isActive
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-700 font-bold'
                        : 'border-transparent hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    {subLabel}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Current selection summary */}
        {selectedTop && form.subcategory && (
          <div className="mt-2 text-xs text-slate-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            ✓ 已選擇：<strong>{selectedTop.label}</strong>
            {' · '}
            {selectedTop.subs[form.subcategory]}
          </div>
        )}

        {errors.category && (
          <div className="text-xs text-rose-600 mt-1">{errors.category}</div>
        )}
        {errors.subcategory && (
          <div className="text-xs text-rose-600 mt-1">{errors.subcategory}</div>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          商戶簡介
        </label>
        <textarea
          value={form.description}
          onChange={(e) => update({ description: e.target.value })}
          rows={4}
          maxLength={500}
          placeholder="例：超過 10 年頂級酒店及教堂拍攝經驗，擅長紀實唯美風格。曾為 200+ 新人服務。"
          className={`w-full px-4 py-3 rounded-lg border outline-none resize-none ${
            errors.description ? 'border-rose-400 bg-rose-50' : 'border-slate-300'
          }`}
        />
        {errors.description && (
          <div className="text-xs text-rose-600 mt-1">{errors.description}</div>
        )}
        <div className="text-xs text-slate-500 mt-1">
          {(form.description || '').length}/500 — 簡短即可，詳細介紹放喺下一個步驟嘅作品集
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            從業年資
          </label>
          <input
            type="number"
            value={form.yearsInBusiness}
            onChange={(e) => update({ yearsInBusiness: e.target.value })}
            min={0}
            max={100}
            className={`w-full px-4 py-3 rounded-lg border outline-none ${
              errors.yearsInBusiness ? 'border-rose-400 bg-rose-50' : 'border-slate-300'
            }`}
          />
          {errors.yearsInBusiness && (
            <div className="text-xs text-rose-600 mt-1">{errors.yearsInBusiness}</div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            服務地區
          </label>
          <input
            type="text"
            value={form.serviceArea}
            onChange={(e) => update({ serviceArea: e.target.value })}
            placeholder="例：香港、九龍、新界"
            maxLength={60}
            className="w-full px-4 py-3 rounded-lg border border-slate-300 outline-none"
          />
        </div>
      </div>
    </div>
  );
}