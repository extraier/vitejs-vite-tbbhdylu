// VendorSignupCard.jsx — dedicated signup card for vendors.
//
// Rendered as a sibling of <LoginScreen/> by App.jsx when the user clicks
// the "我是商戶" CTA on the public main page. Visually distinct (emerald
// theme, vendor badge, extra "business name" field) so users get clear
// feedback that something happened.
//
// Props:
//   onGoogleLogin       — () => Promise<void>; same handler as LoginScreen
//   onEmailRegister     — (email, password, displayName) => Promise<void>
//                          Note the 3rd arg: useAuth calls
//                          user.updateProfile({ displayName }) so the
//                          vendor business name lands on the Firebase user
//                          record and pre-fills wizard Step 1.
//   onBack              — () => void; returns to LoginScreen
//   onSwitchLanguage    — () => void; (optional) hook for zh/en toggle
//
// Behavior:
//   - Sets sessionStorage.postLoginIntent = 'vendor-onboarding' on mount
//     so App.jsx auto-routes to the wizard after successful sign-up.
//   - Validates password length (≥8 chars) and non-empty business name.
//   - Translates Firebase auth error codes into Chinese error messages.

import { useEffect, useState } from 'react';
import { Briefcase, Mail, Lock, Loader2, Globe } from 'lucide-react';

const STRINGS = {
  zh: {
    badge: '我是商戶',
    title: '加入 Save The Day 商戶指南',
    tagline: '加入 Save The Day 商戶指南，5 分鐘填表，立即收到全港新人查詢。',
    nameLabel: '商戶名稱 / 工作室名',
    namePlaceholder: '例：ABC Wedding Studio',
    emailPlaceholder: '電郵地址',
    passwordPlaceholder: '設定密碼（至少 8 個字元）',
    googleCta: '使用 Google 帳號註冊',
    submitCta: '建立商戶帳號並繼續',
    backLink: '← 我係新人，返回登入',
    busy: '處理中...',
    errEmpty: '請填寫商戶名稱、電郵同密碼',
    errPasswordShort: '密碼至少需要 8 個字元',
    errNameMissing: '請輸入商戶名稱',
    errEmailInUse: '此電郵已被註冊，請改用登入模式',
    errWeakPassword: '密碼強度不足，請用 8 個字元以上',
    errInvalidEmail: '電郵格式不正確',
    errGoogle: 'Google 登入失敗',
    errGeneric: '註冊失敗，請稍後再試',
  },
  en: {
    badge: 'Vendor signup',
    title: 'Join the Vendor Directory',
    tagline: 'Join the savetheday.io directory — fill in your business info in 5 minutes and start receiving inquiries.',
    nameLabel: 'Business name',
    namePlaceholder: 'e.g. ABC Wedding Studio',
    emailPlaceholder: 'Email address',
    passwordPlaceholder: 'Choose a password (min 8 chars)',
    googleCta: 'Sign up with Google',
    submitCta: 'Create vendor account & continue',
    backLink: "← I'm a couple — back to sign in",
    busy: 'Working...',
    errEmpty: 'Please fill in your business name, email and password',
    errPasswordShort: 'Password must be at least 8 characters',
    errNameMissing: 'Please enter your business name',
    errEmailInUse: 'This email is already registered. Try signing in instead.',
    errWeakPassword: 'Password too weak — use 8+ characters',
    errInvalidEmail: 'Invalid email format',
    errGoogle: 'Google sign-up failed',
    errGeneric: 'Sign-up failed. Please try again.',
  },
};

