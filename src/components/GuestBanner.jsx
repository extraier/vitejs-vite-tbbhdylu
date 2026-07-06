import { Heart, AlertCircle, X } from 'lucide-react';

/**
 * GuestBanner — sticky amber banner shown above the header when the
 * current user is anonymous (signed in via "訪客模式繼續").
 *
 * Purpose: gentle nag to register, so the user understands their work
 * is at risk if they leave without creating an account.
 *
 * Dismissal: NOT supported. The banner is the visible "cost" of using
 * guest mode. If we let people dismiss it, they'll forget and lose
 * their data on next visit.
 *
 * Props:
 *   onSignUp   — () => void; opens the SignUpPromptModal
 *   onLogout   — () => void; exits guest mode and returns to login
 */
export function GuestBanner({ onSignUp, onLogout }) {
  return (
    <div
      role="alert"
      className="sticky top-0 z-[60] bg-amber-100 border-b-2 border-amber-400 text-amber-900 px-4 py-2.5 flex items-center justify-between gap-3 shadow-sm"
    >
      <div className="flex items-center gap-2 text-sm font-medium flex-1 min-w-0">
        <AlertCircle className="w-4 h-4 flex-shrink-0 text-amber-600" />
        <span className="truncate">
          <strong className="font-black">👋 你正在以訪客身份試用</strong>
          <span className="hidden sm:inline"> · 結束此分頁後資料會遺失</span>
        </span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={onSignUp}
          className="bg-rose-500 hover:bg-rose-600 text-white text-xs font-black px-3 py-1.5 rounded-full transition-colors flex items-center gap-1 shadow-sm"
        >
          <Heart className="w-3 h-3 fill-white" />
          註冊以保存 →
        </button>
        <button
          onClick={onLogout}
          aria-label="離開訪客模式"
          title="返回登入頁"
          className="text-amber-700 hover:text-amber-900 p-1 rounded transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}