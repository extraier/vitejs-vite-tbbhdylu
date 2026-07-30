// ChangePasswordModal — let users change (or set) their login password.
//
// 2026-07-30 — initial release. Two modes driven by `mode` prop:
//
//   'change' — user has a password provider. Show THREE fields:
//                1. Current password (re-auth gate)
//                2. New password (with complexity checklist)
//                3. Confirm new password (with live match indicator)
//              On submit: call useAuth().changePassword(currentPassword, newPassword).
//              Requires re-auth (Firebase Auth drops sessions after 5 min idle
//              for sensitive ops; we re-auth transparently).
//
//   'set'    — user is Google-only. Show TWO fields:
//                1. New password (with complexity checklist)
//                2. Confirm new password (with live match indicator)
//              On submit: call useAuth().linkPassword(newPassword).
//              Firebase's linkWithCredential requires a recent login too,
//              but Google sessions are usually fresh because we just signed
//              in via the popup. If the call fails with requires-recent-login,
//              we tell the user to sign in again.
//
// Errors are mapped to Chinese. The password validator lives in
// src/lib/passwordValidation.js — shared with LoginScreen.
//
// State: all fields are local useState. The modal is mounted by App.jsx
// only when open=true, so unmounting on close clears all state automatically.

import { useState, useEffect } from 'react';
import { X, Lock, ShieldCheck, AlertCircle, Check, Loader2 } from 'lucide-react';
import { evaluatePassword, isPasswordValid, PASSWORD_RULES } from '../../lib/passwordValidation';
import { useAuth } from '../../hooks/useAuth';

// Firebase Auth error code → user message mapping. Bilingual not
// necessary here — profile screen is Chinese-only for now.
const ERROR_MAP = {
  'auth/wrong-password': '現時密碼錯誤，請重新輸入',
  'auth/invalid-credential': '現時密碼錯誤，請重新輸入',
  'auth/weak-password': '新密碼強度不足，請重設',
  'auth/requires-recent-login': '登入已過期，請先登出再重新登入',
  'auth/network-request-failed': '網絡連線失敗，請稍後再試',
  'auth/too-many-requests': '嘗試次數太多，請稍後再試',
  'auth/email-already-in-use': '此電郵已被使用（不應該發生，請聯絡客服）',
};

function mapError(err) {
  if (!err) return null;
  const code = err.code || '';
  if (ERROR_MAP[code]) return ERROR_MAP[code];
  // Fallback: surface the raw message if it's safe-looking (no stack/keys)
  if (err.message && err.message.length < 200) return err.message;
  return '操作失敗，請稍後再試';
}

