import { useState, useEffect, useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Clock,
  ClipboardList,
  Coffee,
  Music2,
  Plus,
  Trash2,
  X,
  CheckCircle2,
  Circle,
  GripVertical,
  Search,
  Play,
  Pause,
  Users,
  Package,
  MessageCircle,
  ChevronUp,
  ChevronDown,
  Flame,
} from 'lucide-react';

/**
 * WeddingDay — Big Day (大日統籌)
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

// 2026-08-09 — comments and vendor assignment for 大日流程/物資.
// ItemComments needs a Firestore CollectionReference. To keep this
// file Firebase-free (see comment at line 55), the parent
// (App.jsx) passes the resolved `rundownCommentPath` /
// `resourceCommentPath` prop down for each entry/item. The VendorPicker
// is pure-presentational so it can live here without a firebase import.
import { VendorPicker } from '../components/VendorPicker';
import { ItemComments } from '../components/ItemComments';

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

// 2026-07-31 — Time-arithmetic helpers for the rundown editor. Previously
// the editor stored `startTime` + `durationMin` and rendered
// `5:30 AM / +30分`. The new editor surfaces both `startTime` and
// `endTime` as independent `<input type="time">` pickers, so brides see
// `5:30 AM → 6:00 AM` instead of doing the math themselves. Storage
// still keeps `durationMin` so existing entries render correctly
// without data migration.
//
// All three helpers are tolerant of malformed inputs:
//   - `parseHHMMToMinutes` returns null on bad input
//   - `addMinutesToHHMM` clamps to the 24:00 hour (allows e.g.
//     23:45 + 30 = 24:15, which we display as the next day)
//   - `computeEndHHMM` derives end from start + duration, returning
//     the original start string if either is invalid so the
//     caller can still render without throwing.

function parseHHMMToMinutes(s) {
  if (typeof s !== 'string') return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 24 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function addMinutesToHHMM(startHHMM, addMin) {
  const base = parseHHMMToMinutes(startHHMM);
  const delta = Number.isFinite(addMin) ? addMin : 0;
  if (base === null) return startHHMM || '';
  const total = base + delta;
  // Wrap past 24h. Most wedding timelines stay under 24 hours so
  // this is cosmetic, but it avoids NaN if someone adds > 24h.
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const hh = Math.floor(wrapped / 60);
  const mm = wrapped % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function computeEndHHMM(startHHMM, durationMin) {
  if (!startHHMM) return '';
  return addMinutesToHHMM(startHHMM, durationMin || 0);
}

function computeMinutesBetween(startHHMM, endHHMM) {
  const a = parseHHMMToMinutes(startHHMM);
  const b = parseHHMMToMinutes(endHHMM);
  if (a === null || b === null) return 30;
  // If end is before start (rare — couples crossing midnight), treat
  // the entry as crossing midnight and add a full day to end.
  const diff = b >= a ? b - a : b + 24 * 60 - a;
  return Math.max(5, Math.min(diff, 24 * 60));
}

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
//
// 2026-07-22 — UX rework per user feedback. The dropdown is now
// the PRIMARY control (always visible) so couples see the helpers
// they can pick from. The free-text input is demoted to a small
// "+ 自訂" toggle that reveals a text field on demand. Before this
// change, couples with no helpers invited only saw a text input —
// which pushed them toward typing free-form names instead of
// inviting helpers, defeating the point of having helpers in
// the app. Now the dropdown is always visible and the free-text
// is opt-in.
//
// 2026-08-01 — Owner (couple) support. Pass `ownerNames: {boyName,
// girlName}` and the picker renders the couple as a separate
// "新人自己" group ABOVE the 兄弟姊妹 group. The couple IDs are
// stable so they can be re-selected across sessions, and they
// share the chip-pill UI for visual consistency. Couples with
// no helpers invited (only the two of them) can still assign
// themselves to rundown entries.
// 2026-08-01 — Internal export for smoke tests. The component is
// pure presentational (no Firestore, no side effects), so it's
// safe to import directly from tests. See
// src/screens/WeddingDay.owner-picker.test.jsx for the regression
// suite that locks in the 新人自己 optgroup behaviour.
export function HelperPicker({ helpers = [], ownerNames, value = [], onChange }) {
  const [showCustom, setShowCustom] = useState(false);
  const add = (h) => {
    if (value.find((x) => x.id === h.id)) return;
    onChange([...value, h]);
  };
  const remove = (id) => onChange(value.filter((x) => x.id !== id));

  // 2026-07-22 — Build deduped option list (same logic as before
  // but pulled out so we can show it even when helpers.length is 0).
  // Same person can appear in both /helpers and /pendingInvites
  // (registered email pending acceptance vs. just an invited email),
  // often with different doc ids. We dedupe on email — when both
  // exist, prefer the /helpers row (uid-keyed).
  const picked = new Set(value.map((v) => v.id));
  const byEmail = new Map();
  helpers.forEach((h) => {
    const key = (h.email || h.id || '').toLowerCase();
    if (!key || picked.has(h.id)) return;
    if (h.status === 'revoked') return;
    const cur = byEmail.get(key);
    if (!cur || (h._src === 'helpers' && cur._src !== 'helpers')) {
      byEmail.set(key, h);
    }
  });
  const list = Array.from(byEmail.values()).sort((a, b) =>
    (a.displayName || a.email).localeCompare(b.displayName || b.email),
  );

  return (
    <div>
      <label className="text-xs font-bold text-slate-600 mb-1 block">
        兄弟姊妹 / 負責人
      </label>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {value.map((h) => (
          <span
            key={h.id}
            className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full border ${
              h.id === 'owner-boy' || h.id === 'owner-girl'
                ? 'bg-rose-100 text-rose-700 border-rose-200'
                : 'bg-indigo-100 text-indigo-700 border-indigo-200'
            }`}
          >
            <span>{h.name || h.id}</span>
            <button
              type="button"
              onClick={() => remove(h.id)}
              className="leading-none opacity-70 hover:opacity-100"
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
      {/* 2026-08-01 — Owner (couple) optgroup above the helper list.
          Only render the optgroup if the user has set at least one
          name. Couples who haven't filled in the names yet won't see
          this — the fallback text nudges them to MyProfile. */}
      {ownerNames && (ownerNames.boyName || ownerNames.girlName) && (
        <select
          value=""
          onChange={(e) => {
            const id = e.target.value;
            if (!id) return;
            const list = [
              ownerNames.boyName && { id: 'owner-boy', name: ownerNames.boyName, uid: 'owner-boy' },
              ownerNames.girlName && { id: 'owner-girl', name: ownerNames.girlName, uid: 'owner-girl' },
            ].filter(Boolean);
            const owner = list.find((x) => x.id === id);
            if (owner) add(owner);
          }}
          className="w-full p-2 rounded-lg border border-rose-200 text-xs bg-rose-50/40 mb-1.5"
        >
          <option value="">+ 新人自己...</option>
          {ownerNames.boyName && (
            <option value="owner-boy">🤵 {ownerNames.boyName}</option>
          )}
          {ownerNames.girlName && (
            <option value="owner-girl">👰 {ownerNames.girlName}</option>
          )}
        </select>
      )}
      {/* 2026-07-22 — Always-on dropdown. Was hidden when
          helpers.length === 0, which pushed couples into the
          free-text input. Now we render it always so couples
          see "this is the way to assign helpers" even before
          they've invited anyone. When list is empty, the
          dropdown is disabled and the helper text below points
          them at the helpers manager. */}
      <select
        value=""
        onChange={(e) => {
          const hid = e.target.value;
          const h = helpers.find((x) => x.id === hid);
          if (h) add({
            id: h.id,
            name: h.displayName || h.name || h.email || '?',
            uid: h.helperUid || '',
          });
        }}
        disabled={list.length === 0}
        className="w-full p-2 rounded-lg border border-slate-300 text-xs bg-white disabled:bg-slate-50 disabled:text-slate-400"
      >
        {list.length > 0 ? (
          <>
            <option value="">+ 從已邀請嘅兄弟姊妹加入...</option>
            {list.map((h) => {
              const accepted = h.status === 'active';
              return (
                <option key={h.id} value={h.id}>
                  {h.displayName || h.name || h.email}
                  {!accepted ? '  (待接受)' : ''}
                </option>
              );
            })}
          </>
        ) : (
          <option value="">未邀請任何兄弟姊妹 (去主控台邀請)</option>
        )}
      </select>
      {list.length === 0 && (
        <p className="text-[10px] text-amber-600 mt-1 leading-relaxed">
          💡 去主控台點「兄弟姊妹」→「邀請」加入常用嘅助手，之後就可以喺度直接指派。
        </p>
      )}
      {/* 2026-07-22 — Opt-in custom-name input. Demoted from
          always-visible to a "+ 自訂" toggle. The dropdown is
          now the primary path; this is the escape hatch for
          on-the-fly names like "表姊 KC" who isn't in the app
          yet. */}
      {showCustom ? (
        <div className="mt-1.5 flex gap-1">
          <input
            type="text"
            autoFocus
            placeholder="自行輸入名 (例: 表姊 KC)"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                const name = e.currentTarget.value.trim();
                const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                add({ id, name, uid: '' });
                e.currentTarget.value = '';
                e.preventDefault();
              }
            }}
            className="flex-1 p-2 rounded-lg border border-slate-300 text-xs"
          />
          <button
            type="button"
            onClick={() => setShowCustom(false)}
            className="px-2 text-xs text-slate-400 hover:text-slate-700"
            title="取消自訂"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowCustom(true)}
          className="mt-1 text-[10px] text-slate-500 hover:text-indigo-600 underline"
        >
          + 自行輸入名 (不在已邀請名單內)
        </button>
      )}
    </div>
  );
}

