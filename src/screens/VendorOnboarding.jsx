// VendorOnboarding.jsx — 5-step wizard that turns a signed-in user into a
// vendor. State machine:
//   - step 1: account confirmation
//   - step 2: business info
//   - step 3: pricing
//   - step 4: portfolio + tags
//   - step 5: review + submit
//
// After submit, we render a "success" panel that prompts the user to sign
// out and back in so the new `vendor: true` custom claim takes effect on
// their ID token (which gates routing to vendor tabs).

import { useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Briefcase,
  LogOut,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import {
  formFromUser,
  validateStep,
} from '../lib/vendorOnboarding';
import { Step1Account } from '../components/onboarding/Step1Account';
import { Step2Business } from '../components/onboarding/Step2Business';
import { Step3Pricing } from '../components/onboarding/Step3Pricing';
import { Step4Portfolio } from '../components/onboarding/Step4Portfolio';
import { Step5Review } from '../components/onboarding/Step5Review';

const STEPS = [
  { id: 1, label: '帳號', short: '帳號' },
  { id: 2, label: '商戶資料', short: '商戶' },
  { id: 3, label: '價錢', short: '價錢' },
  { id: 4, label: '作品集', short: '作品' },
  { id: 5, label: '確認', short: '確認' },
];

export function VendorOnboarding({ user, onComplete, onCancel }) {
  const { logout } = useAuth();
  const [form, setForm] = useState(() => formFromUser(user));
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState({});
  const [submitResult, setSubmitResult] = useState(null);

  const update = (patch) => {
    setForm((f) => ({ ...f, ...patch }));
    // Clear errors for changed fields so the next attempt shows fresh state.
    setErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(patch)) delete next[k];
      return next;
    });
  };

  const goNext = () => {
    const r = validateStep(step, form);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors({});
    setStep((s) => Math.min(5, s + 1));
  };

  const goBack = () => {
    setErrors({});
    setStep((s) => Math.max(1, s - 1));
  };

  const handleSuccess = (result) => {
    setSubmitResult(result);
  };

  // Success screen
  if (submitResult) {
    return <SuccessScreen result={submitResult} logout={logout} onComplete={onComplete} />;
  }

  return (
    <div className="max-w-2xl mx-auto mt-6 px-4 pb-24">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Briefcase className="w-6 h-6 text-emerald-600" />
            加入商戶
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            5 步完成。資料會即時寫入平台，新人搜尋後可以睇到。
          </p>
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-sm text-slate-500 hover:text-slate-800"
          >
            取消
          </button>
        )}
      </div>

      {/* Step progress */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          {STEPS.map((s, i) => {
            const isActive = s.id === step;
            const isDone = s.id < step;
            return (
              <div key={s.id} className="flex-1 flex items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                    isDone
                      ? 'bg-emerald-600 text-white'
                      : isActive
                      ? 'bg-emerald-100 text-emerald-700 ring-2 ring-emerald-500'
                      : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {isDone ? <CheckCircle2 className="w-4 h-4" /> : s.id}
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-2 ${
                      isDone ? 'bg-emerald-500' : 'bg-slate-200'
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between text-xs text-slate-500">
          {STEPS.map((s) => (
            <div
              key={s.id}
              className={`flex-1 text-center ${
                s.id === step ? 'text-emerald-700 font-bold' : ''
              }`}
            >
              {s.short}
            </div>
          ))}
        </div>
      </div>

      {/* Step content */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        {step === 1 && (
          <Step1Account
            form={form}
            user={user}
            update={update}
            onSignInClick={() => {
              // Re-route to login. The App.jsx handles the auth flow.
              window.location.hash = '#login';
            }}
          />
        )}
        {step === 2 && (
          <Step2Business form={form} update={update} errors={errors} />
        )}
        {step === 3 && (
          <Step3Pricing form={form} update={update} errors={errors} />
        )}
        {step === 4 && (
          <Step4Portfolio
            form={form}
            update={update}
            user={user}
            errors={errors}
          />
        )}
        {step === 5 && (
          <Step5Review
            form={form}
            update={update}
            user={user}
            errors={errors}
            onSuccess={handleSuccess}
            onBack={goBack}
          />
        )}

        {/* Bottom nav (steps 1-4) */}
        {step < 5 && (
          <div className="flex gap-2 mt-6 pt-4 border-t border-slate-100">
            {step > 1 && (
              <button
                type="button"
                onClick={goBack}
                className="px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 font-bold hover:bg-slate-50 inline-flex items-center gap-1"
              >
                <ChevronLeft className="w-4 h-4" />
                上一步
              </button>
            )}
            <button
              type="button"
              onClick={goNext}
              disabled={step === 1 && !user}
              className="flex-1 py-2.5 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1"
            >
              下一步
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SuccessScreen({ result, logout, onComplete }) {
  const handleLogout = async () => {
    try {
      await logout();
    } catch (e) {
      console.error('logout failed:', e);
    }
    // After logout, force a full reload so the fresh Auth state clears any
    // stale custom claims cached in the ID token.
    window.location.href = '/';
  };

  const wasClaim = typeof result.migratedStorageObjects === 'number';

  return (
    <div className="max-w-xl mx-auto mt-12 px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
        <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 flex items-center justify-center mb-4">
          <CheckCircle2 className="w-10 h-10 text-emerald-600" />
        </div>
        <h2 className="text-2xl font-bold text-slate-800 mb-2">
          🎉 申請成功！
        </h2>
        {wasClaim ? (
          <>
            <p className="text-slate-600 mb-6">
              已成功激活你嘅商戶帳戶。
              {result.migratedStorageObjects > 0 ? (
                <>
                  原本嘅 <strong>{result.migratedStorageObjects}</strong> 張作品集相片已經過戶到你嘅新帳戶，無需重新上載。
                </>
              ) : (
                <>原本嘅 vendor listing 資料已經過戶到你嘅新帳戶。</>
              )}
            </p>
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-6 text-left">
              <div className="font-bold text-emerald-900 mb-1 text-sm">下一步</div>
              <ol className="text-sm text-emerald-800 space-y-1 list-decimal list-inside">
                <li>登出並用同一個 email 重新登入</li>
                <li>系統會帶你去「商戶接單大堂」</li>
                <li>可以即刻編輯你嘅價錢、上載新作品、回覆新人查詢</li>
              </ol>
            </div>
          </>
        ) : (
          <p className="text-slate-600 mb-6">
            你的商戶專頁已建立。請重新登入以啟用商戶權限，
            <br />
            然後就可以接單、管理作品集、回覆新人查詢。
          </p>
        )}

        {!wasClaim && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-left">
            <div className="font-bold text-amber-900 mb-1 text-sm">下一步</div>
            <ol className="text-sm text-amber-800 space-y-1 list-decimal list-inside">
              <li>點擊下方按鈕登出</li>
              <li>用同一個 email 重新登入</li>
              <li>系統會自動帶你去「商戶接單大堂」</li>
            </ol>
          </div>
        )}

        <button
          type="button"
          onClick={handleLogout}
          className="w-full py-3 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 inline-flex items-center justify-center gap-2"
        >
          <LogOut className="w-4 h-4" />
          登出並重新登入
        </button>
      </div>
    </div>
  );
}