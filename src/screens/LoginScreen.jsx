import { useState } from 'react';
import {
  Heart,
  Mail,
  Lock,
  Loader2,
  QrCode,
  Camera,
  Wallet,
  Users,
  Globe,
  Briefcase,
} from 'lucide-react';

// ─── i18n strings ───────────────────────────────────────────────────────
// Two-language toggle (zh-Hant / en) for the marketing copy. Form
// validation messages and Firebase error mappings stay in Chinese (the
// primary audience), but the value-prop copy switches.

const STRINGS = {
  zh: {
    tagline:
      '全港創新一站式婚禮管理平台。 Save your big day with endless vendor choices. Save your big day with timeless memories.',
    googleCta: '使用 Google 帳號登入',
    emailPlaceholder: '電郵地址',
    passwordPlaceholder: '密碼',
    passwordSignupPlaceholder: '設定密碼 (至少 8 字元)',
    emailCta: '📧 電郵登入',
    emailSignupCta: '✨ 建立帳號',
    switchToSignup: '還未有帳號？',
    signupLink: '立即註冊',
    switchToSignin: '已有帳號？',
    signinLink: '返回登入',
    footer: '新人及婚禮統籌專用',
    guestCta: '訪客模式繼續 →',
    featuresTitle: '三大核心功能',
    featureQrTitle: '實時 QR Code 入席',
    featureQrDesc: '賓客掃碼即時核對，大幅減少人手點名',
    featurePhotoTitle: '賓客相片收集箱',
    featurePhotoDesc: '一場婚禮，所有精彩瞬間自動匯總',
    featureBudgetTitle: '預算與統籌',
    featureBudgetDesc: '廠商報價、待辦事項、實際支出同板管理',
    audienceTitle: '為誰而設',
    audienceOwner: '新人 / 主理',
    audienceHelper: '兄弟姊妹',
    audienceVendor: '商戶',
    busyLabel: '處理中...',
    errEmpty: '請填寫電郵及密碼',
    errPasswordShort: '密碼至少需要 8 個字元',
    errWrongCreds: '電郵或密碼錯誤',
    errEmailInUse: '此電郵已被註冊，請改用登入模式',
    errWeakPassword: '密碼強度不足, 請用 8 個字元以上',
    errInvalidEmail: '電郵格式不正確',
    errGeneric: '登入失敗, 請稍後再試',
    errGoogle: 'Google 登入失敗',
    errGuest: '訪客登入失敗',
  },
  en: {
    tagline:
      "Hong Kong's first all-in-one wedding SaaS with live QR check-in, a shared photo drop, and budget tracking.",
    googleCta: 'Sign in with Google',
    emailPlaceholder: 'Email address',
    passwordPlaceholder: 'Password',
    passwordSignupPlaceholder: 'Choose a password (min 8 chars)',
    emailCta: '📧 Email sign-in',
    emailSignupCta: '✨ Create account',
    switchToSignup: "Don't have an account?",
    signupLink: 'Sign up',
    switchToSignin: 'Already have an account?',
    signinLink: 'Sign in',
    footer: 'For couples and wedding planners',
    guestCta: 'Continue as guest →',
    featuresTitle: 'Three core features',
    featureQrTitle: 'Live QR check-in',
    featureQrDesc: 'Guests scan to check in — no more manual roll call',
    featurePhotoTitle: 'Shared photo drop',
    featurePhotoDesc: 'Every candid shot from every guest, in one album',
    featureBudgetTitle: 'Budget & planning',
    featureBudgetDesc: 'Quotes, to-dos, and actual spend on one board',
    audienceTitle: 'Built for',
    audienceOwner: 'Couples',
    audienceHelper: 'Wedding party',
    audienceVendor: 'Vendors',
    busyLabel: 'Working...',
    errEmpty: 'Please enter email and password',
    errPasswordShort: 'Password must be at least 8 characters',
    errWrongCreds: 'Wrong email or password',
    errEmailInUse: 'This email is already registered. Try signing in instead.',
    errWeakPassword: 'Password too weak — use 8+ characters',
    errInvalidEmail: 'Invalid email format',
    errGeneric: 'Sign-in failed. Please try again.',
    errGoogle: 'Google sign-in failed',
    errGuest: 'Guest sign-in failed',
  },
};

// LoginScreen — Google + email/password (sign-in OR sign-up), with optional
// guest-mode CTA. Now also includes: language toggle (zh-Hant / en), a
// three-feature value-prop row, and an audience pill row.
//
// Props:
//   onGoogleLogin     — () => Promise<void>     (called on Google button click)
//   onEmailLogin      — (email, password) => Promise<void>
//   onEmailRegister   — (email, password) => Promise<void>
//   onContinueAsGuest — optional () => Promise<void> (renders guest button)

