// 2026-07-30 — UserMenu. Avatar + dropdown header widget.
//
// Phase B of the my-profile work. Replaces the two standalone header
// buttons (👤 我的資料, 🚪 登出) added in Phase A with a single
// avatar button that opens a compact dropdown containing:
//   1. Email + member status header strip
//   2. 👤 我的資料 (routes to currentView='profile')
//   3. 🚪 登出 (with confirm() guard)
//
// Click-outside and Escape close the menu. The `aria-haspopup` +
// `aria-expanded` keeps screen readers oriented. The avatar circle
// shows the first letter of the user's email (badge-style) — no
// actual avatar upload in this phase.
//
// Why an avatar circle instead of a button-with-icon: an avatar uses
// less horizontal space in the header (the parent wrapper is flexed
// with 兄弟姊妹, 邀請另一半, 助手控制台, 返回總大堂 already), and
// it matches the pattern every modern app uses (Gmail, Slack, etc.).
// Mobile keeps the avatar only (no text label), so the header stays
// compact on small screens.

import { useEffect, useRef, useState } from 'react';
import { User, LogOut, Crown, ChevronDown } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useUserProfile } from '../hooks/useUserProfile';

const AVATAR_PALETTE = [
  'from-rose-400 to-amber-400',
  'from-indigo-400 to-rose-400',
  'from-emerald-400 to-cyan-400',
  'from-amber-400 to-rose-400',
  'from-purple-400 to-pink-400',
  'from-cyan-400 to-blue-400',
];

function getAvatarGradient(seed) {
  // Stable mapping from uid → palette index. Hashing the uid string
  // into a 0–5 index avoids the avatar color changing mid-session.
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

function getInitial(displayName, email) {
  // Prefer the leading character of the email's local part (handy
  // and stable). Falls back to displayName's first char, then '?'.
  const fromEmail = email && email[0];
  if (fromEmail && /[a-zA-Z0-9]/.test(fromEmail)) return fromEmail.toUpperCase();
  const fromName = displayName && displayName[0];
  if (fromName) return fromName.toUpperCase();
  return '?';
}

export function UserMenu({ user, onOpenProfile, onUpgrade }) {
  const { logout } = useAuth();
  const { tier, loading } = useUserProfile(user);
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  // Click-outside + Escape close.
  // Mirrors the same pattern from CoupleChecklist.jsx (the only
  // existing click-outside handler in the codebase, added 2026-07-21).
  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleLogout = () => {
    setOpen(false);
    if (window.confirm('確定要登出？登出後你仍可再次登入。')) {
      logout();
    }
  };

  const handleOpenProfile = () => {
    setOpen(false);
    onOpenProfile();
  };

  // Don't render anything for unauthenticated users. The parent
  // (App.jsx) already guards on `user`, so this is a safety net.
  if (!user) return null;

  const initial = getInitial(user.displayName, user.email);
  const gradient = getAvatarGradient(user.uid || user.email || 'anon');

  return (
    <div className="relative flex-shrink-0" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="用戶選單"
        title={user.email || '用戶選單'}
        data-testid="user-menu-trigger"
        className={`flex items-center gap-1.5 rounded-full border transition-all ${
          open
            ? 'border-rose-400 ring-2 ring-rose-100 bg-white'
            : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
        }`}
      >
        <span
          className={`w-8 h-8 rounded-full bg-gradient-to-br ${gradient} text-white text-sm font-black flex items-center justify-center`}
        >
          {initial}
        </span>
        <ChevronDown
          className={`w-3 h-3 text-slate-500 mr-1.5 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="用戶選單"
          data-testid="user-menu-panel"
          className="absolute right-0 top-full mt-2 w-64 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-150"
        >
          {/* Header strip — email + membership status */}
          <div className="px-4 py-3 bg-gradient-to-br from-slate-50 to-rose-50 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <span
                className={`w-9 h-9 rounded-full bg-gradient-to-br ${gradient} text-white text-sm font-black flex items-center justify-center flex-shrink-0`}
              >
                {initial}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-800 truncate">
                  {user.displayName || user.email?.split('@')[0] || '用戶'}
                </p>
                <p className="text-xs text-slate-500 truncate">
                  {user.email}
                </p>
              </div>
            </div>
            <div className="mt-2">
              {loading ? (
                <span className="inline-block h-4 w-20 bg-slate-200 rounded animate-pulse" />
              ) : tier === 'premium' ? (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                  <Crown className="w-3 h-3" />
                  👑 Premium 會員
                </span>
              ) : (
                <button
                  type="button"
                  onClick={onUpgrade}
                  className="text-xs font-bold text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 px-2 py-0.5 rounded-full border border-rose-200 transition-colors"
                >
                  升級為 Premium · HK$99
                </button>
              )}
            </div>
          </div>

          {/* Menu items */}
          <div className="p-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={handleOpenProfile}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-bold text-slate-700 hover:bg-slate-100 transition-colors"
            >
              <User className="w-4 h-4 text-slate-500" />
              我的資料
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={handleLogout}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-bold text-rose-600 hover:bg-rose-50 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              登出
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
