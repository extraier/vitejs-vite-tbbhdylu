// Step5Review.jsx — final review before submit.
//
// Shows a summary of all entered data and a T&C checkbox. Submit button
// triggers the applyAsVendor callable. On success, parent shows a
// confirmation screen; on error, we surface the message inline.

import { useState } from 'react';
import { Loader2, Send, AlertCircle } from 'lucide-react';
import { TASK_CATEGORIES } from '../../lib/config';
import { formatMoney } from '../../lib/format';
import { submitVendorApplication } from '../../lib/vendorOnboarding';

export function Step5Review({ form, update, user, errors, onSuccess, onBack }) {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const handleSubmit = async () => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const result = await submitVendorApplication(form);
      onSuccess(result);
    } catch (e) {
      // Firebase callable errors come wrapped in e.code / e.message.
      const msg = e?.message || '提交失敗';
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const categoryLabel = TASK_CATEGORIES[form.category] || form.category || '—';

  return (
    <div className="space-y-4">
      <div className="text-sm text-slate-600 mb-2">
        確認以下資料無誤，提交後我哋會審批並透過電郵通知你。
      </div>

      {/* Summary card */}
      <div className="border border-slate-200 rounded-xl divide-y divide-slate-200">
        <SummaryRow label="商戶名稱" value={form.name} />
        <SummaryRow label="服務分類" value={categoryLabel} />
        {form.description && (
          <SummaryRow label="簡介" value={form.description} multiline />
        )}
        <SummaryRow
          label="年資 / 地區"
          value={`${form.yearsInBusiness || 0} 年 · ${form.serviceArea || '—'}`}
        />
        <SummaryRow
          label="價錢範圍"
          value={`${form.currency} ${formatMoney(form.priceMin)}${
            form.openEnded ? '+' : ` - ${formatMoney(form.priceMax)}`
          }`}
        />
        <div className="px-4 py-3">
          <div className="text-xs font-medium text-slate-500 mb-2">
            作品集 ({form.portfolio.length} 張)
          </div>
          {form.portfolio.length > 0 ? (
            <div className="grid grid-cols-6 gap-1">
              {form.portfolio.map((url, idx) => (
                <img
                  key={url}
                  src={url}
                  alt={`作品 ${idx + 1}`}
                  className="w-full aspect-square object-cover rounded"
                />
              ))}
            </div>
          ) : (
            <div className="text-sm text-rose-600">（未上傳）</div>
          )}
        </div>
        {form.tags.length > 0 && (
          <div className="px-4 py-3">
            <div className="text-xs font-medium text-slate-500 mb-2">標籤</div>
            <div className="flex flex-wrap gap-1">
              {form.tags.map((t) => (
                <span
                  key={t}
                  className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}
        <SummaryRow label="聯絡電郵" value={form.email} mono />
      </div>

      {/* T&C */}
      <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50">
        <input
          type="checkbox"
          checked={form.termsAccepted}
          onChange={(e) => update({ termsAccepted: e.target.checked })}
          className="w-4 h-4 mt-0.5 rounded border-slate-300"
        />
        <div className="text-sm text-slate-700">
          本人確認以上資料真實，並同意{' '}
          <a href="/vendor-terms" target="_blank" rel="noreferrer" className="text-emerald-700 underline">
            商戶服務條款
          </a>
          。明白商戶專頁需要通過審批後先會公開展示。
        </div>
      </label>
      {errors.termsAccepted && (
        <div className="text-xs text-rose-600 -mt-2">{errors.termsAccepted}</div>
      )}

      {/* Submit error */}
      {submitError && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex gap-2 text-sm text-rose-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>{submitError}</div>
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="px-4 py-3 rounded-lg border border-slate-300 text-slate-700 font-bold hover:bg-slate-50 disabled:opacity-50"
        >
          ← 返回修改
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || !form.termsAccepted}
          className="flex-1 py-3 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              提交中…
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              提交申請
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, multiline, mono }) {
  return (
    <div className="px-4 py-3 flex items-start gap-3">
      <div className="text-xs font-medium text-slate-500 w-20 flex-shrink-0 pt-0.5">
        {label}
      </div>
      <div
        className={`flex-1 text-sm text-slate-800 ${
          multiline ? 'whitespace-pre-wrap' : ''
        } ${mono ? 'font-mono text-xs' : ''}`}
      >
        {value || '—'}
      </div>
    </div>
  );
}