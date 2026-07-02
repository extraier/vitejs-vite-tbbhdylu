import { useState } from 'react';
import { Briefcase, Info, Save, DollarSign, AlertCircle } from 'lucide-react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, appId } from '../lib/firebase';
import { formatVendorPrice, formatMoney, parseFormattedNumber } from '../lib/format';

/**
 * Vendor self-edit screen.
 *
 * Editable: budget (priceMin, priceMax, currency) — the fields the AI
 * matching engine uses to rank vendors against couple task budgets.
 *
 * Read-only: name, description, tags, portfolio (managed elsewhere — full
 * vendor onboarding form is a future chunk of work).
 *
 * Save handler currently toasts only (no Firestore vendor collection exists
 * yet — vendors are loaded from `DEFAULT_VENDORS` constants). When the
 * vendor onboarding flow is built, the save call lands here.
 */
export function VendorProfileEdit({ vendor, onSave }) {
  const [priceMin, setPriceMin] = useState(
    formatMoney(vendor.priceMin ?? 0),
  );
  const [priceMax, setPriceMax] = useState(
    vendor.priceMax === null || vendor.priceMax === undefined
      ? ''
      : formatMoney(vendor.priceMax),
  );
  const [isOpenEnded, setIsOpenEnded] = useState(vendor.priceMax === null);
  const [currency, setCurrency] = useState(vendor.currency || 'HKD');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Build the live preview vendor object so the "現時顯示" line reflects
  // the form state, not the stale prop.
  const livePreview = {
    priceMin: parseFormattedNumber(priceMin),
    priceMax: isOpenEnded ? null : parseFormattedNumber(priceMax),
    currency,
  };

  const handleSave = async () => {
    setError(null);
    const min = parseFormattedNumber(priceMin);
    if (!min && min !== 0) {
      setError('請輸入起步價');
      return;
    }
    let max = null;
    if (!isOpenEnded) {
      max = parseFormattedNumber(priceMax);
      if (!max) {
        setError('請輸入最高價，或剔選「無上限」');
        return;
      }
      if (max < min) {
        setError('最高價不能低於起步價');
        return;
      }
    }
    setSaving(true);
    try {
      if (onSave) {
        await onSave({ priceMin: min, priceMax: max, currency });
        return;
      }
      // Default behaviour: persist directly to Firestore under the vendor's
      // own document id (`vendor.id` from the prop). The setDoc call merges
      // into the existing doc rather than overwriting the whole record, so
      // name/description/tags/portfolio (managed elsewhere) are preserved.
      await setDoc(
        doc(db, 'artifacts', appId, 'vendors', String(vendor.id)),
        {
          priceMin: min,
          priceMax: max,
          currency,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    } catch (e) {
      setError(e?.message || '儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto mt-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="bg-emerald-900 p-8 text-white">
          <h2 className="text-2xl font-bold flex items-center gap-3">
            <Briefcase className="w-7 h-7 text-emerald-400" /> 商戶專頁管理 (Profile Builder)
          </h2>
          <p className="text-emerald-100 mt-2 text-sm">
            完善你的專頁資料及上載最新作品。價格範圍會直接影響 AI 智能配對嘅結果。
          </p>
        </div>

        <div className="p-8 space-y-8">
          {/* Basic info — read-only for now (managed elsewhere) */}
          <div>
            <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
              <Info className="w-5 h-5 text-emerald-600" /> 基本資料
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">商戶名稱</label>
                <input
                  type="text"
                  className="w-full p-3 rounded-xl border border-slate-300 bg-slate-50 text-slate-600"
                  value={vendor.name}
                  readOnly
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-bold text-slate-700 mb-1">商戶簡介</label>
                <textarea
                  rows="3"
                  className="w-full p-3 rounded-xl border border-slate-300 bg-slate-50 text-slate-600 resize-none"
                  value={vendor.description}
                  readOnly
                ></textarea>
              </div>
            </div>
          </div>

          {/* Pricing — the editable section the matching engine uses */}
          <div>
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
              {/* Currency */}
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

              {/* Price min */}
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

              {/* Price max */}
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

            {/* Live preview */}
            <div className="mt-4 bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3">
              <DollarSign className="w-5 h-5 text-emerald-600 flex-shrink-0" />
              <div className="text-sm">
                <span className="text-slate-500 mr-2">客人睇到：</span>
                <span className="font-bold text-emerald-800">{formatVendorPrice(livePreview)}</span>
              </div>
            </div>

            {error && (
              <div className="mt-3 bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-2 text-sm text-red-700">
                <AlertCircle className="w-4 h-4" />
                {error}
              </div>
            )}
          </div>

          <button
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