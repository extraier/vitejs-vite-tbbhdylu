import { useState, useEffect, useMemo } from 'react';
import {
  Clock,
  ClipboardList,
  Coffee,
  Music2,
  Plus,
  Trash2,
  CheckCircle2,
  Circle,
  GripVertical,
  Search,
  Play,
  Pause,
  Users,
  Package,
} from 'lucide-react';

/**
 * WeddingDay — 大日統籌
 *
 * One screen with four sub-tabs covering the day-of operations:
 *   rundown    — 司儀稿 / Timeline of the day (time-ordered slots)
 *   resources  — 物資 / 兄弟姊妹分配清單 (what + who + qty)
 *   teaCeremony — 敬茶 & 大影相 (long-side family & friends with status)
 *   playlist   — 歌單建議 (song recs grouped by moment, vote-aggregated)
 *
 * Each sub-tab reads from its own Firestore collection under
 *   /artifacts/{appId}/users/{ownerUid}/{rundown|resources|teaCeremony|playlist}
 * via the per-tab hook the parent passes down. We don't subscribe here to
 * keep this component pure — the parent (App.jsx) wires the actual queries
 * so it can manage ordering/sorting consistently across the suite.
 *
 * Pure presentational. No Firebase imports. No state side-effects beyond
 * local UI (edit-mode, search query, sort direction).
 */

// ---------- shared sub-tab shell ----------
const SUB_TABS = [
  { id: 'rundown', label: '大日流程', Icon: Clock },
  { id: 'resources', label: '物資分配', Icon: Package },
  { id: 'teaCeremony', label: '敬茶・影相', Icon: Coffee },
  { id: 'playlist', label: '歌單建議', Icon: Music2 },
];