export function LoginScreen({ onGoogleLogin, onEmailLogin, onEmailRegister, onContinueAsGuest, onVendorSignup }) {
  const [lang, setLang] = useState('zh'); // 'zh' | 'en'
  const t = STRINGS[lang];

  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submitEmail = async (e) => {
    e.preventDefault();
    setError(null);
    if (!email || !password) {
      setError(t.errEmpty);
      return;
    }
    if (mode === 'signup' && password.length < 8) {
      setError(t.errPasswordShort);
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signin') {
        await onEmailLogin(email, password);
      } else {
        await onEmailRegister(email, password);
      }
    } catch (err) {
      const code = err?.code || '';
      if (code.includes('user-not-found') || code.includes('wrong-password') || code.includes('invalid-credential')) {
        setError(t.errWrongCreds);
      } else if (code.includes('email-already-in-use')) {
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

  const switchMode = (newMode) => {
    setMode(newMode);
    setError(null);
  };

  // 2026-07-14 — 'I'm a Vendor' CTA. Now delegates to App.jsx which
  // swaps in the dedicated <VendorSignupCard/>. Previously this just
  // set a sessionStorage flag and flipped the form to signup mode —
  // users reported it looked like nothing happened.
  const handleVendorCta = () => {
    if (onVendorSignup) onVendorSignup();
  };

  const handleGuest = async () => {
    if (!onContinueAsGuest) return;
    setError(null);
    setBusy(true);
    try {
      await onContinueAsGuest();
    } catch (err) {
      setError(err?.message || t.errGuest);
    } finally {
      setBusy(false);
    }
  };

  // Three feature cards rendered below the login card.
  const features = [
    { icon: QrCode, title: t.featureQrTitle, desc: t.featureQrDesc, color: 'rose' },
    { icon: Camera, title: t.featurePhotoTitle, desc: t.featurePhotoDesc, color: 'pink' },
    { icon: Wallet, title: t.featureBudgetTitle, desc: t.featureBudgetDesc, color: 'amber' },
  ];
  const featureColorClasses = {
    rose: 'bg-rose-50 text-rose-600',
    pink: 'bg-pink-50 text-pink-600',
    amber: 'bg-amber-50 text-amber-600',
  };

  const audiences = [
    { icon: Heart, label: t.audienceOwner, color: 'bg-rose-100 text-rose-700' },
    { icon: Users, label: t.audienceHelper, color: 'bg-indigo-100 text-indigo-700' },
    { icon: Wallet, label: t.audienceVendor, color: 'bg-emerald-100 text-emerald-700' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-rose-50/40 to-pink-50/30 py-10 px-4">
      {/* Language toggle — top-right, persistent across the page */}
      <div className="max-w-md mx-auto flex justify-end mb-2">
        <div className="inline-flex bg-white rounded-full shadow-sm border border-slate-200 p-1 text-xs font-bold">
          <button
            type="button"
            onClick={() => setLang('zh')}
            aria-pressed={lang === 'zh'}
            className={`px-3 py-1 rounded-full flex items-center gap-1 transition-colors ${
              lang === 'zh' ? 'bg-rose-500 text-white' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Globe className="w-3 h-3" /> 中
          </button>
          <button
            type="button"
            onClick={() => setLang('en')}
            aria-pressed={lang === 'en'}
            className={`px-3 py-1 rounded-full flex items-center gap-1 transition-colors ${
              lang === 'en' ? 'bg-rose-500 text-white' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Globe className="w-3 h-3" /> EN
          </button>
        </div>
      </div>

      <div className="max-w-md mx-auto">
        {/* Login card */}
        <div className="bg-white p-8 md:p-10 rounded-[2rem] shadow-2xl w-full text-center border border-slate-100 relative overflow-hidden animate-in fade-in zoom-in duration-500">
          <div className="absolute top-0 inset-x-0 h-2 bg-gradient-to-r from-rose-400 to-pink-500"></div>
          <Heart className="w-16 h-16 text-rose-500 fill-rose-500 mx-auto mb-6" />
          <h1 className="text-4xl font-black text-slate-800 tracking-wider mb-2">
            Save The Day
          </h1>
          <p className="text-sm font-bold text-slate-500 tracking-widest uppercase mb-6">
            Hong Kong Wedding Platform
          </p>
          <p className="text-slate-500 mb-6 text-sm leading-relaxed">{t.tagline}</p>

          {/* Google button */}
          <button
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
            <span className="text-xs font-bold text-slate-400 tracking-widest">{lang === 'zh' ? '或' : 'OR'}</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>

          {/* Email/password form */}
          <form onSubmit={submitEmail} className="space-y-3">
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
                className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-rose-400 focus:border-rose-400 disabled:opacity-50"
              />
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="password"
                required
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                placeholder={mode === 'signup' ? t.passwordSignupPlaceholder : t.passwordPlaceholder}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                minLength={mode === 'signup' ? 8 : undefined}
                className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-rose-400 focus:border-rose-400 disabled:opacity-50"
              />
            </div>

            {error && (
              <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold px-3 py-2 rounded-lg text-left">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full bg-rose-500 hover:bg-rose-600 disabled:bg-slate-300 text-white font-bold py-3.5 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm"
            >
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> {t.busyLabel}
                </>
              ) : mode === 'signin' ? (
                t.emailCta
              ) : (
                t.emailSignupCta
              )}
            </button>
          </form>

          {/* Mode switch */}
          <div className="mt-5 text-xs text-slate-500">
            {mode === 'signin' ? (
              <>
                {t.switchToSignup}{' '}
                <button
                  type="button"
                  onClick={() => switchMode('signup')}
                  disabled={busy}
                  className="text-rose-600 hover:text-rose-700 font-bold disabled:opacity-50"
                >
                  {t.signupLink}
                </button>
              </>
            ) : (
              <>
                {t.switchToSignin}{' '}
                <button
                  type="button"
                  onClick={() => switchMode('signin')}
                  disabled={busy}
                  className="text-rose-600 hover:text-rose-700 font-bold disabled:opacity-50"
                >
                  {t.signinLink}
                </button>
              </>
            )}
          </div>

          <p className="text-xs text-slate-400 mt-5">{t.footer}</p>

          {/* Guest mode — skip auth, explore the app without an account */}
          {onContinueAsGuest && (
            <>
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-xs font-bold text-slate-400 tracking-widest">{lang === 'zh' ? '或' : 'OR'}</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>
              <button
                type="button"
                onClick={handleGuest}
                disabled={busy}
                data-testid="continue-as-guest"
                className="w-full bg-slate-100 hover:bg-slate-200 disabled:bg-slate-50 text-slate-600 font-bold py-3 rounded-xl transition-colors text-sm"
              >
                {t.guestCta}
              </button>
            </>
          )}
        </div>

        {/*
          2026-07-14 — added inline vendor CTA inside the login card so it's
          visible above the fold (the existing dark CTA card at the bottom
          of the page gets missed by users who don't scroll). Sits between
          the login form and the features section.

          Two intents:
            1. New users signing up just to become a vendor can click
               '立即註冊' directly from here.
            2. Existing couples/admins can share this link with vendor
               friends — they sign up via Google and the wizard auto-opens.
        */}
        <div className="mt-3">
          <div className="flex items-center gap-3 my-3">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-xs font-bold text-slate-400 tracking-widest">
              {lang === 'zh' ? '其他身份' : 'OTHER ROLES'}
            </span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>
          <a
            href="#signup-as-vendor"
            onClick={(e) => { e.preventDefault(); handleVendorCta(); }}
            className="w-full inline-flex items-center justify-between gap-2 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 font-bold py-3 px-4 rounded-xl transition-colors text-sm"
          >
            <span className="flex items-center gap-2">
              <Briefcase className="w-4 h-4" />
              <span>{lang === 'zh' ? '我是商戶 / 申請加入' : 'I\'m a Vendor — Apply'}</span>
            </span>
            <span className="text-emerald-600">→</span>
          </a>
        </div>

        {/* Features row — three core value props */}
        <section className="mt-8">
          <h3 className="text-center text-xs font-black tracking-widest text-slate-500 uppercase mb-4">
            {t.featuresTitle}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {features.map((f) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.title}
                  className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 text-left"
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${featureColorClasses[f.color]}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <h4 className="font-bold text-slate-800 text-sm mb-1">{f.title}</h4>
                  <p className="text-xs text-slate-500 leading-relaxed">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Vendor CTA — appears below the value props. Drives sign-ups by
            showing vendors there's a path for them too. */}
        <div className="mt-6 bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-5 text-white">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <Briefcase className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-bold mb-1">{lang === 'zh' ? '我是商戶' : 'For Vendors'}</h3>
              <p className="text-xs text-slate-300 mb-2">
                {lang === 'zh'
                  ? '加入 Save The Day 商戶指南，接觸全港新人。先註冊帳號再填寫商戶資料。'
                  : 'Join the directory to reach HK couples. Sign up first, then complete your vendor profile.'}
              </p>
              <a
                href="#signup"
                onClick={(e) => { e.preventDefault(); setMode('signup'); }}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-bold transition-colors"
              >
                {lang === 'zh' ? '建立商戶帳號 →' : 'Create vendor account →'}
              </a>
            </div>
          </div>
        </div>

        {/* Audience pills */}
        <section className="mt-6">
          <h3 className="text-center text-xs font-black tracking-widest text-slate-500 uppercase mb-3">
            {t.audienceTitle}
          </h3>
          <div className="flex justify-center flex-wrap gap-2">
            {audiences.map((a) => {
              const Icon = a.icon;
              return (
                <span
                  key={a.label}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${a.color}`}
                >
                  <Icon className="w-3 h-3" />
                  {a.label}
                </span>
              );
            })}
          </div>
        </section>

        <p className="text-center text-xs text-slate-400 mt-8">
          © 2026 Save The Day · Hong Kong Wedding Platform
        </p>
      </div>
    </div>
  );
}