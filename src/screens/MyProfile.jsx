// 2026-07-30 — MyProfile screen.
//
// Where the user can:
//   1. See their email + verification status
//   2. See their member status (Free vs Premium) + the date they joined
//      (Promoted date for Premium, signup date for Free)
//   3. See which unlocks they have (for Premium users)
//   4. Opt in to upgrade (Free users only — opens PurchaseModal)
//   5. See their account metadata (display name, UID, referral code)
//   6. Log out (with confirm dialog so a mis-tap doesn't lose session)
//
// What this screen does NOT do (deferred to Phase B+):
//   - Edit display name
//   - Change password
//   - Delete account
//   - Link to the partner account
//
// Routing: App.jsx renders this when currentView === 'profile'.
// Reads: useUserProfile hook (real-time tier + unlocks + dates).
// Writes: only via useAuth().logout (no direct Firestore writes).
//
// The "← 返回" button routes to events-dashboard (always reachable for
// the signed-in user, regardless of which role they're in). The
// events dashboard is the role-appropriate landing for couples,
// owners, and vendors — and it works for helpers too via the role
// pills.

import { useState } from 'react';
import { ChevronLeft, Crown, Copy, Check, LogOut, User as UserIcon, AlertCircle, ShieldCheck, KeyRound, ChevronRight } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useUserProfile } from '../hooks/useUserProfile';

// 2026-07-30 — labels kept inline (not imported from RewardsBanner)
// to avoid coupling between screens. tiny duplication, no shared
// const we have to keep in sync. Labels match PurchaseModal's
// UNLOCK_LABELS so the profile screen reads consistently with the
// upgrade modal.
const UNLOCK_TYPES = ['custom-template', 'storage-500mb', 'permanent-archive'];
const UNLOCK_LABELS = {
  'custom-template': '上傳自訂電子喜帖設計',
  'storage-500mb': '+500MB 相簿 + 移除浮水印',
  'permanent-archive': '永久保存婚禮檔案',
};

export function MyProfile({ currentUser, onBack, onUpgrade, onChangePassword }) {
  const { logout, hasPasswordProvider } = useAuth();
  const { tier, unlocks, createdAt, promotedAt, referralCode, loading } = useUserProfile(currentUser);
  const [copied, setCopied] = useState(null);

  const handleCopy = async (value, key) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch (e) {
      // Fallback for older browsers / non-https contexts
      // (jsdom doesn't implement clipboard, so this is the test path too)
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (_) { /* noop */ }
      document.body.removeChild(ta);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    }
  };

  const handleLogout = () => {
    if (window.confirm('確定要登出？登出後你仍可再次登入。')) {
      logout();
    }
  };

  if (!currentUser) return null;

  return (
    <div className="max-w-2xl mx-auto p-4 animate-in fade-in zoom-in duration-300">
      {/* Header strip */}
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-sm font-bold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors"
          aria-label="返回"
        >
          <ChevronLeft className="w-4 h-4" />
          返回
        </button>
        <h1 className="text-lg font-black text-slate-800 flex items-center gap-2">
          <UserIcon className="w-5 h-5" />
          我的資料
        </h1>
      </div>

      {/* Email + verification */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 mb-4 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-rose-100 to-amber-100 flex items-center justify-center flex-shrink-0">
            <UserIcon className="w-7 h-7 text-slate-600" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold text-slate-800 truncate">
              {currentUser.email || '未設定電郵'}
            </p>
            <div className="mt-1">
              {currentUser.emailVerified ? (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                  <ShieldCheck className="w-3 h-3" />
                  已驗證電郵
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                  <AlertCircle className="w-3 h-3" />
                  未驗證電郵
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Membership status */}
      <section className="mb-4">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 px-1">
          會員狀態
        </h2>
        {loading ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <div className="h-4 bg-slate-200 rounded w-1/3 animate-pulse" />
            <div className="h-3 bg-slate-100 rounded w-1/2 mt-2 animate-pulse" />
          </div>
        ) : tier === 'premium' ? (
          <PremiumCard
            promotedAt={promotedAt}
            unlocks={unlocks}
          />
        ) : (
          <FreeCard
            createdAt={createdAt}
            onUpgrade={onUpgrade}
          />
        )}
      </section>

      {/* Account metadata */}
      <section className="mb-4">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 px-1">
          賬號
        </h2>
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <MetadataRow
            label="用戶 ID"
            value={currentUser.uid}
            onCopy={() => handleCopy(currentUser.uid, 'uid')}
            copied={copied === 'uid'}
          />
          <MetadataRow
            label="註冊時間"
            value={formatDate(createdAt)}
          />
          <MetadataRow
            label="推薦碼"
            // 2026-07-30 — show real referralCode (e.g. "STD-A4X7K")
            // from useUserProfile. The Cloud Function referralCodes.
            // onUserCreate mints this on every fresh signup. Still
            // copyable so users can share it; the existing
            // ReferralModal share UI is the primary share path.
            value={referralCode || '（載入中）'}
            onCopy={referralCode ? () => handleCopy(referralCode, 'referral') : undefined}
            copied={copied === 'referral'}
            copyLabel={referralCode ? '複製邀請碼' : undefined}
            muted
          />
        </div>
      </section>

      {/* 2026-07-30 — Security section. Houses password management.
          Single tile that adapts:
            - user has password provider → "更換密碼" (mode='change')
            - user is Google-only          → "設定登入密碼" (mode='set')
          Email verification badge also lives here (resend button is
          a follow-up; just shows the verified status for now). */}
      <section className="mb-4">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 px-1">
          賬號安全
        </h2>
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => onChangePassword?.(hasPasswordProvider(currentUser) ? 'change' : 'set')}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-9 h-9 rounded-xl bg-rose-50 flex items-center justify-center flex-shrink-0">
                <KeyRound className="w-4 h-4 text-rose-500" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-800">
                  {hasPasswordProvider(currentUser) ? '更換密碼' : '設定登入密碼'}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {hasPasswordProvider(currentUser)
                    ? '已啟用電郵 + 密碼登入'
                    : '現時只可以用 Google 登入'}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />
          </button>
        </div>
      </section>

      {/* Logout */}
      <section className="border-t border-slate-200 pt-4">
        <button
          type="button"
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 bg-white border-2 border-slate-300 text-slate-700 font-bold py-3 rounded-2xl hover:bg-slate-50 hover:border-slate-400 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          登出
        </button>
        <p className="text-center text-xs text-slate-400 mt-2">
          登出後你仍可再次登入
        </p>
      </section>
    </div>
  );
}

