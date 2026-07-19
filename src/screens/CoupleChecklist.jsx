import { useMemo, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Circle,
  MapPin,
  Clock,
  DollarSign,
  Trash2,
  Plus,
  ArrowRight,
  Search,
  Star,
  Sparkles,
  Save,
  X,
  MessageCircle,
  Calendar as CalendarIcon,
  CalendarDays,
} from 'lucide-react';
import { TaskComments } from '../components/TaskComments';
import { TaskActivityTimeline } from '../components/TaskActivityTimeline';
import { TASK_CATEGORIES, VENDOR_CATEGORIES, getTaskCategoryLabel } from '../lib/config';
import { formatAbsoluteDue, formatLongAbsoluteDue } from '../lib/dueDate';

// 2026-07-15 — local helper for the vendor-contact dropdown in
// the add-task form. Reads VENDOR_CATEGORIES and resolves
// 'venue.banquet_hall' → '婚宴場地 · 酒店宴會廳', 'venue' → '婚宴場地',
// etc. Falls back to the raw key.
function categoryLabel(key) {
  if (!key) return '';
  if (key.includes('.')) {
    const [top, sub] = key.split('.');
    const t = VENDOR_CATEGORIES[top];
    if (t?.subs?.[sub]) return `${t.label} · ${t.subs[sub]}`;
    if (t) return t.label;
    return key;
  }
  return VENDOR_CATEGORIES[key]?.label || key;
}

/**
 * DateTimePicker — chip-style combined date+time picker for the
 * new-task form. Reads as one unit (`📅 12月31日 14:30`) and opens a
 * popover with date <input type="date">, time <input type="time">,
 * quick presets ('今天' / '明天' / '後天' / '+1 週'), and an
 * "整天" toggle that clears the time (date-only mode).
 *
 * 2026-07-17 — replaces the two side-by-side inputs from the
 * previous turn. Click-outside closes the popover. We do not
 * auto-close on input change — couples often type the date and
 * then immediately the time without clicking away, so a premature
 * close is more disruptive than helpful.
 */
