// VendorProfileEdit.jsx — vendor's own profile manager.
//
// 2026-07-15 — rebuilt so the form actually edits name, description,
// category, service area, years in business, tags, pricing, AND the
// portfolio images. Previously name/description/tags were read-only
// stubs and the save handler wrote to the wrong path
// (artifacts/{appId}/vendors instead of /vendors/{uid}).
//
// Now reads / writes live Firestore at /vendors/{user.uid} via the
// updateMyVendorProfile Cloud Function (which has a strict allow-list
// of editable fields and a vendor claim requirement).
//
// Routing: shown when currentView === 'vendor-profile'. Reachable
// from VendorDashboard via the "管理專頁" CTA in the top-right corner.

import { useEffect, useState } from 'react';
import {
  Briefcase,
  Info,
  Save,
  DollarSign,
  AlertCircle,
  Tag,
  X,
  CheckCircle2,
  ArrowLeft,
  Image as ImageIcon,
} from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import {
  formatVendorPrice,
  formatMoney,
  parseFormattedNumber,
} from '../lib/format';
import { TASK_CATEGORIES, VENDOR_CATEGORIES, getVendorCategoryLabel } from '../lib/config';
import { PortfolioEditor } from '../components/PortfolioEditor';

const MAX_TAGS = 10;

