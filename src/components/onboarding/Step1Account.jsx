// Step1Account.jsx — Welcome + auth confirmation.
//
// The wizard is gated on auth (a vendor needs a stable identity to write to
// /vendors/{uid}). If the user lands here without being signed in, we show
// a "please sign in first" message with a button that opens the regular
// login screen. Once signed in, this step is purely informational.
//
// The display name is editable so vendors can correct typos from the
// signup form (the VendorSignupCard captures "商戶名稱 / 工作室名" but the
// user may want a shorter/shorter display name shown elsewhere).

import { Mail, User as UserIcon, CheckCircle2 } from 'lucide-react';

export function Step1Account({ form, user, update, onSignInClick }) {
  if (!user) {
    return (
      <div className="space-y-4">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
          <UserIcon className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900">
            <div className="font-bold mb-1">需要先登入</div>
            <div>
              申請成為商戶需要一個穩定嘅帳號。我哋會將你嘅商戶資料綁定到呢個帳號，
              之後用同一個 email 登入就可以管理你嘅專頁。
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onSignInClick}
          className="w-full py-3 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 transition-colors"
        >
          去登入 / 註冊
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex gap-3">
        <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-emerald-900">
          <div className="font-bold mb-1">你已登入，可以開始申請</div>
          <div>
            商戶專頁會綁定到以下帳號。申請成功後請重新登入以啟用商戶權限。
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            <Mail className="w-4 h-4 inline mr-1" />
            帳號電郵
          </label>
          <div className="px-4 py-3 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 font-mono text-sm">
            {form.email || '（無電郵）'}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            如需修改請到「帳號設定」（稍後加入）。申請提交後此電郵會用作聯絡。
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            <UserIcon className="w-4 h-4 inline mr-1" />
            顯示名稱（會自動帶入商戶名稱，你可之後修改）
          </label>
          <input
            type="text"
            value={form.displayName || ''}
            onChange={(e) => update?.({ displayName: e.target.value })}
            maxLength={80}
            className="w-full px-4 py-3 rounded-lg border border-slate-200 bg-white text-slate-700 outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400"
            placeholder="例：ABC Wedding Studio"
          />
          <div className="text-xs text-slate-500 mt-1">
            會顯示喺商戶指南頁同新人搜尋結果。
          </div>
        </div>
      </div>
    </div>
  );
}