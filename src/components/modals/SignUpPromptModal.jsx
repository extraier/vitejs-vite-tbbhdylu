import { useState } from 'react';
import { X, Heart, Mail, Lock, Loader2 } from 'lucide-react';

/**
 * SignUpPromptModal — appears when an anonymous (guest) user attempts
 * a write (or clicks the GuestBanner CTA). Lets them convert their
 * anonymous account to a permanent email/password one via Firebase's
 * linkWithCredential — so all their data is preserved.
 *
 * The "link" path is what makes this UX work: the guest can explore
 * freely, build up state under the anonymous UID, and when they're
 * ready, ONE signup keeps everything (no migration, no copy).
 *
 * If the email is already in use by a different account, we surface
 * a clear error and offer the "sign in instead" escape hatch (which
 * abandons the anonymous work and switches to the existing account).
 *
 * Props:
 *   onClose       — dismiss the modal without action
 *   onLink        — (email, password) => Promise<void>; throws on failure
 *   onSignIn      — (email, password) => Promise<void>; throws on failure
 *   linkedAccountEmail — optional pre-fill (e.g. last attempted email)
 */
export function SignUpPromptModal({ onClose, onLink, onSignIn, linkedAccountEmail = '' }) {
  const [email, setEmail] = useState(linkedAccountEmail);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // When Firebase says the email is already taken, we flip into a
  // sign-in mode so the user can claim their real account instead.
  const [mode, setMode] = useState('signup'); // 'signup' | 'signin'

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!email || !password) {
      setError('請填寫電郵同密碼');
      return;
    }
    if (password.length < 8) {
      setError('密碼至少 8 個字');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signup') {
        await onLink(email, password);
        // Parent unmounts us on success (isAnonymous flips to false).
      } else {
        await onSignIn(email, password);
      }
    } catch (err) {
      const code = err?.code || '';
      if (code.includes('email-already-in-use')) {
        setError('此電郵已註冊。請切換到「登入現有帳號」繼續。');
        setMode('signin');
      } else if (code.includes('weak-password')) {
        setError('密碼太弱 — 至少 8 個字，建議英數混合');
      } else if (code.includes('invalid-email')) {
        setError('電郵格式不正確');
      } else if (code.includes('user-not-found') || code.includes('wrong-password') || code.includes('invalid-credential')) {
        setError('電郵或密碼錯誤');
      } else {
        setError(err?.message || '註冊失敗，請稍後再試');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 z-[200] flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        // Click backdrop to dismiss (only when not busy — avoids mid-submit cancel).
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 relative animate-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          disabled={busy}
          aria-label="關閉"
          className="absolute top-3 right-3 text-slate-400 hover:text-slate-700 disabled:opacity-30"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-center mb-5">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-rose-100 rounded-full mb-3">
            <Heart className="w-7 h-7 text-rose-500 fill-rose-200" />
          </div>
          <h2 className="text-2xl font-black text-slate-800 mb-1">
            {mode === 'signup' ? '保存你的婚禮進度' : '登入現有帳號'}
          </h2>
          <p className="text-sm text-slate-500">
            {mode === 'signup'
              ? '建立帳號以永久保存你剛剛建立的內容，所有資料都會保留。'
              : '此電郵已註冊。登入後你會切換到原有帳號（本機訪客資料將會遺失）。'}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="email"
              placeholder="電郵地址"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              autoComplete="email"
              className="w-full pl-10 pr-3 py-3 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-rose-400 focus:border-transparent disabled:bg-slate-50"
            />
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="password"
              placeholder="密碼 (至少 8 個字)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              minLength={8}
              className="w-full pl-10 pr-3 py-3 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-rose-400 focus:border-transparent disabled:bg-slate-50"
            />
          </div>

          {error && (
            <div className="bg-rose-50 text-rose-700 text-sm p-3 rounded-lg border border-rose-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full bg-rose-500 hover:bg-rose-600 text-white font-black py-3 rounded-xl transition-colors disabled:bg-rose-300 flex items-center justify-center gap-2"
          >
            {busy ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {mode === 'signup' ? '建立帳號中…' : '登入中…'}
              </>
            ) : mode === 'signup' ? (
              '✨ 建立帳號並保存進度'
            ) : (
              '🔑 登入'
            )}
          </button>
        </form>

        <div className="mt-4 text-center">
          {mode === 'signup' ? (
            <button
              type="button"
              onClick={() => { setMode('signin'); setError(null); }}
              disabled={busy}
              className="text-xs text-slate-500 hover:text-slate-700 underline disabled:opacity-50"
            >
              已有帳號？登入
            </button>
          ) : (
            <button
              type="button"
              onClick={() => { setMode('signup'); setError(null); }}
              disabled={busy}
              className="text-xs text-slate-500 hover:text-slate-700 underline disabled:opacity-50"
            >
              ← 返回註冊
            </button>
          )}
        </div>

        <p className="mt-4 text-[10px] text-slate-400 text-center leading-relaxed">
          註冊即代表你同意儲存你的婚禮資料。
          訪客模式下建立的資料會喺你註冊之後保留，唔會流失。
        </p>
      </div>
    </div>
  );
}