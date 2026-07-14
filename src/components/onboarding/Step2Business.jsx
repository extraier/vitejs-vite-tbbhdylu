// Step2Business.jsx — Name, category, description, years, service area.
//
// Category dropdown reuses TASK_CATEGORIES from src/lib/config.ts — same
// 23 categories the couples use on their checklist. Keeps a single source
// of truth so vendor categories and couple checklist always match.

import { TASK_CATEGORIES } from '../../lib/config';

export function Step2Business({ form, update, errors }) {
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

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          服務分類 <span className="text-rose-600">*</span>
        </label>
        <select
          value={form.category}
          onChange={(e) => update({ category: e.target.value })}
          className={`w-full px-4 py-3 rounded-lg border outline-none bg-white ${
            errors.category ? 'border-rose-400 bg-rose-50' : 'border-slate-300'
          }`}
        >
          <option value="">請選擇…</option>
          {Object.entries(TASK_CATEGORIES).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        {errors.category && (
          <div className="text-xs text-rose-600 mt-1">{errors.category}</div>
        )}
        <div className="text-xs text-slate-500 mt-1">
          揀最接近你主力服務嘅分類。新人會用呢個分類搜尋你。
        </div>
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