export function VendorProfileEdit({ vendor, user, onBack, onSaved }) {
  // Local form state. Initialised from the live vendor doc, then
  // mutated freely without re-fetching.
  const [name, setName] = useState(vendor?.name || '');
  const [description, setDescription] = useState(vendor?.description || '');
  const [category, setCategory] = useState(vendor?.category || '');
  const [subcategory, setSubcategory] = useState(vendor?.subcategory || '');
  const [serviceArea, setServiceArea] = useState(vendor?.serviceArea || '香港');
  const [yearsInBusiness, setYearsInBusiness] = useState(
    vendor?.yearsInBusiness ?? 0,
  );
  const [portfolio, setPortfolio] = useState(
    Array.isArray(vendor?.portfolio) ? vendor.portfolio : [],
  );
  const [tags, setTags] = useState(Array.isArray(vendor?.tags) ? vendor.tags : []);
  const [tagInput, setTagInput] = useState('');
  const [priceMin, setPriceMin] = useState(formatMoney(vendor?.priceMin ?? 0));
  const [priceMax, setPriceMax] = useState(
    vendor?.priceMax === null || vendor?.priceMax === undefined
      ? ''
      : formatMoney(vendor.priceMax),
  );
  const [isOpenEnded, setIsOpenEnded] = useState(vendor?.priceMax === null);
  const [currency, setCurrency] = useState(vendor?.currency || 'HKD');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [error, setError] = useState(null);

  // Re-hydrate the form if the live vendor doc changes (e.g. uploaded
  // a new photo and the snapshot fires). Only re-fill empty fields
  // so we don't blow away in-progress edits.
  useEffect(() => {
    if (!vendor) return;
    setName((prev) => prev || vendor.name || '');
    setDescription((prev) => prev || vendor.description || '');
    setCategory((prev) => prev || vendor.category || '');
    setSubcategory((prev) => prev || vendor.subcategory || '');
    setServiceArea((prev) => prev || vendor.serviceArea || '香港');
  }, [vendor]);

  const livePreview = {
    priceMin: parseFormattedNumber(priceMin),
    priceMax: isOpenEnded ? null : parseFormattedNumber(priceMax),
    currency,
  };

  const handleAddTag = () => {
    const t = tagInput.trim();
    if (!t) return;
    if (tags.includes(t)) {
      setTagInput('');
      return;
    }
    if (tags.length >= MAX_TAGS) {
      setError(`最多 ${MAX_TAGS} 個標籤`);
      return;
    }
    setTags([...tags, t]);
    setTagInput('');
  };

  const handleRemoveTag = (idx) => {
    setTags(tags.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    setError(null);
    setSavedAt(null);

    // Client-side validation — keep server validation in mind but
    // catch obvious errors here for fast feedback.
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      setError('商戶名稱至少要有 2 個字');
      return;
    }
    if (trimmedName.length > 60) {
      setError('商戶名稱最多 60 個字');
      return;
    }
    if (!category) {
      setError('請選擇分類');
      return;
    }
    if (category && !subcategory) {
      setError('請選擇子分類');
      return;
    }
    const min = parseFormattedNumber(priceMin);
    if (min === null || Number.isNaN(min) || min < 0) {
      setError('請輸入有效嘅起步價');
      return;
    }
    let max = null;
    if (!isOpenEnded) {
      max = parseFormattedNumber(priceMax);
      if (max === null || Number.isNaN(max)) {
        setError('請輸入有效嘅最高價，或剔選「無上限」');
        return;
      }
      if (max < min) {
        setError('最高價不能低於起步價');
        return;
      }
    }
    if (portfolio.length > 24) {
      setError('作品集最多 24 張圖片');
      return;
    }

    setSaving(true);
    try {
      // updateMyVendorProfile (functions/src/vendors.ts) is a callable
      // that requires the `vendor` custom claim and writes through an
      // allow-list of fields. We pass EVERYTHING editable so the user
      // gets atomic save semantics.
      const fn = httpsCallable(functions, 'updateMyVendorProfile');
      await fn({
        updates: {
          name: trimmedName,
          description: description.trim(),
          category,
          subcategory,
          serviceArea: serviceArea.trim() || '香港',
          yearsInBusiness: Number(yearsInBusiness) || 0,
          portfolio,
          tags: tags.slice(0, MAX_TAGS),
          priceMin: min,
          priceMax: max,
          currency,
          openEnded: Boolean(isOpenEnded),
        },
      });
      setSavedAt(Date.now());
      if (typeof onSaved === 'function') onSaved();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[VendorProfileEdit] save failed:', e);
      setError(`${e?.code ? `[${e.code}] ` : ''}${e?.message || '儲存失敗'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto mt-8 mb-16 animate-in slide-in-from-bottom-4 duration-500">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="bg-emerald-900 p-8 text-white">
          <div className="flex items-center gap-3 mb-2">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="text-emerald-100 hover:text-white inline-flex items-center gap-1 text-sm"
              >
                <ArrowLeft className="w-4 h-4" />
                返回接單大堂
              </button>
            )}
          </div>
          <h2 className="text-2xl font-bold flex items-center gap-3">
            <Briefcase className="w-7 h-7 text-emerald-400" /> 商戶專頁管理 (Profile Builder)
          </h2>
          <p className="text-emerald-100 mt-2 text-sm">
            完善你的專頁資料及上載最新作品。價格範圍會直接影響 AI 智能配對嘅結果。
          </p>
        </div>

        <div className="p-8 space-y-8">
          {/* ----- Basic info ----- */}
          <section>
            <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
              <Info className="w-5 h-5 text-emerald-600" /> 基本資料
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">
                  商戶名稱 <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  maxLength={60}
                  className="w-full p-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-300 outline-none"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例：Visionary Capture 婚紗攝影"
                />
                <div className="text-xs text-slate-400 mt-1 text-right">
                  {name.length}/60
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">
                  服務分類 <span className="text-rose-600">*</span>
                </label>
                {/* Two-column hierarchical picker — same UX as Step2Business in the
                    wizard, so the post-onboarding edit flow stays consistent. */}
                <div className="grid grid-cols-2 gap-2 border border-slate-200 rounded-xl overflow-hidden">
                  {/* Left: top-level categories */}
                  <div className="bg-slate-50 max-h-64 overflow-y-auto">
                    {Object.entries(VENDOR_CATEGORIES).map(([key, top]) => {
                      const isActive = category === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => {
                            if (category !== key) {
                              setCategory(key);
                              setSubcategory('');
                            }
                          }}
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

                  {/* Right: sub-services of the selected top */}
                  <div className="bg-white max-h-64 overflow-y-auto">
                    {!VENDOR_CATEGORIES[category] ? (
                      <div className="px-3 py-6 text-xs text-slate-400 text-center">
                        ← 先揀左邊嘅類別
                      </div>
                    ) : Object.entries(VENDOR_CATEGORIES[category].subs).length === 0 ? (
                      <div className="px-3 py-6 text-xs text-slate-400 text-center">
                        呢個類別未有細項
                      </div>
                    ) : (
                      Object.entries(VENDOR_CATEGORIES[category].subs).map(([subKey, subLabel]) => {
                        const isActive = subcategory === subKey;
                        return (
                          <button
                            key={subKey}
                            type="button"
                            onClick={() => setSubcategory(subKey)}
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
                {category && subcategory && (
                  <div className="mt-2 text-xs text-slate-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                    ✓ 已選擇：<strong>{getVendorCategoryLabel(category, subcategory)}</strong>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">
                  服務地區
                </label>
                <input
                  type="text"
                  className="w-full p-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-300 outline-none"
                  value={serviceArea}
                  onChange={(e) => setServiceArea(e.target.value)}
                  placeholder="例：香港 / 九龍 / 新界"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">
                  經營年資
                </label>
                <input
                  type="number"
                  min={0}
                  max={99}
                  className="w-full p-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-300 outline-none"
                  value={yearsInBusiness}
                  onChange={(e) => setYearsInBusiness(e.target.value)}
                />
                <div className="text-xs text-slate-400 mt-1">年</div>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-bold text-slate-700 mb-1">
                  商戶簡介
                </label>
                <textarea
                  rows={4}
                  maxLength={500}
                  className="w-full p-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-300 outline-none resize-none"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="介紹你嘅服務風格、過往作品、服務範圍..."
                />
                <div className="text-xs text-slate-400 mt-1 text-right">
                  {description.length}/500
                </div>
              </div>
            </div>
          </section>

          {/* ----- Tags ----- */}
          <section>
            <h3 className="text-lg font-bold text-slate-800 mb-2 flex items-center gap-2">
              <Tag className="w-5 h-5 text-emerald-600" /> 標籤
            </h3>
            <p className="text-sm text-slate-500 mb-3">
              加入風格、地點、特色等關鍵字，方便新人搜尋到你。
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                placeholder="例：伯大尼、自然唯美"
                className="flex-1 p-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-300 outline-none"
                disabled={tags.length >= MAX_TAGS}
              />
              <button
                type="button"
                onClick={handleAddTag}
                disabled={tags.length >= MAX_TAGS || !tagInput.trim()}
                className="px-4 py-3 rounded-xl bg-slate-800 text-white font-bold hover:bg-slate-700 disabled:opacity-50"
              >
                加入
              </button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {tags.map((t, idx) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-full px-3 py-1 text-sm"
                  >
                    #{t}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(idx)}
                      className="text-emerald-600 hover:text-rose-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="text-xs text-slate-400 mt-1">
              {tags.length}/{MAX_TAGS} 個標籤
            </div>
          </section>

          {/* ----- Portfolio ----- */}
          <section>
            <h3 className="text-lg font-bold text-slate-800 mb-2 flex items-center gap-2">
              <ImageIcon className="w-5 h-5 text-emerald-600" /> 作品集圖片
            </h3>
            <p className="text-sm text-slate-500 mb-3">
              上傳作品相片。建議 6-12 張展示最佳風格。最多 24 張。
            </p>
            <PortfolioEditor
              value={portfolio}
              onChange={setPortfolio}
              user={user}
            />
          </section>

          {/* ----- Pricing ----- */}
          <section>
            <h3 className="text-lg font-bold text-slate-800 mb-2 flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-emerald-600" /> 價格範圍
              <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                AI 配對必填
              </span>
            </h3>
            <p className="text-sm text-slate-500 mb-4">
              設定你提供服務嘅價格範圍。新人嘅 AI 智能配對會優先推薦範圍內含佢哋預算嘅商戶。
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">貨幣</label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full p-3 rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-emerald-300 outline-none"
                >
                  <option value="HKD">HKD (港幣)</option>
                  <option value="USD">USD (美元)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">起步價</label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="8,000"
                  className="w-full p-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-300 outline-none"
                  value={priceMin}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/[^0-9]/g, '');
                    setPriceMin(digits ? Number(digits).toLocaleString('en-US') : '');
                  }}
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">
                  最高價{' '}
                  <label className="inline-flex items-center gap-1 text-xs font-normal text-slate-500 cursor-pointer ml-1">
                    <input
                      type="checkbox"
                      checked={isOpenEnded}
                      onChange={(e) => setIsOpenEnded(e.target.checked)}
                      className="rounded"
                    />
                    無上限
                  </label>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder={isOpenEnded ? '∞' : '18,000'}
                  disabled={isOpenEnded}
                  className="w-full p-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-300 outline-none disabled:bg-slate-100 disabled:text-slate-400"
                  value={priceMax}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/[^0-9]/g, '');
                    setPriceMax(digits ? Number(digits).toLocaleString('en-US') : '');
                  }}
                />
              </div>
            </div>

            <div className="mt-4 bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3">
              <DollarSign className="w-5 h-5 text-emerald-600 flex-shrink-0" />
              <div className="text-sm">
                <span className="text-slate-500 mr-2">客人睇到：</span>
                <span className="font-bold text-emerald-800">
                  {formatVendorPrice(livePreview)}
                </span>
              </div>
            </div>
          </section>

          {/* ----- Feedback ----- */}
          {error && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex items-start gap-2 text-sm text-rose-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                {error}
              </div>
            </div>
          )}
          {savedAt && !error && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 className="w-4 h-4" />
              已儲存成功
            </div>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="w-full bg-emerald-600 text-white font-bold py-3.5 rounded-xl hover:bg-emerald-700 transition-colors shadow-sm flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Save className="w-4 h-4" />
            {saving ? '儲存中…' : '儲存專頁設定'}
          </button>
        </div>
      </div>
    </div>
  );
}