export function ChangePasswordModal({ mode = 'change', onClose, onSuccess }) {
  const { changePassword, linkPassword } = useAuth();
  const isChange = mode === 'change';

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);

  // Reset on open (in case the modal is reused, e.g. switched from
  // change → set). The parent remounts us when mode changes, so this
  // would normally run on mount, but the explicit clear on mode-change
  // makes the reset behavior obvious.
  useEffect(() => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError(null);
    setSuccess(false);
  }, [mode]);

  // Live password evaluation — used by the checklist + the submit gate.
  const evalPwd = evaluatePassword(newPassword, '');

  // Submit gate:
  //   - mode 'change': requires currentPassword + valid newPassword + match
  //   - mode 'set':    requires valid newPassword + match
  const canSubmit =
    !busy &&
    !success &&
    newPassword.length > 0 &&
    evalPwd.isValid &&
    confirmPassword === newPassword &&
    (!isChange || currentPassword.length > 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!canSubmit) return;
    setBusy(true);
    try {
      if (isChange) {
        await changePassword(currentPassword, newPassword);
      } else {
        await linkPassword(newPassword);
      }
      setSuccess(true);
      // Auto-close after a beat so the user sees the success state.
      // The parent App.jsx remounts us on the next open anyway.
      setTimeout(() => {
        onSuccess?.();
      }, 1200);
    } catch (err) {
      setError(mapError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-slate-900/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-t-3xl sm:rounded-3xl max-w-md w-full shadow-2xl animate-in slide-in-from-bottom-4 duration-200 max-h-[90dvh] sm:max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-200 flex justify-between items-center flex-shrink-0">
          <h3 className="font-black text-slate-800 flex items-center gap-2 text-lg">
            <ShieldCheck className="w-5 h-5 text-rose-500" />
            {isChange ? '更換密碼' : '設定登入密碼'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1"
            aria-label="關閉"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4 pb-[max(1rem,env(safe-area-inset-bottom))] [-webkit-overflow-scrolling:touch]">
          {success ? (
            <div className="py-8 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
                <Check className="w-9 h-9 text-emerald-600" />
              </div>
              <p className="text-base font-bold text-slate-800">
                {isChange ? '密碼已更新' : '登入密碼已設定'}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {isChange
                  ? '下次登入請用新密碼'
                  : '下次可以選擇用電郵 + 密碼登入'}
              </p>
            </div>
          ) : (
            <>
              {/* Mode-specific intro */}
              <p className="text-sm text-slate-600 leading-relaxed">
                {isChange
                  ? '出於安全考量，更換密碼前需要先輸入現時密碼。'
                  : '設定登入密碼後，下次可以唔經 Google 直接用電郵同密碼登入。'}
              </p>

              {/* Current password (change mode only) */}
              {isChange && (
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">
                    現時密碼
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="password"
                      autoComplete="current-password"
                      required
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      disabled={busy}
                      className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-rose-400 focus:border-rose-400 disabled:opacity-50"
                    />
                  </div>
                </div>
              )}

              {/* New password */}
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">
                  新密碼
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    disabled={busy}
                    className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-rose-400 focus:border-rose-400 disabled:opacity-50"
                  />
                </div>

                {/* Live complexity checklist */}
                {newPassword && (
                  <ul className="mt-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-left space-y-1">
                    {PASSWORD_RULES.map((rule) => {
                      const ok = evalPwd.checks[rule.key];
                      return (
                        <li
                          key={rule.key}
                          className={`text-[11px] flex items-start gap-1.5 ${
                            ok ? 'text-emerald-700' : 'text-slate-500'
                          }`}
                        >
                          <span className="flex-shrink-0 font-bold">{ok ? '✓' : '○'}</span>
                          <span>{rule.label_zh}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* Confirm password */}
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">
                  再次輸入新密碼
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={busy}
                    className={`w-full pl-11 pr-4 py-3 bg-slate-50 border rounded-xl text-sm outline-none focus:ring-2 disabled:opacity-50 ${
                      confirmPassword && confirmPassword === newPassword
                        ? 'border-emerald-300 focus:ring-emerald-400 focus:border-emerald-400'
                        : confirmPassword && confirmPassword !== newPassword
                        ? 'border-rose-300 focus:ring-rose-400 focus:border-rose-400'
                        : 'border-slate-200 focus:ring-rose-400 focus:border-rose-400'
                    }`}
                  />
                  {confirmPassword && (
                    <span
                      className={`absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold ${
                        confirmPassword === newPassword
                          ? 'text-emerald-600'
                          : 'text-rose-500'
                      }`}
                    >
                      {confirmPassword === newPassword ? '✓ 一致' : '✗ 唔一致'}
                    </span>
                  )}
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold px-3 py-2 rounded-lg flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
            </>
          )}
        </form>

        {/* Footer */}
        {!success && (
          <div className="p-4 border-t border-slate-100 flex gap-2 flex-shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="flex-1 px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex-1 px-4 py-3 bg-rose-500 hover:bg-rose-600 disabled:bg-slate-300 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  處理中...
                </>
              ) : isChange ? (
                '更新密碼'
              ) : (
                '設定密碼'
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}