function PremiumCard({ promotedAt, unlocks }) {
  return (
    <div className="bg-gradient-to-br from-amber-50 to-rose-50 border-2 border-amber-300 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <Crown className="w-6 h-6 text-amber-500" />
        <h3 className="text-lg font-black text-slate-800">👑 Premium 會員</h3>
      </div>
      <p className="text-xs text-slate-600 mb-3">
        {promotedAt
          ? `${formatDate(promotedAt)} 加入 · 永久`
          : '永久'}
      </p>
      <ul className="space-y-1.5">
        {UNLOCK_TYPES.map((t) => {
          const has = unlocks.includes(t);
          return (
            <li
              key={t}
              className={`flex items-center gap-2 text-sm ${
                has ? 'text-slate-800' : 'text-slate-400'
              }`}
            >
              <span className={has ? 'text-emerald-500' : 'text-slate-300'}>
                {has ? '✓' : '○'}
              </span>
              <span className={has ? '' : 'line-through'}>
                {UNLOCK_LABELS[t] || t}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-slate-600 mt-3 pt-3 border-t border-amber-200">
        感謝支持 🙏
      </p>
    </div>
  );
}

function FreeCard({ createdAt, onUpgrade }) {
  return (
    <div className="bg-white border-2 border-dashed border-slate-300 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-2xl">🎁</span>
        <h3 className="text-lg font-black text-slate-800">Free 會員</h3>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        {createdAt
          ? `${formatDate(createdAt)} 註冊`
          : '歡迎使用 Save The Day'}
      </p>
      <p className="text-sm text-slate-600 mb-3">
        想要所有功能 + 永久 Premium 徽章？
      </p>
      <button
        type="button"
        onClick={onUpgrade}
        className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-rose-500 text-white font-bold py-3 rounded-xl shadow-lg hover:shadow-xl hover:scale-105 transition-all"
      >
        <Crown className="w-4 h-4" />
        升級為 Premium · HK$99
      </button>
      <p className="text-[10px] text-slate-400 mt-2 text-center">
        一次性付款 · 永久有效
      </p>
    </div>
  );
}

function MetadataRow({ label, value, onCopy, copied, copyLabel = '複製', muted }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 last:border-b-0 ${
        muted ? 'bg-slate-50' : ''
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-slate-500">{label}</p>
        <p className="text-sm text-slate-800 truncate mt-0.5">{value}</p>
      </div>
      {onCopy && (
        <button
          type="button"
          onClick={onCopy}
          className="flex items-center gap-1 text-xs font-bold text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 px-2.5 py-1.5 rounded-lg border border-rose-200 transition-colors flex-shrink-0"
          aria-label={copyLabel}
        >
          {copied ? (
            <>
              <Check className="w-3 h-3" />
              已複製
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              {copyLabel}
            </>
          )}
        </button>
      )}
    </div>
  );
}

function formatDate(timestamp) {
  if (!timestamp) return '—';
  // Firestore Timestamp vs ISO string vs Date
  const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  if (isNaN(d.getTime())) return '—';
  // YYYY-MM-DD in user's local timezone
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
