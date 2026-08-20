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

import { useState, useMemo, useEffect, useRef } from 'react';
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
  ClipboardList,
  CheckCircle2,
  Circle,
  ChevronDown,
  Hourglass,
  PlayCircle,
  AlertTriangle,
  CalendarDays,
  PartyPopper,
  X,
  History,
  ChevronUp,
} from 'lucide-react';
import { getVendorCategoryLabel } from '../lib/config';
import { formatAbsoluteDue, formatLongAbsoluteDue } from '../lib/dueDate';
import { formatBudgetString } from '../lib/format';
import { ItemComments } from '../components/ItemComments';
import { VendorPortfolioAnalytics } from '../components/VendorPortfolioAnalytics';
import { VendorInquiriesPanel } from '../components/VendorInquiriesPanel';
import { TaskActivityTimeline } from '../components/TaskActivityTimeline';

// 2026-07-17 — task-status config. Five states. Stored on
// /tasks/{taskId}.status. Vendor-side writable per firestore.rules
// (allow-update with hasOnly(['status','statusUpdatedAt','statusNote'])).
// Owner-side shows a chip in their checklist. Vendors change status
// from this dashboard.
const TASK_STATUSES = [
  {
    id: 'pending',
    label: '待接 (仲未睇)',
    shortLabel: '待接',
    color: 'slate',
    Icon: Hourglass,
  },
  {
    id: 'accepted',
    label: '已接工作',
    shortLabel: '已接',
    color: 'emerald',
    Icon: CheckCircle2,
  },
  {
    id: 'in_progress',
    label: '進行中',
    shortLabel: '進行中',
    color: 'emerald',
    Icon: PlayCircle,
  },
  {
    id: 'blocked',
    label: '需要新人協助',
    shortLabel: '卡住',
    color: 'amber',
    Icon: AlertTriangle,
  },
  {
    id: 'done',
    label: '已完成',
    shortLabel: '完成',
    color: 'emerald',
    Icon: CheckCircle2,
  },
];

const STATUS_BY_ID = Object.fromEntries(TASK_STATUSES.map((s) => [s.id, s]));