function SubTabBar({ active, onChange }) {
  return (
    <div className="flex bg-slate-100 rounded-xl p-1 mb-6 overflow-x-auto custom-scrollbar">
      {SUB_TABS.map(({ id, label, Icon }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`flex-1 min-w-[120px] flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-bold rounded-lg transition-all whitespace-nowrap ${
            active === id
              ? 'bg-white text-rose-600 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <Icon className="w-4 h-4" />
          {label}
        </button>
      ))}
    </div>
  );
}

// =========================================================================
// Tab 1 — RUNDOWN  (大日流程 / 司儀稿)
// =========================================================================

const RUNDOWN_GROUP_LABELS = {
  prep: '準備 / 化妝',
  travel: '出門 / 車隊',
  ceremony: '敬茶 / 過大禮',
  reception: '到場 / 行禮',
  banquet: '婚宴 / 敬酒',
  after: '送客 / 結尾',
};

// 2026-07-18 — Reusable helper-picker chip group. Lets the couple
// tag 大日流程 or 物資 items with one or more 兄弟姊妹. Stored on
// the item as `assignedHelpers: [{id,name,uid}]` (uid empty for
// free-typed names — used as the "before invite" fallback).
function HelperPicker({ helpers = [], value = [], onChange }) {
  const add = (h) => {
    if (value.find((x) => x.id === h.id)) return;
    onChange([...value, h]);
  };
  const remove = (id) => onChange(value.filter((x) => x.id !== id));
  return (
    <div>
      <label className="text-xs font-bold text-slate-600 mb-1 block">
        兄弟姊妹 / 負責人
      </label>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {value.map((h) => (
          <span
            key={h.id}
            className="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200"
          >
            <span>{h.name || h.id}</span>
            <button
              type="button"
              onClick={() => remove(h.id)}
              className="text-indigo-500 hover:text-indigo-900 leading-none"
              aria-label="移除"
            >
              ✕
            </button>
          </span>
        ))}
        {value.length === 0 && (
          <span className="text-xs text-slate-400">未分配</span>
        )}
      </div>
      {helpers.length > 0 && (
        <select
          value=""
          onChange={(e) => {
            const hid = e.target.value;
            const h = helpers.find((x) => x.id === hid);
            if (h) add({ id: h.id, name: h.displayName || h.name || '?', uid: h.helperUid || '' });
          }}
          className="w-full p-2 rounded-lg border border-slate-300 text-xs bg-white"
        >
          <option value="">+ 從已邀請嘅兄弟姊妹加入...</option>
          {helpers
            .filter((h) => !value.find((x) => x.id === h.id))
            .map((h) => (
              <option key={h.id} value={h.id}>
                {h.displayName || h.name || h.email}
              </option>
            ))}
        </select>
      )}
      <input
        type="text"
        placeholder="或自行輸入名 (例: 表姊 KC)"
        value=""
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.currentTarget.value.trim()) {
            const name = e.currentTarget.value.trim();
            const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            add({ id, name, uid: '' });
            e.currentTarget.value = '';
            e.preventDefault();
          }
        }}
        className="w-full mt-1 p-2 rounded-lg border border-slate-300 text-xs"
      />
    </div>
  );
}

function RundownTab({ entries, onUpsert, onDelete, onReorder, helpers }) {
  const [editing, setEditing] = useState(null);
  const [filterGroup, setFilterGroup] = useState('all');
  const [filterAssigned, setFilterAssigned] = useState('all');

  const unassignedCount = (entries || []).filter(
    (e) => !e.assignedHelpers || e.assignedHelpers.length === 0,
  ).length;

  const sorted = useMemo(() => {
    let s = [...(entries || [])];
    s.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
    if (filterGroup !== 'all') s = s.filter((e) => (e.group || 'prep') === filterGroup);
    if (filterAssigned === 'unassigned')
      s = s.filter((e) => !e.assignedHelpers || e.assignedHelpers.length === 0);
    return s;
  }, [entries, filterGroup, filterAssigned]);

  const counts = useMemo(() => {
    const out = { all: (entries || []).length };
    Object.keys(RUNDOWN_GROUP_LABELS).forEach((g) => {
      out[g] = (entries || []).filter((e) => (e.group || 'prep') === g).length;
    });
    return out;
  }, [entries]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        按時間排序嘅大日流程 — 兄弟姊妹/司儀可以即時查閱，唔使再 WhatsApp 過嚟問。
      </p>

      <div className="flex flex-wrap gap-2">
        <FilterPill
          active={filterGroup === 'all'}
          onClick={() => setFilterGroup('all')}
          label={`全部 (${counts.all})`}
        />
        {Object.entries(RUNDOWN_GROUP_LABELS).map(([g, lbl]) => (
          <FilterPill
            key={g}
            active={filterGroup === g}
            onClick={() => setFilterGroup(g)}
            label={`${lbl} (${counts[g] || 0})`}
          />
        ))}
        {unassignedCount > 0 && (
          <FilterPill
            active={filterAssigned === 'unassigned'}
            onClick={() => setFilterAssigned(filterAssigned === 'unassigned' ? 'all' : 'unassigned')}
            label={`⚠️ 未分配 (${unassignedCount})`}
          />
        )}
      </div>

      <NewEntryRow
        helpers={helpers}
        onSubmit={(data) => {
          onUpsert({ id: `rd-${Date.now()}`, ...data });
        }}
      />

      <div className="space-y-2">
        {sorted.length === 0 && (
          <div className="text-center py-10 text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
            暫無流程。加入例如「10:00 兄弟姊妹集合」嘅項目就會喺度出現。
          </div>
        )}
        {sorted.map((entry, idx) => (
          <RundownCard
            key={entry.id}
            entry={entry}
            helpers={helpers}
            isFirst={idx === 0}
            isLast={idx === sorted.length - 1}
            isEditing={editing === entry.id}
            onEdit={() => setEditing(entry.id)}
            onCancel={() => setEditing(null)}
            onSave={(data) => {
              onUpsert({ ...entry, ...data });
              setEditing(null);
            }}
            onDelete={() => onDelete(entry.id)}
            onMoveUp={() => onReorder(entry.id, 'up')}
            onMoveDown={() => onReorder(entry.id, 'down')}
          />
        ))}
      </div>
    </div>
  );
}

function FilterPill({ active, onClick, label }) {
  return (
    <button
      onClick={onClick}
      className={`text-xs font-bold px-3 py-1.5 rounded-full border transition-colors ${
        active
          ? 'bg-rose-500 text-white border-rose-500'
          : 'bg-white text-slate-500 border-slate-200 hover:border-rose-200 hover:text-rose-600'
      }`}
    >
      {label}
    </button>
  );
}

function RundownCard({ entry, helpers, isEditing, isFirst, isLast, onEdit, onCancel, onSave, onDelete, onMoveUp, onMoveDown }) {
  const [draft, setDraft] = useState({
    startTime: entry.startTime || '12:00',
    durationMin: entry.durationMin || 30,
    title: entry.title || '',
    location: entry.location || '',
    notes: entry.notes || '',
    group: entry.group || 'prep',
    assignedHelpers: entry.assignedHelpers || [],
  });

  if (isEditing) {
    return (
      <div className="rounded-xl border-2 border-rose-300 p-4 bg-rose-50/30 space-y-3">
        <div className="grid grid-cols-12 gap-3">
          <input
            type="time"
            value={draft.startTime}
            onChange={(e) => setDraft({ ...draft, startTime: e.target.value })}
            className="col-span-3 p-2 rounded-lg border border-slate-300 text-sm"
          />
          <input
            type="number"
            min="5"
            max="600"
            placeholder="分鐘"
            value={draft.durationMin}
            onChange={(e) =>
              setDraft({ ...draft, durationMin: Number(e.target.value) || 30 })
            }
            className="col-span-3 p-2 rounded-lg border border-slate-300 text-sm"
          />
          <select
            value={draft.group}
            onChange={(e) => setDraft({ ...draft, group: e.target.value })}
            className="col-span-6 p-2 rounded-lg border border-slate-300 text-sm bg-white"
          >
            {Object.entries(RUNDOWN_GROUP_LABELS).map(([g, lbl]) => (
              <option key={g} value={g}>
                {lbl}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="流程標題 (例: 兄弟姊妹集合)"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            className="col-span-12 p-2 rounded-lg border border-slate-300 text-sm"
          />
          <input
            type="text"
            placeholder="地點 (例: 君悅酒店宴會廳)"
            value={draft.location}
            onChange={(e) => setDraft({ ...draft, location: e.target.value })}
            className="col-span-12 p-2 rounded-lg border border-slate-300 text-sm"
          />
          <textarea
            rows="3"
            placeholder="備註／要事先通知邊個／物資..."
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            className="col-span-12 p-2 rounded-lg border border-slate-300 text-sm resize-none"
          />
          <div className="col-span-12">
            <HelperPicker
              helpers={helpers}
              value={draft.assignedHelpers}
              onChange={(ah) => setDraft({ ...draft, assignedHelpers: ah })}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100"
          >
            取消
          </button>
          <button
            onClick={() => draft.title && onSave(draft)}
            className="px-3 py-1.5 text-sm rounded-lg bg-rose-600 text-white font-bold hover:bg-rose-700"
          >
            儲存
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5 flex gap-3 items-start">
      <div className="flex flex-col items-center gap-1 text-slate-300 flex-shrink-0 pt-1">
        <button
          onClick={onMoveUp}
          disabled={isFirst}
          className="hover:text-rose-500 disabled:opacity-20"
          title="向上移"
        >
          ▲
        </button>
        <GripVertical className="w-3 h-3" />
        <button
          onClick={onMoveDown}
          disabled={isLast}
          className="hover:text-rose-500 disabled:opacity-20"
          title="向下移"
        >
          ▼
        </button>
      </div>
      <div className="flex-shrink-0 text-center min-w-[68px]">
        <div className="text-lg font-black text-rose-600 font-mono">
          {entry.startTime}
        </div>
        <div className="text-[10px] text-slate-400">+{entry.durationMin || 30}分</div>
        {entry.location && (
          <div className="text-[10px] text-slate-500 mt-1 leading-tight">{entry.location}</div>
        )}
      </div>
      <div className="flex-grow min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="font-bold text-slate-800 truncate">{entry.title}</span>
          {entry.group && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 uppercase tracking-wide">
              {RUNDOWN_GROUP_LABELS[entry.group] || entry.group}
            </span>
          )}
          {entry.assignedHelpers && entry.assignedHelpers.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {entry.assignedHelpers.map((h) => (
                <span
                  key={h.id}
                  className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200"
                  title={h.uid ? `已邀請 (uid: ${h.uid})` : '尚未邀請'}
                >
                  <Users className="w-2.5 h-2.5" />
                  {h.name || h.id}
                </span>
              ))}
            </div>
          )}
          {(!entry.assignedHelpers || entry.assignedHelpers.length === 0) && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200"
              title="尚未分配 兄弟姊妹"
            >
              ⚠️ 未分配
            </span>
          )}
        </div>
        {entry.notes && (
          <p className="text-xs text-slate-500 whitespace-pre-wrap leading-relaxed">
            {entry.notes}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <button
          onClick={onEdit}
          className="px-2 py-1 text-xs rounded border border-slate-200 text-slate-500 hover:bg-slate-50"
        >
          編輯
        </button>
        <button
          onClick={onDelete}
          className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded"
          title="刪除"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function NewEntryRow({ onSubmit, helpers }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    startTime: '12:00',
    durationMin: 30,
    title: '',
    location: '',
    notes: '',
    group: 'reception',
    assignedHelpers: [],
  });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full p-3 rounded-xl border-2 border-dashed border-slate-300 text-slate-500 hover:border-rose-300 hover:text-rose-600 font-bold flex items-center justify-center gap-2"
      >
        <Plus className="w-4 h-4" /> 加入新流程
      </button>
    );
  }

  return (
    <div className="rounded-xl border-2 border-rose-300 p-4 bg-rose-50/30 space-y-3">
      <div className="grid grid-cols-12 gap-3">
        <input
          type="time"
          value={draft.startTime}
          onChange={(e) => setDraft({ ...draft, startTime: e.target.value })}
          className="col-span-3 p-2 rounded-lg border border-slate-300 text-sm"
        />
        <input
          type="number"
          min="5"
          max="600"
          placeholder="分鐘"
          value={draft.durationMin}
          onChange={(e) => setDraft({ ...draft, durationMin: Number(e.target.value) || 30 })}
          className="col-span-3 p-2 rounded-lg border border-slate-300 text-sm"
        />
        <select
          value={draft.group}
          onChange={(e) => setDraft({ ...draft, group: e.target.value })}
          className="col-span-6 p-2 rounded-lg border border-slate-300 text-sm bg-white"
        >
          {Object.entries(RUNDOWN_GROUP_LABELS).map(([g, lbl]) => (
            <option key={g} value={g}>{lbl}</option>
          ))}
        </select>
        <input
          type="text"
          required
          placeholder="流程標題"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          className="col-span-12 p-2 rounded-lg border border-slate-300 text-sm"
        />
        <input
          type="text"
          placeholder="地點 (可選)"
          value={draft.location}
          onChange={(e) => setDraft({ ...draft, location: e.target.value })}
          className="col-span-12 p-2 rounded-lg border border-slate-300 text-sm"
        />
        <textarea
          rows="2"
          placeholder="備註"
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          className="col-span-12 p-2 rounded-lg border border-slate-300 text-sm resize-none"
        />
        <div className="col-span-12">
          <HelperPicker
            helpers={helpers}
            value={draft.assignedHelpers}
            onChange={(ah) => setDraft({ ...draft, assignedHelpers: ah })}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button
          onClick={() => setOpen(false)}
          className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100"
        >
          取消
        </button>
        <button
          onClick={() => {
            if (!draft.title.trim()) return;
            onSubmit({ ...draft, createdAt: Date.now() });
            setDraft({ startTime: '12:00', durationMin: 30, title: '', location: '', notes: '', group: 'reception', assignedHelpers: [] });
            setOpen(false);
          }}
          className="px-3 py-1.5 text-sm rounded-lg bg-rose-600 text-white font-bold hover:bg-rose-700"
        >
          新增
        </button>
      </div>
    </div>
  );
}

// =========================================================================
// Tab 2 — RESOURCES  (物資 / 分配)
// =========================================================================

const RESOURCE_CATEGORIES = {
  decor: '佈置物資',
  hardware: '硬件 / 器材',
  favours: '回禮禮物',
  paper: '印刷 / 紙品',
  food: '餐飲 / 茶水',
  other: '其他',
};

function ResourcesTab({ items, onUpsert, onDelete, onToggle, currentUser, helpers }) {
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState('all');

  const filtered = useMemo(() => {
    if (filter === 'all') return items || [];
    if (filter === 'todo') return (items || []).filter((i) => !i.checked);
    if (filter === 'mine') return (items || []).filter((i) => i.assignedToId === (currentUser?.uid || ''));
    if (filter === 'unassigned') return (items || []).filter(
      (i) => !i.assignedToName && !(i.assignedHelpers && i.assignedHelpers.length > 0),
    );
    return (items || []).filter((i) => (i.category || 'other') === filter);
  }, [items, filter, currentUser]);

  const unassignedCount = (items || []).filter(
    (i) => !i.assignedToName && !(i.assignedHelpers && i.assignedHelpers.length > 0),
  ).length;

  const grouped = useMemo(() => {
    const out = {};
    filtered.forEach((it) => {
      const c = it.category || 'other';
      if (!out[c]) out[c] = [];
      out[c].push(it);
    });
    return out;
  }, [filtered]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        大日各項物資 — 點對點交俾兄弟姊妹負責。新增時可以寫埋負責人。
      </p>

      <div className="flex flex-wrap gap-2">
        <FilterPill active={filter === 'all'} onClick={() => setFilter('all')} label={`全部 (${items?.length || 0})`} />
        <FilterPill active={filter === 'todo'} onClick={() => setFilter('todo')} label={`未完成 (${(items || []).filter((i) => !i.checked).length})`} />
        <FilterPill active={filter === 'mine'} onClick={() => setFilter('mine')} label={`我負責 (${(items || []).filter((i) => i.assignedToId === (currentUser?.uid || '')).length})`} />
        {unassignedCount > 0 && (
          <FilterPill
            active={filter === 'unassigned'}
            onClick={() => setFilter(filter === 'unassigned' ? 'all' : 'unassigned')}
            label={`⚠️ 未分配 (${unassignedCount})`}
          />
        )}
        {Object.entries(RESOURCE_CATEGORIES).map(([c, lbl]) => (
          <FilterPill
            key={c}
            active={filter === c}
            onClick={() => setFilter(c)}
            label={`${lbl} (${(items || []).filter((i) => (i.category || 'other') === c).length})`}
          />
        ))}
      </div>

      <NewResourceRow
        helpers={helpers}
        onSubmit={(d) => onUpsert({ id: `rs-${Date.now()}`, ...d })}
      />

      {Object.entries(grouped).map(([cat, list]) => (
        <div key={cat} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600 uppercase tracking-wide">
            {RESOURCE_CATEGORIES[cat] || cat}
          </div>
          <div className="divide-y divide-slate-100">
            {list.map((item) => (
              <div
                key={item.id}
                className={`flex items-center gap-3 px-4 py-2.5 ${
                  item.checked ? 'bg-slate-50 opacity-60' : ''
                }`}
              >
                <button
                  onClick={() => onToggle(item.id, !item.checked)}
                  className="flex-shrink-0"
                >
                  {item.checked ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  ) : (
                    <Circle className="w-5 h-5 text-slate-300" />
                  )}
                </button>
                <div className="flex-grow min-w-0">
                  <div
                    className={`font-bold ${item.checked ? 'line-through text-slate-500' : 'text-slate-800'}`}
                  >
                    {item.label}
                  </div>
                  {(item.qty || item.assignedToName || item.notes ||
                    (item.assignedHelpers && item.assignedHelpers.length > 0)) && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5 text-xs text-slate-500">
                      {item.qty && <span>數量: <b className="text-slate-700">{item.qty}</b></span>}
                      {item.assignedToName && (
                        <span className="inline-flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          負責: <b className="text-rose-600">{item.assignedToName}</b>
                        </span>
                      )}
                      {item.assignedHelpers && item.assignedHelpers.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {item.assignedHelpers.map((h) => (
                            <span
                              key={h.id}
                              className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700"
                            >
                              {h.name || h.id}
                            </span>
                          ))}
                        </div>
                      )}
                      {item.notes && <span>📝 {item.notes}</span>}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => onDelete(item.id)}
                  className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded flex-shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}

      {filtered.length === 0 && (
        <div className="text-center py-10 text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
          {filter === 'todo'
            ? '全部已經完成喇 ✨'
            : '暫無物資。新增例如「10 個回禮福袋」嘅項目就會喺度出現。'}
        </div>
      )}
    </div>
  );
}

function NewResourceRow({ onSubmit, helpers }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    label: '',
    qty: '',
    category: 'decor',
    assignedToName: '',
    assignedHelpers: [],
    notes: '',
  });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full p-3 rounded-xl border-2 border-dashed border-slate-300 text-slate-500 hover:border-rose-300 hover:text-rose-600 font-bold flex items-center justify-center gap-2"
      >
        <Plus className="w-4 h-4" /> 加入物資
      </button>
    );
  }

  return (
    <div className="rounded-xl border-2 border-rose-300 p-4 bg-rose-50/30 space-y-3">
      <div className="grid grid-cols-12 gap-3">
        <input
          type="text"
          required
          autoFocus
          placeholder="物資名稱 (例: 10 個回禮福袋)"
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          className="col-span-12 p-2 rounded-lg border border-slate-300 text-sm"
        />
        <input
          type="text"
          placeholder="數量 (例: 10 個 / 2 盒)"
          value={draft.qty}
          onChange={(e) => setDraft({ ...draft, qty: e.target.value })}
          className="col-span-4 p-2 rounded-lg border border-slate-300 text-sm"
        />
        <select
          value={draft.category}
          onChange={(e) => setDraft({ ...draft, category: e.target.value })}
          className="col-span-4 p-2 rounded-lg border border-slate-300 text-sm bg-white"
        >
          {Object.entries(RESOURCE_CATEGORIES).map(([c, lbl]) => (
            <option key={c} value={c}>{lbl}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="負責人 (例: 阿明)"
          value={draft.assignedToName}
          onChange={(e) => setDraft({ ...draft, assignedToName: e.target.value })}
          className="col-span-4 p-2 rounded-lg border border-slate-300 text-sm"
        />
        <div className="col-span-12">
          <HelperPicker
            helpers={helpers}
            value={draft.assignedHelpers}
            onChange={(ah) => setDraft({ ...draft, assignedHelpers: ah })}
          />
        </div>
        <input
          type="text"
          placeholder="備註 (可選)"
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          className="col-span-12 p-2 rounded-lg border border-slate-300 text-sm"
        />
      </div>
      <div className="flex justify-end gap-2">
        <button
          onClick={() => setOpen(false)}
          className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100"
        >
          取消
        </button>
        <button
          onClick={() => {
            if (!draft.label.trim()) return;
            onSubmit({ ...draft, checked: false, createdAt: Date.now() });
            setDraft({ label: '', qty: '', category: 'decor', assignedToName: '', assignedHelpers: [], notes: '' });
            setOpen(false);
          }}
          className="px-3 py-1.5 text-sm rounded-lg bg-rose-600 text-white font-bold hover:bg-rose-700"
        >
          新增
        </button>
      </div>
    </div>
  );
}

// =========================================================================
// Tab 3 — TEA CEREMONY & PHOTO LIST  (敬茶 & 影相名單)
// =========================================================================

const RELATION_LABELS = {
  // Husband's family
  husband_father: '家翁',
  husband_mother: '家姑',
  husband_gp1: '老爺爺',
  husband_gm1: '老太太',
  // Wife's family
  wife_father: '外父',
  wife_mother: '外母',
  wife_gp: '外祖父',
  wife_gm: '外祖母',
  // Siblings & relatives
  relative: '長輩親戚',
  // Friends
  friend: '朋友',
  other: '其他',
};

const CEREMONY_GROUPS = [
  { id: 'husband', label: '夫家', e: '🧧' },
  { id: 'wife', label: '娘家', e: '🧧' },
  { id: 'friends', label: '新娘朋友', e: '👯‍♀️' },
  { id: 'groom_friends', label: '新郎朋友', e: '🤵' },
];

function TeaCeremonyTab({ people, onUpsert, onDelete }) {
  const [editing, setEditing] = useState(null);

  const grouped = useMemo(() => {
    const out = {};
    (people || []).forEach((p) => {
      const k = p.group || 'husband';
      if (!out[k]) out[k] = [];
      out[k].push(p);
    });
    Object.keys(out).forEach((k) =>
      out[k].sort((a, b) => Number(b.completed) - Number(a.completed) || (a.order || 0) - (b.order || 0)),
    );
    return out;
  }, [people]);

  const totals = useMemo(() => {
    const total = (people || []).length;
    const done = (people || []).filter((p) => p.completed).length;
    const photosTaken = (people || []).filter((p) => p.photoTaken).length;
    const giftReceived = (people || []).filter((p) => p.giftReceived).length;
    return { total, done, photosTaken, giftReceived };
  }, [people]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        逐位長輩／賓客 — 記低「敬茶」、「大影相」、「收到利是」嘅狀態，大日當日可以快速 pass 俾「左邊嗰位未影相」。
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KPICard label="總人數" value={totals.total} />
        <KPICard label="已敬茶" value={totals.done} accent="rose" />
        <KPICard label="已影相" value={totals.photosTaken} accent="amber" />
        <KPICard label="已收利是" value={totals.giftReceived} accent="emerald" />
      </div>

      <NewPersonRow onSubmit={(d) => onUpsert({ id: `tc-${Date.now()}`, ...d })} />

      {CEREMONY_GROUPS.map(({ id, label, e }) => (
        <div key={id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
            <span className="text-lg">{e}</span>
            <span className="text-sm font-bold text-slate-700">{label}</span>
            <span className="ml-auto text-xs text-slate-500">
              {(grouped[id]?.filter((p) => p.completed).length) || 0} / {(grouped[id]?.length) || 0}
            </span>
          </div>
          {(!grouped[id] || grouped[id].length === 0) && (
            <div className="px-4 py-3 text-xs text-slate-400 text-center">
              尚未加入任何{label}成員
            </div>
          )}
          <div className="divide-y divide-slate-100">
            {(grouped[id] || []).map((person) => (
              <PersonRow
                key={person.id}
                person={person}
                onUpsert={(data) => onUpsert({ ...person, ...data })}
                onDelete={() => onDelete(person.id)}
                isEditing={editing === person.id}
                onEditToggle={() => setEditing(editing === person.id ? null : person.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function KPICard({ label, value, accent = 'slate' }) {
  const palette = {
    slate: 'bg-slate-50 text-slate-700 border-slate-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  }[accent];
  return (
    <div className={`rounded-xl border p-3 ${palette}`}>
      <div className="text-xs font-bold opacity-80">{label}</div>
      <div className="text-2xl font-black mt-0.5">{value}</div>
    </div>
  );
}

function PersonRow({ person, onUpsert, onDelete, isEditing, onEditToggle }) {
  const [draft, setDraft] = useState({
    name: person.name || '',
    relation: person.relation || 'relative',
    order: person.order ?? 99,
    notes: person.notes || '',
  });

  if (isEditing) {
    return (
      <div className="px-4 py-3 bg-rose-50/30 space-y-2">
        <div className="grid grid-cols-12 gap-2">
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="姓名／稱謂 (例: 伯父 陳大明)"
            className="col-span-6 p-2 rounded-lg border border-slate-300 text-sm"
          />
          <select
            value={draft.relation}
            onChange={(e) => setDraft({ ...draft, relation: e.target.value })}
            className="col-span-6 p-2 rounded-lg border border-slate-300 text-sm bg-white"
          >
            {Object.entries(RELATION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <input
            type="number"
            placeholder="第幾位"
            value={draft.order}
            onChange={(e) => setDraft({ ...draft, order: Number(e.target.value) || 99 })}
            className="col-span-3 p-2 rounded-lg border border-slate-300 text-sm"
          />
          <input
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            placeholder="備註 (例: 行動不便)"
            className="col-span-9 p-2 rounded-lg border border-slate-300 text-sm"
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onEditToggle}
            className="px-3 py-1.5 text-xs rounded border border-slate-300 text-slate-700 hover:bg-slate-100"
          >
            取消
          </button>
          <button
            onClick={() => {
              onUpsert(draft);
              onEditToggle();
            }}
            className="px-3 py-1.5 text-xs rounded bg-rose-600 text-white font-bold hover:bg-rose-700"
          >
            儲存
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 ${person.completed ? 'opacity-70' : ''}`}>
      <button
        onClick={() => onUpsert({ completed: !person.completed })}
        className="flex-shrink-0"
        title={person.completed ? '完成 — 點擊重設' : '標記為已完成'}
      >
        {person.completed ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-500" />
        ) : (
          <Circle className="w-5 h-5 text-slate-300" />
        )}
      </button>
      <div className="flex-grow min-w-0">
        <div className={`font-bold ${person.completed ? 'line-through text-slate-500' : 'text-slate-800'}`}>
          {person.name || '未命名'}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
            {RELATION_LABELS[person.relation] || person.relation}
          </span>
          {person.order && (
            <span className="text-[10px] text-slate-400">第 {person.order} 位</span>
          )}
          {person.notes && (
            <span className="text-[10px] text-slate-500 truncate italic">「{person.notes}」</span>
          )}
        </div>
      </div>
      <div className="flex gap-1 flex-shrink-0">
        <button
          onClick={() => onUpsert({ photoTaken: !person.photoTaken })}
          className={`text-[10px] font-bold px-2 py-1 rounded border ${
            person.photoTaken
              ? 'bg-amber-500 text-white border-amber-500'
              : 'bg-white text-slate-400 border-slate-200 hover:text-amber-600'
          }`}
          title="已影相"
        >
          📸
        </button>
        <button
          onClick={() => onUpsert({ giftReceived: !person.giftReceived })}
          className={`text-[10px] font-bold px-2 py-1 rounded border ${
            person.giftReceived
              ? 'bg-emerald-500 text-white border-emerald-500'
              : 'bg-white text-slate-400 border-slate-200 hover:text-emerald-600'
          }`}
          title="已收利是"
        >
          🧧
        </button>
      </div>
      <button
        onClick={onEditToggle}
        className="p-1 text-slate-300 hover:text-slate-700 rounded"
        title="編輯"
      >
        <span className="text-xs">✏️</span>
      </button>
      <button
        onClick={onDelete}
        className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded"
        title="刪除"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

function NewPersonRow({ onSubmit }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    name: '',
    relation: 'husband_father',
    group: 'husband',
    order: 1,
    notes: '',
  });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full p-3 rounded-xl border-2 border-dashed border-slate-300 text-slate-500 hover:border-rose-300 hover:text-rose-600 font-bold flex items-center justify-center gap-2"
      >
        <Plus className="w-4 h-4" /> 加入長輩／賓客
      </button>
    );
  }

  return (
    <div className="rounded-xl border-2 border-rose-300 p-4 bg-rose-50/30 space-y-3">
      <div className="grid grid-cols-12 gap-3">
        <input
          autoFocus
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="姓名／稱謂 (例: 家翁 陳伯)"
          className="col-span-6 p-2 rounded-lg border border-slate-300 text-sm"
        />
        <select
          value={draft.relation}
          onChange={(e) => setDraft({ ...draft, relation: e.target.value })}
          className="col-span-6 p-2 rounded-lg border border-slate-300 text-sm bg-white"
        >
          {Object.entries(RELATION_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={draft.group}
          onChange={(e) => setDraft({ ...draft, group: e.target.value })}
          className="col-span-6 p-2 rounded-lg border border-slate-300 text-sm bg-white"
        >
          {CEREMONY_GROUPS.map((g) => (
            <option key={g.id} value={g.id}>{g.label}</option>
          ))}
        </select>
        <input
          type="number"
          min="1"
          value={draft.order}
          onChange={(e) => setDraft({ ...draft, order: Number(e.target.value) || 1 })}
          placeholder="第幾位"
          className="col-span-3 p-2 rounded-lg border border-slate-300 text-sm"
        />
        <input
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          placeholder="備註 (例: 行動不便)"
          className="col-span-3 p-2 rounded-lg border border-slate-300 text-sm"
        />
      </div>
      <div className="flex justify-end gap-2">
        <button
          onClick={() => setOpen(false)}
          className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100"
        >
          取消
        </button>
        <button
          onClick={() => {
            if (!draft.name.trim()) return;
            onSubmit({
              ...draft,
              completed: false,
              photoTaken: false,
              giftReceived: false,
              createdAt: Date.now(),
            });
            setDraft({ name: '', relation: 'husband_father', group: 'husband', order: 1, notes: '' });
            setOpen(false);
          }}
          className="px-3 py-1.5 text-sm rounded-lg bg-rose-600 text-white font-bold hover:bg-rose-700"
        >
          新增
        </button>
      </div>
    </div>
  );
}

// =========================================================================
// Tab 4 — PLAYLIST  (歌單建議)
// =========================================================================

const PLAYLIST_MOMENTS = [
  { id: 'pre_guest', label: '迎賓', e: '🎵' },
  { id: 'ceremony', label: '敬茶 / 出門', e: '🧧' },
  { id: 'entrance', label: '進場', e: '👰' },
  { id: 'first_dance', label: '第一支舞', e: '💃' },
  { id: 'banquet', label: '宴會 / 敬酒', e: '🥂' },
  { id: 'party', label: 'After-party', e: '🎉' },
  { id: 'send_off', label: '送客', e: '💐' },
];

/**
 * Extract a YouTube video ID from any common URL form:
 *   youtube.com/watch?v=XXX
 *   youtu.be/XXX
 *   youtube.com/embed/XXX
 *   youtube.com/shorts/XXX
 * Returns null if the string isn't a recognizable YT URL.
 */
function youtubeId(url) {
  if (!url) return null;
  const m1 = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (m1) return m1[1];
  const m2 = url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (m2) return m2[1];
  const m3 = url.match(/embed\/([A-Za-z0-9_-]{11})/);
  if (m3) return m3[1];
  const m4 = url.match(/shorts\/([A-Za-z0-9_-]{11})/);
  if (m4) return m4[1];
  return null;
}

function PlaylistTab({ songs, onUpsert, onDelete, currentUserUid }) {
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  // 2026-07-18 — P1 inline audio preview. We track which song id is
  // currently playing so that tapping a different row stops the
  // previous one (only one preview at a time across the whole tab).
  // Storing the id, not the player ref, is enough — the iframe URL
  // reacts to playingYtId and re-mounts cleanly.
  const [playingYtId, setPlayingYtId] = useState(null);

  const grouped = useMemo(() => {
    const out = {};
    let s = songs || [];
    if (filter !== 'all') s = s.filter((sg) => sg.moment === filter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      s = s.filter((sg) =>
        (sg.title || '').toLowerCase().includes(q) ||
        (sg.artist || '').toLowerCase().includes(q) ||
        (sg.suggestedByName || '').toLowerCase().includes(q),
      );
    }
    s.forEach((sg) => {
      const k = sg.moment || 'pre_guest';
      if (!out[k]) out[k] = [];
      // Sort by votes desc, then alpha
      out[k].sort(
        (a, b) => (b.votes?.length || 0) - (a.votes?.length || 0) || (a.title || '').localeCompare(b.title || ''),
      );
      out[k].push(sg);
    });
    return out;
  }, [songs, filter, search]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        邊隻歌適合邊個時段用？有舊朋友或商戶建議嘅話可以加入，❤️ 愈多愈接近使用。
      </p>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-grow">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜歌名 / 歌手..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm"
          />
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
        >
          <option value="all">全部時段</option>
          {PLAYLIST_MOMENTS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.e} {m.label}
            </option>
          ))}
        </select>
      </div>

      <NewSongRow
        onSubmit={(d) =>
          onUpsert({
            id: `pl-${Date.now()}`,
            ...d,
            votes: d.votes || [],
            createdAt: Date.now(),
          })
        }
      />

      {PLAYLIST_MOMENTS.map(({ id, label, e }) => (
        grouped[id]?.length > 0 && (
          <div key={id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
              <span className="text-lg">{e}</span>
              <span className="text-sm font-bold text-slate-700">{label}</span>
              <span className="ml-auto text-xs text-slate-500">
                {grouped[id].length} 首
              </span>
            </div>
            <div className="divide-y divide-slate-100">
              {grouped[id].map((song) => (
                <SongRow
                  key={song.id}
                  song={song}
                  currentUserUid={currentUserUid}
                  // 2026-07-18 — P1 inline preview wiring: SongRow
                  // reports its own playing state up; PlaylistTab
                  // flips off whichever row was playing before.
                  isPlaying={playingYtId === song.id}
                  onTogglePlay={(ytId) =>
                    setPlayingYtId((prev) => (prev === ytId ? null : ytId))
                  }
                  onVote={() => {
                    const votes = new Set(song.votes || []);
                    if (votes.has(currentUserUid)) votes.delete(currentUserUid);
                    else votes.add(currentUserUid);
                    onUpsert({ ...song, votes: Array.from(votes) });
                  }}
                  onDelete={() => onDelete(song.id)}
                />
              ))}
            </div>
          </div>
        )
      ))}

      {songs?.length === 0 && (
        <div className="text-center py-10 text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
          尚未有歌單建議。新增例如「陳奕迅 - 我甚麼都沒有」就會喺度出現。
        </div>
      )}
    </div>
  );
}

