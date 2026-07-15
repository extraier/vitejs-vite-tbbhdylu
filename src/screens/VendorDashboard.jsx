// VendorDashboard.jsx — vendor's view of the public job marketplace.
//
// Reads the vendor's own profile from props (passed by App.jsx, which
// fetches it live from /vendors/{uid}) so the "current vendor" pill
// reflects the logged-in user's actual business name instead of a
// hardcoded demo value.
//
// Job requests are also passed as a prop from App.jsx, sourced from
// Firestore /jobRequests collection — see the live query in App.jsx.
//
// 2026-07-15 — previously hardcoded "Visionary Capture" as the
// vendor name and used a hardcoded INITIAL_JOB_REQUESTS array as
// the listing. Both now come from Firestore.

import {
  Briefcase,
  Calendar,
  DollarSign,
  MessageSquare,
  Loader2,
  Inbox,
  Settings,
  AlertCircle,
  LogOut,
} from 'lucide-react';
import { getVendorCategoryLabel } from '../lib/config';

export function VendorDashboard({
  vendor,
  jobRequests,
  loading,
  onSubmitProposal,
  onManageProfile,
  onLogout,
}) {
  const vendorName = vendor?.name || '（未設定商戶名稱）';
  // 2026-07-15 — hierarchical category: getVendorCategoryLabel resolves
  // (category, subcategory) to "婚宴場地 · 酒店宴會廳" etc. Falls back
  // to the flat TASK_CATEGORIES label for legacy docs that have no
  // subcategory yet.
  const categoryLabel = vendor?.category
    ? ` · ${getVendorCategoryLabel(vendor.category, vendor.subcategory)}`
    : '';
  const hasName = Boolean(vendor?.name && vendor.name.trim().length >= 2);

  return (
    <div className="max-w-6xl mx-auto mt-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="bg-slate-900 rounded-2xl p-8 text-white mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-3">
            <Briefcase className="w-7 h-7 text-emerald-400" /> 商戶接單大堂 (Vendor Board)
          </h2>
          <p className="text-slate-400 mt-2 text-sm">
            瀏覽全港新人發佈的急切要求，主動發送報價單發掘潛在客源。
          </p>
        </div>
        <div className="flex items-center gap-3">
          {onManageProfile && (
            <button
              type="button"
              onClick={onManageProfile}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-xl flex items-center gap-2 transition-colors"
            >
              <Settings className="w-4 h-4" /> 管理專頁
            </button>
          )}
          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="bg-slate-700 hover:bg-slate-800 text-white font-bold px-4 py-2 rounded-xl flex items-center gap-2 transition-colors border border-slate-600"
              title="登出商戶帳號"
            >
              <LogOut className="w-4 h-4" /> 登出
            </button>
          )}
          <div className="bg-slate-800/80 backdrop-blur px-5 py-3 rounded-xl border border-slate-700">
            <div className="text-xs text-slate-400 mb-0.5">當前登入商戶：</div>
            <div className="font-bold text-emerald-400 text-lg" data-testid="vendor-name">
              {vendorName}
            </div>
            {categoryLabel && (
              <div className="text-xs text-slate-400 mt-0.5">{categoryLabel}</div>
            )}
          </div>
        </div>
      </div>

      {/* Missing-name prompt — only shows when the vendor doc has no name,
          which happens for users who completed the wizard with empty
          form fields, or for stale docs from before the field was
          mandatory. */}
      {!loading && !hasName && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-6 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-bold text-amber-900 mb-1">尚未設定商戶名稱</h3>
            <p className="text-sm text-amber-800 mb-3">
              你嘅商戶專頁缺少商戶名稱，新人搜唔到你。請到「管理專頁」補回資料。
            </p>
            {onManageProfile && (
              <button
                type="button"
                onClick={onManageProfile}
                className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-4 py-2 rounded-xl text-sm transition-colors"
              >
                去設定 →
              </button>
            )}
          </div>
        </div>
      )}

      {/* Loading / empty states */}
      {loading && (
        <div className="bg-white rounded-2xl p-12 text-center border border-slate-200">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mx-auto mb-3" />
          <p className="text-slate-500">載入中...</p>
        </div>
      )}

      {!loading && (!jobRequests || jobRequests.length === 0) && (
        <div className="bg-white rounded-2xl p-12 text-center border border-slate-200">
          <Inbox className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-slate-700 mb-1">暫時未有 job 刊登</h3>
          <p className="text-sm text-slate-500">
            全港新人嘅急切要求會顯示喺度。稍後返嚟睇睇啦！
          </p>
        </div>
      )}

      {!loading && jobRequests && jobRequests.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {jobRequests.map((job) => (
            <div
              key={job.id}
              className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 hover:border-emerald-300 transition-all flex flex-col h-full"
            >
              <div className="mb-4 mt-2">
                <h3 className="text-xl font-bold text-slate-800 mb-1">
                  {job.serviceNeeded}
                </h3>
                <p className="text-sm text-slate-500 font-medium">
                  客戶: {job.coupleName} • 發佈於 {formatPostedAt(job.postedAt)}
                </p>
              </div>
              <div className="space-y-3 mb-6 flex-grow bg-slate-50 p-4 rounded-xl border border-slate-100">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500 flex items-center gap-1.5">
                    <Calendar className="w-4 h-4" /> 婚期
                  </span>
                  <strong className="text-slate-800">{job.weddingDate}</strong>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500 flex items-center gap-1.5">
                    <DollarSign className="w-4 h-4" /> 預算
                  </span>
                  <strong className="text-rose-600">{job.budget}</strong>
                </div>
                <div className="text-sm text-slate-700 mt-3 pt-3 border-t border-slate-200 leading-relaxed">
                  <span className="text-slate-400 block mb-1 text-xs">詳細要求：</span>
                  "{job.details}"
                </div>
              </div>
              <button
                onClick={() => onSubmitProposal(job.id)}
                className="w-full bg-emerald-600 text-white font-bold py-3 rounded-xl hover:bg-emerald-700 transition-colors flex justify-center items-center gap-2 shadow-sm"
              >
                <MessageSquare className="w-5 h-5" /> 立即發送報價單
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// postedAt may be a Firestore Timestamp, a millisecond number, an ISO
// string, or already a humanised string (e.g. '2小時前'). Handle all
// four shapes so we don't crash on older / in-flight data.
function formatPostedAt(postedAt) {
  if (!postedAt) return '—';
  if (typeof postedAt === 'string') return postedAt;
  let date;
  if (typeof postedAt === 'number') {
    date = new Date(postedAt);
  } else if (typeof postedAt.toDate === 'function') {
    date = postedAt.toDate();
  } else if (postedAt.seconds) {
    date = new Date(postedAt.seconds * 1000);
  } else {
    return '—';
  }
  if (Number.isNaN(date.getTime())) return '—';
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return '剛剛';
  if (minutes < 60) return `${minutes}分鐘前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小時前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}日前`;
  return date.toLocaleDateString('zh-HK');
}