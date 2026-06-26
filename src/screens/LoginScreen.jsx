import { useState } from 'react';
import { Heart, Mail, Lock, Loader2 } from 'lucide-react';

// LoginScreen — supports Google + email/password (sign-in OR sign-up).
//
// Props:
//   onGoogleLogin     — () => Promise<void>     (called on Google button click)
//   onEmailLogin      — (email, password) => Promise<void>
//   onEmailRegister   — (email, password) => Promise<void>
//
// UX:
//   - Mode toggle: 'signin' | 'signup' (signup = create new account)
//   - Inline error from parent (string | null)
//   - Loading state disables all buttons
//   - Minimum password length 8 (Firebase Auth requirement)
//   - "OR" divider between Google and email
//
export function LoginScreen({ onGoogleLogin, onEmailLogin, onEmailRegister, onContinueAsGuest }) {
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submitEmail = async (e) => {
    e.preventDefault();
    setError(null);
    if (!email || !password) {
      setError('請填寫電郵及密碼');
      return;
    }
    if (mode === 'signup' && password.length < 8) {
      setError('密碼至少需要 8 個字元');
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
      // Friendly mapping for common Firebase errors
      const code = err?.code || '';
      if (code.includes('user-not-found') || code.includes('wrong-password') || code.includes('invalid-credential')) {
        setError('電郵或密碼錯誤');
      } else if (code.includes('email-already-in-use')) {
        setError('此電郵已被註冊，請改用登入模式');
      } else if (code.includes('weak-password')) {
        setError('密碼強度不足, 請用 8 個字元以上');
      } else if (code.includes('invalid-email')) {
        setError('電郵格式不正確');
      } else {
        setError(err?.message || '登入失敗, 請稍後再試');
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
      setError(err?.message || 'Google 登入失敗');
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (newMode) => {
    setMode(newMode);
    setError(null);
  };

  const handleGuest = async () => {
    if (!onContinueAsGuest) return;
    setError(null);
    setBusy(true);
    try {
      await onContinueAsGuest();
    } catch (err) {
      setError(err?.message || '訪客登入失敗');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white p-8 md:p-12 rounded-[2rem] shadow-2xl max-w-md w-full text-center border border-slate-100 relative overflow-hidden animate-in fade-in zoom-in duration-500">
        <div className="absolute top-0 inset-x-0 h-2 bg-gradient-to-r from-rose-400 to-pink-500"></div>
        <Heart className="w-16 h-16 text-rose-500 fill-rose-500 mx-auto mb-6" />
        <h1 className="text-3xl font-black text-slate-800 tracking-wider mb-2">囍程</h1>
        <h2 className="text-xl font-bold text-slate-600 mb-8">Save The Day</h2>
        <p className="text-slate-500 mb-8 text-sm leading-relaxed">
          全港首個具備實時 QR Code 入席、相片收集箱及預算管理的一站式婚禮 SaaS 平台。
        </p>

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
          使用 Google 帳號登入
        </button>

        {/* OR divider */}
        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px bg-slate-200" />
          <span className="text-xs font-bold text-slate-400 tracking-widest">或</span>
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
              placeholder="電郵地址"
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
              placeholder={mode === 'signup' ? '設定密碼 (至少 8 字元)' : '密碼'}
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
                <Loader2 className="w-4 h-4 animate-spin" />
                處理中...
              </>
            ) : mode === 'signin' ? (
              '📧 電郵登入'
            ) : (
              '✨ 建立帳號'
            )}
          </button>
        </form>

        {/* Mode switch */}
        <div className="mt-6 text-xs text-slate-500">
          {mode === 'signin' ? (
            <>
              還未有帳號？{' '}
              <button
                type="button"
                onClick={() => switchMode('signup')}
                disabled={busy}
                className="text-rose-600 hover:text-rose-700 font-bold disabled:opacity-50"
              >
                立即註冊
              </button>
            </>
          ) : (
            <>
              已有帳號？{' '}
              <button
                type="button"
                onClick={() => switchMode('signin')}
                disabled={busy}
                className="text-rose-600 hover:text-rose-700 font-bold disabled:opacity-50"
              >
                返回登入
              </button>
            </>
          )}
        </div>

        <p className="text-xs text-slate-400 mt-6">新人及婚禮統籌專用</p>

        {/* Guest mode — skip auth, explore the app without an account */}
        {onContinueAsGuest && (
          <>
            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px bg-slate-200" />
              <span className="text-xs font-bold text-slate-400 tracking-widest">或</span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>
            <button
              type="button"
              onClick={handleGuest}
              disabled={busy}
              data-testid="continue-as-guest"
              className="w-full bg-slate-100 hover:bg-slate-200 disabled:bg-slate-50 text-slate-600 font-bold py-3 rounded-xl transition-colors text-sm"
            >
              訪客模式繼續 →
            </button>
          </>
        )}
      </div>
    </div>
  );
}