function VendorAssignedItem({ item, currentUser, forceExpanded = false, onFocusedRef, focusedCommentId = null }) {
  const [expanded, setExpanded] = useState(forceExpanded);
  const rowRef = useRef(null);
  // 2026-08-17 — Manus A8: vendor-side deep-link focus. When the
  // couple clicks a Big Day comment bell alert addressed to this
  // vendor, App.jsx passes focusedParentId + focusedParentKind
  // down. The dashboard finds the matching assigned item (rd /
  // rs / tk), sets forceExpanded=true on this row so the
  // <ItemComments> panel opens, and scrolls into view with a
  // brief rose-400 ring highlight. The user can collapse it
  // manually afterwards.
  useEffect(() => {
    if (forceExpanded && !expanded) {
      setExpanded(true);
    }
    if (forceExpanded && rowRef.current) {
      // Defer to next tick so the expanded panel is mounted
      // before we measure its height.
      requestAnimationFrame(() => {
        const safeId =
          typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
            ? CSS.escape(item.id)
            : item.id.replace(/([^\w-])/g, '\\$1');
        const el =
          document.querySelector(`[data-row-id="${safeId}"]`) ||
          rowRef.current;
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Brief ring flash so the user sees what changed.
          el.classList.add('ring-2', 'ring-rose-400', 'rounded-xl');
          setTimeout(() => {
            el.classList.remove('ring-2', 'ring-rose-400', 'rounded-xl');
          }, 2200);
        }
        // Hand the ref back to the dashboard so the parent can
        // clear its focus state.
        if (onFocusedRef) onFocusedRef();
      });
    }
    // We intentionally only react to forceExpanded changes —
    // expanded is local UI state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceExpanded]);
  const title = item.title || item.name || item.label || item.description || '未命名項目';
  const detail = item.description || item.note || item.location || item.venue || '';
  const path = item.commentPath;
  // 2026-08-09 — Surface which wedding this is for at the top of
  // every assigned card. Vendors routinely take more than one event
  // at a time, so without this header they can't tell whether
  // "新娘梳洗、更衣" belongs to the 2027-01-01 wedding or the
  // 2027-04-15 one. The eventName / eventDate fields are
  // denormalized on the doc at write time (see App.jsx upsert
  // helpers) so we don't need a separate event-doc read here.
  const eventName = item.eventName || null;
  const eventDate = item.eventDate || null;
  return (
    <li
      ref={rowRef}
      data-row-id={item.id}
      // 2026-08-17 — data-row-kind is used by helpers / tests
      // to filter which list section a deep-link focus should
      // hit. We derive it from `item.commentPath` defensively:
      //   * string  — split on '/' and take the second-to-last
      //               (e.g. 'artifacts/.../rundown/rd-1/comments'
      //               → 'rundown')
      //   * object  — has __segments array (per ItemComments'
      //               contract); pull the kind from segments[-3]
      //   * other   — empty (no kind label)
      data-row-kind={
        typeof item.commentPath === 'string'
          ? item.commentPath.split('/').slice(-3, -2)[0] || ''
          : Array.isArray(item.commentPath?.__segments)
          ? item.commentPath.__segments.slice(-3, -2)[0] || ''
          : ''
      }
      className="rounded-xl border border-emerald-200 bg-white overflow-hidden"
    >
      {eventName && (
        <div
          className="px-3 py-2 bg-gradient-to-r from-emerald-50 to-teal-50 border-b border-emerald-200 flex items-center gap-2"
          title="呢個工作係邊場婚禮"
        >
          <span className="text-base">💒</span>
          <span className="text-xs font-black text-emerald-900 truncate flex-1">
            {eventName}
          </span>
          {eventDate && (
            <span className="text-[11px] font-bold text-emerald-700 bg-white border border-emerald-200 px-2 py-0.5 rounded-full whitespace-nowrap">
              📅 {eventDate}
            </span>
          )}
        </div>
      )}
      <div className="p-3 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-bold text-slate-800">{title}</div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-500 mt-1">
            {!eventName && item.eventId && (
              <span className="text-slate-400">💒 (event {item.eventId.slice(0, 6)}…)</span>
            )}
            {item.startTime && <span>🕒 {item.startTime}</span>}
            {item.dueDate && <span>📅 {item.dueDate}</span>}
            {item.dueTime && <span>· {item.dueTime}</span>}
            {item.category && <span>📂 {item.category}</span>}
            {item.venue && <span>📍 {item.venue}</span>}
          </div>
          {detail && (
            <p className="mt-1 text-xs text-slate-600 whitespace-pre-wrap">{detail}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={`p-1.5 rounded-lg border ${
            expanded
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-white text-slate-400 border-slate-200 hover:border-emerald-300'
          }`}
          aria-label="留言溝通"
          title="留言溝通"
        >
          <MessageSquare className="w-4 h-4" />
        </button>
      </div>
      {expanded && path && (
        <div className="px-3 pb-3">
          <ItemComments
            path={path}
            currentUser={{
              uid: currentUser?.uid,
              displayName: currentUser?.displayName || currentUser?.name,
              email: currentUser?.email,
            }}
            currentRole="vendor"
            label="留言溝通"
            emptyHint="未有留言，可以留低第一句。"
            parentAssignedVendorUid={item.assignedVendorUid || null}
            parentAssignedHelperUid={item.assignedHelperUid || null}
            // 2026-08-20 — Manus: comment-level deep-link (see
            // <ItemComments> focusedCommentId effect). Only
            // forward on this row when it's the one matching
            // focusedParentId; the parent <VendorDashboard> already
            // gates that, but a defensive null check here keeps
            // the contract clean.
            focusedCommentId={focusedCommentId}
          />
        </div>
      )}
      {expanded && !path && (
        <p className="px-3 pb-3 text-xs text-rose-600">
          留言路徑未準備好，請重新整理再試。
        </p>
      )}
    </li>
  );
}

export function VendorDashboard({
  user,
  vendor,
  jobRequests,
  loading,
  onSubmitProposal,
  onManageProfile,
  onLogout,
  isAdminPreview = false,
  assignedTasks = [],
  assignedRundown = [],
  assignedResources = [],
  onUpdateTaskStatus,
  onOpenInquiry,
  // 2026-08-17 — Manus A8: vendor-side deep-link focus. The bell
  // alert routed to vendor-dashboard now also seeds focusedParent*
  // so the matching assigned item auto-expands + scrolls into
  // view. The parent dashboard's job is just to find the item
  // and forward forceExpanded=true to the right <VendorAssignedItem>.
  focusedParentId = null,
  focusedParentKind = null,
  // 2026-08-20 — Manus: comment-level deep-link for vendor-side
  // bell alerts. Forwarded to each <VendorAssignedItem>; the one
  // whose item.id matches focusedParentId passes it to its
  // <ItemComments> panel for scrollIntoView on the matching
  // comment. Optional; defaults to null (no-op).
  focusedCommentId = null,
  onFocusedParentHandled = null,
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

  // 2026-07-20 — activation banner. For vendors who claimed their
  // seeded slot within the last 7 days, surface a friendly banner
  // asking them to confirm their listing is ready. The banner uses
  // sessionStorage so it dismisses per-session and doesn't pester
  // the vendor on every visit.
  const [activationBannerDismissed, setActivationBannerDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return sessionStorage.getItem('activationBannerDismissed') === '1';
    } catch {
      return false;
    }
  });
  const activationBanner = useMemo(() => {
    if (activationBannerDismissed) return null;
    if (!vendor?.claimedAt) return null;
    // claimedAt may be a Firestore Timestamp, ISO string, or number.
    let claimedMs = 0;
    try {
      const c = vendor.claimedAt;
      if (typeof c === 'object' && typeof c.toMillis === 'function') claimedMs = c.toMillis();
      else if (typeof c === 'object' && typeof c._seconds === 'number') claimedMs = c._seconds * 1000;
      else if (typeof c === 'string') claimedMs = new Date(c).getTime();
      else if (typeof c === 'number') claimedMs = c;
    } catch {
      return null;
    }
    if (!claimedMs) return null;
    const ageMs = Date.now() - claimedMs;
    if (ageMs < 0 || ageMs > 7 * 24 * 60 * 60 * 1000) return null;
    return { ageDays: Math.floor(ageMs / (24 * 60 * 60 * 1000)), originalSlug: vendor.originalSlug || null };
  }, [vendor?.claimedAt, vendor?.originalSlug, activationBannerDismissed]);

  // 2026-07-20 — portfolio analytics collapsible. Vendor clicks
  // "作品集分析" to expand the analytics panel. Collapsed by
  // default — most vendor tasks (claim jobs, edit profile) don't
  // need analytics on every visit.
  const [showAnalytics, setShowAnalytics] = useState(false);

  function dismissActivationBanner() {
    try {
      sessionStorage.setItem('activationBannerDismissed', '1');
    } catch {
      // ignore
    }
    setActivationBannerDismissed(true);
  }

  return (
    <div className="max-w-6xl mx-auto mt-8 animate-in slide-in-from-bottom-4 duration-500">
      {/* 2026-07-15 — when an admin clicks the 商戶 pill to preview the
          vendor UI but they themselves don't have a vendor profile, the
          dashboard would otherwise look broken (warning banner + empty
          state, no name, no category). Show a clear admin-preview
          banner so the admin understands what's happening. */}
      {isAdminPreview && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4 mb-6 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-bold text-indigo-900 mb-1">
              管理員預覽模式
            </h3>
            <p className="text-sm text-indigo-800">
              你正以管理員身份預覽商戶控制台。你本身並非商戶，所以呢度唔會顯示真實商戶資料。要睇真實商戶 UI，請用商戶帳號登入。
            </p>
          </div>
        </div>
      )}
      {/* 2026-07-20 — first-week activation banner. Shown to vendors
          who claimed their seeded listing within the last 7 days;
          helps them get oriented (edit profile, see job marketplace,
          set up pricing). Dismisses per-session so it doesn't pester
          repeat visitors — eventually the claimedAt threshold pushes
          it out of view permanently. */}
      {activationBanner && (
        <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl p-5 mb-6 relative animate-in slide-in-from-top-2 duration-500">
          <button
            type="button"
            onClick={dismissActivationBanner}
            className="absolute top-3 right-3 text-emerald-700 hover:bg-emerald-100 rounded-lg p-1.5"
            aria-label="關閉"
            title="下次再顯示"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="flex items-start gap-4 pr-8">
            <div className="w-12 h-12 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
              <PartyPopper className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-emerald-900 text-lg mb-1">
                歡迎！你的商戶帳戶已啟動 ✨
              </h3>
              <p className="text-emerald-800 text-sm mb-4 leading-relaxed">
                {activationBanner.ageDays === 0
                  ? '你今日剛完成啟動，建議花幾分鐘確認下以下資料，新人搜尋時就會見到你。'
                  : `你 ${activationBanner.ageDays} 日前完成啟動，建議盡快確認下以下資料，新人搜尋時會見到你。`}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => onManageProfile?.()}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 px-4 rounded-xl text-sm flex items-center justify-center gap-2"
                >
                  <Settings className="w-4 h-4" />
                  編輯商戶資料
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // Scroll to job marketplace area (the InboxSection is below).
                    const el = document.getElementById('job-marketplace-anchor');
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  className="bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-300 font-bold py-2.5 px-4 rounded-xl text-sm flex items-center justify-center gap-2"
                >
                  <Inbox className="w-4 h-4" />
                  睇睇新人嘅查詢
                </button>
                {activationBanner.originalSlug && (
                  <a
                    href={`https://www.heychoices.com/products/${activationBanner.originalSlug}-好唔好`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-300 font-bold py-2.5 px-4 rounded-xl text-sm flex items-center justify-center gap-2"
                    title="前往原本嘅 heychoices listing"
                  >
                    <Briefcase className="w-4 h-4" />
                    原本嘅 listing
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* 2026-07-20 — vendor inquiry inbox panel. Always visible
          at the top of the dashboard (not collapsible like the
          analytics one) — incoming customer messages are the most
          time-sensitive thing a vendor sees. Subscribes to
          /artifacts/{appId}/vendorInquiries for the current vendor,
          shows unread badge + recent 4 inquiries + link to full
          inbox. Click an inquiry → onOpenInquiry → App.jsx routes
          to the shared ChatRoom. */}
      <div className="mb-6">
        <VendorInquiriesPanel
          user={user}
          onOpenInquiry={onOpenInquiry}
        />
      </div>

      {/* 2026-07-20 — Portfolio analytics collapsible. Vendor clicks
          the button to expand; renders VendorPortfolioAnalytics
          which queries /vendorImageViews (firestore rule allows
          own-vendor read). */}
      <div className="mb-6">
        <button
          type="button"
          onClick={() => setShowAnalytics((s) => !s)}
          className="w-full bg-white border border-slate-200 hover:border-emerald-300 rounded-2xl px-5 py-3 flex items-center justify-between text-left shadow-sm transition-colors"
        >
          <span className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
              <History className="w-4 h-4 text-emerald-600" />
            </span>
            <span>
              <span className="font-black text-slate-800">作品集瀏覽分析</span>
              <span className="text-xs text-slate-500 ml-2">
                邊張相最多人睇 · 訪客來源
              </span>
            </span>
          </span>
          {showAnalytics ? (
            <ChevronUp className="w-5 h-5 text-slate-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-slate-400" />
          )}
        </button>
        {showAnalytics && (
          <div className="mt-3">
            <VendorPortfolioAnalytics user={user} vendorUid={vendor?.vendorUid || vendor?.id} />
          </div>
        )}
      </div>
      <div className="bg-slate-900 rounded-2xl p-5 md:p-8 text-white mb-8 flex flex-col md:flex-row md:justify-between md:items-center gap-4">
        <div className="min-w-0 flex-1">
          {/* 2026-07-23 — Mobile-friendly header.
              Previously the title wrapped to "商戶接單大堂\n(Vendor
              Board)" on narrow viewports because (Vendor Board) was
              inline with the Chinese title. On mobile we now show
              the Chinese-only version; the English translation
              appears on sm+ where there's room. The Briefcase icon
              also gets whitespace-nowrap so the icon + first
              character never separate. */}
          <h2 className="text-xl md:text-2xl font-bold flex items-center gap-2 md:gap-3">
            <Briefcase className="w-6 h-6 md:w-7 md:h-7 text-emerald-400 flex-shrink-0" />
            <span className="whitespace-nowrap md:hidden">商戶接單大堂</span>
            <span className="hidden md:inline whitespace-nowrap">商戶接單大堂 (Vendor Board)</span>
          </h2>
          <p className="text-slate-400 mt-2 text-sm">
            瀏覽全港新人發佈的急切要求，主動發送報價單發掘潛在客源。
          </p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full md:w-auto min-w-0">
          {onManageProfile && (
            <button
              type="button"
              onClick={onManageProfile}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2.5 rounded-xl flex items-center justify-center gap-2 transition-colors whitespace-nowrap flex-shrink-0"
            >
              <Settings className="w-4 h-4 flex-shrink-0" />
              <span>管理專頁</span>
            </button>
          )}
          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="bg-slate-700 hover:bg-slate-800 text-white font-bold px-4 py-2.5 rounded-xl flex items-center justify-center gap-2 transition-colors border border-slate-600 whitespace-nowrap flex-shrink-0"
              title="登出商戶帳號"
            >
              <LogOut className="w-4 h-4 flex-shrink-0" />
              <span>登出</span>
            </button>
          )}
          {/* Vendor name card — on mobile it goes full-width below
              the buttons; on sm+ it sits inline. min-w-0 lets it
              truncate instead of pushing the buttons off-screen. */}
          <div className="bg-slate-800/80 backdrop-blur px-4 py-3 rounded-xl border border-slate-700 min-w-0 flex-1 sm:flex-initial">
            <div className="text-xs text-slate-400 mb-0.5">當前登入商戶：</div>
            <div
              className="font-bold text-emerald-400 text-base md:text-lg truncate"
              data-testid="vendor-name"
              title={vendorName}
            >
              {vendorName}
            </div>
            {categoryLabel && (
              <div className="text-xs text-slate-400 mt-0.5 truncate">{categoryLabel}</div>
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

      {/* 2026-07-15 — assigned tasks from couple's to-do list.
          Vendors see tasks here when a 主理新人 adds them in their
          MyVendorsPanel and assigns them to a checklist task.
          Tasks are filtered by assignedVendorUid == vendor.uid
          (queried via collectionGroup in App.jsx). Lets vendors
          see exactly what work is on their plate for each couple
          they're connected to. */}
      {!loading && (assignedTasks.length > 0 || assignedRundown.length > 0 || assignedResources.length > 0) && (
        <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-2xl p-6 border border-emerald-200 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <ClipboardList className="w-6 h-6 text-emerald-600" />
            <h2 className="text-xl font-black text-emerald-900">📋 主理新人指派嘅工作</h2>
            <span className="ml-auto bg-emerald-500 text-white text-xs font-black px-2.5 py-0.5 rounded-full">
              {assignedTasks.length + assignedRundown.length + assignedResources.length} 個
            </span>
          </div>
          <p className="text-sm text-emerald-800 mb-4">
            任務、大日流程同物資都會喺度顯示。你可以更新任務狀態，亦可以直接留言同新人溝通。
          </p>
          {/*
            2026-08-09 — Group by event, NOT by type. A vendor routinely
            takes more than one wedding at a time, so seeing "大日流程
            (3) 📦 物資 (2)" across two couples makes it impossible to
            tell which item belongs to which wedding. Now each event
            gets its own section header (event name + date) so the
            vendor immediately knows which wedding the items below
            are for. Within an event, we still sub-group by type
            (rundown / resources / tasks) so the structure is familiar.
          */}
          {(() => {
            // Build unique event list, ordered by eventDate asc (the
            // soonest wedding first). Falls back to eventName for
            // stability if the date isn't denormalized yet (legacy
            // docs).
            const allItems = [
              ...assignedRundown,
              ...assignedResources,
              ...assignedTasks,
            ];
            const eventKeys = [
              ...new Map(
                allItems
                  .filter((i) => i.eventId)
                  .map((i) => [
                    `${i.ownerUid}/${i.eventId}`,
                    {
                      key: `${i.ownerUid}/${i.eventId}`,
                      ownerUid: i.ownerUid,
                      eventId: i.eventId,
                      eventName: i.eventName,
                      eventDate: i.eventDate,
                    },
                  ]),
              ).values(),
            ];
            eventKeys.sort((a, b) => {
              const ad = a.eventDate || '';
              const bd = b.eventDate || '';
              if (ad !== bd) return ad.localeCompare(bd);
              return (a.eventName || '').localeCompare(b.eventName || '');
            });
            const inEvent = (key) => (item) =>
              item.eventId && `${item.ownerUid}/${item.eventId}` === key;
            if (eventKeys.length === 0) return null;
            return eventKeys.map((ev) => {
              const rd = assignedRundown.filter(inEvent(ev.key));
              const rs = assignedResources.filter(inEvent(ev.key));
              const tk = assignedTasks.filter(inEvent(ev.key));
              return (
                <div
                  key={ev.key}
                  className="mb-5 last:mb-0 bg-white/40 border border-emerald-100 rounded-xl p-3"
                >
                  <div className="flex items-center gap-2 mb-3 pb-2 border-b border-emerald-100">
                    <span className="text-base">💒</span>
                    <span className="font-black text-emerald-900 truncate flex-1">
                      {ev.eventName || `婚禮 ${ev.eventId.slice(0, 6)}…`}
                    </span>
                    {ev.eventDate && (
                      <span className="text-[11px] font-bold text-emerald-700 bg-white border border-emerald-200 px-2 py-0.5 rounded-full whitespace-nowrap">
                        📅 {ev.eventDate}
                      </span>
                    )}
                    <span className="text-[10px] text-emerald-700 font-bold">
                      {rd.length + rs.length + tk.length} 個
                    </span>
                  </div>
                  {rd.length > 0 && (
                    <div className="mb-3">
                      <h4 className="text-xs font-bold text-emerald-800 mb-1.5">
                        🕒 大日流程 ({rd.length})
                      </h4>
                      <ul className="space-y-2">
                        {rd.map((item) => (
                          <VendorAssignedItem
                            key={`${item.ownerUid}_${item.eventId}_${item.id}`}
                            item={item}
                            currentUser={user}
                            forceExpanded={
                              focusedParentId === item.id &&
                              (focusedParentKind === 'rundown' ||
                                focusedParentKind === null)
                            }
                            // 2026-08-20 — Manus: pass the comment-
                            // level focus only to the matching row so
                            // the other (non-matching) ItemComments
                            // panels don't try to scroll the same
                            // comment. Same gating as forceExpanded.
                            focusedCommentId={
                              focusedParentId === item.id
                                ? focusedCommentId
                                : null
                            }
                            onFocusedRef={
                              focusedParentId === item.id
                                ? onFocusedParentHandled
                                : undefined
                            }
                          />
                        ))}
                      </ul>
                    </div>
                  )}
                  {rs.length > 0 && (
                    <div className="mb-3">
                      <h4 className="text-xs font-bold text-emerald-800 mb-1.5">
                        📦 物資 ({rs.length})
                      </h4>
                      <ul className="space-y-2">
                        {rs.map((item) => (
                          <VendorAssignedItem
                            key={`${item.ownerUid}_${item.eventId}_${item.id}`}
                            item={item}
                            currentUser={user}
                            forceExpanded={
                              focusedParentId === item.id &&
                              (focusedParentKind === 'resources' ||
                                focusedParentKind === null)
                            }
                            // 2026-08-20 — see rundown block above.
                            focusedCommentId={
                              focusedParentId === item.id
                                ? focusedCommentId
                                : null
                            }
                            onFocusedRef={
                              focusedParentId === item.id
                                ? onFocusedParentHandled
                                : undefined
                            }
                          />
                        ))}
                      </ul>
                    </div>
                  )}
                  {tk.length > 0 && (
                    <div>
                      <h4 className="text-xs font-bold text-emerald-800 mb-1.5">
                        ✅ 待辦任務 ({tk.length})
                      </h4>
                      <ul className="space-y-2">
                        {tk.map((t) => (
                          <VendorTaskCard
                            key={`${t.ownerUid}_${t.id}`}
                            task={t}
                            onUpdateStatus={onUpdateTaskStatus}
                            currentUser={vendor}
                          />
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            });
          })()}
        </div>
      )}
      {!loading && assignedTasks.length === 0 && assignedRundown.length === 0 && assignedResources.length === 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 mb-6">
          <div className="flex items-start gap-3">
            <ClipboardList className="w-5 h-5 text-emerald-600 mt-0.5" />
            <div>
              <h2 className="font-black text-emerald-900">暫時未有指派工作</h2>
              <p className="text-sm text-emerald-800 mt-1">新人可以喺大日流程、物資或待辦清單入面揀選你。完成指派後，工作會自動出現喺呢度。</p>
            </div>
          </div>
        </div>
      )}

      {/* Loading / empty states */}
      <div id="job-marketplace-anchor" />
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
                  <strong className="text-rose-600">{formatBudgetString(job.budget)}</strong>
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

/**
 * VendorTaskCard
 *
 * Single assigned-task row in the vendor's "主理新人指派嘅工作" panel.
 * Lets the vendor pick a status (pending / accepted / in_progress /
 * blocked / done) without leaving the dashboard. Writes go through
 * the parent callback which directly update the Firestore doc — the
 * rules allow only those three fields in this update path.
 *
 * The vendor can attach a short `statusNote` (one-line clarification,
 * e.g. "等緊場地回覆"). Optional + only shown when status === blocked.
 *
 * 2026-07-17:
 *   • Status defaults to `pending` for tasks created before this date
 *     (no status field) — backwards-compat with existing task docs.
 *   • Done status syncs with the couple's "已完成" checkbox semantics:
 *     flipping to "done" also flips `isCompleted = true` on the task
 *     so the couple's checklist stays the single source of truth for
 *     completion. The couple can still uncheck to override.
 */
function VendorTaskCard({ task, onUpdateStatus, currentUser }) {
  const statusId = task.status || 'pending';
  const status = STATUS_BY_ID[statusId] || STATUS_BY_ID.pending;
  const StatusIcon = status.Icon;
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [note, setNote] = useState(task.statusNote || '');
  const [expanded, setExpanded] = useState(false);

  // Color palette maps to vendor's emerald theme + amber for blocked.
  const palette = {
    slate: { chip: 'bg-slate-100 text-slate-700 border-slate-200' },
    emerald: { chip: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    amber: { chip: 'bg-amber-100 text-amber-700 border-amber-200' },
  }[status.color];

  const handleSelect = async (newStatusId) => {
    if (!onUpdateStatus) return;
    if (newStatusId === statusId) {
      setPicking(false);
      return;
    }
    setSaving(true);
    try {
      await onUpdateStatus(task, newStatusId, note);
      setPicking(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <li
      className={`rounded-xl border bg-white overflow-hidden ${
        statusId === 'done' || task.isCompleted
          ? 'border-slate-200 opacity-75'
          : statusId === 'blocked'
            ? 'border-amber-300 ring-1 ring-amber-100'
            : 'border-emerald-300'
      }`}
    >
      <div className="p-3 flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <StatusIcon
            className={`w-5 h-5 ${
              status.color === 'amber'
                ? 'text-amber-500'
                : status.color === 'emerald'
                  ? 'text-emerald-500'
                  : 'text-slate-400'
            }`}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div
            className={`font-bold text-slate-800 ${
              statusId === 'done' || task.isCompleted ? 'line-through' : ''
            }`}
          >
            {task.title || task.category || '未命名任務'}
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-slate-500 mt-1">
            {task.category && (
              <span>
                📂{' '}
                {getVendorCategoryLabel(
                  task.category.split('.')[0],
                  task.category.split('.')[1],
                )}
              </span>
            )}
            {task.dueDate && (
              <span
                className="inline-flex items-center gap-1 bg-white border border-slate-200 px-2 py-0.5 rounded-full text-[11px] text-slate-600"
                title={formatLongAbsoluteDue(task.dueDate, task.dueTime)}
              >
                <CalendarDays className="w-3 h-3 text-slate-400" />
                {formatAbsoluteDue(task.dueDate, task.dueTime)}
                {!task.dueTime && (
                  <span className="text-[10px] text-slate-400 ml-1">整天</span>
                )}
              </span>
            )}
            {task.estimatedCost ? (
              <span>💰 預算 ${Number(task.estimatedCost).toLocaleString()}</span>
            ) : null}
            {task.ownerUid && (
              <span className="text-xs text-slate-400">
                · {task.ownerName || '主理新人'}
              </span>
            )}
          </div>
          {task.statusNote && (
            <div className="mt-1.5 text-xs text-slate-600 italic bg-slate-50 border-l-2 border-slate-300 pl-2 py-1">
              「{task.statusNote}」
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className={`p-1.5 rounded-lg border ${
              expanded
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-white text-slate-400 border-slate-200 hover:border-emerald-300 hover:text-emerald-600'
            }`}
            title="留言溝通"
            aria-label="留言溝通"
          >
            <MessageCircle className="w-4 h-4" />
          </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setPicking((p) => !p)}
            disabled={saving}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border ${palette.chip} ${
              saving ? 'opacity-50' : ''
            }`}
            title="更新工作狀態"
          >
            {saving ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
            {status.shortLabel}
          </button>
          {picking && (
            <div className="absolute right-0 mt-1 z-20 bg-white rounded-lg shadow-xl border border-slate-200 py-1 min-w-[160px]">
              {TASK_STATUSES.map((s) => {
                const SIcon = s.Icon;
                const isCurrent = s.id === statusId;
                return (
                  <button
                    key={s.id}
                    onClick={() => handleSelect(s.id)}
                    disabled={saving}
                    className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-slate-50 ${
                      isCurrent ? 'bg-slate-50 font-bold' : ''
                    } ${saving ? 'opacity-50' : ''}`}
                  >
                    <SIcon className="w-3.5 h-3.5 text-slate-500" />
                    {s.label}
                    {isCurrent && (
                      <CheckCircle2 className="w-3 h-3 ml-auto text-emerald-500" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        </div>
      </div>
      {/* Note field — only meaningful for `blocked`. For other statuses
          we hide it but the value still persists if previously set. */}
      {statusId === 'blocked' && (
        <div className="px-3 pb-3">
          <input
            type="text"
            placeholder="一句講低卡喺邊度（例：等緊場地回覆）..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => note !== (task.statusNote || '') && onUpdateStatus && onUpdateStatus(task, 'blocked', note)}
            className="w-full px-2.5 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-xs"
            maxLength={120}
          />
        </div>
      )}
      {expanded && (
        <div className="px-3 pb-3">
          {/* 2026-07-19 — switch to merged `<TaskActivityTimeline>`
              so vendors see status updates from the couple alongside
              discussion. Same role pass-through, vendor-side.
              ownerUid is `task.ownerUid` here because vendor tasks
              come in via collectionGroup which preserves that field
              (CoupleChecklist's tasks don't carry it, so there we
              have to source it from currentUser instead). */}
          <TaskActivityTimeline
            task={task}
            ownerUid={task.ownerUid}
            eventId={task.eventId}
            currentUser={{ uid: currentUser?.uid || '', displayName: currentUser?.name || '商戶' }}
            currentRole="vendor"
          />
        </div>
      )}
    </li>
  );
}