export function VendorSignupCard({ onGoogleLogin, onEmailRegister, onBack }) {
  const [lang, setLang] = useState('zh');
  const t = STRINGS[lang];
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // 2026-07-14 — on mount, set the post-login intent so App.jsx routes
  // the user to the vendor wizard after a successful sign-up. Cleared
  // by App.jsx once consumed so subsequent visits don't auto-route.
  useEffect(() => {
    try {
      sessionStorage.setItem('postLoginIntent', 'vendor-onboarding');
    } catch {
      // sessionStorage may throw in private mode; the user can still
      // sign up — they just won't be auto-routed to the wizard.
    }
  }, []);

  const handleGoogle = async () => {
    setError(null);
    setBusy(true);
    try {
      await onGoogleLogin();
    } catch (err) {
      setError(err?.message || t.errGoogle);
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!displayName.trim() || !email || !password) {
      setError(t.errEmpty);
      return;
    }
    if (password.length < 8) {
      setError(t.errPasswordShort);
      return;
    }
    setBusy(true);
    try {
      await onEmailRegister(email, password, displayName.trim());
    } catch (err) {
      const code = err?.code || '';
      if (code.includes('email-already-in-use')) {
        setError(t.errEmailInUse);
      } else if (code.includes('weak-password')) {
        setError(t.errWeakPassword);
      } else if (code.includes('invalid-email')) {
        setError(t.errInvalidEmail);
      } else {
        setError(err?.message || t.errGeneric);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50/40 to-cyan-50/30 py-10 px-4">
      {/* Language toggle */}
      <div className="max-w-md mx-auto flex justify-end mb-2">
        <div className="inline-flex bg-white rounded-full shadow-sm border border-slate-200 p-1 text-xs font-bold">
          <button
            type="button"
            onClick={() => setLang('zh')}
            aria-pressed={lang === 'zh'}
            className={`px-3 py-1 rounded-full flex items-center gap-1 transition-colors ${
              lang === 'zh' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Globe className="w-3 h-3" /> 中
          </button>
          <button
            type="button"
            onClick={() => setLang('en')}
            aria-pressed={lang === 'en'}
            className={`px-3 py-1 rounded-full flex items-center gap-1 transition-colors ${
              lang === 'en' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Globe className="w-3 h-3" /> EN
          </button>
        </div>
      </div>

      <div className="max-w-md mx-auto">
        <div className="bg-white p-8 md:p-10 rounded-[2rem] shadow-2xl w-full text-center border-2 border-emerald-300 relative overflow-hidden animate-in fade-in zoom-in duration-500">
          <div className="absolute top-0 inset-x-0 h-2 bg-gradient-to-r from-emerald-400 to-teal-500"></div>

          <div className="inline-flex items-center gap-2 bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full text-xs font-black tracking-wider mb-4">
            <Briefcase className="w-3 h-3" />
            {t.badge}
          </div>

          <Briefcase className="w-14 h-14 text-emerald-600 mx-auto mb-4" />
          <h1 className="text-2xl font-black text-slate-800 mb-2">{t.title}</h1>
          <p className="text-slate-500 mb-6 text-sm leading-relaxed">{t.tagline}</p>

          {/* Google signup */}
          <button
            type="button"
            onClick={handleGoogle}
            disabled={busy}
            className="w-full bg-white border-2 border-slate-200 text-slate-700 font-bold py-3.5 rounded-xl hover:bg-slate-50 hover:border-slate-300 transition-all flex items-center justify-center gap-3 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <img
              src="https://www.svgrepo.com/show/475656/google-color.svg"
              className="w-5 h-5"
              alt="Google"
            />
            {t.googleCta}
          </button>

          {/* OR divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-xs font-bold text-slate-400 tracking-widest">
              {lang === 'zh' ? '或' : 'OR'}
            </span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>

          {/* Email signup form */}
          <form onSubmit={handleSubmit} className="space-y-3 text-left">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t.nameLabel}
              </label>
              <div className="relative">
                <Briefcase className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  required
                  autoComplete="organization"
                  placeholder={t.namePlaceholder}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  disabled={busy}
                  maxLength={80}
                  className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 disabled:opacity-50"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t.emailPlaceholder}
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="email"
                  required
                  autoComplete="email"
                  placeholder={t.emailPlaceholder}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                  className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 disabled:opacity-50"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {t.passwordPlaceholder}
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  placeholder={t.passwordPlaceholder}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                  minLength={8}
                  className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 disabled:opacity-50"
                />
              </div>
            </div>

            {error && (
              <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold px-3 py-2 rounded-lg text-left">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-300 text-white font-bold py-3.5 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm"
            >
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> {t.busy}
                </>
              ) : (
                t.submitCta
              )}
            </button>
          </form>

          <button
            type="button"
            onClick={onBack}
            disabled={busy}
            className="mt-5 text-xs text-slate-500 hover:text-slate-700 disabled:opacity-50"
          >
            {t.backLink}
          </button>
        </div>

        <p className="text-center text-xs text-slate-500 mt-6">
          {lang === 'zh'
            ? '註冊即代表你同意儲存你的商戶資料。'
            : 'By signing up you agree to our storing your business information.'}
        </p>
      </div>
    </div>
  );
}