function SongRow({ song, currentUserUid, isPlaying, onTogglePlay, onVote, onDelete }) {
  const voted = (song.votes || []).includes(currentUserUid);
  const ytId = youtubeId(song.link);

  return (
    <div className="px-4 py-3 flex gap-3 items-start">
      <div className="flex-shrink-0 w-20">
        {ytId ? (
          // 2026-07-18 — P1 inline preview. We render an iframe when
          // this row is the active one (autoplay=1, modest UI). When
          // the user taps the same thumbnail again we lift `null`
          // up to PlaylistTab, which causes us to fall back to the
          // static thumbnail. Tapping a different row's thumbnail
          // causes the previous iframe to unmount cleanly because
          // its parent re-renders without that branch.
          isPlaying ? (
            <div className="block relative aspect-video bg-slate-900 rounded-lg overflow-hidden">
              <iframe
                title={`preview-${song.id}`}
                src={`https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&modestbranding=1&playsinline=1&rel=0`}
                allow="autoplay; encrypted-media"
                allowFullScreen
                className="absolute inset-0 w-full h-full"
              />
              <button
                type="button"
                onClick={() => onTogglePlay(song.id)}
                className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 text-white rounded-full p-1"
                aria-label="停止播放"
                title="停止播放"
              >
                <Pause className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onTogglePlay(song.id)}
              className="block w-full relative aspect-video bg-slate-900 rounded-lg overflow-hidden group"
              aria-label={`播放 ${song.title}`}
              title={`播放 ${song.title}`}
            >
              <img
                src={`https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`}
                alt={song.title}
                className="w-full h-full object-cover opacity-90 group-hover:opacity-100"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
                <Play className="w-7 h-7 text-white" />
              </div>
            </button>
          )
        ) : (
          <div className="aspect-video rounded-lg bg-slate-100 flex items-center justify-center">
            <Music2 className="w-5 h-5 text-slate-400" />
          </div>
        )}
      </div>
      <div className="flex-grow min-w-0">
        <div className="font-bold text-slate-800 truncate">{song.title}</div>
        <div className="text-xs text-slate-500 truncate">
          {song.artist || '—'}
          {song.suggestedByName && (
            <span className="ml-2 text-rose-500">· 建議: {song.suggestedByName}</span>
          )}
        </div>
        {song.notes && (
          <div className="text-xs text-slate-500 mt-1 italic leading-tight">{song.notes}</div>
        )}
      </div>
      <div className="flex flex-col items-center flex-shrink-0">
        <button
          onClick={onVote}
          className={`text-base ${voted ? 'text-rose-500' : 'text-slate-300 hover:text-rose-500'}`}
          title="投呢首歌一票"
        >
          {voted ? '❤️' : '🤍'}
        </button>
        <span className="text-xs font-bold text-slate-600">{(song.votes || []).length}</span>
      </div>
      <button
        onClick={onDelete}
        className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded flex-shrink-0"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

function NewSongRow({ onSubmit }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    title: '',
    artist: '',
    moment: 'entrance',
    link: '',
    notes: '',
    suggestedByName: '',
  });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full p-3 rounded-xl border-2 border-dashed border-slate-300 text-slate-500 hover:border-rose-300 hover:text-rose-600 font-bold flex items-center justify-center gap-2"
      >
        <Plus className="w-4 h-4" /> 加入歌曲建議
      </button>
    );
  }

  return (
    <div className="rounded-xl border-2 border-rose-300 p-4 bg-rose-50/30 space-y-3">
      <div className="grid grid-cols-12 gap-3">
        <input
          autoFocus
          required
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          placeholder="歌名 (例: 我甚麼都沒有)"
          className="col-span-7 p-2 rounded-lg border border-slate-300 text-sm"
        />
        <input
          value={draft.artist}
          onChange={(e) => setDraft({ ...draft, artist: e.target.value })}
          placeholder="歌手"
          className="col-span-5 p-2 rounded-lg border border-slate-300 text-sm"
        />
        <select
          value={draft.moment}
          onChange={(e) => setDraft({ ...draft, moment: e.target.value })}
          className="col-span-6 p-2 rounded-lg border border-slate-300 text-sm bg-white"
        >
          {PLAYLIST_MOMENTS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.e} {m.label}
            </option>
          ))}
        </select>
        <input
          value={draft.link}
          onChange={(e) => setDraft({ ...draft, link: e.target.value })}
          placeholder="YouTube 連結 (可選)"
          className="col-span-6 p-2 rounded-lg border border-slate-300 text-sm"
        />
        <input
          value={draft.suggestedByName}
          onChange={(e) => setDraft({ ...draft, suggestedByName: e.target.value })}
          placeholder="誰建議? (例: 商戶 DJ Sam)"
          className="col-span-6 p-2 rounded-lg border border-slate-300 text-sm"
        />
        <input
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          placeholder="為何適合? (可選)"
          className="col-span-6 p-2 rounded-lg border border-slate-300 text-sm"
        />
      </div>
      <div className="flex justify-end gap-2">
        <button
          onClick={() => setOpen(false)}
          className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100"
        >
          取消
        </button>
        <button
          onClick={() => {
            if (!draft.title.trim()) return;
            onSubmit({ ...draft });
            setDraft({ title: '', artist: '', moment: 'entrance', link: '', notes: '', suggestedByName: '' });
            setOpen(false);
          }}
          className="px-3 py-1.5 text-sm rounded-lg bg-rose-600 text-white font-bold hover:bg-rose-700"
        >
          新增
        </button>
      </div>
    </div>
  );
}

