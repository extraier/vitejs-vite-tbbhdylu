// HelperWaitingScreen — shown when a user has signed in (Google or email)
// but is NOT an active helper anywhere. Three sub-states:
//
//  1. No assignments at all → "你尚未被邀請"
//  2. Has pendingInvite (status='invited') → "等待主人確認" + accept button
//  3. Has only revoked assignments → "已撤銷, 請聯絡主人"
//
// We deliberately keep this screen full-bleed so it doesn't look like a
// broken empty-state of the main app. Logout is always available so the
// user isn't trapped.

import { Heart, Mail, Clock, CheckCircle2, LogOut, ShieldOff } from 'lucide-react';

export function HelperWaitingScreen({
  assignments,
  loading,
  onAccept,
  onLogout,
  accepting,
}) {
  const hasPending = assignments.some((a) => a.status === 'invited' || a.status === 'pending');
  const hasRevoked = assignments.length > 0 && !hasPending && !assignments.some((a) => a.status === 'active');
  const empty = !loading && assignments.length === 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-rose-50 flex items-center justify-center p-6 font-sans">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <Heart className="w-16 h-16 text-rose-500 mx-auto mb-4 fill-rose-100" />
          <h1 className="text-3xl font-black text-slate-800 mb-2">囍程 · 兄弟姊妹</h1>
          <p className="text-slate-500 text-sm">婚禮助手專用入口</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8">
          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full mx-auto mb-3" />
              <p className="text-slate-500 text-sm">檢查邀請中...</p>
            </div>
          ) : empty ? (
            <EmptyState />
          ) : hasPending ? (
            <PendingState
              assignments={assignments.filter((a) => a.status === 'invited' || a.status === 'pending')}
              onAccept={onAccept}
              accepting={accepting}
            />
          ) : hasRevoked ? (
            <RevokedState />
          ) : (
            // Fallback — assignments exist and at least one is active but
            // somehow the main app didn't take over. Should be rare.
            <div className="text-center text-slate-500 text-sm">載入中...</div>
          )}
        </div>

        <button
          onClick={onLogout}
          className="mt-6 w-full flex items-center justify-center gap-2 text-slate-500 hover:text-slate-700 text-sm font-bold py-3 transition-colors"
        >
          <LogOut className="w-4 h-4" /> 登出
        </button>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center">
      <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <Mail className="w-8 h-8 text-slate-400" />
      </div>
      <h2 className="text-xl font-bold text-slate-800 mb-2">尚未收到邀請</h2>
      <p className="text-slate-500 text-sm leading-relaxed">
        你還沒有被邀請加入任何婚禮。
        <br />
        請聯絡主人 (新人) 並確認你使用的電郵與邀請相同。
      </p>
      <div className="mt-6 p-3 bg-indigo-50 border border-indigo-100 rounded-lg text-xs text-indigo-700">
        💡 如果你已經收到邀請但用錯了電郵登入，請先登出再用邀請電郵重新註冊。
      </div>
    </div>
  );
}

function PendingState({ assignments, onAccept, accepting }) {
  return (
    <div>
      <div className="text-center mb-6">
        <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Clock className="w-8 h-8 text-amber-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-800 mb-2">收到 {assignments.length} 個邀請</h2>
        <p className="text-slate-500 text-sm">點擊下方按鈕接受邀請以加入婚禮團隊</p>
      </div>

      <ul className="space-y-2 mb-6">
        {assignments.map((a) => (
          <li
            key={a.id}
            className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200"
          >
            <div>
              <div className="font-bold text-slate-800 text-sm">{a.ownerName || '婚禮'}</div>
              <div className="text-xs text-slate-500">{a.email}</div>
            </div>
            <CheckCircle2 className="w-5 h-5 text-amber-500" />
          </li>
        ))}
      </ul>

      <button
        onClick={onAccept}
        disabled={accepting}
        className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
      >
        {accepting ? (
          <>
            <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
            處理中...
          </>
        ) : (
          <>✓ 接受邀請並加入</>
        )}
      </button>
    </div>
  );
}

function RevokedState() {
  return (
    <div className="text-center">
      <div className="w-16 h-16 bg-rose-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <ShieldOff className="w-8 h-8 text-rose-600" />
      </div>
      <h2 className="text-xl font-bold text-slate-800 mb-2">邀請已撤銷</h2>
      <p className="text-slate-500 text-sm leading-relaxed">
        主人已撤銷你對這個婚禮的訪問權限。
        <br />
        如有疑問，請直接聯絡新人。
      </p>
    </div>
  );
}