function RundownTab({
  entries,
  onUpsert,
  onDelete,
  onReorder,
  onSetOrders,
  helpers,
  ownerNames,
  vendors = [],
  ownerUid,
  eventId,
  currentUser,
  commentPathFor, // (entryId) => CollectionReference | null
  // 2026-08-20 — Manus P0: comment-level deep-link forwarding.
  // The tab uses these to (a) auto-open the matching entry's
  // comments panel and (b) forward the focus to its
  // <ItemComments>. Optional; defaults to null so existing
  // callers (tests, storybook) keep working.
  focusedParentId = null,
  focusedParentKind = null,
  focusedCommentId = null,
  onFocusedCommentHandled = null,
}) {
  const [editing, setEditing] = useState(null);
  const [filterGroup, setFilterGroup] = useState('all');
  const [filterAssigned, setFilterAssigned] = useState('all');
  // 2026-08-09 — Track which entry's comments panel is open. Single
  // entry at a time so we only mount one ItemComments subscription.
  const [openCommentsFor, setOpenCommentsFor] = useState(null);
  const toggleComments = (id) =>
    setOpenCommentsFor((cur) => (cur === id ? null : id));
  // 2026-08-20 — Manus P0: auto-open the matching entry's
  // comments panel when a bell alert routes here. The deep-link
  // is two-stage: WeddingDay scrolls the row into view, then
  // this effect opens its comments panel so <ItemComments> can
  // mount + find the matching comment. We depend on
  // focusedParentKind so a resources-tab focus (kind='resources')
  // doesn't open a rundown panel — those targets belong to
  // ResourcesTab.
  useEffect(() => {
    if (
      focusedParentKind === 'rundown' &&
      focusedParentId &&
      openCommentsFor !== focusedParentId
    ) {
      setOpenCommentsFor(focusedParentId);
    }
  }, [focusedParentKind, focusedParentId]);

  // 2026-07-22 — Sort mode for 大日流程. Two modes:
  //   'time'   (default) — sort by startTime asc. The natural
  //                        schedule-driven order; couples plan
  //                        around actual times.
  //   'manual'          — sort by manualPosition asc. Drag the
  //                        rows around when the start times are
  //                        equal (e.g. three events all at 14:00)
  //                        or when you want a custom run-of-show.
  // Same pattern as PlaylistTab and ResourcesTab.
  const [sortMode, setSortMode] = useState('time');

  const unassignedCount = (entries || []).filter(
    (e) => !e.assignedHelpers || e.assignedHelpers.length === 0,
  ).length;

  const sorted = useMemo(() => {
    let s = [...(entries || [])];
    if (sortMode === 'manual') {
      // Sort by manualPosition asc; unpinned entries go to the
      // bottom (so couples can still see new entries that
      // haven't been placed yet). Within manualPosition ties,
      // fall back to startTime for stable ordering.
      s.sort((a, b) => {
        const ap = a.manualPosition;
        const bp = b.manualPosition;
        if (ap == null && bp == null) {
          return (a.startTime || '').localeCompare(b.startTime || '');
        }
        if (ap == null) return 1;
        if (bp == null) return -1;
        return ap - bp;
      });
    } else {
      s.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
    }
    if (filterGroup !== 'all') s = s.filter((e) => (e.group || 'prep') === filterGroup);
    if (filterAssigned === 'unassigned')
      s = s.filter((e) => !e.assignedHelpers || e.assignedHelpers.length === 0);
    return s;
  }, [entries, filterGroup, filterAssigned, sortMode]);

  const counts = useMemo(() => {
    const out = { all: (entries || []).length };
    Object.keys(RUNDOWN_GROUP_LABELS).forEach((g) => {
      out[g] = (entries || []).filter((e) => (e.group || 'prep') === g).length;
    });
    return out;
  }, [entries]);

  // 2026-07-22 — Drag-and-drop reorder for manual sort mode.
  // Same algorithm as 敬茶: compute contiguous positions 1..N,
  // diff against existing positions, write only changed rows.
  function persistManualOrder(orderedEntries) {
    const writes = [];
    orderedEntries.forEach((e, idx) => {
      const targetPos = idx + 1;
      if ((e.manualPosition ?? null) !== targetPos) {
        writes.push({ id: e.id, manualPosition: targetPos });
      }
    });
    if (writes.length === 0) return;
    onSetOrders?.(writes);
  }

  // 2026-07-22 — Per-row dnd-kit drag handle. Each row gets
  // its own DragEnd handler via a ref-pattern because we need
  // access to the local `sorted` array. We expose a wrapper
  // that handles drag for the whole list.
  function RundownListDnD({ list, children }) {
    const sensors = useSensors(
      useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
      useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
      useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    function handleDragEnd(event) {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIdx = list.findIndex((e) => e.id === active.id);
      const newIdx = list.findIndex((e) => e.id === over.id);
      if (oldIdx < 0 || newIdx < 0) return;
      persistManualOrder(arrayMove(list, oldIdx, newIdx));
    }

    return (
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={list.map((e) => e.id)} strategy={verticalListSortingStrategy}>
          {children}
        </SortableContext>
      </DndContext>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        按時間排序嘅大日流程 — 兄弟姊妹/司儀可以即時查閱，唔使再 WhatsApp 過嚟問。
      </p>
      <p className="text-xs text-slate-400 -mt-2">
        💡 想自訂順序？按 <span className="font-bold">自訂</span>，然後捉住右邊嗰條拖把 <GripVertical className="inline w-3 h-3" /> 就可以拖去新位置。
      </p>

      <div className="flex flex-wrap gap-2 items-center">
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
        {/* 2026-07-22 — sort mode toggle. Same pattern as 歌單/物資. */}
        <div className="inline-flex rounded-lg border border-slate-300 bg-white overflow-hidden text-xs ml-auto">
          <button
            type="button"
            onClick={() => setSortMode('time')}
            className={`px-2.5 py-1 flex items-center gap-1 transition-colors ${
              sortMode === 'time'
                ? 'bg-rose-500 text-white'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
            title="按開始時間排序"
          >
            <Clock className="w-3.5 h-3.5" />
            <span>時間</span>
          </button>
          <button
            type="button"
            onClick={() => setSortMode('manual')}
            className={`px-2.5 py-1 flex items-center gap-1 transition-colors border-l border-slate-200 ${
              sortMode === 'manual'
                ? 'bg-rose-500 text-white'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
            title="按自訂順序排序（拖動重新排列）"
          >
            <GripVertical className="w-3.5 h-3.5" />
            <span>自訂</span>
          </button>
        </div>
      </div>

      <NewEntryRow
        helpers={helpers}
        ownerNames={ownerNames}
        vendors={vendors}
        onSubmit={(data) => {
          onUpsert({ id: `rd-${Date.now()}`, ...data });
        }}
      />

      {sorted.length === 0 && (
        <div className="text-center py-10 text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
          暫無流程。加入例如「10:00 兄弟姊妹集合」嘅項目就會喺度出現。
        </div>
      )}
      {sortMode === 'manual' ? (
        <RundownListDnD list={sorted}>
          <div className="space-y-2">
            {sorted.map((entry, idx) => (
              <SortableRow key={entry.id} id={entry.id}>
                {({ dragHandleProps }) => (
                  <RundownCard
                    entry={entry}
                    helpers={helpers}
                    ownerNames={ownerNames}
                    vendors={vendors}
                    ownerUid={ownerUid}
                    eventId={eventId}
                    currentUser={currentUser}
                    commentPath={commentPathFor ? commentPathFor(entry.id) : null}
                    showComments={openCommentsFor === entry.id}
                    onToggleComments={() => toggleComments(entry.id)}
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
                    dragHandleProps={dragHandleProps}
                    // 2026-08-20 — Manus P0: comment-level focus
                    // forwarding (see <ItemComments>' success
                    // effect). Gated by focusedParentKind so
                    // non-matching cards don't race.
                    focusedCommentId={
                      focusedParentKind === 'rundown' ? focusedCommentId : null
                    }
                    onFocusedCommentHandled={onFocusedCommentHandled}
                  />
                )}
              </SortableRow>
            ))}
          </div>
        </RundownListDnD>
      ) : (
        <div className="space-y-2">
          {sorted.map((entry, idx) => (
            <RundownCard
              key={entry.id}
              entry={entry}
              helpers={helpers}
              ownerNames={ownerNames}
              vendors={vendors}
              ownerUid={ownerUid}
              eventId={eventId}
              currentUser={currentUser}
              commentPath={commentPathFor ? commentPathFor(entry.id) : null}
              showComments={openCommentsFor === entry.id}
              onToggleComments={() => toggleComments(entry.id)}
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
              // 2026-08-20 — Manus P0: see the manual-mode
              // RundownCard above; same forwarding.
              focusedCommentId={
                focusedParentKind === 'rundown' ? focusedCommentId : null
              }
              onFocusedCommentHandled={onFocusedCommentHandled}
            />
          ))}
        </div>
      )}
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

function RundownCard({
  entry,
  helpers,
  ownerNames,
  vendors = [],
  isEditing,
  isFirst,
  isLast,
  onEdit,
  onCancel,
  onSave,
  onDelete,
  onMoveUp,
  onMoveDown,
  // 2026-08-09 — comments + assigned-vendor plumbing.
  ownerUid,
  eventId,
  currentUser,
  commentPath,
  showComments = false,
  onToggleComments,
  // 2026-07-22 — dnd-kit drag handle props. When set, the card
  // renders a GripVertical handle bound to dragHandleProps so
  // couples can drag to reorder in manual sort mode. When
  // undefined (time mode), the legacy ▲▼ buttons are rendered
  // as a fallback.
  dragHandleProps,
  // 2026-08-20 — Manus P0: comment-level focus forwarding.
  // <ItemComments> uses these to scrollIntoView the matching
  // comment and fire the consumption acknowledgement.
  focusedCommentId = null,
  onFocusedCommentHandled = null,
}) {
  const [draft, setDraft] = useState({
    startTime: entry.startTime || '12:00',
    durationMin: entry.durationMin || 30,
    title: entry.title || '',
    location: entry.location || '',
    notes: entry.notes || '',
    group: entry.group || 'prep',
    assignedHelpers: entry.assignedHelpers || [],
    // 2026-08-09 — vendor assignment. Single-vendor shape:
    // { uid, name } | null. uid is null when the owner typed a
    // custom name (no real vendor account yet).
    assignedVendor: entry.assignedVendor || null,
  });

  // 2026-07-31 — Derive an end-time picker from the existing
  // `durationMin` so the editor reads "5:30 AM → 6:00 AM" instead
  // of the legacy "5:30 AM / 30 分鐘" mental-math pattern. Keeps
  // `durationMin` in storage (no data migration) — the end picker
  // re-derives it whenever startTime or endTime changes.
  const draftEndTime = computeEndHHMM(draft.startTime, draft.durationMin);
  const endBeforeStart =
    parseHHMMToMinutes(draft.startTime) !== null &&
    parseHHMMToMinutes(draftEndTime) !== null &&
    parseHHMMToMinutes(draftEndTime) <= parseHHMMToMinutes(draft.startTime);

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
          <div className="col-span-3 flex items-center justify-center text-slate-300 text-sm">
            →
          </div>
          <input
            type="time"
            value={draftEndTime}
            onChange={(e) => {
              // User picks an end-time directly. Convert that into
              // a duration so storage stays consistent.
              const nextDur = computeMinutesBetween(draft.startTime, e.target.value);
              setDraft({ ...draft, durationMin: nextDur });
            }}
            className="col-span-3 p-2 rounded-lg border border-slate-300 text-sm"
          />
          <select
            value={draft.group}
            onChange={(e) => setDraft({ ...draft, group: e.target.value })}
            className="col-span-3 p-2 rounded-lg border border-slate-300 text-sm bg-white"
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
          <div className="col-span-12 grid grid-cols-1 md:grid-cols-2 gap-3">
            <HelperPicker
              helpers={helpers}
              ownerNames={ownerNames}
              value={draft.assignedHelpers}
              onChange={(ah) => setDraft({ ...draft, assignedHelpers: ah })}
            />
            <VendorPicker
              vendors={vendors}
              value={draft.assignedVendor}
              onChange={(av) => setDraft({ ...draft, assignedVendor: av })}
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
            onClick={() => {
              if (!draft.title || endBeforeStart) return;
              // 2026-08-09 — flatten the VendorPicker value
              // ({uid, name}) to Firestore-friendly scalars.
              // assignedVendorUid is what the rule checks for the
              // assigned-vendor gate; assignedVendorName is for
              // display. If uid is null (custom-typed placeholder)
              // we still write the name but the rule will reject
              // any vendor trying to comment until the name is
              // replaced with a real uid.
              const { assignedVendor, ...rest } = draft;
              onSave({
                ...rest,
                assignedVendorUid: assignedVendor?.uid || null,
                assignedVendorName: assignedVendor?.name || null,
              });
            }}
            disabled={!draft.title || endBeforeStart}
            className="px-3 py-1.5 text-sm rounded-lg bg-rose-600 text-white font-bold hover:bg-rose-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            儲存
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5 flex gap-3 items-start">
      {/* 2026-07-22 — reorder column. In manual sort mode
          (dragHandleProps provided), render a large drag handle
          that initiates a dnd-kit drag. In time mode (no
          dragHandleProps), fall back to the legacy ▲▼
          micro-shift buttons. Same icon set, two affordances. */}
      {dragHandleProps ? (
        <button
          type="button"
          {...dragHandleProps}
          className="flex-shrink-0 self-stretch flex items-center justify-center w-9 px-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-grab active:cursor-grabbing touch-none"
          title="捉住拖動重新排列"
          aria-label="拖動重新排列"
        >
          <GripVertical className="w-5 h-5" strokeWidth={2} />
        </button>
      ) : (
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
      )}
      <div className="flex-shrink-0 text-center min-w-[68px]">
        <div className="text-lg font-black text-rose-600 font-mono">
          {entry.startTime}
        </div>
        {/* 2026-07-31 — replaced `+30分` with an end-time arrow so
            the agenda card reads "5:30 → 6:00" at a glance. Falls
            back to `+N分` when there's no startTime (older data
            imported without startTime), and wraps past midnight for
            late receptions. */}
        {entry.startTime ? (
          <div className="text-[10px] text-slate-400">
            → {computeEndHHMM(entry.startTime, entry.durationMin || 30)}
          </div>
        ) : (
          <div className="text-[10px] text-slate-400">
            +{entry.durationMin || 30}分
          </div>
        )}
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
          {/* 2026-08-09 — Vendor assignment pill. uid truthy means a
              real vendor account is tagged (vendor can see + comment).
              name-only (custom placeholder) is rendered with a
              different style so the couple can tell at a glance that
              no real vendor is connected yet. */}
          {(entry.assignedVendorUid || entry.assignedVendorName) && (
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
                entry.assignedVendorUid
                  ? 'bg-amber-100 text-amber-700 border-amber-200'
                  : 'bg-slate-100 text-slate-500 border-slate-200'
              }`}
              title={entry.assignedVendorUid ? `商戶帳號 ${entry.assignedVendorUid}` : '自訂名稱（未連結商戶帳號）'}
            >
              🏪 {entry.assignedVendorName || '商戶'}
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
        {/* 2026-08-09 — Comments toggle. Same logic as the bell
            dropdown's 全部已讀: clicking expands an inline
            <ItemComments/> for this entry. Click again to collapse.
            Hidden when ownerUid / eventId / path are missing (e.g.
            old entry that pre-dates this change but hasn't been
            re-saved with the new fields). */}
        {commentPath && currentUser && onToggleComments && (
          <button
            onClick={onToggleComments}
            className={`p-1 rounded ${
              showComments
                ? 'text-rose-600 bg-rose-50'
                : 'text-slate-300 hover:text-rose-600 hover:bg-rose-50'
            }`}
            title={showComments ? '收埋留言' : '睇留言 / 留'}
            aria-label={showComments ? '收埋留言' : '睇留言 / 留'}
          >
            <MessageCircle className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={onEdit}
          className="p-1 text-slate-300 hover:text-slate-700 rounded"
          title="編輯"
          aria-label="編輯"
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
      {/* 2026-08-09 — Inline comments panel. Spans the full card
          width (below the meta row + buttons). Only mounted when
          expanded, so the subscription is paid for one entry at a
          time — keeps Firestore read costs bounded even with 50+
          rundown entries. */}
      {showComments && commentPath && currentUser && (
        <div className="col-span-12 mt-2">
          <ItemComments
            path={commentPath}
            currentUser={currentUser}
            currentRole="owner"
            label="大日流程留言"
            parentAssignedVendorUid={entry?.assignedVendorUid || null}
            parentAssignedHelperUid={entry?.assignedHelperUid || null}
            // 2026-08-20 — Manus P0: forward the focus props so
            // <ItemComments> can scroll the matching comment and
            // fire the consumption ack. The tab-level gate
            // (focusedParentKind === 'rundown') is already
            // applied upstream, so by the time we reach this
            // <ItemComments>, focusedCommentId is only set when
            // THIS card is the matching one.
            focusedCommentId={focusedCommentId}
            onFocusedCommentHandled={onFocusedCommentHandled}
          />
        </div>
      )}
    </div>
  );
}

function NewEntryRow({ onSubmit, helpers, ownerNames, vendors = [] }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    startTime: '12:00',
    endTime: '12:30',
    durationMin: 30,
    title: '',
    location: '',
    notes: '',
    group: 'reception',
    assignedHelpers: [],
    // 2026-08-09 — vendor assignment for new rundown entries.
    assignedVendor: null,
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

  // 2026-07-31 — Same `startTime → endTime` picker pattern as the
  // inline editor. `endTime` lives in `draft` so we know which the
  // user touched last; `durationMin` is derived on save so it stays
  // in sync with storage.
  const endBeforeStart =
    parseHHMMToMinutes(draft.startTime) !== null &&
    parseHHMMToMinutes(draft.endTime) !== null &&
    parseHHMMToMinutes(draft.endTime) <= parseHHMMToMinutes(draft.startTime);

  return (
    <div className="rounded-xl border-2 border-rose-300 p-4 bg-rose-50/30 space-y-3">
      <div className="grid grid-cols-12 gap-3">
        <input
          type="time"
          value={draft.startTime}
          onChange={(e) => {
            const nextStart = e.target.value;
            // If the existing endTime is no longer after the new
            // startTime, push it forward by the previous gap so the
            // user doesn't lose their work to an invalid state.
            const gap = parseHHMMToMinutes(draft.endTime) -
              parseHHMMToMinutes(draft.startTime);
            setDraft(
              gap > 0
                ? { ...draft, startTime: nextStart }
                : { ...draft, startTime: nextStart, endTime: addMinutesToHHMM(nextStart, 30) },
            );
          }}
          className="col-span-3 p-2 rounded-lg border border-slate-300 text-sm"
        />
        <div className="col-span-3 flex items-center justify-center text-slate-300 text-sm">
          →
        </div>
        <input
          type="time"
          value={draft.endTime}
          onChange={(e) => setDraft({ ...draft, endTime: e.target.value })}
          className="col-span-3 p-2 rounded-lg border border-slate-300 text-sm"
        />
        <select
          value={draft.group}
          onChange={(e) => setDraft({ ...draft, group: e.target.value })}
          className="col-span-3 p-2 rounded-lg border border-slate-300 text-sm bg-white"
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
        <div className="col-span-12 grid grid-cols-1 md:grid-cols-2 gap-3">
          <HelperPicker
            helpers={helpers}
            ownerNames={ownerNames}
            value={draft.assignedHelpers}
            onChange={(ah) => setDraft({ ...draft, assignedHelpers: ah })}
          />
          <VendorPicker
            vendors={vendors}
            value={draft.assignedVendor}
            onChange={(av) => setDraft({ ...draft, assignedVendor: av })}
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
            if (endBeforeStart) return;
            // 2026-07-31 — Derive durationMin from the picked endTime
            // so storage stays consistent with the legacy readers
            // (render site uses durationMin to compute the end
            // arrow).
            const durationMin = computeMinutesBetween(
              draft.startTime,
              draft.endTime,
            );
            const { endTime: _ignored, assignedVendor, ...rest } = draft;
            // 2026-08-09 — flatten VendorPicker value into
            // assignedVendorUid/Name for Firestore.
            onSubmit({
              ...rest,
              durationMin,
              assignedVendorUid: assignedVendor?.uid || null,
              assignedVendorName: assignedVendor?.name || null,
              createdAt: Date.now(),
            });
            setDraft({ startTime: '12:00', endTime: '12:30', durationMin: 30, title: '', location: '', notes: '', group: 'reception', assignedHelpers: [], assignedVendor: null });
            setOpen(false);
          }}
          disabled={!draft.title.trim() || endBeforeStart}
          className="px-3 py-1.5 text-sm rounded-lg bg-rose-600 text-white font-bold hover:bg-rose-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
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

function ResourcesTab({
  items,
  onUpsert,
  onDelete,
  onToggle,
  onReorder,
  onSetOrders,
  currentUser,
  helpers,
  showToast,
  ownerNames,
  // 2026-08-09 — vendor assignment + comments for 物資.
  vendors = [],
  ownerUid,
  eventId,
  commentPathFor, // (itemId) => CollectionReference | null
  // 2026-08-20 — Manus P0: comment-level focus forwarding. The
  // tab uses these to auto-open the matching item's comments
  // panel + forward to <ItemComments>. See RundownTab for the
  // same pattern.
  focusedParentId = null,
  focusedParentKind = null,
  focusedCommentId = null,
  onFocusedCommentHandled = null,
}) {
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState('all');
  // 2026-08-09 — Track which item's comments panel is open. Same
  // pattern as RundownTab.
  const [openCommentsFor, setOpenCommentsFor] = useState(null);
  const toggleComments = (id) =>
    setOpenCommentsFor((cur) => (cur === id ? null : id));
  // 2026-08-20 — Manus P0: auto-open the matching item's
  // comments panel when a bell alert routes here. Mirrors the
  // rundown-tab effect. Depend on focusedParentKind so a
  // rundown-tab focus (kind='rundown') doesn't open a resource
  // panel here.
  useEffect(() => {
    if (
      focusedParentKind === 'resources' &&
      focusedParentId &&
      openCommentsFor !== focusedParentId
    ) {
      setOpenCommentsFor(focusedParentId);
    }
  }, [focusedParentKind, focusedParentId]);
  // 2026-07-22 — Sort mode toggle. Same pattern as PlaylistTab.
  //   'created' (default) — sort by createdAt asc; new items
  //                          appear at the bottom of their
  //                          category. Couples can mentally
  //                          track order without effort.
  //   'manual'             — sort by manualPosition asc. Couples
  //                          use ▲▼ in each row to pin specific
  //                          items to specific positions.
  //                          Useful when the morning-of packing
  //                          order matters (fridge stuff first,
  //                          decorations last).
  const [sortMode, setSortMode] = useState('created');

  // 2026-07-22 — swap handler. Same algorithm as PlaylistTab.
  // Items are grouped by category; ▲/▼ swaps the manualPosition
  // of the moved item with the neighbour in the same group.
  function handleReorder(itemId, direction) {
    const item = (items || []).find((i) => i.id === itemId);
    if (!item) return;
    const cat = item.category || 'other';
    const groupList = grouped[cat] || [];
    const idx = groupList.findIndex((i) => i.id === itemId);
    if (idx < 0) return;
    const delta = direction === 'up' ? -1 : 1;
    const swapWith = groupList[idx + delta];
    if (!swapWith) return;
    const myPos = item.manualPosition;
    const otherPos = swapWith.manualPosition;
    let newMine, newOther;
    if (myPos != null && otherPos != null) {
      newMine = otherPos;
      newOther = myPos;
    } else if (myPos == null && otherPos == null) {
      const base = groupList.filter((s) => s.manualPosition != null).length;
      newMine = base;
      newOther = base + 1;
    } else {
      newMine = otherPos ?? idx;
      newOther = myPos ?? idx + 1;
    }
    onReorder?.(itemId, newMine, swapWith.id, newOther);
  }

  // 2026-07-22b — Drag-and-drop wrapper for each 物資 category.
  // Each category (佈置 / 物資 / 食物 / etc.) gets its own
  // dnd-kit context so couples can only drag within a category.
  // On drop we compute contiguous manualPosition values and
  // batch-write them to Firestore via onSetOrders.
  function ResourcesGroupDnD({ list, children }) {
    const sensors = useSensors(
      useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
      useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
      useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    function handleDragEnd(event) {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIdx = list.findIndex((i) => i.id === active.id);
      const newIdx = list.findIndex((i) => i.id === over.id);
      if (oldIdx < 0 || newIdx < 0) return;
      const reordered = arrayMove(list, oldIdx, newIdx);
      const writes = [];
      reordered.forEach((i, idx) => {
        const targetPos = idx + 1;
        if ((i.manualPosition ?? null) !== targetPos) {
          writes.push({ id: i.id, manualPosition: targetPos });
        }
      });
      if (writes.length > 0) onSetOrders?.(writes);
    }

    if (!list || list.length === 0) return null;

    return (
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={list.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          {children}
        </SortableContext>
      </DndContext>
    );
  }

  // 2026-07-22b — Extract the resource-item body (label + qty +
  // assigned helpers + notes) into a small component so both the
  // drag-mode and non-drag-mode rows render the same markup
  // without duplication.
  function ResourceItemBody({ item }) {
    return (
      <div className="flex-grow min-w-0">
        <div
          className={`font-bold ${item.checked ? 'line-through text-slate-500' : 'text-slate-800'}`}
        >
          {item.label}
        </div>
        {(item.qty || item.assignedToName || item.notes ||
          (item.assignedHelpers && item.assignedHelpers.length > 0) ||
          item.assignedVendorUid || item.assignedVendorName) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5 text-xs text-slate-500">
            {item.qty && <span>數量: <b className="text-slate-700">{item.qty}</b></span>}
            {item.assignedToName && (
              <span className="inline-flex items-center gap-1">
                <Users className="w-3 h-3" />
                負責: <b className="text-rose-600">{item.assignedToName}</b>
              </span>
            )}
            {/* 2026-08-09 — Vendor pill. Same shape/colors as the
                rundown one. uid truthy = real account, name-only =
                custom placeholder. */}
            {(item.assignedVendorUid || item.assignedVendorName) && (
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
                  item.assignedVendorUid
                    ? 'bg-amber-100 text-amber-700 border-amber-200'
                    : 'bg-slate-100 text-slate-500 border-slate-200'
                }`}
                title={item.assignedVendorUid ? `商戶帳號 ${item.assignedVendorUid}` : '自訂名稱（未連結商戶帳號）'}
              >
                🏪 {item.assignedVendorName || '商戶'}
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
    );
  }

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
    // 2026-07-22 — sort each group by the active mode.
    Object.keys(out).forEach((k) => {
      if (sortMode === 'manual') {
        out[k].sort((a, b) => {
          const ap = a.manualPosition;
          const bp = b.manualPosition;
          if (ap == null && bp == null) return (a.createdAt || 0) - (b.createdAt || 0);
          if (ap == null) return 1;
          if (bp == null) return -1;
          return ap - bp;
        });
      } else {
        // 'created' (default) — sort by createdAt asc. Stable
        // enough for typical usage; older items appear first
        // which mirrors a "checklist of to-dos" mental model.
        out[k].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      }
    });
    return out;
  }, [filtered, sortMode]);

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
        {/* 2026-07-22 — sort mode toggle. Two pills: 加入時間
            (default, createdAt) and 自訂順序 (manual, ▲▼).
            Same component pattern as PlaylistTab. */}
        <div className="inline-flex rounded-lg border border-slate-300 bg-white overflow-hidden text-xs ml-auto">
          <button
            type="button"
            onClick={() => setSortMode('created')}
            className={`px-2.5 py-1 flex items-center gap-1 transition-colors ${
              sortMode === 'created'
                ? 'bg-rose-500 text-white'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
            title="按加入時間排序"
          >
            <Clock className="w-3.5 h-3.5" />
            <span>時間</span>
          </button>
          <button
            type="button"
            onClick={() => setSortMode('manual')}
            className={`px-2.5 py-1 flex items-center gap-1 transition-colors border-l border-slate-200 ${
              sortMode === 'manual'
                ? 'bg-rose-500 text-white'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
            title="按自訂順序排序（用 ▲▼ 排列）"
          >
            <GripVertical className="w-3.5 h-3.5" />
            <span>自訂</span>
          </button>
        </div>
      </div>

      <NewResourceRow
        helpers={helpers}
        ownerNames={ownerNames}
        vendors={vendors}
        onSubmit={(d) => onUpsert({ id: `rs-${Date.now()}`, ...d })}
      />

      {Object.entries(grouped).map(([cat, list]) => (
        <div key={cat} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600 uppercase tracking-wide">
            {RESOURCE_CATEGORIES[cat] || cat}
          </div>
          {/* 2026-07-22b — Wrap each category in ResourcesGroupDnD
              when in manual sort mode. Couples can drag items
              within a category (e.g. 佈置 items reorder within
              佈置) but not across categories. In default 時間
              mode we render the legacy non-draggable list. */}
          {sortMode === 'manual' ? (
            <ResourcesGroupDnD list={list}>
              <div className="divide-y divide-slate-100">
                {list.map((item) => (
                  <SortableRow key={item.id} id={item.id}>
                    {({ dragHandleProps }) => (
                      <div>
                      <div
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
                        {/* Drag handle. Same style as 大日流程
                            and 敬茶 handles. */}
                        <button
                          type="button"
                          {...dragHandleProps}
                          className="flex-shrink-0 self-stretch flex items-center justify-center w-8 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-grab active:cursor-grabbing touch-none"
                          title="捉住拖動重新排列"
                          aria-label="拖動重新排列"
                        >
                          <GripVertical className="w-4 h-4" strokeWidth={2} />
                        </button>
                        <ResourceItemBody item={item} />
                        {/* 2026-08-09 — Comments toggle for 物資.
                            Same shape as the rundown one; clicking
                            expands the inline ItemComments panel
                            below the row. */}
                        {commentPathFor && currentUser && (
                          <button
                            type="button"
                            onClick={() => toggleComments(item.id)}
                            className={`p-1 rounded flex-shrink-0 ${
                              openCommentsFor === item.id
                                ? 'text-rose-600 bg-rose-50'
                                : 'text-slate-300 hover:text-rose-600 hover:bg-rose-50'
                            }`}
                            title={openCommentsFor === item.id ? '收埋留言' : '睇留言 / 留'}
                            aria-label={openCommentsFor === item.id ? '收埋留言' : '睇留言 / 留'}
                          >
                            <MessageCircle className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => setEditing(item.id)}
                          className="p-1 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded flex-shrink-0"
                          title="編輯物資"
                          aria-label="編輯物資"
                        >
                          <span className="text-xs">✏️</span>
                        </button>
                        <button
                          onClick={() => onDelete(item.id)}
                          className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded flex-shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      {/* 2026-08-09 — Inline comments panel for
                          物資 (drag-mode row). Same single-open-at-
                          a-time pattern as the rundown tab. */}
                      {openCommentsFor === item.id && commentPathFor && currentUser && (
                        <div className="px-4 pb-2">
                          <ItemComments
                            path={commentPathFor(item.id)}
                            currentUser={currentUser}
                            currentRole="owner"
                            label="物資留言"
                            parentAssignedVendorUid={item.assignedVendorUid || null}
                            parentAssignedHelperUid={item.assignedHelperUid || null}
                            // 2026-08-20 — see rundown block above.
                            focusedCommentId={focusedParentKind === 'resources' ? focusedCommentId : null}
                            // 2026-08-20 — Manus P0: forward the
                            // consumption authority callback so the
                            // matching <ItemComments> can ack on
                            // scrollIntoView success.
                            onFocusedCommentHandled={onFocusedCommentHandled}
                          />
                        </div>
                      )}
                      </div>
                    )}
                  </SortableRow>
                ))}
                {editing && (items || []).some((i) => i.id === editing) && (
                  <EditResourceRow
                    key={editing}
                    item={(items || []).find((i) => i.id === editing)}
                    helpers={helpers}
                    ownerNames={ownerNames}
                    vendors={vendors}
                    onSave={(updated) => {
                      onUpsert(updated);
                      setEditing(null);
                      showToast('✅ 物資已更新');
                    }}
                    onCancel={() => setEditing(null)}
                  />
                )}
              </div>
            </ResourcesGroupDnD>
          ) : (
            <div className="divide-y divide-slate-100">
              {list.map((item) => (
                // 2026-08-17 — Manus A8: data-row-id on the non-drag
                // resources row too, so bell-click focus works in
                // both manual-sort and time-sort groups.
                <div
                  key={item.id}
                  data-row-id={item.id}
                  className={`${editing === item.id ? 'hidden' : 'flex flex-col'} ${item.checked ? 'bg-slate-50 opacity-60' : ''}`}
                >
                <div className="flex items-center gap-3 px-4 py-2.5">
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
                  <ResourceItemBody item={item} />
                  {/* 2026-08-09 — Comments toggle (non-drag row). */}
                  {commentPathFor && currentUser && (
                    <button
                      type="button"
                      onClick={() => toggleComments(item.id)}
                      className={`p-1 rounded flex-shrink-0 ${
                        openCommentsFor === item.id
                          ? 'text-rose-600 bg-rose-50'
                          : 'text-slate-300 hover:text-rose-600 hover:bg-rose-50'
                      }`}
                      title={openCommentsFor === item.id ? '收埋留言' : '睇留言 / 留'}
                      aria-label={openCommentsFor === item.id ? '收埋留言' : '睇留言 / 留'}
                    >
                      <MessageCircle className="w-4 h-4" />
                    </button>
                  )}
                  {/* 2026-07-24 — edit button. ✏️ emoji to match
                      the rest of the wedding-day suite. */}
                  <button
                    onClick={() => setEditing(item.id)}
                    className="p-1 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded flex-shrink-0"
                    title="編輯物資"
                    aria-label="編輯物資"
                  >
                    <span className="text-xs">✏️</span>
                  </button>
                  <button
                    onClick={() => onDelete(item.id)}
                    className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded flex-shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {/* 2026-08-09 — Inline comments panel (non-drag). */}
                {openCommentsFor === item.id && commentPathFor && currentUser && (
                  <div className="px-4 pb-2">
                    <ItemComments
                      path={commentPathFor(item.id)}
                      currentUser={currentUser}
                      currentRole="owner"
                      label="物資留言"
                      parentAssignedVendorUid={item.assignedVendorUid || null}
                      parentAssignedHelperUid={item.assignedHelperUid || null}
                      // 2026-08-20 — see rundown block above.
                      focusedCommentId={focusedParentKind === 'resources' ? focusedCommentId : null}
                      // 2026-08-20 — Manus P0: forward the
                      // consumption authority callback so the
                      // matching <ItemComments> can ack on
                      // scrollIntoView success.
                      onFocusedCommentHandled={onFocusedCommentHandled}
                    />
                  </div>
                )}
                </div>
              ))}
              {editing && (items || []).some((i) => i.id === editing) && (
                <EditResourceRow
                  key={editing}
                  item={(items || []).find((i) => i.id === editing)}
                  helpers={helpers}
                  ownerNames={ownerNames}
                  onSave={(updated) => {
                    onUpsert(updated);
                    setEditing(null);
                    showToast('✅ 物資已更新');
                  }}
                  onCancel={() => setEditing(null)}
                />
              )}
            </div>
          )}
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

function NewResourceRow({ onSubmit, helpers, ownerNames, vendors = [] }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    label: '',
    qty: '',
    category: 'decor',
    assignedToName: '',
    assignedHelpers: [],
    // 2026-08-09 — vendor assignment for new 物資 items.
    assignedVendor: null,
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
        <div className="col-span-12 grid grid-cols-1 md:grid-cols-2 gap-3">
          <HelperPicker
            helpers={helpers}
            ownerNames={ownerNames}
            value={draft.assignedHelpers}
            onChange={(ah) => setDraft({ ...draft, assignedHelpers: ah })}
          />
          <VendorPicker
            vendors={vendors}
            value={draft.assignedVendor}
            onChange={(av) => setDraft({ ...draft, assignedVendor: av })}
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
            // 2026-08-09 — flatten VendorPicker value to scalars
            // before sending to onSubmit.
            const { assignedVendor, ...rest } = draft;
            onSubmit({
              ...rest,
              checked: false,
              assignedVendorUid: assignedVendor?.uid || null,
              assignedVendorName: assignedVendor?.name || null,
              createdAt: Date.now(),
            });
            setDraft({ label: '', qty: '', category: 'decor', assignedToName: '', assignedHelpers: [], assignedVendor: null, notes: '' });
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

/**
 * EditResourceRow — inline editor for an existing 物資 item.
 *
 * 2026-07-24 — Added per user request. Same field set as
 * NewResourceRow but pre-filled with the existing item's values.
 * Saves via onSave which receives the full updated item; the
 * caller merges it into Firestore via onUpsert. We deliberately
 * re-use the onUpsert path so the save logic stays single-source.
 */
function EditResourceRow({ item, helpers, ownerNames, vendors = [], onSave, onCancel }) {
  const [label, setLabel] = useState(item.label || '');
  const [qty, setQty] = useState(item.qty || '');
  const [category, setCategory] = useState(item.category || 'other');
  const [assignedToName, setAssignedToName] = useState(item.assignedToName || '');
  const [assignedHelpers, setAssignedHelpers] = useState(item.assignedHelpers || []);
  // 2026-08-09 — Vendor assignment. Round-trip the {uid, name} from
  // the existing item into the picker. If only name is set (custom
  // placeholder from before this feature), reconstruct a
  // {uid: null, name} shape so the picker renders correctly.
  const [assignedVendor, setAssignedVendor] = useState(
    item.assignedVendorUid || item.assignedVendorName
      ? { uid: item.assignedVendorUid || null, name: item.assignedVendorName || '' }
      : null,
  );
  const [notes, setNotes] = useState(item.notes || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!label.trim()) return;
    setSaving(true);
    try {
      // Pass through the original id + createdAt/checked so we don't
      // accidentally reset them; only the editable fields are touched.
      await onSave({
        ...item,
        label: label.trim(),
        qty: qty.trim(),
        category,
        assignedToName: assignedToName.trim(),
        assignedHelpers,
        // 2026-08-09 — flatten VendorPicker value into Firestore
        // scalars. Same shape as NewRundownEntry / NewResourceRow.
        assignedVendorUid: assignedVendor?.uid || null,
        assignedVendorName: assignedVendor?.name || null,
        notes: notes.trim(),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border-2 border-rose-300 p-4 bg-rose-50/30 space-y-3 mx-4 my-2">
      <div className="flex items-center justify-between mb-1">
        <div className="font-bold text-slate-800 text-sm">編輯物資</div>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="text-slate-400 hover:text-slate-600 p-1"
          aria-label="關閉編輯"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-12 gap-3">
        <input
          type="text"
          required
          autoFocus
          placeholder="物資名稱"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="col-span-12 p-2 rounded-lg border border-slate-300 text-sm"
        />
        <input
          type="text"
          placeholder="數量"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="col-span-4 p-2 rounded-lg border border-slate-300 text-sm"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="col-span-4 p-2 rounded-lg border border-slate-300 text-sm bg-white"
        >
          {Object.entries(RESOURCE_CATEGORIES).map(([c, lbl]) => (
            <option key={c} value={c}>{lbl}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="負責人"
          value={assignedToName}
          onChange={(e) => setAssignedToName(e.target.value)}
          className="col-span-4 p-2 rounded-lg border border-slate-300 text-sm"
        />
        <div className="col-span-12 grid grid-cols-1 md:grid-cols-2 gap-3">
          <HelperPicker
            helpers={helpers}
            ownerNames={ownerNames}
            value={assignedHelpers}
            onChange={setAssignedHelpers}
          />
          <VendorPicker
            vendors={vendors}
            value={assignedVendor}
            onChange={setAssignedVendor}
          />
        </div>
        <input
          type="text"
          placeholder="備註"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="col-span-12 p-2 rounded-lg border border-slate-300 text-sm"
        />
      </div>
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          disabled={saving}
          className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100"
        >
          取消
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !label.trim()}
          className="px-3 py-1.5 text-sm rounded-lg bg-rose-600 text-white font-bold hover:bg-rose-700 disabled:opacity-50"
        >
          {saving ? '儲存中...' : '儲存'}
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

// 2026-07-22 — Shared sortable row wrapper. Powers drag-and-drop
// reorder for 敬茶・影相, 物資分配, and 歌單建議. Each row calls
// useSortable to participate in the parent SortableContext, then
// applies the dnd-kit transform style so the row animates as it
// lifts. The drag handle (a GripVertical button) is the only
// thing that initiates a drag — couples can still tap the row
// body for other interactions (checkbox toggle, vote, delete).
//
// Why dnd-kit: HTML5 native drag is unreliable on mobile (no
// haptic, no native drag preview, requires long-press on most
// browsers). dnd-kit's PointerSensor + TouchSensor combo gives
// us proper touch-drag with auto-scroll, sensor activation
// constraints, and keyboard accessibility for free. ~30kb
// gzipped, well under budget.
function SortableRow({ id, disabled = false, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });

  // dnd-kit gives us transform/transition CSS values; apply them
  // to the row so it animates smoothly while being dragged. When
  // the row is being dragged, lift it visually (z-index, opacity,
  // shadow) so the user can see what they're moving.
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : 'auto',
    boxShadow: isDragging ? '0 8px 16px rgba(0,0,0,0.15)' : 'none',
  };

  // The drag handle is provided as a slot — children pass it the
  // listeners + attributes to attach to whatever element should
  // initiate the drag (typically a GripVertical icon button).
  return (
    // 2026-08-17 — Manus A8: data-row-id attribute lets App.jsx's
    // bell-click focus handler scroll the matching row into view
    // via document.querySelector. SortableRow is shared between
    // rundown + resources; we use a generic attribute name and let
    // the focus effect in WeddingDay.jsx scope by `[data-row-id="${id}"]`.
    // setNodeRef still owns the dnd-kit sortable ref; the attribute
    // is purely an anchor for the focus effect.
    <div ref={setNodeRef} style={style} className="touch-none" data-row-id={id}>
      {typeof children === 'function'
        ? children({ dragHandleProps: { ...attributes, ...listeners } })
        : children}
    </div>
  );
}

function TeaCeremonyTab({ people, onUpsert, onDelete, onSetOrders, ownerNames }) {
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

  // 2026-07-22 — Drag-and-drop reorder. Compute the new order
  // positions for every person in the affected group, then call
  // onSetOrders with the full list of writes. dnd-kit's arrayMove
  // gives us the new ordering; onSetOrders does the persistence
  // in a single batched Promise.all (one round-trip instead of N).
  //
  // We skip writes for rows whose order is already correct to
  // minimize traffic on common cases (e.g. dragging the last
  // person to the top only renumbers two people).
  function persistGroupOrder(groupId, orderedPeople) {
    const writes = [];
    orderedPeople.forEach((p, idx) => {
      const targetOrder = idx + 1;
      if ((p.order ?? 99) !== targetOrder) {
        writes.push({ id: p.id, order: targetOrder });
      }
    });
    if (writes.length === 0) return;
    onSetOrders?.(writes);
  }

  const totals = useMemo(() => {
    const total = (people || []).length;
    const done = (people || []).filter((p) => p.completed).length;
    const photosTaken = (people || []).filter((p) => p.photoTaken).length;
    const giftReceived = (people || []).filter((p) => p.giftReceived).length;
    return { total, done, photosTaken, giftReceived };
  }, [people]);

  // 2026-07-22 — Per-group drag-and-drop. Each group has its own
  // SortableContext so couples can only reorder within the same
  // group (夫家 can never get tangled with 娘家). When a drag ends
  // we persist the new order via persistGroupOrder above.
  // Sensors: PointerSensor for mouse + desktop touch screens,
  // TouchSensor with a short activation delay for mobile (so a
  // brief tap doesn't accidentally start a drag), KeyboardSensor
  // for keyboard-only users with screen readers.
  function TeaCeremonyGroupList({ groupId, list, editing, setEditing, onUpsert, onDelete, onPersist, ownerNames }) {
    const sensors = useSensors(
      useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
      useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
      useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    function handleDragEnd(event) {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIdx = list.findIndex((p) => p.id === active.id);
      const newIdx = list.findIndex((p) => p.id === over.id);
      if (oldIdx < 0 || newIdx < 0) return;
      const reordered = arrayMove(list, oldIdx, newIdx);
      onPersist(groupId, reordered);
    }

    if (!list || list.length === 0) return null;

    return (
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={list.map((p) => p.id)} strategy={verticalListSortingStrategy}>
          <div className="divide-y divide-slate-100">
            {list.map((person, personIdx) => (
              <SortableRow key={person.id} id={person.id}>
                {({ dragHandleProps }) => (
                  <PersonRow
                    person={person}
                    onUpsert={(data) => onUpsert({ ...person, ...data })}
                    onDelete={() => onDelete(person.id)}
                    isEditing={editing === person.id}
                    onEditToggle={() => setEditing(editing === person.id ? null : person.id)}
                    // 2026-07-22 — drag handle replaces ▲▼. User
                    // can grab this with mouse / touch and drag
                    // the row to a new position.
                    dragHandleProps={dragHandleProps}
                    ownerNames={ownerNames}
                  />
                )}
              </SortableRow>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        逐位長輩／賓客 — 記低「敬茶」、「大影相」、「收到利是」嘅狀態，大日當日可以快速 pass 俾「左邊嗰位未影相」。
      </p>
      <p className="text-xs text-slate-400 -mt-2">
        💡 想重新排列順序？捉住右邊嗰條 <GripVertical className="inline w-3 h-3" /> 就可以拖去新位置。
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
          <TeaCeremonyGroupList
            groupId={id}
            list={grouped[id] || []}
            editing={editing}
            setEditing={setEditing}
            onUpsert={onUpsert}
            onDelete={onDelete}
            onPersist={persistGroupOrder}
            ownerNames={ownerNames}
          />
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

function PersonRow({
  person,
  onUpsert,
  onDelete,
  isEditing,
  onEditToggle,
  // 2026-07-22 — drag-and-drop replaces ▲▼ reorder. dragHandleProps
  // contains the dnd-kit listeners + attributes; we spread them
  // onto the GripVertical icon button so only that element
  // initiates a drag. Couples can still tap the rest of the row
  // for checkbox toggle, edit, etc.
  dragHandleProps,
  // 2026-08-01 — single owner field. Couples want to mark
  // "志明 handles 夫家 group" or "春嬌 handles 娘家 group" so
  // they know who to nudge on the day. ownerId is one of
  // 'owner-boy' | 'owner-girl' | '' — a flat string field on
  // the person doc, persisted alongside the existing fields.
  ownerNames,
}) {
  const [draft, setDraft] = useState({
    name: person.name || '',
    relation: person.relation || 'relative',
    order: person.order ?? 99,
    notes: person.notes || '',
    ownerId: person.ownerId || '',
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
        {/* 2026-08-01 — Single-owner selector. Lets couples tag
            who is responsible for this relative on the day
            (e.g. 志明 handles 夫家 group). Rendered as a
            pill row so it reads as a quick pick, not a 兄弟姊妹
            picker (敬茶/影相 is a personal relationship, not a
            task assignment). Empty state hides the row when
            ownerNames is also empty so the editor stays clean. */}
        {(ownerNames?.boyName || ownerNames?.girlName) && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-bold text-slate-500 mr-1">由邊位負責</span>
            {ownerNames.boyName && (
              <button
                type="button"
                onClick={() => setDraft({
                  ...draft,
                  ownerId: draft.ownerId === 'owner-boy' ? '' : 'owner-boy',
                })}
                className={`text-xs font-bold px-2 py-1 rounded-full border transition-colors ${
                  draft.ownerId === 'owner-boy'
                    ? 'bg-rose-100 text-rose-700 border-rose-300'
                    : 'bg-white text-slate-500 border-slate-200 hover:border-rose-200 hover:text-rose-600'
                }`}
                aria-pressed={draft.ownerId === 'owner-boy'}
              >
                🤵 {ownerNames.boyName}
              </button>
            )}
            {ownerNames.girlName && (
              <button
                type="button"
                onClick={() => setDraft({
                  ...draft,
                  ownerId: draft.ownerId === 'owner-girl' ? '' : 'owner-girl',
                })}
                className={`text-xs font-bold px-2 py-1 rounded-full border transition-colors ${
                  draft.ownerId === 'owner-girl'
                    ? 'bg-rose-100 text-rose-700 border-rose-300'
                    : 'bg-white text-slate-500 border-slate-200 hover:border-rose-200 hover:text-rose-600'
                }`}
                aria-pressed={draft.ownerId === 'owner-girl'}
              >
                👰 {ownerNames.girlName}
              </button>
            )}
          </div>
        )}
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
      {/* 2026-07-22 — Drag handle. Replaces ▲▼ column entirely.
          Touch-and-hold (or click-and-drag on desktop) to grab
          the row and reorder. dnd-kit's dragHandleProps contain
          the listeners + ARIA attributes; we spread them onto
          this GripVertical button so only the handle initiates
          drag — couples can still tap the rest of the row for
          checkbox / edit / photo / gift toggles.
          Cursor is 'grab' so users know it's draggable; switches
          to 'grabbing' while actively dragged. */}
      <button
        type="button"
        {...dragHandleProps}
        className="flex-shrink-0 self-stretch flex items-center justify-center w-9 px-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-grab active:cursor-grabbing touch-none"
        title="捉住拖動重新排列"
        aria-label="拖動重新排列"
      >
        <GripVertical className="w-5 h-5" strokeWidth={2} />
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
          {person.ownerId && (
            <span className="text-[10px] bg-rose-50 text-rose-700 px-2 py-0.5 rounded border border-rose-200">
              {person.ownerId === 'owner-boy' && ownerNames?.boyName
                ? `🤵 ${ownerNames.boyName}`
                : person.ownerId === 'owner-girl' && ownerNames?.girlName
                ? `👰 ${ownerNames.girlName}`
                : person.ownerId === 'owner-boy'
                ? '🤵 新郎'
                : '👰 新娘'}
            </span>
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

function PlaylistTab({ songs, onUpsert, onDelete, onReorder, onSetOrders, currentUserUid, showToast, ownerNames }) {
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  // 2026-07-22 — Sort mode for each playlist group. Two modes:
  //   'hot'  — sort by votes desc, then alphabetical (default).
  //            Couples see what the wedding party is rallying
  //            around; the "wisdom of the crowd" picks the
  //            running order.
  //   'manual' — sort by manualPosition asc. Couples use the
  //            ▲▼ buttons in each row to pin specific songs
  //            to specific positions. manualPosition is null
  //            for songs that have never been reordered — they
  //            get appended at the end of the manual sort.
  //            This is the right pattern for the owner who
  //            already knows which song they want where.
  // We could also auto-promote a song to the manual sort on
  // first ▲/▼ tap, but couples switching from hot → manual
  // for the first time would see a strange initial ordering.
  // Cleaner: only songs with a manualPosition participate.
  const [sortMode, setSortMode] = useState('hot');
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
      out[k].push(sg);
    });
    // Sort each group by the active mode. We use a stable sort so
    // ties don't shuffle unpredictably between renders.
    Object.keys(out).forEach((k) => {
      if (sortMode === 'manual') {
        out[k].sort((a, b) => {
          // Songs with manualPosition come first, ascending.
          const ap = a.manualPosition;
          const bp = b.manualPosition;
          if (ap == null && bp == null) {
            // Both unpinned — keep createdAt ascending (older first).
            return (a.createdAt || 0) - (b.createdAt || 0);
          }
          if (ap == null) return 1;  // unpinned goes to end
          if (bp == null) return -1;
          return ap - bp;
        });
      } else {
        // 'hot' mode — votes desc, then alpha.
        out[k].sort(
          (a, b) =>
            (b.votes?.length || 0) - (a.votes?.length || 0) ||
            (a.title || '').localeCompare(b.title || ''),
        );
      }
    });
    return out;
  }, [songs, filter, search, sortMode]);

  // 2026-07-22 — Up/down handler. In manual mode we swap the
  // manualPosition of the moved song with the song directly above
  // or below it in the same moment group. Swapping is more
  // robust than renumbering all subsequent rows because:
  //   • O(1) writes instead of O(n)
  //   • no race conditions if two arrows are tapped quickly
  //   • when the user taps ▲ and then ▼, they end up back where
  //     they started (instead of somewhere unexpected).
  // If the song above/below is unpinned (manualPosition = null)
  // we assign the next free position so the moved song is
  // guaranteed to move into a defined slot.
  // 2026-07-22b — Drag-and-drop reorder for 歌單. Each moment
  // group has its own dnd-kit context; couples can only drag
  // within the same group (e.g. 入場 songs can never tangle
  // with 敬茶 songs). The drop handler calls arrayMove on the
  // sorted list, then asks the parent to persist the new
  // manualPosition values for any rows whose position changed.
  //
  // In 自訂 mode we wrap each group in <PlaylistGroupDnD>
  // which provides the DndContext + SortableContext. The
  // SongRow receives dragHandleProps via render prop and
  // attaches them to its GripVertical button.
  function PlaylistGroupDnD({ groupId, list, children }) {
    const sensors = useSensors(
      useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
      useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
      useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    function handleDragEnd(event) {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIdx = list.findIndex((s) => s.id === active.id);
      const newIdx = list.findIndex((s) => s.id === over.id);
      if (oldIdx < 0 || newIdx < 0) return;
      const reordered = arrayMove(list, oldIdx, newIdx);
      // Assign contiguous manualPosition values starting from 1,
      // but only write rows whose position actually changed.
      const writes = [];
      reordered.forEach((s, idx) => {
        const targetPos = idx + 1;
        if ((s.manualPosition ?? null) !== targetPos) {
          writes.push({ id: s.id, manualPosition: targetPos });
        }
      });
      if (writes.length > 0) onSetOrders?.(writes);
    }

    if (!list || list.length === 0) return null;

    return (
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={list.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {children}
        </SortableContext>
      </DndContext>
    );
  }

  // 2026-07-22 — Legacy ▲▼ reorder kept for backward compatibility.
  // The new drag-and-drop is the primary UX; this swap handler
  // remains in case any code path still calls it (and as a
  // fallback if dnd-kit sensors fail on some browsers).
  function handleReorder(songId, direction) {
    const song = (songs || []).find((s) => s.id === songId);
    if (!song) return;
    const moment = song.moment || 'pre_guest';
    const groupList = grouped[moment] || [];
    const idx = groupList.findIndex((s) => s.id === songId);
    if (idx < 0) return;
    const delta = direction === 'up' ? -1 : 1;
    const swapWith = groupList[idx + delta];
    if (!swapWith) return;
    const myPos = song.manualPosition;
    const otherPos = swapWith.manualPosition;
    let newMine, newOther;
    if (myPos != null && otherPos != null) {
      newMine = otherPos;
      newOther = myPos;
    } else if (myPos == null && otherPos == null) {
      const base = groupList.filter((s) => s.manualPosition != null).length;
      newMine = base;
      newOther = base + 1;
    } else {
      newMine = otherPos ?? idx;
      newOther = myPos ?? idx + 1;
    }
    onReorder?.(songId, newMine, swapWith.id, newOther);
  }

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
        {/* 2026-07-22 — Sort mode toggle. Two pills: 熱度 (default,
            votes-based) and 自訂順序 (manual, ▲▼ reorder). The
            toggle is sticky per-tab so couples can switch between
            views without losing their intent. */}
        <div className="inline-flex rounded-lg border border-slate-300 bg-white overflow-hidden text-sm">
          <button
            type="button"
            onClick={() => setSortMode('hot')}
            className={`px-3 py-2 flex items-center gap-1 transition-colors ${
              sortMode === 'hot'
                ? 'bg-rose-500 text-white'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
            title="按熱度排序（❤️ 數量）"
          >
            <Flame className="w-4 h-4" />
            {/* 2026-07-23 — Show label on mobile. The button is
                only ~50px tall and there's plenty of horizontal
                room next to the search input above, so hiding the
                text was unnecessary compression. */}
            <span>熱度</span>
          </button>
          <button
            type="button"
            onClick={() => setSortMode('manual')}
            className={`px-3 py-2 flex items-center gap-1 transition-colors border-l border-slate-200 ${
              sortMode === 'manual'
                ? 'bg-rose-500 text-white'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
            title="按自訂順序排序（用 ▲▼ 排列）"
          >
            <GripVertical className="w-4 h-4" />
            <span>自訂</span>
          </button>
        </div>
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
        // 2026-08-01 — owner (couple) for the new song entry.
        ownerNames={ownerNames}
      />

      {PLAYLIST_MOMENTS.map(({ id, label, e }) => {
        // 2026-07-24 — rewrite. The previous version inlined a
        // `grouped[id]?.length > 0 && (<div>...)` expression as
        // the arrow function body, which works but is hard to
        // read and was breaking in some bundles. Hoist the
        // guard to a plain `if` and return the JSX directly.
        const list = grouped[id];
        if (!list || list.length === 0) return null;
        return (
          <div key={id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
              <span className="text-lg">{e}</span>
              <span className="text-sm font-bold text-slate-700">{label}</span>
              <span className="ml-auto text-xs text-slate-500">
                {list.length} 首
              </span>
            </div>
            {sortMode === 'manual' ? (
              <PlaylistGroupDnD groupId={id} list={list}>
                <div className="divide-y divide-slate-100">
                  {list.map((song) => (
                    editing === song.id ? (
                      <EditSongRow
                        key={song.id}
                        song={song}
                        onSave={(updated) => {
                          onUpsert(updated);
                          setEditing(null);
                          showToast('✅ 歌曲已更新');
                        }}
                        onCancel={() => setEditing(null)}
                        ownerNames={ownerNames}
                      />
                    ) : (
                      <SortableRow key={song.id} id={song.id}>
                        {({ dragHandleProps }) => (
                          <SongRow
                            song={song}
                            currentUserUid={currentUserUid}
                            sortMode={sortMode}
                            dragHandleProps={dragHandleProps}
                            isPlaying={playingYtId === song.id}
                            onEdit={() => setEditing(song.id)}
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
                            ownerNames={ownerNames}
                          />
                        )}
                      </SortableRow>
                    )
                  ))}
                </div>
              </PlaylistGroupDnD>
            ) : (
              <div className="divide-y divide-slate-100">
                {list.map((song) => (
                  editing === song.id ? (
                    <EditSongRow
                      key={song.id}
                      song={song}
                      onSave={(updated) => {
                        onUpsert(updated);
                        setEditing(null);
                        showToast('✅ 歌曲已更新');
                      }}
                      onCancel={() => setEditing(null)}
                      ownerNames={ownerNames}
                    />
                  ) : (
                    <SongRow
                      key={song.id}
                      song={song}
                      currentUserUid={currentUserUid}
                      sortMode={sortMode}
                      isPlaying={playingYtId === song.id}
                      onEdit={() => setEditing(song.id)}
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
                      ownerNames={ownerNames}
                    />
                  )
                ))}
              </div>
            )}
          </div>
        );
      })}

      {songs?.length === 0 && (
        <div className="text-center py-10 text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
          尚未有歌單建議。新增例如「陳奕迅 - 我甚麼都沒有」就會喺度出現。
        </div>
      )}
    </div>
  );
}

function SongRow({
  song,
  currentUserUid,
  isPlaying,
  onTogglePlay,
  onVote,
  onDelete,
  // 2026-07-24 — onEdit opens the inline editor for this song.
  // 2026-07-22 — sortMode + legacy ▲▼ reorder props. Kept for
  // backward compatibility (some code paths still pass them).
  // 2026-07-22b — dragHandleProps replaces ▲▼ in manual sort
  // mode. dnd-kit's listeners + ARIA attributes; we spread them
  // onto a GripVertical button so only that element initiates
  // a drag. Couples can still tap the thumbnail to play/pause
  // and the heart to vote without triggering a drag.
  onEdit,
  sortMode,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  dragHandleProps,
  // 2026-08-01 — owner (couple) for this song. Lets couples
  // mark "first dance is 志明 & 春嬌" or "志明's pick" etc.
  // ownerNames is the raw {boyName, girlName} from the hook.
  ownerNames,
}) {
  const voted = (song.votes || []).includes(currentUserUid);
  const ytId = youtubeId(song.link);

  return (
    <div className="px-4 py-3 flex gap-3 items-start">
      {/* 2026-07-22b — Reorder column. In manual sort mode +
          dragHandleProps provided → drag handle (new dnd-kit UX).
          In manual sort mode + no dragHandleProps → legacy ▲▼
          (fallback for callers that don't use the new pattern).
          In any other sortMode → column hidden entirely.
          Same logic as the 大日流程 RundownCard. */}
      {sortMode === 'manual' && dragHandleProps && (
        <button
          type="button"
          {...dragHandleProps}
          className="flex-shrink-0 self-center flex items-center justify-center w-9 h-12 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-grab active:cursor-grabbing touch-none"
          title="捉住拖動重新排列"
          aria-label="拖動重新排列"
        >
          <GripVertical className="w-5 h-5" strokeWidth={2} />
        </button>
      )}
      {sortMode === 'manual' && !dragHandleProps && (
        <div className="flex-shrink-0 flex flex-col gap-0.5 bg-slate-100 rounded-lg p-0.5 self-center">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={isFirst}
            className="p-1.5 rounded-md hover:bg-rose-500 text-slate-600 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="向上移一個位置"
            aria-label="向上移"
          >
            <ChevronUp className="w-5 h-5" strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isLast}
            className="p-1.5 rounded-md hover:bg-rose-500 text-slate-600 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="向下移一個位置"
            aria-label="向下移"
          >
            <ChevronDown className="w-5 h-5" strokeWidth={2.5} />
          </button>
        </div>
      )}
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
          {song.ownerId && (
            <span className="ml-2 bg-rose-50 text-rose-700 px-1.5 py-0.5 rounded border border-rose-200">
              {song.ownerId === 'owner-boy' && ownerNames?.boyName
                ? `🤵 ${ownerNames.boyName}`
                : song.ownerId === 'owner-girl' && ownerNames?.girlName
                ? `👰 ${ownerNames.girlName}`
                : song.ownerId === 'owner-boy'
                ? '🤵 新郎'
                : '👰 新娘'}
            </span>
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
      {/* 2026-07-24 — edit button. ✏️ emoji to match the rest
          of the wedding-day suite. Sets editing=song.id which
          hides this row and shows <EditSongRow> instead. */}
      {onEdit && (
        <button
          onClick={onEdit}
          className="p-1 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded flex-shrink-0"
          title="編輯歌曲"
          aria-label="編輯歌曲"
        >
          <span className="text-xs">✏️</span>
        </button>
      )}
      <button
        onClick={onDelete}
        className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded flex-shrink-0"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

function NewSongRow({ onSubmit, ownerNames }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    title: '',
    artist: '',
    moment: 'entrance',
    link: '',
    notes: '',
    suggestedByName: '',
    ownerId: '',
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
      {/* 2026-08-01 — owner pill row in the new-song editor. */}
      {(ownerNames?.boyName || ownerNames?.girlName) && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-bold text-slate-500 mr-1">屬於邊位</span>
          {ownerNames.boyName && (
            <button
              type="button"
              onClick={() => setDraft({
                ...draft,
                ownerId: draft.ownerId === 'owner-boy' ? '' : 'owner-boy',
              })}
              className={`text-xs font-bold px-2 py-1 rounded-full border transition-colors ${
                draft.ownerId === 'owner-boy'
                  ? 'bg-rose-100 text-rose-700 border-rose-300'
                  : 'bg-white text-slate-500 border-slate-200 hover:border-rose-200 hover:text-rose-600'
              }`}
              aria-pressed={draft.ownerId === 'owner-boy'}
            >
              🤵 {ownerNames.boyName}
            </button>
          )}
          {ownerNames.girlName && (
            <button
              type="button"
              onClick={() => setDraft({
                ...draft,
                ownerId: draft.ownerId === 'owner-girl' ? '' : 'owner-girl',
              })}
              className={`text-xs font-bold px-2 py-1 rounded-full border transition-colors ${
                draft.ownerId === 'owner-girl'
                  ? 'bg-rose-100 text-rose-700 border-rose-300'
                  : 'bg-white text-slate-500 border-slate-200 hover:border-rose-200 hover:text-rose-600'
              }`}
              aria-pressed={draft.ownerId === 'owner-girl'}
            >
              👰 {ownerNames.girlName}
            </button>
          )}
        </div>
      )}
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
            setDraft({ title: '', artist: '', moment: 'entrance', link: '', notes: '', suggestedByName: '', ownerId: '' });
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

/**
 * EditSongRow — inline editor for an existing 歌單 item.
 *
 * 2026-07-24 — Same pattern as EditResourceRow. Pre-filled with
 * the existing song's values. Saves via onSave → onUpsert so
 * the save path is shared with create.
 */
function EditSongRow({ song, ownerNames, onSave, onCancel }) {
  const [title, setTitle] = useState(song.title || '');
  const [artist, setArtist] = useState(song.artist || '');
  const [moment, setMoment] = useState(song.moment || 'entrance');
  const [link, setLink] = useState(song.link || '');
  const [notes, setNotes] = useState(song.notes || '');
  const [suggestedByName, setSuggestedByName] = useState(song.suggestedByName || '');
  // 2026-08-01 — owner field. Lets couples tag which partner
  // this song is "for" or "picked by" (e.g. 志明's pick for
  // the entrance song). ownerId is one of 'owner-boy' |
  // 'owner-girl' | ''. Empty by default; rendered as a
  // pill row at the bottom of the editor so couples can
  // toggle without breaking their flow.
  const [ownerId, setOwnerId] = useState(song.ownerId || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onSave({
        ...song,
        title: title.trim(),
        artist: artist.trim(),
        moment,
        link: link.trim(),
        notes: notes.trim(),
        suggestedByName: suggestedByName.trim(),
        ownerId: ownerId || '',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border-2 border-rose-300 p-4 bg-rose-50/30 space-y-3 mx-4 my-2">
      <div className="flex items-center justify-between mb-1">
        <div className="font-bold text-slate-800 text-sm">編輯歌曲</div>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="text-slate-400 hover:text-slate-600 p-1"
          aria-label="關閉編輯"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-12 gap-3">
        <input
          type="text"
          required
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="歌名"
          className="col-span-7 p-2 rounded-lg border border-slate-300 text-sm"
        />
        <input
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          placeholder="歌手"
          className="col-span-5 p-2 rounded-lg border border-slate-300 text-sm"
        />
        <select
          value={moment}
          onChange={(e) => setMoment(e.target.value)}
          className="col-span-6 p-2 rounded-lg border border-slate-300 text-sm bg-white"
        >
          {PLAYLIST_MOMENTS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.e} {m.label}
            </option>
          ))}
        </select>
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="YouTube 連結 (可選)"
          className="col-span-6 p-2 rounded-lg border border-slate-300 text-sm"
        />
        <input
          value={suggestedByName}
          onChange={(e) => setSuggestedByName(e.target.value)}
          placeholder="誰建議?"
          className="col-span-6 p-2 rounded-lg border border-slate-300 text-sm"
        />
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="為何適合?"
          className="col-span-6 p-2 rounded-lg border border-slate-300 text-sm"
        />
      </div>
      {/* 2026-08-01 — owner pill row. Same pattern as
          PersonRow in 敬茶. Empty when ownerNames is empty
          so the editor doesn't render an empty row. */}
      {(ownerNames?.boyName || ownerNames?.girlName) && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-bold text-slate-500 mr-1">屬於邊位</span>
          {ownerNames.boyName && (
            <button
              type="button"
              onClick={() => setOwnerId(ownerId === 'owner-boy' ? '' : 'owner-boy')}
              className={`text-xs font-bold px-2 py-1 rounded-full border transition-colors ${
                ownerId === 'owner-boy'
                  ? 'bg-rose-100 text-rose-700 border-rose-300'
                  : 'bg-white text-slate-500 border-slate-200 hover:border-rose-200 hover:text-rose-600'
              }`}
              aria-pressed={ownerId === 'owner-boy'}
            >
              🤵 {ownerNames.boyName}
            </button>
          )}
          {ownerNames.girlName && (
            <button
              type="button"
              onClick={() => setOwnerId(ownerId === 'owner-girl' ? '' : 'owner-girl')}
              className={`text-xs font-bold px-2 py-1 rounded-full border transition-colors ${
                ownerId === 'owner-girl'
                  ? 'bg-rose-100 text-rose-700 border-rose-300'
                  : 'bg-white text-slate-500 border-slate-200 hover:border-rose-200 hover:text-rose-600'
              }`}
              aria-pressed={ownerId === 'owner-girl'}
            >
              👰 {ownerNames.girlName}
            </button>
          )}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          disabled={saving}
          className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100"
        >
          取消
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !title.trim()}
          className="px-3 py-1.5 text-sm rounded-lg bg-rose-600 text-white font-bold hover:bg-rose-700 disabled:opacity-50"
        >
          {saving ? '儲存中...' : '儲存'}
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
  onSetRundownPositions,
  onUpsertResource,
  onDeleteResource,
  onToggleResource,
  onReorderResource,
  onSetResourcePositions,
  onUpsertTeaCeremony,
  onDeleteTeaCeremony,
  // 2026-07-22b — Bulk order setter for drag-and-drop reorder.
  // Takes [{id, order}, ...] and writes them all in parallel.
  onSetTeaCeremonyOrders,
  onUpsertPlaylist,
  onDeletePlaylist,
  // 2026-07-22 — playlist reorder handler (▲▼ buttons in manual
  // sort mode). Optional so WeddingDay keeps working in test/
  // preview environments without it.
  onReorderPlaylist,
  onSetPlaylistPositions,
  currentUser,
  // 2026-07-18 — pass the active helper list down so rundown and
  // resources tabs can offer a 兄弟姊妹 picker for each item.
  helpers = [],
  // 2026-07-24 — toast for the new edit save confirmations.
  showToast,
  // 2026-08-01 — owner names (新郎 / 新娘). Plumbed down to
  // <RundownTab> so the HelperPicker can offer the couple as
  // assignees alongside the 兄弟姊妹. Optional for backwards
  // compat with pre-2026-08-01 callers (renders the picker
  // without the 新人自己 optgroup).
  ownerNames,
  // 2026-08-09 — vendor assignment + comments plumbing. vendors
  // is the list of vendors the couple has chatted with (for the
  // VendorPicker source). ownerUid/eventId are needed by App.jsx
  // to build the comment subcollection path. currentUser is the
  // signed-in user (for author attribution).
  vendors = [],
  ownerUid,
  eventId,
  rundownCommentPathFor,
  resourceCommentPathFor,
  // 2026-08-17 — Manus A8: bell-click deep-link focus. When the
  // couple clicks a Big Day comment alert, App.jsx sets these:
  //   focusedParentId   = the parentKind doc id (e.g. rundown entry id)
  //   focusedParentKind = 'rundown' | 'resources'
  // We switch the active tab and scroll the matching row into view.
  // Optional; default no-op keeps existing callers untouched.
  focusedParentId = null,
  focusedParentKind = null,
  // 2026-08-20 — Manus: deep-link to the exact comment that
  // triggered the bell alert. Forwarded to each rendered
  // <ItemComments> for this kind so the matching comment scrolls
  // + highlights. Optional; default no-op keeps existing callers
  // untouched.
  focusedCommentId = null,
  // 2026-08-20 — Manus P0: forwarded to the matching
  // <ItemComments> panel; the matching panel fires this on
  // scrollIntoView success (consumption authority). App.jsx
  // guards the clear by id match. Optional; defaults to no-op.
  onFocusedCommentHandled = null,
}) {
  const [active, setActive] = useState('rundown');

  // 2026-08-17 — Manus A8: bell-click deep-link focus. Effect:
  //   1. Switch the active subtab to whichever kind the alert is for.
  //   2. After React commits the new layout, query the DOM for the
  //      row with matching data-row-id and scrollIntoView it.
  //   3. Briefly apply a ring highlight so the user lands on the
  //      right entry even if the page was scrolled away from it.
  // The querySelector + setTimeout give the tab switch a microtask
  // to mount before we try to find it.
  useEffect(() => {
    if (!focusedParentId || !focusedParentKind) return;
    if (focusedParentKind !== 'rundown' && focusedParentKind !== 'resources') return;
    if (focusedParentKind !== active) setActive(focusedParentKind);
    const id = focusedParentId;
    const attemptScroll = (tries = 5) => {
      // 2026-08-17 — guard CSS.escape. It's a standard Web API but
      // jsdom (vitest's default test env) doesn't polyfill it, so
      // production code crashes in tests when the bell-focus effect
      // runs. Fall back to a regex-safe replace that handles the
      // common Firestore doc-id character set (alphanumeric + -_).
      // CSS.escape() is the right tool in browsers; the regex is
      // a guard for environments where it's missing.
      const safeId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(id)
        : String(id).replace(/([^\w-])/g, '\\$1');
      const el = document.querySelector(`[data-row-id="${safeId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Highlight so the user knows where they landed. Tailwind's
        // ring utilities compose cleanly with the existing card.
        el.classList.add('ring-2', 'ring-rose-400', 'ring-offset-2');
        setTimeout(() => {
          el.classList.remove('ring-2', 'ring-rose-400', 'ring-offset-2');
        }, 2400);
        return;
      }
      // Tab switch may not have re-rendered yet; retry up to 5x.
      if (tries > 0) setTimeout(() => attemptScroll(tries - 1), 80);
    };
    // scheduleScroll after the tab switch has had a chance to mount.
    setTimeout(() => attemptScroll(5), 80);
  }, [focusedParentId, focusedParentKind, active]);

  return (
    <div className="max-w-4xl mx-auto mt-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-rose-100 p-3 rounded-2xl">
            <ClipboardList className="w-7 h-7 text-rose-500" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-slate-800">Big Day 大日統籌</h2>
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
            // 2026-08-01 — owner names (新郎 / 新娘) so the
            // HelperPicker can offer the couple as assignees
            // alongside the 兄弟姊妹. Live-updates when the user
            // edits the names in MyProfile.
            ownerNames={ownerNames}
            // 2026-07-22b — drag-and-drop reorder. Used in
            // 自訂 sort mode to write batched manualPosition
            // updates for the dragged entries.
            onSetOrders={onSetRundownPositions}
            helpers={helpers}
            // 2026-08-09 — vendor assignment + comments. App.jsx
            // builds the comments path resolver so this file
            // stays Firebase-free.
            vendors={vendors}
            currentUser={currentUser}
            ownerUid={ownerUid}
            eventId={eventId}
            commentPathFor={rundownCommentPathFor}
          />
        )}
        {active === 'resources' && (
          <ResourcesTab
            items={resources}
            onUpsert={onUpsertResource}
            onDelete={onDeleteResource}
            onToggle={onToggleResource}
            onReorder={onReorderResource}
            // 2026-07-22b — drag-and-drop reorder in 物資.
            onSetOrders={onSetResourcePositions}
            currentUser={currentUser}
            helpers={helpers}
            // 2026-08-01 — owner (couple) names so the HelperPicker
            // can offer the couple as assignees alongside the
            // 兄弟姊妹 in 物資 too.
            ownerNames={ownerNames}
            showToast={showToast}
            // 2026-08-09 — vendor assignment + comments for 物資.
            vendors={vendors}
            ownerUid={ownerUid}
            eventId={eventId}
            commentPathFor={resourceCommentPathFor}
          />
        )}
        {active === 'teaCeremony' && (
          <TeaCeremonyTab
            people={teaCeremony}
            onUpsert={onUpsertTeaCeremony}
            onDelete={onDeleteTeaCeremony}
            // 2026-07-22b — Bulk order setter for drag-and-drop
            // reorder. Takes [{id, order}, ...] and writes them
            // all in parallel. Replaces the older onReorder
            // swap-pair handler.
            onSetOrders={onSetTeaCeremonyOrders}
            // 2026-08-01 — owner names (新郎 / 新娘) so the
            // PersonRow editor can let couples tag which
            // partner is responsible for each relative on
            // the day (e.g. 志明 handles 夫家 group).
            ownerNames={ownerNames}
          />
        )}
        {active === 'playlist' && (
          <PlaylistTab
            songs={playlist}
            onUpsert={onUpsertPlaylist}
            onDelete={onDeletePlaylist}
            onReorder={onReorderPlaylist}
            // 2026-07-22b — drag-and-drop reorder in 歌單.
            onSetOrders={onSetPlaylistPositions}
            currentUserUid={currentUser?.uid}
            // 2026-08-01 — owner names so the new-song + edit-song
            // editors can offer a single-owner pill (e.g.
            // 「志明's pick for entrance」).
            ownerNames={ownerNames}
            showToast={showToast}
          />
        )}
      </div>
    </div>
  );
}