// =========================================================================
// Outer shell
// =========================================================================

export function WeddingDay({
  rundown,
  resources,
  teaCeremony,
  playlist,
  onUpsertRundown,
  onDeleteRundown,
  onReorderRundown,
  onUpsertResource,
  onDeleteResource,
  onToggleResource,
  onUpsertTeaCeremony,
  onDeleteTeaCeremony,
  onUpsertPlaylist,
  onDeletePlaylist,
  currentUser,
  // 2026-07-18 — pass the active helper list down so rundown and
  // resources tabs can offer a 兄弟姊妹 picker for each item.
  helpers = [],
}) {
  const [active, setActive] = useState('rundown');

  return (
    <div className="max-w-4xl mx-auto mt-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-rose-100 p-3 rounded-2xl">
            <ClipboardList className="w-7 h-7 text-rose-500" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-slate-800">大日統籌</h2>
            <p className="text-slate-500 text-sm mt-1">
              流程、物資、敬茶名單、歌單 — 全部一個畫面搞掂。
            </p>
          </div>
        </div>

        <SubTabBar active={active} onChange={setActive} />

        {active === 'rundown' && (
          <RundownTab
            entries={rundown}
            onUpsert={onUpsertRundown}
            onDelete={onDeleteRundown}
            onReorder={onReorderRundown}
          />
        )}
        {active === 'resources' && (
          <ResourcesTab
            items={resources}
            onUpsert={onUpsertResource}
            onDelete={onDeleteResource}
            onToggle={onToggleResource}
            currentUser={currentUser}
            helpers={helpers}
          />
        )}
        {active === 'teaCeremony' && (
          <TeaCeremonyTab
            people={teaCeremony}
            onUpsert={onUpsertTeaCeremony}
            onDelete={onDeleteTeaCeremony}
          />
        )}
        {active === 'playlist' && (
          <PlaylistTab
            songs={playlist}
            onUpsert={onUpsertPlaylist}
            onDelete={onDeletePlaylist}
            currentUserUid={currentUser?.uid}
          />
        )}
      </div>
    </div>
  );
}
