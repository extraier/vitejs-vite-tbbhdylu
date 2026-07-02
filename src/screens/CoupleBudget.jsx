import { Wallet, PieChart, CheckCircle2, Circle, Pencil, Save, X, ExternalLink } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { formatMoney } from '../lib/format';

export function CoupleBudget({ tasks, totalBudget, totalSpent, canEdit = false, onSaveBudget, onSelectTask }) {
  const totalRemaining = totalBudget - totalSpent;
  const budgetPercentage = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;

  return (
    <div className="max-w-5xl mx-auto mt-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200 mb-8">
        <h2 className="text-2xl font-bold text-slate-800 mb-6 flex items-center gap-2">
          <Wallet className="w-7 h-7 text-rose-500" /> 預算管理與明細
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {canEdit ? (
            <EditableBudgetCard value={totalBudget} onSave={onSaveBudget} />
          ) : (
            <SummaryCard label="總預算目標 (HKD)" value={`$${totalBudget.toLocaleString()}`} tone="slate" />
          )}
          <SummaryCard label="已確認開支" value={`$${totalSpent.toLocaleString()}`} tone="rose" />
          <SummaryCard
            label="剩餘可分配"
            value={`$${totalRemaining.toLocaleString()}`}
            tone={totalRemaining < 0 ? 'red' : 'emerald'}
          />
        </div>

        <div className="mb-10 bg-slate-50 p-5 rounded-xl border border-slate-100">
          <div className="flex justify-between text-sm mb-2">
            <span className="font-bold text-slate-700 flex items-center gap-2">
              <PieChart className="w-4 h-4" />預算消耗進度
            </span>
            <span className="font-black text-slate-800">{budgetPercentage}%</span>
          </div>
          <div className="w-full bg-slate-200 rounded-full h-4 overflow-hidden shadow-inner">
            <div
              className={`h-full transition-all duration-1000 ease-out relative ${
                budgetPercentage > 100 ? 'bg-red-500' : 'bg-gradient-to-r from-rose-400 to-rose-500'
              }`}
              style={{ width: `${Math.min(budgetPercentage, 100)}%` }}
            ></div>
          </div>
        </div>

        <div className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
          <div className="hidden sm:grid grid-cols-12 gap-4 p-4 bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
            <div className="col-span-6">項目</div>
            <div className="col-span-2 text-center">狀態</div>
            <div className="col-span-4 text-right">金額 (HKD)</div>
          </div>
          <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto custom-scrollbar">
            {tasks.map((task) => (
              <BudgetItemRow
                key={task.id}
                task={task}
                onSelect={() => onSelectTask && onSelectTask(task.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function EditableBudgetCard({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleSave = async () => {
    setError(null);
    // Strip everything except digits so "$300,000" / "300,000.00" / " 300000 " all work
    const cleaned = draft.replace(/[^0-9]/g, '');
    const num = Number(cleaned);
    if (!cleaned || Number.isNaN(num) || num < 0) {
      setError('請輸入有效金額');
      return;
    }
    if (num > 100_000_000) {
      setError('金額過大，請檢查');
      return;
    }
    setSaving(true);
    try {
      await onSave(num);
      setEditing(false);
    } catch (e) {
      setError(e?.message || '儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setDraft(String(value));
    setError(null);
    setEditing(false);
  };

  const handleKey = (e) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') handleCancel();
  };

  const handleDraftChange = (e) => {
    // Allow digits, commas, spaces, $ — strip everything else as the user types,
    // then re-insert commas every 3 digits from the right.
    const raw = e.target.value;
    const digits = raw.replace(/[^0-9]/g, '');
    if (!digits) {
      setDraft('');
      return;
    }
    // Cap input length at 11 digits (up to 100,000,000 with leading "1").
    const capped = digits.length > 11 ? digits.slice(0, 11) : digits;
    // Preserve cursor position relative to the digit count.
    const beforeDigits = raw.slice(0, e.target.selectionStart ?? raw.length).replace(/[^0-9]/g, '').length;
    const formatted = Number(capped).toLocaleString('en-US');
    setDraft(formatted);
    // Restore cursor at the equivalent digit offset (clamped).
    requestAnimationFrame(() => {
      if (!inputRef.current) return;
      let pos = 0;
      let seen = 0;
      while (pos < formatted.length && seen < beforeDigits) {
        const ch = formatted[pos];
        if (ch >= '0' && ch <= '9') seen++;
        pos++;
      }
      try { inputRef.current.setSelectionRange(pos, pos); } catch { /* noop */ }
    });
  };

  return (
    <div className="rounded-xl p-5 border shadow-sm bg-slate-50 border-slate-200 text-slate-800 relative">
      <p className="text-sm mb-1 font-bold flex items-center justify-between">
        <span>總預算目標 (HKD)</span>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="編輯總預算"
            className="ml-2 inline-flex items-center justify-center w-7 h-7 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors"
            title="編輯總預算"
          >
            <Pencil className="w-4 h-4" />
          </button>
        )}
      </p>
      {editing ? (
        <div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              value={draft}
              onChange={handleDraftChange}
              onKeyDown={handleKey}
              disabled={saving}
              className="w-full pl-7 pr-3 py-2 text-3xl font-black bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-300 outline-none disabled:opacity-50"
              placeholder="0"
            />
          </div>
          {error && (
            <p className="text-xs text-red-600 mt-1.5 font-medium">{error}</p>
          )}
          <div className="flex gap-2 mt-3">
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
              onClick={handleCancel}
              disabled={saving}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-bold rounded-lg transition-colors disabled:opacity-50"
            >
              <X className="w-4 h-4" />
              取消
            </button>
          </div>
          <p className="text-[10px] text-slate-400 mt-2">Enter 儲存 / Esc 取消</p>
        </div>
      ) : (
        <p className="text-3xl font-black">${value.toLocaleString()}</p>
      )}
    </div>
  );
}

function BudgetItemRow({ task, onSelect }) {
  const clickable = typeof onSelect === 'function';
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!clickable}
      title={clickable ? '前往任務清單編輯金額' : undefined}
      className={`w-full text-left grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-4 p-4 bg-white items-center transition-colors group ${
        clickable ? 'hover:bg-rose-50/40 cursor-pointer' : ''
      }`}
    >
      <div className="sm:col-span-6 flex items-center gap-3">
        {task.isCompleted ? (
          <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
        ) : (
          <Circle className="w-5 h-5 text-amber-400 flex-shrink-0" />
        )}
        <div className="font-bold text-slate-800 truncate">{task.title}</div>
        {clickable && (
          <ExternalLink className="w-3.5 h-3.5 text-slate-300 group-hover:text-rose-500 transition-colors flex-shrink-0" />
        )}
      </div>
      <div className="sm:col-span-2 sm:text-center pl-8 sm:pl-0">
        {task.isCompleted ? (
          <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-1 rounded">
            已確認 (已付款)
          </span>
        ) : (
          <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-1 rounded">
            籌備中 (預算)
          </span>
        )}
      </div>
      <div className="sm:col-span-4 sm:text-right pl-8 sm:pl-0 font-mono">
        {task.isCompleted ? (
          <span className="font-bold text-slate-800">{formatMoney(task.actualCost)}</span>
        ) : (
          <span className="text-slate-400">{formatMoney(task.estimatedCost)}</span>
        )}
      </div>
    </button>
  );
}

function SummaryCard({ label, value, tone }) {
  const palette = {
    slate: 'bg-slate-50 border-slate-200 text-slate-800',
    rose: 'bg-rose-50 border-rose-200 text-rose-700',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    red: 'bg-red-50 border-red-200 text-red-700',
  }[tone];
  return (
    <div className={`rounded-xl p-5 border shadow-sm ${palette}`}>
      <p className={`text-sm mb-1 font-bold`}>{label}</p>
      <p className="text-3xl font-black">{value}</p>
    </div>
  );
}