// Step3Pricing.jsx — priceMin, priceMax, currency, openEnded toggle.
//
// Same field shape as VendorProfileEdit so the post-submit edit flow can
// reuse the existing UI without translation.

import { formatMoney, parseFormattedNumber } from '../../lib/format';

const CURRENCIES = [
  { code: 'HKD', label: 'HKD 港幣' },
  { code: 'USD', label: 'USD 美元' },
  { code: 'CNY', label: 'CNY 人民幣' },
];

export function Step3Pricing({ form, update, errors }) {
  // Local state mirrors what VendorProfileEdit does: keep raw string in the
  // input so the user can type freely (with commas), parse to number on save.
  const handleMinChange = (e) => {
    const raw = e.target.value.replace(/[^0-9]/g, '');
    update({ priceMin: raw === '' ? 0 : Number(raw) });
  };
  const handleMaxChange = (e) => {
    const raw = e.target.value.replace(/[^0-9]/g, '');
    update({ priceMax: raw === '' ? 0 : Number(raw) });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1">
            起步價 <span className="text-rose-600">*</span>
          </label>
          <div className="relative">
            <input
              type="text"
              inputMode="numeric"
              value={formatMoney(form.priceMin)}
              onChange={handleMinChange}
              placeholder="5,000"
              className={`w-full pl-4 pr-12 py-3 rounded-lg border outline-none ${
                errors.priceMin ? 'border-rose-400 bg-rose-50' : 'border-slate-300'
              }`}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">
              {form.currency}
            </span>
          </div>
          {errors.priceMin && (
            <div className="text-xs text-rose-600 mt-1">{errors.priceMin}</div>
          )}
          <div className="text-xs text-slate-500 mt-1">
            最平一個 package 嘅價錢，新人會見到嘅「由 X 起」
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            貨幣
          </label>
          <select
            value={form.currency}
            onChange={(e) => update({ currency: e.target.value })}
            className="w-full px-3 py-3 rounded-lg border border-slate-300 outline-none bg-white"
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="border border-slate-200 rounded-xl p-4 space-y-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(form.openEnded)}
            onChange={(e) => update({ openEnded: e.target.checked })}
            className="w-4 h-4 rounded border-slate-300"
          />
          <span className="text-sm font-medium text-slate-700">
            無最高價（按項目報價）
          </span>
        </label>

        {!form.openEnded && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              最高價 <span className="text-rose-600">*</span>
            </label>
            <div className="relative">
              <input
                type="text"
                inputMode="numeric"
                value={formatMoney(form.priceMax)}
                onChange={handleMaxChange}
                placeholder="15,000"
                className={`w-full pl-4 pr-12 py-3 rounded-lg border outline-none ${
                  errors.priceMax ? 'border-rose-400 bg-rose-50' : 'border-slate-300'
                }`}
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">
                {form.currency}
              </span>
            </div>
            {errors.priceMax && (
              <div className="text-xs text-rose-600 mt-1">{errors.priceMax}</div>
            )}
          </div>
        )}
      </div>

      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center gap-2 text-sm">
        <span className="text-slate-500">新人睇到：</span>
        <span className="font-bold text-emerald-800">
          {form.currency} {formatMoney(form.priceMin)}
          {form.openEnded ? '+' : ` - ${formatMoney(form.priceMax)}`}
        </span>
      </div>

      {/* Hidden numeric inputs so parseFormattedNumber can read raw values later */}
      <input type="hidden" value={parseFormattedNumber(String(form.priceMin))} readOnly />
      <input type="hidden" value={parseFormattedNumber(String(form.priceMax))} readOnly />
    </div>
  );
}