function DateTimePicker({ dueDate, dueTime, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
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

  const quickSet = (daysFromNow) => {
    const target = new Date();
    target.setDate(target.getDate() + daysFromNow);
    const yyyy = target.getFullYear();
    const mm = String(target.getMonth() + 1).padStart(2, '0');
    const dd = String(target.getDate()).padStart(2, '0');
    onChange({ ...{ dueDate: dueDate, dueTime: dueTime }, dueDate: `${yyyy}-${mm}-${dd}` });
  };

  const absolute = formatAbsoluteDue(dueDate, dueTime);
  const allDay = !dueTime;

  return (
    <div className="relative col-span-1" ref={rootRef}>
      {/* The chip — single visual unit, full width of its slot. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`w-full flex items-center gap-2 p-2.5 border rounded-lg text-sm outline-none text-slate-700 bg-white hover:border-rose-300 transition-colors ${
          open ? 'border-rose-400 ring-1 ring-rose-100' : 'border-slate-300'
        }`}
      >
        <CalendarIcon className="w-4 h-4 text-slate-400 shrink-0" />
        <span className="font-medium truncate">
          {absolute || '揀日子...'}
        </span>
        {allDay && dueDate && (
          <span className="ml-auto text-[10px] text-slate-400 font-normal">整天</span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="任務到期日 / 時間"
          className="absolute z-30 left-0 right-0 top-full mt-2 rounded-xl bg-white shadow-xl border border-slate-200 p-3 w-[260px]"
        >
          {/* Quick presets row */}
          <div className="grid grid-cols-4 gap-1 mb-2">
            <button
              type="button"
              className="px-2 py-1.5 rounded-md text-[11px] font-medium bg-slate-100 hover:bg-rose-50 hover:text-rose-700"
              onClick={() => quickSet(0)}
            >
              今天
            </button>
            <button
              type="button"
              className="px-2 py-1.5 rounded-md text-[11px] font-medium bg-slate-100 hover:bg-rose-50 hover:text-rose-700"
              onClick={() => quickSet(1)}
            >
              明天
            </button>
            <button
              type="button"
              className="px-2 py-1.5 rounded-md text-[11px] font-medium bg-slate-100 hover:bg-rose-50 hover:text-rose-700"
              onClick={() => quickSet(2)}
            >
              後天
            </button>
            <button
              type="button"
              className="px-2 py-1.5 rounded-md text-[11px] font-medium bg-slate-100 hover:bg-rose-50 hover:text-rose-700"
              onClick={() => quickSet(7)}
            >
              +1 週
            </button>
          </div>

          {/* Date + time inputs */}
          <div className="grid grid-cols-2 gap-2 mb-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                日期
              </span>
              <input
                type="date"
                required
                className="p-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-rose-300"
                value={dueDate}
                onChange={(e) => onChange({ dueDate: e.target.value, dueTime })}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                時間
              </span>
              <input
                type="time"
                className="p-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-rose-300"
                value={dueTime}
                onChange={(e) => onChange({ dueDate, dueTime: e.target.value })}
              />
            </label>
          </div>

          {/* All-day toggle + close */}
          <div className="flex items-center justify-between mt-1 pt-2 border-t border-slate-100">
            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allDay}
                onChange={(e) => {
                  // Toggle: clearing time => date-only mode.
                  onChange({ dueDate, dueTime: e.target.checked ? '' : dueTime || '09:00' });
                }}
                className="w-3.5 h-3.5 accent-rose-600"
              />
              整天（全日）
            </label>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs font-bold text-rose-600 hover:text-rose-700"
            >
              完成
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * TaskDeadline — countdown badge for the checklist.
 *
 * Renders a live-updating label relative to a YYYY-MM-DD deadline.
 * Three visual states:
 *   overdue  : red-50 / red-700, "已過 X 日"             (negative)
 *   urgent   : amber-50 / amber-700, "<= 7 日"          (small remainder)
 *   upcoming : slate-100 / slate-600, "X 日 Y 個鐘"     (> 7 日)
 *
 * Ticks once per minute (not per second) to avoid rAF churn on
 * long task lists. Only re-renders THIS badge when its own ms
 * elapsed crosses a fresh minute boundary — siblings stay quiet.
 *
 * The badge is calendar-day aware — partial days round down to 0
 * once we cross into "today", we still show "今天到期" until the
 * end of the day (instead of "0 日 3 小時"). This matches what
 * couples actually want to know: "is today THE day".
 */
function TaskDeadline({ dueDate, dueTime }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!dueDate) {
    return (
      <div className="flex items-center gap-1">
        <Clock className="w-3.5 h-3.5" /> 沒有期限
      </div>
    );
  }

  // dueDate is a 'YYYY-MM-DD' string. Treat it as midnight LOCAL on
  // that date — that's how the form's <input type="date"> emits it.
  const [y, m, d] = dueDate.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) {
    return (
      <div className="flex items-center gap-1">
        <Clock className="w-3.5 h-3.5" /> {dueDate}
      </div>
    );
  }
  // 2026-07-17 — accept an optional HH:MM time. When present, the
  // deadline is anchored to that exact minute (not end-of-day). When
  // absent, fall back to end-of-day (23:59:59) — same as before, so
  // existing date-only tasks behave identically.
  let hour = 23, min = 59;
  if (dueTime && /^\d{2}:\d{2}$/.test(dueTime)) {
    const [hh, mm] = dueTime.split(':').map((n) => parseInt(n, 10));
    if (!Number.isNaN(hh) && !Number.isNaN(mm) && hh >= 0 && hh < 24 && mm >= 0 && mm < 60) {
      hour = hh; min = mm;
    }
  }
  const deadlineMs = new Date(y, m - 1, d, hour, min, 0).getTime();
  const msRemaining = deadlineMs - now;
  const overdueMs = -msRemaining;

  // Format the human label.
  let label, style;
  if (msRemaining < 0) {
    const days = Math.floor(overdueMs / 86_400_000);
    label = days === 1 ? '已過 1 日' : `已過 ${days} 日`;
    style = 'bg-rose-50 text-rose-700 border-rose-200';
  } else {
    const days = Math.floor(msRemaining / 86_400_000);
    const hours = Math.floor((msRemaining % 86_400_000) / 3_600_000);
    if (days === 0 && hours === 0) {
      // 2026-07-17 — when a task has both date + time, show the
      // actual time on the badge so couples see when the deadline
      // truly ticks. Otherwise keep the legacy "今天到期" wording.
      label = dueTime ? `今天 ${dueTime} 到期` : '今天到期';
      style = 'bg-rose-50 text-rose-700 border-rose-200';
    } else if (days === 0) {
      label = `今天仲有 ${hours} 小時`;
      style = 'bg-amber-50 text-amber-700 border-amber-200';
    } else if (days <= 7) {
      label = `${days} 日 ${hours} 小時`;
      style = 'bg-amber-50 text-amber-700 border-amber-200';
    } else {
      label = `${days} 日 ${hours} 小時`;
      style = 'bg-slate-100 text-slate-600 border-slate-200';
    }
  }

  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border ${style}`}
      title={`期限：${dueDate}${dueTime ? ` ${dueTime}` : ''}（剩下時間即時更新）`}
    >
      <Clock className="w-3 h-3" />
      {label}
    </span>
  );
}

// 2026-07-17 — mirrors the status the assigned vendor picked on their
// VendorDashboard. Pure display — couple can't change vendor status.
// Same five-state taxonomy as on the vendor side. Rendered as a small
// chip next to the assigned-vendor badge on each task row.
//
// Note field is shown as italic prefix in the badge title (hover) so
// the couple can see e.g. "卡住：等緊場地回覆" without us crowding the
// row.
function VendorStatusChip({ status, note }) {
  const map = {
    pending:    { label: '商戶：待接',     color: 'bg-slate-100 text-slate-600 border-slate-200' },
    accepted:   { label: '商戶：已接',     color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    in_progress:{ label: '商戶：進行中',   color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    blocked:    { label: '商戶：卡住',     color: 'bg-amber-50 text-amber-700 border-amber-200' },
    done:       { label: '商戶：已完成',   color: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  };
  const m = map[status] || map.pending;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${m.color}`}
      title={note ? `${m.label} — ${note}` : m.label}
    >
      {m.label}
    </span>
  );
}
import { budgetFitTier, budgetDistance, formatVendorPrice, formatMoney, parseFormattedNumber } from '../lib/format';

