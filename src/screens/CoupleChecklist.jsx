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
} from 'lucide-react';
import { TASK_CATEGORIES, VENDOR_CATEGORIES, getTaskCategoryLabel } from '../lib/config';
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
    let matched = vendors.filter((v) => v.category === activeCategory);

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
            <input
              type="date"
              required
              className="p-2.5 border border-slate-300 rounded-lg text-sm outline-none text-slate-600"
              value={newTaskForm.dueDate}
              onChange={(e) => onNewTaskFormChange({ ...newTaskForm, dueDate: e.target.value })}
            />
            <input
              type="number"
              placeholder="大約預算 $"
              className="p-2.5 border border-slate-300 rounded-lg text-sm outline-none"
              value={newTaskForm.estimatedCost}
              onChange={(e) => onNewTaskFormChange({ ...newTaskForm, estimatedCost: e.target.value })}
            />
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
    <div
      ref={rowRef}
      onClick={onSelect}
      className={`flex items-start p-3.5 rounded-xl cursor-pointer border transition-all ${
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
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> {task.dueDate}
          </div>
          <div className="flex items-center gap-1">
            <DollarSign className="w-3.5 h-3.5" />{' '}
            {task.isCompleted
              ? `實際: ${formatMoney(task.actualCost)}`
              : `預算: ${formatMoney(task.estimatedCost)}`}
          </div>
        </div>
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
    </div>
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