export function CoupleChecklist({
  tasks,
  vendors,
  activeCategory,
  activeVenue,
  editingTaskId,
  onClearEditingTask,
  onSelectCategory,
  onToggleTask,
  onDeleteTask,
  onUpdateTaskCost,
  newTaskForm,
  onNewTaskFormChange,
  onAddTask,
  onClearActiveCategory,
  onGoDiscover,
  onGoJobBoard,
  onOpenChat,
  myVendorsPanel,
  vendorContacts = [],
  // 2026-07-17 — Active helpers (兄弟姊妹) sourced from
  // users/{uid}/helpers in App.jsx. Same parallel pattern as
  // vendorContacts: each entry has at least id and a
  // displayName/name; we render 'pick' mode for them and offer
  // a '+ 自訂' toggle to fall back to a free-form typed name
  // when the helper hasn't been invited yet.
  helpers = [],
  helpersLoading = false,
  currentUser,
}) {
  const progressPercentage = Math.round(
    (tasks.filter((t) => t.isCompleted).length / (tasks.length || 1)) * 100,
  );

  // Resolve the budget for the currently-selected task (the first
  // non-completed task in `activeCategory`). Used by the vendor sort below
  // — falls back to `null` if there's no budget, in which case we skip the
  // budget tier entirely and just use venue match + rating.
  const activeTaskBudget = useMemo(() => {
    const t = tasks.find(
      (task) => task.category === activeCategory && !task.isCompleted,
    );
    return t?.estimatedCost ? Number(t.estimatedCost) : null;
  }, [tasks, activeCategory]);

  const filteredVendors = useMemo(() => {
    if (!activeCategory) return [];
    // 2026-07-18 — Subcategory-aware smart-match. Tasks may store
    // category as either a bare top-level key (e.g. 'photo_video')
    // OR a 'top.sub' namespace ('photo_video.photographer'). When a
    // subcategory is in scope we narrow to vendors whose category
    // matches the top AND whose subcategory matches the sub. When
    // there's no sub (or the key didn't split) we keep the legacy
    // top-only filter, which is the documented v1 behaviour.
    let matched;
    const dotIdx = activeCategory.indexOf('.');
    if (dotIdx > 0) {
      const top = activeCategory.slice(0, dotIdx);
      const sub = activeCategory.slice(dotIdx + 1);
      matched = vendors.filter(
        (v) => v.category === top && v.subcategory === sub,
      );
    } else {
      matched = vendors.filter((v) => v.category === activeCategory);
    }

    // Stable per-vendor helpers so the comparator stays readable.
    const venueMatchScore = (v) =>
      activeVenue && v.tags.some((tag) => activeVenue.includes(tag) || tag.includes(activeVenue))
        ? 1
        : 0;

    matched.sort((a, b) => {
      // 1. Budget fit (when task has a budget). Lower tier = better fit.
      if (activeTaskBudget) {
        const tierDiff = budgetFitTier(a, activeTaskBudget) - budgetFitTier(b, activeTaskBudget);
        if (tierDiff !== 0) return tierDiff;
        // Within the same tier, push the vendor whose midpoint is closest
        // to the budget to the top.
        const distDiff = budgetDistance(a, activeTaskBudget) - budgetDistance(b, activeTaskBudget);
        if (distDiff !== 0) return distDiff;
      }
      // 2. Venue match (Ritz / 伯大尼 / etc.).
      const venueDiff = venueMatchScore(b) - venueMatchScore(a);
      if (venueDiff !== 0) return venueDiff;
      // 3. Rating as final tiebreaker.
      return (b.rating || 0) - (a.rating || 0);
    });
    return matched;
  }, [activeCategory, activeVenue, activeTaskBudget, vendors]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mt-8 animate-in slide-in-from-bottom-4 duration-500">
      <section className="lg:col-span-6 flex flex-col gap-4">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
              {myVendorsPanel && (
                <div className="mb-6 pb-6 border-b border-slate-200 -mx-2 px-2">
                  {myVendorsPanel}
                </div>
              )}
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-slate-800">我的任務清單</h2>
            <div className="text-sm font-bold text-rose-600 bg-rose-50 px-3 py-1 rounded-full">
              進度 {progressPercentage}%
            </div>
          </div>

          <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar mb-4">
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                currentUser={currentUser}
                isActive={activeCategory === task.category}
                isEditing={editingTaskId === task.id}
                onSelect={() => {
                  if (!task.isCompleted) {
                    onSelectCategory(task.category, task.venue);
                  }
                }}
                onToggle={(e) => onToggleTask(task, e)}
                onDelete={(e) => onDeleteTask(task, e)}
                onClearActive={onClearActiveCategory}
                onUpdateCost={onUpdateTaskCost}
                onClearEditing={onClearEditingTask}
              />
            ))}
            {tasks.length === 0 && (
              <div className="text-center py-8 text-slate-400">目前沒有籌備任務，立即新增！</div>
            )}
          </div>

          <form
            onSubmit={onAddTask}
            className="bg-slate-50 p-4 rounded-xl border border-slate-200 grid grid-cols-2 gap-2 mt-4"
          >
            {/* 2026-07-15 — two-step category picker:
                  1. Pick a top-level category (e.g. 婚宴場地)
                  2. Pick a sub-service (e.g. 酒店宴會廳) — or leave
                     blank to match the whole top category.
                  Picking a different top clears the sub. */}
            <select
              className="col-span-2 p-2.5 border border-slate-300 rounded-lg text-sm outline-none bg-white"
              value={newTaskForm.categoryTop}
              onChange={(e) => onNewTaskFormChange({
                ...newTaskForm,
                categoryTop: e.target.value,
                categorySub: '', // reset sub when top changes
                categoryKey: e.target.value === 'other' ? 'other' : '',
              })}
            >
              <option value="">請選擇主類別...</option>
              {Object.entries(VENDOR_CATEGORIES).map(([topKey, top]) => (
                <option key={topKey} value={topKey}>
                  {top.icon} {top.label}
                </option>
              ))}
              <option value="other">✏️ 自訂項目 (其他)...</option>
            </select>

            {newTaskForm.categoryTop &&
              newTaskForm.categoryTop !== 'other' &&
              VENDOR_CATEGORIES[newTaskForm.categoryTop] && (
                <select
                  className="col-span-2 p-2.5 border border-slate-300 rounded-lg text-sm outline-none bg-white"
                  value={newTaskForm.categorySub}
                  onChange={(e) => onNewTaskFormChange({
                    ...newTaskForm,
                    categorySub: e.target.value,
                    categoryKey: e.target.value
                      ? `${newTaskForm.categoryTop}.${e.target.value}`
                      : newTaskForm.categoryTop,
                  })}
                >
                  <option value="">
                    {VENDOR_CATEGORIES[newTaskForm.categoryTop].label} (全部)
                  </option>
                  {Object.entries(
                    VENDOR_CATEGORIES[newTaskForm.categoryTop].subs
                  ).map(([subKey, subLabel]) => (
                    <option key={subKey} value={subKey}>
                      ↳ {subLabel}
                    </option>
                  ))}
                </select>
              )}
            {newTaskForm.categoryKey === 'other' && (
              <input
                type="text"
                placeholder="自訂項目名稱..."
                required
                className="col-span-2 p-2.5 border border-slate-300 rounded-lg text-sm outline-none"
                value={newTaskForm.customTitle}
                onChange={(e) => onNewTaskFormChange({ ...newTaskForm, customTitle: e.target.value })}
              />
            )}
            <input
              type="text"
              placeholder="📍 指定場地 (選填)"
              className="col-span-2 p-2.5 border border-slate-300 rounded-lg text-sm outline-none"
              value={newTaskForm.venue}
              onChange={(e) => onNewTaskFormChange({ ...newTaskForm, venue: e.target.value })}
            />
            {/* 2026-07-17 — replaced the previous two-input row with a
                single chip-style combined date+time picker. Reads as
                one unit (e.g. "12月31日 · 14:30") and pops a small
                dialog with quick presets + date/time inputs. The
                existing dueDate/dueTime fields on newTaskForm are
                unchanged, so saved tasks work the same. */}
            <DateTimePicker
              dueDate={newTaskForm.dueDate}
              dueTime={newTaskForm.dueTime}
              onChange={(next) =>
                onNewTaskFormChange({
                  ...newTaskForm,
                  dueDate: next.dueDate,
                  dueTime: next.dueTime,
                })
              }
            />
            <input
              type="number"
              placeholder="大約預算 $"
              className="p-2.5 border border-slate-300 rounded-lg text-sm outline-none"
              value={newTaskForm.estimatedCost}
              onChange={(e) => onNewTaskFormChange({ ...newTaskForm, estimatedCost: e.target.value })}
            />
            {/*
              2026-07-15 — vendor assignment dropdown. Lists every
              contact in MyVendorsPanel. Empty value = "未指派".
              Contacts that are already linked (linkedVendorUid set)
              show a "✓ 已連結" badge; unlinked ones show
              "未加入 (對方加入平台後商戶先睇到)" so the user
              understands the limits.
            */}
            <select
              value={newTaskForm.assignedContactId || ''}
              onChange={(e) =>
                onNewTaskFormChange({
                  ...newTaskForm,
                  assignedContactId: e.target.value,
                })
              }
              className="col-span-2 p-2.5 border border-slate-300 rounded-lg text-sm outline-none bg-white"
            >
              <option value="">🏪 未指派商戶 (從下方「我嘅商戶」加入)</option>
              {(vendorContacts || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.linkedVendorUid ? '✓ ' : '⏳ '}
                  {c.vendorName}
                  {c.category ? ` · ${categoryLabel(c.category)}` : ''}
                  {c.linkedVendorUid ? ' (已連結)' : ' (未加入)'}
                </option>
              ))}
            </select>
            {/*
              2026-07-17 — Helper (兄弟姊妹) assignment. Two visual
              modes share the same `col-span-2` slot as the vendor
              dropdown so the form's two-line layout stays balanced:
                - 'pick' (default): a dropdown sourced from
                  users/{uid}/helpers filtered to status='active'.
                  Empty entry = "未指派".
                - 'custom' : a small text input for ad-hoc names
                  ("I'll ask my cousin tomorrow"). The text is
                  stored verbatim on the task as assignedHelperName,
                  with no assignedHelperId (so it's clearly
                  free-form rather than an invite).
              A small "+ 自訂" / "📋 從清單" button below toggles
              between the two. We deliberately keep both modes in
              the same component (not a separate <select>) so the
              UX matches the vendor dropdown visually.
            */}
            {newTaskForm.assignedHelperMode === 'pick' ? (
              <select
                value={newTaskForm.assignedHelperId || ''}
                onChange={(e) =>
                  onNewTaskFormChange({
                    ...newTaskForm,
                    assignedHelperId: e.target.value,
                  })
                }
                className="col-span-2 p-2.5 border border-slate-300 rounded-lg text-sm outline-none bg-white"
              >
                <option value="">🤝 未指派兄弟姊妹 (從上方「兄弟姊妹」加入)</option>
                {helpersLoading && (
                  <option value="" disabled>讀取中...</option>
                )}
                {!helpersLoading && helpers.length === 0 && (
                  <option value="" disabled>尚未邀請任何兄弟姊妹</option>
                )}
                {helpers.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.displayName || h.name || '(未命名)'}
                    {h.perms?.canScan ? ' · 接待' : ''}
                    {h.perms?.canViewGuestList ? ' · 名冊' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                placeholder="輸入兄弟姊妹名稱 (例: 嘉嘉、阿明)..."
                className="col-span-2 p-2.5 border border-slate-300 rounded-lg text-sm outline-none"
                value={newTaskForm.assignedHelperName}
                onChange={(e) =>
                  onNewTaskFormChange({
                    ...newTaskForm,
                    assignedHelperName: e.target.value,
                  })
                }
              />
            )}
            <div className="col-span-2 flex items-center justify-between -mt-1">
              <button
                type="button"
                onClick={() =>
                  onNewTaskFormChange({
                    ...newTaskForm,
                    assignedHelperMode:
                      newTaskForm.assignedHelperMode === 'pick' ? 'custom' : 'pick',
                    // Clear the unused mode's input so we don't
                    // accidentally persist a stale value when the
                    // user toggles back and forth.
                    assignedHelperId:
                      newTaskForm.assignedHelperMode === 'pick' ? '' : newTaskForm.assignedHelperId,
                    assignedHelperName:
                      newTaskForm.assignedHelperMode === 'custom'
                        ? ''
                        : newTaskForm.assignedHelperName,
                  })
                }
                className="text-[11px] text-slate-500 hover:text-rose-600 font-medium"
              >
                {newTaskForm.assignedHelperMode === 'pick'
                  ? '✏️ + 自訂名稱'
                  : '📋 從兄弟姊妹清單揀'}
              </button>
              <span className="text-[10px] text-slate-400">
                {newTaskForm.assignedHelperMode === 'pick'
                  ? `${helpers.length} 位活躍兄弟姊妹`
                  : '未邀請都可用，儲存後會保留名稱'}
              </span>
            </div>
            <button
              type="submit"
              className="col-span-2 bg-slate-900 text-white font-bold py-3 rounded-lg mt-1 hover:bg-slate-800 shadow-sm flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" /> 新增任務
            </button>
          </form>
        </div>
      </section>

      <section className="lg:col-span-6">
        <div className="sticky top-28">
          {!activeCategory ? (
            <EmptyMatch onGoDiscover={onGoDiscover} />
          ) : (
            <VendorMatch
              activeCategory={activeCategory}
              activeVenue={activeVenue}
              vendors={filteredVendors}
              onViewProfile={() => {}}
              onGoJobBoard={onGoJobBoard}
              onOpenChat={onOpenChat}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function TaskRow({
  task,
  currentUser,
  isActive,
  isEditing,
  onSelect,
  onToggle,
  onDelete,
  onClearActive,
  onUpdateCost,
  onClearEditing,
}) {
  const rowRef = useRef(null);
  const [showComments, setShowComments] = useState(false);

  useEffect(() => {
    if (isEditing && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [isEditing]);

  if (isEditing) {
    return (
      <TaskCostEditor
        task={task}
        onSave={onUpdateCost}
        onCancel={onClearEditing}
      />
    );
  }

  return (
    <>
    <div
      ref={rowRef}
      onClick={onSelect}
      className={`flex items-start p-3.5 rounded-xl border transition-all ${
        task.isCompleted
          ? 'bg-slate-50 border-transparent opacity-75'
          : isActive
            ? 'bg-rose-50 border-rose-200 shadow-sm ring-1 ring-rose-100'
            : 'bg-white border-slate-200 hover:border-rose-200'
      }`}
    >
      <button onClick={onToggle} className="mt-0.5 mr-3 flex-shrink-0">
        <CheckCircle2
          className={`w-6 h-6 ${task.isCompleted ? 'text-green-500' : 'text-slate-300'}`}
        />
      </button>
      <div className="flex-grow">
        <div className="flex items-center flex-wrap gap-2 mb-1">
          <span
            className={`font-bold ${task.isCompleted ? 'line-through text-slate-500' : 'text-slate-800'}`}
          >
            {task.title}
          </span>
          {task.venue && (
            <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded flex items-center gap-1">
              <MapPin className="w-3 h-3" /> {task.venue}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500 flex-wrap">
          <TaskDeadline dueDate={task.dueDate} dueTime={task.dueTime} />
          {/* 2026-07-17 — absolute-due-date chip. Sits right next to
              the countdown so couples see BOTH at a glance: the
              "live" relative label AND the actual calendar stamp.
              Hover the chip for the full ISO date+time. monday-style
              paired pattern (countdown + date chip). */}
          {task.dueDate && (
            <span
              className="inline-flex items-center gap-1 text-[11px] text-slate-600 bg-white border border-slate-200 px-2 py-0.5 rounded-full"
              title={formatLongAbsoluteDue(task.dueDate, task.dueTime)}
            >
              <CalendarDays className="w-3 h-3 text-slate-400" />
              {formatAbsoluteDue(task.dueDate, task.dueTime)}
              {task.dueTime ? '' : <span className="text-[10px] text-slate-400 ml-1">整天</span>}
            </span>
          )}
          <div className="flex items-center gap-1 ml-auto">
            <DollarSign className="w-3.5 h-3.5" />{' '}
            {task.isCompleted
              ? `實際: ${formatMoney(task.actualCost)}`
              : `預算: ${formatMoney(task.estimatedCost)}`}
          </div>
        </div>
        {/*
          2026-07-15 — assigned-vendor badge on each task row. Shows
          the contact name and a badge state: green (linked vendor,
          vendor can see in their dashboard) or amber (unlinked,
          pending vendor signup).
        */}
        {task.assignedVendorName && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                task.assignedVendorUid
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-amber-50 text-amber-700 border-amber-200'
              }`}
              title={
                task.assignedVendorUid
                  ? '已指派商戶，可於其儀表板睇到'
                  : '已指派聯絡人，商戶加入平台後即可睇到'
              }
            >
              {task.assignedVendorUid ? '✓ ' : '⏳ '}
              {task.assignedVendorName}
              {task.assignedVendorUid ? '' : ' (未加入)'}
            </span>
            {task.status && task.assignedVendorUid && (
              // 2026-07-17 — vendor status chip mirrors what the
              // vendor selected on their dashboard. Hidden for tasks
              // assigned to a contact who hasn't joined yet (no
              // vendor-side status to mirror).
              <VendorStatusChip status={task.status} note={task.statusNote} />
            )}
          </div>
        )}
        {/*
          2026-07-17 — Helper (兄弟姊妹) chip. Mirrors the
          assigned-vendor badge above but without a status layer
          (helpers don't have their own dashboard; they just
          receive the task via the helper view).
            - assignedHelperUid set => emerald (linked helper,
              they've signed up so they can see it in their
              helper dashboard once that's wired).
            - assignedHelperName set but no assignedHelperUid =>
              amber (free-form name, e.g. typed inline); rendering
              this without a uid tells the couple "yes we wrote
              down who, but they're not a registered helper yet".
        */}
        {task.assignedHelperName && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                task.assignedHelperUid
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-amber-50 text-amber-700 border-amber-200'
              }`}
              title={
                task.assignedHelperUid
                  ? '已指派兄弟姊妹'
                  : '自訂名稱（非已邀請兄弟姊妹）'
              }
            >
              {task.assignedHelperUid ? '✓ ' : '🤝 '}
              {task.assignedHelperName}
              {task.assignedHelperUid ? '' : ' (未邀請)'}
            </span>
          </div>
        )}
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(e);
        }}
        className="ml-2 p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
      >
        <Trash2 className="w-4 h-4" />
      </button>
      {!task.isCompleted && (
        // Explicit CTA so users know clicking opens the AI vendor-matching
        // panel — replaces the old silent ArrowRight chevron which gave no
        // hint about what would happen. Label collapses to just the icon on
        // narrow screens so the row stays single-line on mobile.
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSelect && onSelect();
          }}
          title="AI 為你智能配對合適商戶"
          aria-label="智能配對推薦"
          className={`ml-2 flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
            isActive
              ? 'bg-rose-100 text-rose-700 border border-rose-200'
              : 'bg-slate-50 text-slate-500 border border-slate-200 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">智能配對</span>
          <ArrowRight className="w-3 h-3" />
        </button>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setShowComments((s) => !s);
        }}
        className={`ml-2 p-1.5 rounded-lg border ${
          showComments
            ? 'bg-rose-50 text-rose-700 border-rose-200'
            : 'bg-white text-slate-300 hover:text-rose-600 hover:border-rose-200 border-slate-200'
        }`}
        title="留言"
        aria-label="留言"
      >
        <MessageCircle className="w-4 h-4" />
      </button>
    </div>
    {showComments && (
      <div className="mt-2">
        {/* 2026-07-19 — switch from chat-only `<TaskComments>` to the
            merged `<TaskActivityTimeline>` so the couple sees both
            threaded discussion AND status changes in one place.
            ownerUid comes from currentUser (the couple's auth uid),
            not task.ownerUid (which is no longer denormalized onto
            the task doc — it's only in the Firestore path). */}
        <TaskActivityTimeline
          task={task}
          ownerUid={currentUser?.uid}
          currentUser={currentUser}
          currentRole="owner"
        />
        {/* Hidden legacy chat-only view kept behind a comment count
            toggle for backwards-compat. Uncomment below to restore. */}
        {/* <TaskComments task={task} currentUser={currentUser} currentRole="owner" /> */}
      </div>
    )}
    </>
  );
}

function TaskCostEditor({ task, onSave, onCancel }) {
  const [estimatedCost, setEstimatedCost] = useState(
    Number(task.estimatedCost || 0).toLocaleString('en-US'),
  );
  const [actualCost, setActualCost] = useState(
    Number(task.actualCost || 0).toLocaleString('en-US'),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const estRef = useRef(null);
  const actRef = useRef(null);

  const handleSave = async () => {
    setError(null);
    const cleanedEst = estimatedCost.replace(/[^0-9]/g, '');
    const cleanedAct = actualCost.replace(/[^0-9]/g, '');
    const est = Number(cleanedEst);
    const act = Number(cleanedAct);
    if (!cleanedEst || Number.isNaN(est) || est < 0) {
      setError('請輸入有效預算金額');
      return;
    }
    if (!cleanedAct || Number.isNaN(act) || act < 0) {
      setError('請輸入有效實際金額');
      return;
    }
    setSaving(true);
    try {
      await onSave(task.id, est, act);
      onCancel && onCancel();
    } catch (e) {
      setError(e?.message || '儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  // Factory: returns an onChange handler that strips non-digits, caps at 11
  // digits, re-inserts thousands separators, and restores the cursor position
  // relative to the digit offset (so typing inside the string feels natural).
  const makeCommasHandler = (setter, inputRef) => (e) => {
    const raw = e.target.value;
    const digits = raw.replace(/[^0-9]/g, '');
    if (!digits) { setter(''); return; }
    const capped = digits.length > 11 ? digits.slice(0, 11) : digits;
    const beforeDigits = raw
      .slice(0, e.target.selectionStart ?? raw.length)
      .replace(/[^0-9]/g, '').length;
    const formatted = Number(capped).toLocaleString('en-US');
    setter(formatted);
    requestAnimationFrame(() => {
      if (!inputRef.current) return;
      let pos = 0;
      let seen = 0;
      while (pos < formatted.length && seen < beforeDigits) {
        if (formatted[pos] >= '0' && formatted[pos] <= '9') seen++;
        pos++;
      }
      try { inputRef.current.setSelectionRange(pos, pos); } catch { /* noop */ }
    });
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="bg-white border-2 border-rose-300 rounded-xl p-4 shadow-sm ring-2 ring-rose-100 animate-in slide-in-from-top-2 duration-200"
    >
      <div className="flex items-center gap-2 mb-3">
        <DollarSign className="w-5 h-5 text-rose-500" />
        <h3 className="font-bold text-slate-800 flex-grow truncate">{task.title}</h3>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <label className="block">
          <span className="text-xs font-bold text-slate-600 mb-1 block">預算 (HKD)</span>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
            <input
              ref={estRef}
              type="text"
              inputMode="numeric"
              value={estimatedCost}
              onChange={makeCommasHandler(setEstimatedCost, estRef)}
              disabled={saving}
              className="w-full pl-7 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-300 outline-none font-mono disabled:opacity-50"
              placeholder="0"
            />
          </div>
        </label>
        <label className="block">
          <span className="text-xs font-bold text-slate-600 mb-1 block">
            實際 (HKD) {task.isCompleted ? '' : <span className="font-normal text-slate-400">— 完成時填寫</span>}
          </span>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
            <input
              ref={actRef}
              type="text"
              inputMode="numeric"
              value={actualCost}
              onChange={makeCommasHandler(setActualCost, actRef)}
              disabled={saving}
              className="w-full pl-7 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-300 outline-none font-mono disabled:opacity-50"
              placeholder="0"
            />
          </div>
        </label>
      </div>

      {error && (
        <p className="text-xs text-red-600 mb-2 font-medium">{error}</p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-rose-500 hover:bg-rose-600 text-white text-sm font-bold rounded-lg transition-colors disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? '儲存中...' : '儲存'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-bold rounded-lg transition-colors disabled:opacity-50"
        >
          <X className="w-4 h-4" />
          取消
        </button>
      </div>
      <p className="text-[10px] text-slate-400 mt-2 text-center">完成時切換任務狀態會自動把實際金額填成預算金額</p>
    </div>
  );
}

function EmptyMatch({ onGoDiscover }) {
  return (
    <div className="bg-white rounded-2xl p-10 shadow-sm border border-slate-200 text-center flex flex-col items-center justify-center min-h-[400px] bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-50/50 via-white to-white">
      <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center mb-6 shadow-inner">
        <Search className="w-10 h-10 text-indigo-500" />
      </div>
      <h3 className="text-xl font-bold text-slate-800 mb-3">尋找完美商戶靈感？</h3>
      <p className="text-slate-500 mb-6 text-sm leading-relaxed max-w-sm">
        點擊左側未完成任務，AI 會為你配對合適商戶；或直接進入「商戶指南」瀏覽作品集！
      </p>
      <button
        onClick={onGoDiscover}
        className="bg-slate-900 text-white font-bold px-8 py-3.5 rounded-xl hover:bg-slate-800 transition-colors shadow-md w-full max-w-sm"
      >
        🔍 立即探索商戶指南
      </button>
    </div>
  );
}

function VendorMatch({ activeCategory, activeVenue, vendors, onViewProfile, onGoJobBoard, onOpenChat }) {
  return (
    <div className="bg-transparent animate-in slide-in-from-right-4 duration-300">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">智能配對推薦</h2>
          <p className="text-rose-600 font-medium text-sm mt-1">
            正在尋找：{getTaskCategoryLabel(activeCategory) || '商戶'}{' '}
            {activeVenue && <span className="text-slate-500"> @ {activeVenue}</span>}
          </p>
        </div>
      </div>
      <div className="space-y-4 max-h-[750px] overflow-y-auto pr-2 custom-scrollbar">
        {vendors.length > 0 ? (
          vendors.map((vendor) => (
            <VendorCard
              key={vendor.id}
              vendor={vendor}
              activeVenue={activeVenue}
              onViewProfile={onViewProfile}
              onGoJobBoard={onGoJobBoard}
              onOpenChat={onOpenChat}
            />
          ))
        ) : (
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200 text-center">
            <p className="text-slate-500 mb-4 font-medium">資料庫暫時未有此場地的推薦商戶。</p>
            <button
              onClick={onGoJobBoard}
              className="bg-rose-100 text-rose-700 font-bold px-6 py-2.5 rounded-xl hover:bg-rose-200"
            >
              不如去「求救板」出 Post 等 Vendor 搵你？
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function VendorCard({ vendor, activeVenue, onViewProfile, onGoJobBoard, onOpenChat }) {
  const isPerfectMatch =
    activeVenue && vendor.tags.some((tag) => activeVenue.includes(tag) || tag.includes(activeVenue));
  return (
    <div
      className={`bg-white rounded-2xl p-6 shadow-sm border transition-all relative ${
        isPerfectMatch ? 'border-rose-300 ring-1 ring-rose-100' : 'border-slate-100'
      }`}
    >
      {isPerfectMatch && (
        <div className="absolute top-0 right-6 -translate-y-1/2 bg-gradient-to-r from-rose-500 to-pink-500 text-white text-[10px] font-bold px-3 py-1 rounded-full flex items-center gap-1">
          <MapPin className="w-3 h-3" /> 場地經驗匹配
        </div>
      )}
      <div className="flex gap-2 mb-3 flex-wrap">
        {vendor.tags.map((tag) => (
          <span
            key={tag}
            className="text-xs font-bold px-2.5 py-1 rounded-md bg-slate-100 text-slate-600"
          >
            {tag}
          </span>
        ))}
      </div>
      <h3 className="text-lg font-bold text-slate-800">{vendor.name}</h3>
      <div className="flex items-center gap-3 text-sm mb-4 mt-1">
        <span className="font-bold text-slate-700 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
          {formatVendorPrice(vendor)}
        </span>
        <span className="flex items-center gap-1 text-slate-500">
          <Star className="w-4 h-4 fill-amber-400 text-amber-400" /> {vendor.rating}
        </span>
      </div>
      <div className="flex gap-2 mt-4">
        <button
          onClick={() => onViewProfile(vendor)}
          className="flex-1 bg-slate-900 text-white py-2 rounded-xl text-sm font-bold hover:bg-slate-800"
        >
          查看作品集
        </button>
        {onOpenChat && (
          <button
            onClick={() => onOpenChat(vendor)}
            className="bg-white text-rose-600 border border-rose-300 px-3 py-2 rounded-xl text-sm font-bold hover:bg-rose-50 flex items-center gap-1"
            title="向商戶查詢詳情"
          >
            <MessageCircle className="w-4 h-4" />
            訊息
          </button>
        )}
        <button
          onClick={onGoJobBoard}
          className="flex-1 bg-rose-50 text-rose-700 border border-rose-200 py-2 rounded-xl text-sm font-bold hover:bg-rose-100"
        >
          索取報價
        </button>
      </div>
    </div>
  );
}
