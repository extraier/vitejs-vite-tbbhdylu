/**
 * src/screens/CoupleSeating.jsx
 *
 * 2026-09-12 — Hermes P13 (seating chart MVP).
 *
 * Phase 1.1-1.4 owner-facing screen for the Save The Day
 * wedding reception seating chart. Renders:
 *
 *   1. Preset selector — 中式 12 圍 / 西式 8 long / 自訂空板
 *      3 buttons at top of screen. Clicking seeds the tables
 *      collection with the chosen preset geometry.
 *
 *   2. Floor plan canvas — SVG-based, mobile-friendly. Renders
 *      each table as a draggable shape (rect for 'long'/'rect',
 *      circle for 'round'). Tap-empty = create, tap-table = edit,
 *      long-press = delete (delete opens a confirm modal first).
 *
 *   3. Table editor modal — opens on tap-table or tap-create. Edits
 *      label, capacity, tableCategory, rotation.
 *
 * Phase 1.5 (guest→table drag-drop), 1.6 (dietary chips), 1.7 (toast)
 * come in P13.2.
 *
 * Phase 2.6 (live attendance pill) and Phase 2.1 (scanner hook
 * integration) come in P13.3.
 *
 * Phase 2.2 (helper live-edit) splits this file:
 *   • SeatingCanvas  — role-agnostic canvas + drag-drop + guest panel.
 *                       Lives in this file; also re-exported for the
 *                       helper screen (HelperSeatingEdit.jsx).
 *   • CoupleSeating  — thin owner wrapper: adds preset selector +
 *                       editor modal trigger; role='owner'.
 *   • HelperSeatingEdit.jsx — thin helper wrapper: role='helper',
 *                             editor modal disabled, chrome stripped.
 *
 * State store: zustand-free; we hold the in-memory table list in
 * useState and snap it to Firestore via batch writes. The
 * Firestore listener is the source of truth on mount + after
 * every write returns.
 *
 * Permissions: CoupleSeating is owner/co-owner only. The helper
 * drag-drop variant is HelperSeatingEdit (Phase 2.2).
 */
import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { collection, onSnapshot, doc, setDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { seatingItemPath, seatingCollectionPath } from '../lib/firestorePaths';
import {
  normalizeTable,
  occupancy,
  dietaryAllergens,
  guestTableFit,
  emptyAssignment,
  validateAssignment,
  buildAssignmentDocId,
  liveSeatingBadges,
  formatLivePill,
  chinesePreset as chinesePresetFn,
  westernPreset as westernPresetFn,
  CHINESE_ROUND_CAPACITY_OPTIONS,
  CHINESE_ROUND_COUNT_OPTIONS,
  fixedSlotBadge,
  FIXED_SLOT_CATEGORIES,
  DEFAULT_COST_PER_HEAD,
  DEFAULT_BUDGET_CAP,
  computeBudget,
  projectBudgetDelta,
  formatHKD,
  suggestTargetTables,
  autoAssignGuests,
} from '../lib/seatingPure';
// P13.4.5 perf — lazy-load the Find-Seat QR sheet so it doesn't
// pull the firebase + Firestore wiring into the seating chunk
// when the operator never opens the sheet. Splitting the QR
// code PNG URL + the QR rendering tree off the critical path
// saves ~15 KB gz on the seating screen.
import { lazy, Suspense } from 'react';
const FindSeatSheet = lazy(() => import('./FindSeatSheet'));
// 2026-09-20 — P13.4.5 perf follow-up: also lazy-load BudgetSheet
// and AutoAssignSheet. Both were previously inline in this file,
// meaning every CoupleSeating render paid the parse cost for the
// 350+ lines of JSX + style objects, even when the operator never
// opened the budget or auto-assign modal. After extraction:
//   - BudgetSheet (preset chips + form)        → ~3.5 KB gz chunk
//   - AutoAssignSheet (candidate list + picker) → ~4.0 KB gz chunk
// Both are loaded only when first opened; before that they cost
// ~0 KB on the seating screen critical path.
const BudgetSheet = lazy(() => import('./BudgetSheet'));
const AutoAssignSheet = lazy(() => import('./AutoAssignSheet'));
// 2026-09-20 — P13.4.5 a11y follow-up: keyboard-shortcut legend
// overlay. Owner presses "?" or taps the keyboard icon to open.
// Lazy-loaded — operators rarely open it, so it doesn't need
// to be in the seating critical path.
const KeyboardShortcutsOverlay = lazy(
  () => import('./KeyboardShortcutsOverlay'),
);
import {
  shouldHandleCanvasShortcut,
} from '../lib/seatingKeys';
import { invalidateScannerTablesCache } from '../lib/scannerTablesCache';

const APP_ID = 'savetheday-production';

// ─────────────────────────────────────────────────────────────────
// P13.4.5 perf — memoized table node.
//
// Before this commit, every drag tick re-evaluated and re-rendered
// all 29 table <g> blocks even though only one had changed position.
// The pills (count, category, dietary, fixed-slot badge, live-pill)
// are cheap JSX but the foreignObject math (char-width estimator,
// pill positioning) runs on every render of every table.
//
// Solution: extract the per-table JSX into a `memo`'d component
// that only re-renders when its specific props change. The parent
// supplies stable handler references and an `onMove` boolean that
// tells the node whether it's the one being dragged.
//
// Equality strategy (arePropsEqual below):
//   t         — by reference; updated by Firestore snapshot, so
//               reference equality holds between renders when
//               the row hasn't changed.
//   o         — occupancy record by reference; recomputed only
//               when assignments change.
//   liveBadge — by reference; flips rarely (check-in events).
//   focused   — boolean; flips on Tab/click.
//   isDragging — boolean; flips only when dragState moves
//                between tables or starts/ends.
//   handlers  — by reference; parent uses useMemo so the bundle
//               is stable for the canvas's lifetime.
// ─────────────────────────────────────────────────────────────────
const TableNode = memo(function TableNode({
  t,
  o,
  liveBadge,
  focused,
  isDragging,
  handlers,
  guestsById,
}) {
  const { onTablePointerDown, onAssign, setFocusedTableId } = handlers;
  const livePill = formatLivePill(liveBadge);
  const isRound = t.shape === 'round';
  const w = isRound ? 80 : 160;
  const h = isRound ? 80 : 60;
  const filled = o ? o.filled : 0;
  const overflow = o && o.overflow > 0;
  // Char-width estimator (PingFang TC at 10px): CJK=10,
  // Latin/digit=5.5, punct=3, padding 12. Inlined here so the
  // memoized node is self-contained.
  const estW = (s) => {
    let w = 12;
    for (const ch of s) {
      const code = ch.charCodeAt(0);
      if (code >= 0x4E00 && code <= 0x9FFF) w += 10;
      else if (/[A-Za-z0-9]/.test(ch)) w += 5.5;
      else w += 3;
    }
    return w;
  };
  // P13.3 — Two-pill stack BELOW the table body.
  // v4 (2026-09-18): label centered, pills hang below.
  const countLabel = `${filled}/${t.capacity} 座位`;
  const catLabel = t.tableCategory;
  const countH = isRound ? 18 : 20;
  const catH = isRound ? 14 : 18;
  const fontPx = isRound ? 10 : 11;
  const catFontPx = isRound ? 9 : 10;
  const pillMaxW = isRound ? Math.min(72, w) : Math.min(140, w);
  const countEstW = estW(countLabel);
  const countW = Math.min(pillMaxW, Math.ceil(countEstW / 4) * 4);
  const catEstW = estW(catLabel);
  const catW = Math.min(pillMaxW, Math.ceil(catEstW / 4) * 4);
  const countY = h + 2;
  const catY = countY + countH + 2;
  const countX = (w - countW) / 2;
  const catX = (w - catW) / 2;
  const badge = fixedSlotBadge(t.tableCategory);
  const showAboveLivePill = !(livePill && liveBadge && liveBadge.checkedIn > 0);
  return (
    <g
      data-testid={`seating-table-${t.id}`}
      data-filled={filled}
      data-overflow={overflow ? 'true' : 'false'}
      transform={`translate(${t.x}, ${t.y}) rotate(${t.rotation ?? 0} ${w / 2} ${h / 2})`}
      tabIndex={focused ? 0 : -1}
      role="button"
      aria-label={`${t.label || t.id}, ${isRound ? '圓枱' : '長枱'}, 容量 ${t.capacity}, 已坐 ${filled}${overflow ? ', 超出容量' : ''}`}
      onFocus={() => setFocusedTableId(t.id)}
      style={{
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        outline: focused ? '2px solid #0F766E' : 'none',
        outlineOffset: 4,
      }}
      onPointerDown={(e) => onTablePointerDown(e, t)}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(e) => {
        e.preventDefault();
        const guestId = e.dataTransfer.getData('text/guestId');
        if (!guestId) return;
        onAssign(guestId, t.id, guestsById && guestsById[guestId]?.name);
      }}
    >
      <title>{`${t.label || t.id} - ${isRound ? '圓枱' : '長枱'} ${t.capacity}位`}</title>
      {isRound ? (
        <ellipse
          cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2}
          fill={overflow ? '#FEE2E2' : '#FFFFFF'}
          stroke={overflow ? '#DC2626' : '#14B8A6'}
          strokeWidth="2"
        />
      ) : (
        <rect
          x="0" y="0" width={w} height={h} rx="6"
          fill={overflow ? '#FEE2E2' : '#FFFFFF'}
          stroke={overflow ? '#DC2626' : '#14B8A6'}
          strokeWidth="2"
        />
      )}
      <text
        x={w / 2}
        y={h / 2}
        fontSize={isRound ? "13" : "14"}
        fontWeight="600"
        fill="#0F766E"
        textAnchor="middle"
        dominantBaseline="central"
      >
        {t.label}
      </text>
      {/* Count pill (row 1, below table) */}
      <foreignObject x={countX} y={countY} width={countW} height={countH}>
        <div
          xmlns="http://www.w3.org/1999/xhtml"
          data-testid={`table-count-pill-${t.id}`}
          data-filled={filled}
          data-capacity={t.capacity}
          title={`已分配 ${filled}/${t.capacity} 座位`}
          style={{
            background: overflow ? '#FEF2F2' : '#F1F5F9',
            border: overflow
              ? '1px solid #DC2626'
              : '1px solid #CBD5E1',
            borderRadius: 9,
            padding: '0 6px',
            fontSize: fontPx,
            lineHeight: `${countH - 2}px`,
            color: overflow ? '#991B1B' : '#475569',
            textAlign: 'center',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            boxSizing: 'border-box',
            width: '100%',
            height: '100%',
          }}
        >
          {countLabel}
        </div>
      </foreignObject>
      {/* Category pill (row 2, below count) */}
      <foreignObject x={catX} y={catY} width={catW} height={catH}>
        <div
          xmlns="http://www.w3.org/1999/xhtml"
          data-testid={`table-category-pill-${t.id}`}
          data-category={t.tableCategory}
          title={`分類：${t.tableCategory}`}
          style={{
            background: overflow ? '#FEF2F2' : '#FFFFFF',
            border: '1px solid #E2E8F0',
            borderRadius: 9,
            padding: '0 6px',
            fontSize: catFontPx,
            lineHeight: `${catH - 2}px`,
            color: overflow ? '#991B1B' : '#64748B',
            textAlign: 'center',
            fontWeight: 500,
            fontStyle: 'italic',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            boxSizing: 'border-box',
            width: '100%',
            height: '100%',
          }}
        >
          {catLabel}
        </div>
      </foreignObject>
      {/* Dietary chip (P13.2) */}
      {o && Object.keys(o.dietary).length > 0 && (
        <foreignObject x={w - 8} y={-8} width="56" height="20">
          <div
            xmlns="http://www.w3.org/1999/xhtml"
            data-testid={`dietary-chip-${t.id}`}
            style={{
              background: '#FEF3C7',
              border: '1px solid #F59E0B',
              borderRadius: 8,
              padding: '0 4px',
              fontSize: 10,
              lineHeight: '18px',
              color: '#92400E',
              textAlign: 'center',
              fontWeight: 600,
            }}
          >
            ⚠ {Object.keys(o.dietary).length}
          </div>
        </foreignObject>
      )}
      {/* P13.4.3 — Fixed-slot badge (主家/證婚/兄弟/姐妹/長輩) */}
      {badge && (
        <foreignObject
          x={(w - 36) / 2}
          y={showAboveLivePill ? 4 : h / 2 + (isRound ? 8 : 14)}
          width="36"
          height="14"
        >
          <div
            xmlns="http://www.w3.org/1999/xhtml"
            data-testid={`fixed-slot-badge-${t.id}`}
            data-fixed-slot={t.tableCategory}
            style={{
              background: badge.bg,
              border: 'none',
              borderRadius: 4,
              padding: '0 3px',
              fontSize: 9,
              lineHeight: '14px',
              color: badge.color,
              textAlign: 'center',
              fontWeight: 700,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              boxSizing: 'border-box',
              width: '100%',
              height: '100%',
            }}
          >
            {badge.text}
          </div>
        </foreignObject>
      )}
      {/* Live attendance pill (P13.3) */}
      {livePill && liveBadge && liveBadge.checkedIn > 0 && (
        <foreignObject x={4} y={4} width="56" height="20">
          <div
            xmlns="http://www.w3.org/1999/xhtml"
            data-testid={`live-pill-${t.id}`}
            data-checked-in={liveBadge.checkedIn}
            title={`已入座 ${liveBadge.checkedIn}/${liveBadge.filled}/${liveBadge.capacity}`}
            style={{
              background: '#ECFDF5',
              border: '1px solid #6EE7B7',
              borderRadius: 8,
              padding: '0 4px',
              fontSize: 10,
              lineHeight: '18px',
              color: '#065F46',
              textAlign: 'center',
              fontWeight: 600,
            }}
          >
            ✓ {livePill}
          </div>
        </foreignObject>
      )}
    </g>
  );
}, areTableNodePropsEqual);

function areTableNodePropsEqual(prev, next) {
  // Reference-equality for everything except focused/dragging,
  // which are derived booleans (the underlying state objects —
  // focusedTableId and dragState — change reference on every
  // drag tick, but the per-table derivations are stable while
  // that's not the case).
  if (prev.t !== next.t) return false;
  if (prev.o !== next.o) return false;
  if (prev.liveBadge !== next.liveBadge) return false;
  if (prev.focused !== next.focused) return false;
  if (prev.isDragging !== next.isDragging) return false;
  if (prev.handlers !== next.handlers) return false;
  if (prev.guestsById !== next.guestsById) return false;
  return true;
}

export function SeatingCanvas({
  ownerUid,
  eventId,
  onBack,
  onOpenToast,
  role = 'owner', // 'owner' | 'helper' — gates write UI
  // 2026-09-17 — P13.3 refactor: editor modal lives in the
  // owner wrapper. Helper live-edit has no editor modal at all;
  // the canvas simply does not invoke this callback when
  // role='helper'.
  onRequestEditTable = null,
  // 2026-09-17 — P13.3 refactor: preset selector lives in the
  // owner wrapper. Helper live-edit has no preset button; the
  // canvas simply does not render it when role='helper'.
  onRequestApplyPreset = null,
}) {
  // Live data
  const [tables, setTables] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);

  // P13.2 additions — assignments + guests (for drag-drop panel)
  const [assignments, setAssignments] = useState([]);
  const [guests, setGuests] = useState([]);
  // P13.3 — live check-ins for the "已入座 7/12" pill on each table.
  const [checkIns, setCheckIns] = useState([]);

  // Drag state — { tableId, startX, startY, originX, originY, moved }
  const [dragState, setDragState] = useState(null);

  // Editor state
  const [editingTable, setEditingTable] = useState(null);
  // null = closed, 'new' = new table, { id, ... } = existing

  const [presetsOpen, setPresetsOpen] = useState(false);
  // P13.4.1 — budget sheet (modal for setting costPerHead + budgetCap).
  const [budgetSheetOpen, setBudgetSheetOpen] = useState(false);
  // P13.4.2 — auto-assign sheet (modal for batch auto-placement
  // of unassigned guests into existing tables).
  const [autoAssignOpen, setAutoAssignOpen] = useState(false);
  // P13.4.4 — Find-Seat QR sheet (modal for generating a public
  // QR + URL the operator shares at the venue entrance).
  const [findSeatOpen, setFindSeatOpen] = useState(false);

  // P13.4.5 a11y — keyboard-shortcut legend. Owner-only;
  // helper mode never sees this state. Lazy-loaded via
  // React.lazy + Suspense (see imports above).
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Refs
  const svgRef = useRef(null);
  const metaRef = useRef(null);
  metaRef.current = meta;

  // P13.4.5 a11y — global "?" keypress opens the keyboard
  // shortcut legend. Owner-only; helper mode never installs
  // this listener (no `?` surprise for guests looking at the
  // seating canvas in helper view). Skip when the user is
  // typing into an input — otherwise the budget cap field
  // would re-open the overlay every time they typed "?" in
  // a custom-cap value.
  useEffect(() => {
    if (role !== 'owner') return undefined;
    const onKey = (e) => {
      // Punctuation key on QWERTY (and most CJK pinyin IMEs
      // return "?" as key). Also accept Shift+/ which is the
      // the canonical US layout for "?".
      const isQuestionMark =
        e.key === '?' ||
        (e.shiftKey && e.key === '/') ||
        (e.key === '/' && e.shiftKey);
      if (!isQuestionMark) return;
      if (!shouldHandleCanvasShortcut(e)) return;
      e.preventDefault();
      setShortcutsOpen(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [role]);

  // P13.4.5 — a11y: roving tabindex target for the seating canvas.
  // Owner-only; cleared on Escape or successful delete.
  const [focusedTableId, setFocusedTableId] = useState(null);

  const tablesRef = useRef([]);
  tablesRef.current = tables;
  const assignmentsRef = useRef([]);
  assignmentsRef.current = assignments;
  const guestsRef = useRef([]);
  guestsRef.current = guests;

  /* ---------- subscriptions ---------- */
  useEffect(() => {
    if (!ownerUid || !eventId) return;
    setLoading(true);

    const metaUnsub = onSnapshot(
      doc(db, seatingItemPath(APP_ID, { ownerUid, eventId, collection: 'seating', itemId: 'main' })),
      (snap) => {
        if (snap.exists()) {
          setMeta(snap.data());
        } else {
          setMeta({
            style: 'custom',
            canvasWidth: 1200,
            canvasHeight: 800,
            background: 'banquet',
            decorElements: [],
          });
        }
      },
      (err) => {
        console.error('[seating] meta listener', err);
      },
    );

    const tablesUnsub = onSnapshot(
      collection(db, seatingCollectionPath(APP_ID, { ownerUid, eventId, collection: 'tables' })),
      (snap) => {
        const rows = [];
        snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
        setTables(rows);
        setLoading(false);
      },
      (err) => {
        console.error('[seating] tables listener', err);
        setLoading(false);
      },
    );

    // P13.2 — assignments: /events/{eventId}/tableAssignments/{guestId}
    const assignmentsUnsub = onSnapshot(
      collection(db, seatingCollectionPath(APP_ID, { ownerUid, eventId, collection: 'tableAssignments' })),
      (snap) => {
        const rows = [];
        snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
        setAssignments(rows);
      },
      (err) => {
        console.error('[seating] assignments listener', err);
      },
    );

    // P13.2 — guests: /events/{eventId}/guests/{guestId} (sparse fields,
    // but we at least grab name + side + dietary tags).
    const guestsUnsub = onSnapshot(
      collection(db, seatingCollectionPath(APP_ID, { ownerUid, eventId, collection: 'guests' })),
      (snap) => {
        const rows = [];
        snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
        setGuests(rows);
      },
      (err) => {
        console.error('[seating] guests listener', err);
      },
    );

    // P13.3 — seatingCheckIns: per-guest check-in stamp written by
    // ReceptionScanner. Powers the "已入座 X/8" live pill.
    const checkInsUnsub = onSnapshot(
      collection(db, seatingCollectionPath(APP_ID, { ownerUid, eventId, collection: 'seatingCheckIns' })),
      (snap) => {
        const rows = [];
        snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
        setCheckIns(rows);
      },
      (err) => {
        console.error('[seating] checkIns listener', err);
      },
    );

    return () => {
      metaUnsub();
      tablesUnsub();
      assignmentsUnsub();
      guestsUnsub();
      checkInsUnsub();
    };
  }, [ownerUid, eventId]);

  /* ---------- helpers ---------- */
  const showToast = useCallback(
    (msg) => {
      if (typeof onOpenToast === 'function') onOpenToast(msg);
    },
    [onOpenToast],
  );

  /* ---------- save / delete ---------- */
  const saveMeta = useCallback(
    async (next) => {
      if (!ownerUid || !eventId) return;
      try {
        await setDoc(
          doc(db, seatingItemPath(APP_ID, { ownerUid, eventId, collection: 'seating', itemId: 'main' })),
          { ...next, updatedAt: Date.now() },
          { merge: true },
        );
        showToast('已儲存');
      } catch (e) {
        console.error('[seating] saveMeta', e);
        showToast('儲存失敗，請重試');
      }
    },
    [ownerUid, eventId, showToast],
  );

  const saveTable = useCallback(
    async (table) => {
      if (!ownerUid || !eventId) return;
      const { id, ...rest } = table;
      const tableId = id || `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        await setDoc(
          doc(db, seatingItemPath(APP_ID, { ownerUid, eventId, collection: 'tables', itemId: tableId })),
          {
            label: rest.label || 'T-01',
            shape: rest.shape || 'round',
            capacity: rest.capacity ?? 10,
            tableCategory: rest.tableCategory || 'friends',
            x: rest.x ?? 200,
            y: rest.y ?? 200,
            rotation: rest.rotation ?? 0,
            source: rest.source || 'manual',
            updatedAt: Date.now(),
          },
        );
        // P13.3 follow-up: bust the scanner tables cache so the
        // next scan reads the fresh label/category.
        invalidateScannerTablesCache(ownerUid, eventId);
        setEditingTable(null);
        // P13.4.1 — Budget toast on capacity change. Operators see
        // "T-03 加位至 12 人 = 預算 +$0; 總預算 $144k of $150k" when
        // they bump a table's capacity. delta is 0 for capacity
        // changes (cost scales with guests not seats); we still
        // show the projected total so the operator has the number
        // in front of them.
        if (id && typeof rest.capacity === 'number') {
          const cfg = {
            costPerHead: meta?.costPerHead ?? DEFAULT_COST_PER_HEAD,
            budgetCap: meta?.budgetCap ?? DEFAULT_BUDGET_CAP,
          };
          const projection = projectBudgetDelta(
            tables, assignments, tableId, rest.capacity, cfg,
          );
          const cap = cfg.budgetCap;
          const msg = cap > 0
            ? `${rest.label || '枱'} 加位至 ${rest.capacity} 人 · 總預估 ${formatHKD(projection.newProjectedCost, { short: true })} / ${formatHKD(cap, { short: true })}`
            : `${rest.label || '枱'} 加位至 ${rest.capacity} 人 · 總預估 ${formatHKD(projection.newProjectedCost, { short: true })}`;
          showToast(msg);
        } else {
          showToast(id ? '已更新' : '已新增');
        }
      } catch (e) {
        console.error('[seating] saveTable', e);
        showToast('儲存失敗，請重試');
      }
    },
    [ownerUid, eventId, showToast],
  );

  const deleteTable = useCallback(
    async (tableId) => {
      if (!ownerUid || !eventId) return;
      try {
        await deleteDoc(
          doc(db, seatingItemPath(APP_ID, { ownerUid, eventId, collection: 'tables', itemId: tableId })),
        );
        invalidateScannerTablesCache(ownerUid, eventId);
        showToast('已刪除');
      } catch (e) {
        console.error('[seating] deleteTable', e);
        showToast('刪除失敗，請重試');
      }
    },
    [ownerUid, eventId, showToast],
  );

  /* ---------- presets ---------- */
  // P13.4.3 — preset options state. Defaults match the prior
  // behaviour (12 圍 at 10 each) so an operator who taps "套用"
  // without touching anything gets exactly what they used to get.
  const [presetOpts, setPresetOpts] = useState({
    roundCapacity: 10,
    roundCount: 12,
  });
  const applyPreset = useCallback(
    async (preset, opts = presetOpts) => {
      if (!ownerUid || !eventId) return;
      // Sanity: confirm if user already has tables
      if (tablesRef.current.length > 0) {
        const ok = typeof window !== 'undefined' && window.confirm(
          '繼續會清空現有嘅枱同座位。確定要套用新 preset 嗎？',
        );
        if (!ok) return;
      }
      const batch = writeBatch(db);
      // P13.4.3 — Chinese preset now takes options; western stays
      // unchanged. presetTables() picks the right builder.
      const seed = presetTables(preset, opts);

      // Wipe existing tables
      tablesRef.current.forEach((t) => {
        batch.delete(
          doc(db, seatingItemPath(APP_ID, { ownerUid, eventId, collection: 'tables', itemId: t.id })),
        );
      });
      seed.forEach((row) => {
        const ref = doc(db, seatingItemPath(APP_ID, { ownerUid, eventId, collection: 'tables', itemId: row.id }));
        batch.set(ref, { ...row, source: 'preset', updatedAt: Date.now() });
      });
      batch.set(
        doc(db, seatingItemPath(APP_ID, { ownerUid, eventId, collection: 'seating', itemId: 'main' })),
        {
          style: preset,
          canvasWidth: preset === 'western' ? 1600 : 1200,
          canvasHeight: preset === 'western' ? 900 : 800,
          background: 'banquet',
          decorElements: [],
          updatedAt: Date.now(),
        },
        { merge: true },
      );

      try {
        await batch.commit();
        invalidateScannerTablesCache(ownerUid, eventId);
        setPresetsOpen(false);
        showToast(`已套用 ${presetLabel(preset, opts)} preset`);
      } catch (e) {
        console.error('[seating] applyPreset', e);
        showToast('套用 preset 失敗，請重試');
      }
    },
    [ownerUid, eventId, showToast],
  );

  /* ---------- P13.2: assignment CRUD ---------- */
  const saveAssignment = useCallback(
    async (guestId, tableId, guestName) => {
      if (!ownerUid || !eventId) return { ok: false };
      // P13.3 — helper live-edit cannot assign guests to owner-only
      // categories (bride_groom, elder_family, groomsmen, bridesmaid,
      // ceremony). The Firestore rule blocks it too; this is the
      // client-side pre-check so the toast doesn't say "failed" when
      // the rejection is by-design.
      if (role === 'helper') {
        const table = tablesRef.current.find((t) => t.id === tableId);
        if (table && !HELPER_WRITABLE_TABLE_CATEGORIES.includes(table.tableCategory)) {
          showToast(`家族枱（${table.label || tableId}）只能由主人分配`);
          return { ok: false };
        }
      }
      const validation = validateAssignment(
        guestId,
        tableId,
        tablesRef.current,
        assignmentsRef.current,
      );
      if (!validation.ok) {
        showToast('無法分配此賓客到此枱');
        return { ok: false };
      }
      const docId = buildAssignmentDocId(guestId);
      try {
        await setDoc(
          doc(db, seatingItemPath(APP_ID, { ownerUid, eventId, collection: 'tableAssignments', itemId: docId })),
          emptyAssignment(guestId, tableId),
        );
        showToast(`已加 ${guestName || '賓客'} → ${tableId}`);
        return { ok: true };
      } catch (e) {
        console.error('[seating] saveAssignment', e);
        showToast('分配失敗，請重試');
        return { ok: false };
      }
    },
    [ownerUid, eventId, showToast],
  );

  // P13.4.2 — batch auto-assign. Runs the pure helper to plan a
  // greedy bin-pack, then writes each new assignment via the
  // same setDoc path as saveAssignment. The plan is computed
  // from the current tables+assignments snapshot (refs, so
  // always-fresh without re-rendering).
  const autoAssignAll = useCallback(async () => {
    if (!ownerUid || !eventId) return;
    // Build the unassigned guest list.
    const assignedIds = new Set(assignmentsRef.current.map((a) => a.guestId));
    const unassigned = guests
      .filter((g) => g.id && !assignedIds.has(g.id))
      .map((g) => ({
        id: g.id,
        name: g.name,
        // No guest.category table category is implied yet — leave
        // undefined so the helper falls back to "any table" for
        // guests without an explicit category.
        category: undefined,
        // Couples/family grouping: use partnerId when present so
        // couples always get the same table when one has room.
        groupKey: g.partnerId
          ? `couple-${[g.id, g.partnerId].sort().join('-')}`
          : undefined,
      }));
    // Plan with the pure helper.
    const plan = autoAssignGuests(
      tablesRef.current,
      assignmentsRef.current,
      unassigned,
      { prefer: 'tightest' },
    );
    if (plan.newAssignments.length === 0) {
      showToast('冇位擺，全部都係孤兒');
      return;
    }
    // Write each new assignment.
    let ok = 0;
    let fail = 0;
    for (const a of plan.newAssignments) {
      const docId = buildAssignmentDocId(a.guestId);
      try {
        await setDoc(
          doc(db, seatingItemPath(APP_ID, {
            ownerUid, eventId, collection: 'tableAssignments', itemId: docId,
          })),
          emptyAssignment(a.guestId, a.tableId),
        );
        ok += 1;
      } catch (e) {
        console.error('[seating] auto-assign write', e);
        fail += 1;
      }
    }
    // Bust scanner cache + close the sheet.
    invalidateScannerTablesCache(ownerUid, eventId);
    setAutoAssignOpen(false);
    if (plan.remainingOrphans.length > 0) {
      showToast(
        `已擺 ${ok} 位 · 仲有 ${plan.remainingOrphans.length} 位孤兒 (加多張枱或調大現有枱)`,
      );
    } else {
      showToast(`已擺晒 ${ok} 位賓客 🎉`);
    }
  }, [ownerUid, eventId, guests, showToast]);

  const unassignGuest = useCallback(
    async (guestId) => {
      if (!ownerUid || !eventId) return;
      const docId = buildAssignmentDocId(guestId);
      try {
        await deleteDoc(
          doc(db, seatingItemPath(APP_ID, { ownerUid, eventId, collection: 'tableAssignments', itemId: docId })),
        );
        showToast('已取消座位');
      } catch (e) {
        console.error('[seating] unassignGuest', e);
        showToast('取消失敗，請重試');
      }
    },
    [ownerUid, eventId, showToast],
  );

  /* ---------- occupancy memo (for dietary chip + filled badge) ---------- */
  const normalizedTables = useMemo(
    () => tables.map((t) => normalizeTable(t, t.id)).filter(Boolean),
    [tables],
  );
  const guestsById = useMemo(() => {
    const m = {};
    for (const g of guests) {
      m[g.id] = {
        id: g.id,
        name: g.name || '(無名)',
        side: g.side,
        relation: g.relation,
        isChild: g.isChild,
        allergies: g.allergies,
        allergyTags: g.allergyTags,
      };
    }
    return m;
  }, [guests]);
  const occ = useMemo(
    () => occupancy(normalizedTables, assignments, guestsById),
    [normalizedTables, assignments, guestsById],
  );

  // P13.3 — live attendance badges per table. Pure projection of
  // (tables, assignments, checkIns) into the minimal shape the
  // renderer needs. Memoized on the same inputs.
  const liveBadges = useMemo(
    () => liveSeatingBadges(normalizedTables, assignments, guestsById, checkIns),
    [normalizedTables, assignments, guestsById, checkIns],
  );
  const liveBadgeByTable = useMemo(() => {
    const m = {};
    for (const b of liveBadges) m[b.tableId] = b;
    return m;
  }, [liveBadges]);

  /* ---------- P13.2: SVG-native drag (no react-konva) ---------- */
  const onTablePointerDown = useCallback((e, table) => {
    // Capture pointer so we get move/up even outside the table.
    e.stopPropagation();
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgPt = pt.matrixTransform(ctm.inverse());
    setDragState({
      tableId: table.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      originX: table.x,
      originY: table.y,
      pointerX: svgPt.x,
      pointerY: svgPt.y,
      moved: false,
    });
  }, []);

  const onSvgPointerMove = useCallback(
    (e) => {
      setDragState((s) => {
        if (!s) return null;
        // P13.3 — helper live-edit cannot move tables. Drag is
        // owner-only; helpers still get the live-pill + can drag
        // guest chips into helper-writable tables.
        if (role !== 'owner') return s;
        const svg = svgRef.current;
        if (!svg) return s;
        const ctm = svg.getScreenCTM();
        if (!ctm) return s;
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const svgPt = pt.matrixTransform(ctm.inverse());
        // Translate pointer delta into table-local delta
        const dx = svgPt.x - s.pointerX;
        const dy = svgPt.y - s.pointerY;
        const moved = s.moved || Math.hypot(e.clientX - s.startClientX, e.clientY - s.startClientY) > 4;
        const table = tablesRef.current.find((t) => t.id === s.tableId);
        if (!table) return null;
        const newX = Math.max(0, s.originX + dx);
        const newY = Math.max(0, s.originY + dy);
        // Optimistic local update — write through Firestore immediately.
        // The single-doc listener will reconcile any race.
        // P13.3 follow-up: dragging a table doesn't change its label
        // or category, so we do NOT invalidate the scanner cache here
        // (would defeat the cache purpose on every pan). The next
        // saveTable / deleteTable / applyPreset will invalidate.
        setDoc(
          doc(db, seatingItemPath(APP_ID, { ownerUid, eventId, collection: 'tables', itemId: s.tableId })),
          { ...table, x: newX, y: newY, updatedAt: Date.now() },
        ).catch((err) => console.error('[seating] drag update', err));
        return { ...s, moved };
      });
    },
    [ownerUid, eventId, role],
  );

  const onSvgPointerUp = useCallback((e) => {
    setDragState((s) => {
      if (!s) return null;
      // If pointer moved <4px, treat as a click — open the editor modal.
      // P13.3 — helper live-edit does NOT open the editor (read-only mode).
      const wasClick = !s.moved && Math.hypot(e.clientX - s.startClientX, e.clientY - s.startClientY) <= 4;
      if (wasClick && role === 'owner') {
        const table = tablesRef.current.find((t) => t.id === s.tableId);
        if (table) setEditingTable({ ...table });
      }
      return null;
    });
  }, [role]);

  /* ---------- drag/click ---------- */
  const onCanvasClick = useCallback(
    (e) => {
      // Tap on empty SVG (no table hit) creates a new table at the click point.
      // Suppressed during drag-release.
      if (dragState && dragState.moved) return;
      // P13.3 — helper live-edit cannot create new tables. Owner-only.
      if (role !== 'owner') return;
      const svg = svgRef.current;
      if (!svg) return;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const local = pt.matrixTransform(ctm.inverse());
      setEditingTable({
        x: Math.max(40, Math.round(local.x)),
        y: Math.max(40, Math.round(local.y)),
        shape: 'round',
        capacity: 10,
        label: `T-${String(tablesRef.current.length + 1).padStart(2, '0')}`,
        tableCategory: 'friends',
        rotation: 0,
        source: 'manual',
      });
    },
    [role],
  );

  // P13.4.5 — a11y: keyboard navigation for the seating canvas.
  // Roving-tabindex over the table list (Tab moves between
  // tables; arrow keys reposition the focused table; Enter
  // opens the editor; Delete removes; Escape clears focus).
  // Owner-only — helpers shouldn't accidentally delete.
  const onSvgKeyDown = useCallback(
    (e) => {
      if (role !== 'owner') return;
      if (!normalizedTables.length) return;
      const ids = normalizedTables.map((t) => t.id);
      const idx = focusedTableId ? ids.indexOf(focusedTableId) : -1;
      if (e.key === 'Escape') {
        setFocusedTableId(null);
        svgRef.current?.focus?.();
        e.preventDefault();
        return;
      }
      if (e.key === 'Tab') {
        // Tab: cycle through tables (roving). Default Tab would
        // walk every table, which is too noisy — capture it.
        e.preventDefault();
        const next = idx === -1
          ? ids[0]
          : ids[(idx + (e.shiftKey ? -1 : 1) + ids.length) % ids.length];
        setFocusedTableId(next);
        return;
      }
      if (idx === -1) {
        // No table focused yet; pressing Enter/Space on the
        // canvas itself focuses the first table.
        if (e.key === 'Enter' || e.key === ' ') {
          setFocusedTableId(ids[0]);
          e.preventDefault();
        }
        return;
      }
      const table = normalizedTables[idx];
      if (!table) return;
      if (e.key === 'Enter' || e.key === ' ') {
        setEditingTable({ ...table });
        e.preventDefault();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (window.confirm(`確定要刪除 ${table.label || table.id}？(刪咗之後賓客會變成未分配)`)) {
          deleteTable(table.id).then(() => {
            setFocusedTableId(null);
            showToast(`已刪除 ${table.label || table.id}`);
          });
        }
        e.preventDefault();
        return;
      }
      // Arrow keys reposition the focused table by 10px.
      const step = e.shiftKey ? 40 : 10;
      const dx = e.key === 'ArrowLeft' ? -step
               : e.key === 'ArrowRight' ? step
               : 0;
      const dy = e.key === 'ArrowUp' ? -step
               : e.key === 'ArrowDown' ? step
               : 0;
      if (dx || dy) {
        const w = (meta?.canvasWidth ?? 1200);
        const h = (meta?.canvasHeight ?? 800);
        const nextX = Math.max(40, Math.min(w, (table.x ?? 0) + dx));
        const nextY = Math.max(40, Math.min(h, (table.y ?? 0) + dy));
        saveTable({ ...table, x: nextX, y: nextY });
        e.preventDefault();
      }
    },
    [role, normalizedTables, focusedTableId, meta, deleteTable, saveTable, showToast],
  );

  /* ---------- rendering ---------- */
  const dim = useMemo(() => {
    const w = meta?.canvasWidth ?? 1200;
    const h = meta?.canvasHeight ?? 800;
    return { w, h };
  }, [meta]);

  // P13.4.5 perf — stable handler bundle for memoized TableNode.
  // The bundle is the SAME object across renders unless one of
  // its members changes reference. This is what lets `memo` skip
  // re-rendering tables whose props are otherwise identical.
  //
  // 2026-09-25 — TDZ hotfix (the sequel). Commit 98a61bd
  // (P13.4.5 perf follow-up, 2026-09-20) introduced this
  // useMemo with the SHORTHAND `{ onAssign }` — but
  // `onAssign` was never declared in SeatingCanvas. The
  // actual function is `saveAssignment` (L730). The shorthand
  // was supposed to read from the prop the TableNode receives,
  // but SeatingCanvas's parent passes `handlers` from
  // TableNode (the other direction), not the other way around.
  //
  // Until now, this crashed on every seating render with
  // `ReferenceError: onAssign is not defined`. The previous
  // App.jsx TDZ (fixed in 2259922) was masking this — the
  // page errored out before the seating click ever reached
  // SeatingCanvas. With App.jsx rendering, the bug surfaced.
  //
  // Fix: rename `onAssign` to the actual local binding
  // `saveAssignment`. The TableNode receives it via the
  // `handlers.onAssign` destructure at L139, so the consumer
  // contract is unchanged.
  const tableHandlers = useMemo(
    () => ({
      onTablePointerDown,
      onAssign: saveAssignment,
      setFocusedTableId,
    }),
    [onTablePointerDown, saveAssignment, setFocusedTableId],
  );

  if (!ownerUid || !eventId) {
    return (
      <div style={{ padding: 24 }}>
        <p>請先選擇一個婚禮活動。</p>
        <button onClick={onBack}>← 返回</button>
      </div>
    );
  }

  return (
    <div data-testid="couple-seating" style={{ padding: 16, maxWidth: 1024, margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <button onClick={onBack} style={btnGhost}>← 返回</button>
          <h2 style={{ margin: '8px 0 4px', color: '#0F766E' }}>🪑 Reception 座位表</h2>
          <p style={{ margin: 0, color: '#64748B', fontSize: 13 }}>
            {loading ? '載入緊…' : `現有 ${tables.length} 張枱 · 風格：${presetLabel(meta?.style ?? 'custom')}`}
          </p>
          {/* P13.4.1 — Budget pill. Shows projected cost vs cap
              (or "no cap" if budgetCap=0). Owner-only chrome. */}
          {role === 'owner' && (() => {
            const cfg = {
              costPerHead: meta?.costPerHead ?? DEFAULT_COST_PER_HEAD,
              budgetCap: meta?.budgetCap ?? DEFAULT_BUDGET_CAP,
            };
            const summary = computeBudget(tables, assignments, cfg);
            const noCap = cfg.budgetCap <= 0;
            return (
              <div
                data-testid="budget-pill"
                data-over-budget={summary.overBudget}
                onClick={() => setBudgetSheetOpen(true)}
                style={{
                  marginTop: 8,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 10px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: summary.overBudget ? '#FEF2F2' : '#F0FDF4',
                  border: summary.overBudget
                    ? '1px solid #DC2626'
                    : '1px solid #14B8A6',
                  color: summary.overBudget ? '#991B1B' : '#065F46',
                }}
                title={noCap ? '設定預算上限' : '預算詳情'}
              >
                💰{' '}
                <span>{formatHKD(summary.projectedCost, { short: true })}</span>
                {!noCap && (
                  <>
                    <span style={{ opacity: 0.6 }}>/</span>
                    <span>{formatHKD(cfg.budgetCap, { short: true })}</span>
                  </>
                )}
                {/* P13.4.1 refine — visual progress bar. Tiny
                    60×6px strip that fills as you approach the
                    cap. Width is percentUsed (already capped at
                    100 in computeBudget), so an over-budget
                    budget shows fully filled regardless. Empty
                    when no cap is set. */}
                <span
                  data-testid="budget-progress-bar"
                  data-percent={summary.percentUsed}
                  style={{
                    display: 'inline-block',
                    width: 60,
                    height: 6,
                    borderRadius: 3,
                    background: summary.overBudget
                      ? 'rgba(220, 38, 38, 0.15)'
                      : 'rgba(14, 165, 233, 0.15)',
                    overflow: 'hidden',
                    position: 'relative',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      left: 0, top: 0, bottom: 0,
                      width: `${summary.percentUsed}%`,
                      background: summary.overBudget ? '#DC2626' : '#0F766E',
                      transition: 'width 200ms ease',
                    }}
                  />
                </span>
                <span style={{ opacity: 0.5, marginLeft: 4, fontSize: 10 }}>
                  · 每人 ${cfg.costPerHead}
                </span>
              </div>
            );
          })()}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {/* Owner-only chrome (preset selector + auto-assigner).
              Helper live-edit hides both — helpers can move/
              reassign only. */}
          {role === 'owner' && (
            <>
              {/* P13.4.5 a11y — keyboard-shortcut legend button.
                  Tapping is equivalent to pressing "?". Same
                  shortcut keys work everywhere on the seating
                  screen as long as the user isn't typing into
                  an input (see onSvgKeyDown + shouldHandleCanvasShortcut). */}
              <button
                onClick={() => setShortcutsOpen(true)}
                data-testid="shortcuts-btn"
                title="快捷鍵一覽 (按 ? 鍵)"
                aria-label="快捷鍵一覽"
                style={{
                  ...btnGhost,
                  padding: '6px 10px',
                  fontSize: 16,
                  lineHeight: 1,
                }}
              >
                ⌨️
              </button>
              <button
                onClick={() => setFindSeatOpen(true)}
                data-testid="find-seat-btn"
                disabled={tables.length === 0}
                title={
                  tables.length === 0
                    ? '需要先有枱先可以生成 Find-Seat QR'
                    : '生成一個公開 QR，賓客用手機掃就睇到座位表'
                }
                style={{
                  ...btnSecondary,
                  opacity: tables.length === 0 ? 0.5 : 1,
                  cursor: tables.length === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                📱 Find-Seat QR
              </button>
              <button
                onClick={() => setAutoAssignOpen(true)}
                data-testid="auto-assign-btn"
                disabled={tables.length === 0}
                title={
                  tables.length === 0
                    ? '需要先套用 preset 或者新增枱先可以用自動排位'
                    : '將未分配嘅賓客自動擺入仍有空位嘅枱'
                }
                style={{
                  ...btnSecondary,
                  opacity: tables.length === 0 ? 0.5 : 1,
                  cursor: tables.length === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                🎯 自動排位
              </button>
              <button onClick={() => setPresetsOpen(true)} style={btnSecondary}>
                ⚙️ 套用 preset
              </button>
            </>
          )}
        </div>
      </header>

      <div
        style={{
          border: '1px solid #E2E8F0',
          borderRadius: 12,
          background: '#FAFAF9',
          position: 'relative',
          width: '100%',
          maxWidth: dim.w,
          aspectRatio: `${dim.w} / ${dim.h}`,
          overflow: 'hidden',
        }}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${dim.w} ${dim.h}`}
          width="100%"
          height="100%"
          onClick={onCanvasClick}
          onPointerMove={onSvgPointerMove}
          onPointerUp={onSvgPointerUp}
          onPointerCancel={onSvgPointerUp}
          onKeyDown={onSvgKeyDown}
          tabIndex={0}
          role="application"
          aria-label={`座位表畫布，共 ${normalizedTables.length} 張枱。撳 Tab 移動焦點，方向鍵移枱，Enter 開編輯，Esc 取消。`}
          data-testid="seating-canvas"
          style={{
            display: 'block',
            touchAction: 'none', // P13.2: allow our pointer events to drive drag, not the browser's scroll
            cursor: dragState ? 'grabbing' : 'default',
          }}
        >
          {/* simple banquet hall grid (decor) */}
          <defs>
            <pattern id="floor-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#E2E8F0" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width={dim.w} height={dim.h} fill="url(#floor-grid)" />

          {/* 2026-09-26 — V2 #3.5 / P13.5 follow-up. Dance-floor
              decor for the western preset. Drawn BEFORE the
              tables so the tables render on top of it (the
              dance floor is "below" the seating, between the
              two rows of long tables). Gated on
              `meta.style === 'western'` so the chinese preset
              and custom boards don't render a phantom dance
              floor. Geometry mirrors `westernPreset()` —
              x=560, y=430, w=480, h=200. */}
          {meta?.style === 'western' && (
            <g data-testid="dance-floor-decor">
              <rect
                x={560}
                y={430}
                width={480}
                height={200}
                rx={6}
                fill="#0F766E"
                fillOpacity={0.08}
                stroke="#0F766E"
                strokeWidth={1.5}
                strokeDasharray="6 4"
              />
              <text
                x={560 + 480 / 2}
                y={430 + 200 / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={20}
                fontWeight={600}
                fill="#0F766E"
                pointerEvents="none"
                style={{ userSelect: 'none' }}
              >
                💃 中央 Dance Floor 🕺
              </text>
            </g>
          )}

          {/* tables */}
          {/* tables — memoized TableNode for the perf win
              (P13.4.5). The old inline `<g>` block re-evaluated
              and re-rendered every table on every drag tick;
              now only the dragged table's node re-renders. */}
          {normalizedTables.map((t) => {
            const isRound = t.shape === 'round';
            return (
              <TableNode
                key={t.id}
                t={t}
                o={occ[t.id]}
                liveBadge={liveBadgeByTable[t.id]}
                focused={focusedTableId === t.id}
                isDragging={Boolean(dragState && dragState.tableId === t.id && dragState.moved)}
                handlers={tableHandlers}
                guestsById={guestsById}
              />
            );
          })}
        </svg>

        {tables.length === 0 && !loading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
              color: '#94A3B8',
              textAlign: 'center',
            }}
          >
            <div>
              <p style={{ marginBottom: 12 }}>空白 floor plan</p>
              <p style={{ fontSize: 12 }}>撳空白處加枱，或者用右上「套用 preset」一鍵生成</p>
            </div>
          </div>
        )}
      </div>

      <GuestPanel
        guests={guests}
        assignments={assignments}
        normalizedTables={normalizedTables}
        occ={occ}
        onAssign={saveAssignment}
        onUnassign={unassignGuest}
        onSuggest={(guestId) => {
          const g = guestsById[guestId];
          if (!g) return;
          const sorted = normalizedTables
            .map((t) => {
              const fit = guestTableFit(g, t, assignments);
              return { table: t, fit };
            })
            .filter((row) => row.fit.fits)
            .sort((a, b) => a.table.capacity - b.table.capacity);
          if (sorted.length === 0) {
            showToast('冇適合嘅枱，建議你加多張枱或者調容量');
            return;
          }
          saveAssignment(guestId, sorted[0].table.id, g.name);
        }}
      />

      <p style={{ marginTop: 8, color: '#64748B', fontSize: 11 }}>
        {role === 'owner' ? (
          <>
            撳空白 = 加新枱 · 撳枱 = 編輯 · 拖枱 = 搬位 · 拖賓客到枱 = 分配座位
          </>
        ) : (
          <>
            助手模式：可以拖賓客到 <strong>朋友/同事/小朋友/其他</strong> 枱。家族枱同主家席只能由主人改。
          </>
        )}
      </p>
      {role === 'owner' && (
        <p style={{ marginTop: 4, color: '#64748B', fontSize: 11 }}>
          <span style={{ background: '#ECFDF5', padding: '0 4px', borderRadius: 4 }}>✓ 已入座 X/Y/Z</span>
          {' '} = 接待已掃描嘅即時人數 (X 入座 / Y 已分配 / Z 座位上限)
        </p>
      )}

      {/* Editor modal */}
      {editingTable && (
        <TableEditorModal
          initial={editingTable}
          filledCount={
            editingTable.id
              ? assignments.filter((a) => a.tableId === editingTable.id).length
              : 0
          }
          costPerHead={meta?.costPerHead ?? DEFAULT_COST_PER_HEAD}
          onSave={saveTable}
          onCancel={() => setEditingTable(null)}
          onDelete={editingTable.id ? () => {
            if (typeof window !== 'undefined' && window.confirm(`刪除 ${editingTable.label}?`)) {
              deleteTable(editingTable.id).then(() => setEditingTable(null));
            }
          } : null}
        />
      )}

      {/* Preset sheet */}
      {presetsOpen && (
        <PresetSheet
          onPick={(p) => applyPreset(p)}
          onCancel={() => setPresetsOpen(false)}
          roundCapacity={presetOpts.roundCapacity}
          roundCount={presetOpts.roundCount}
          onOptsChange={(patch) => setPresetOpts((o) => ({ ...o, ...patch }))}
        />
      )}

      {/* P13.4.1 — Budget sheet. Owner-only. Tap the budget pill
          in the header to open. Persists costPerHead + budgetCap
          to the seating meta doc. Lazy-loaded (P13.4.5 perf)
          — Suspense boundary keeps the seating screen responsive
          while the chunk downloads. */}
      {budgetSheetOpen && (
        <Suspense fallback={<div style={modalBackdrop}><div style={{ ...modalCard, textAlign: 'center' }}>載入緊預算設定…</div></div>}>
          <BudgetSheet
            costPerHead={meta?.costPerHead ?? DEFAULT_COST_PER_HEAD}
            budgetCap={meta?.budgetCap ?? DEFAULT_BUDGET_CAP}
            summary={computeBudget(tables, assignments, {
              costPerHead: meta?.costPerHead ?? DEFAULT_COST_PER_HEAD,
              budgetCap: meta?.budgetCap ?? DEFAULT_BUDGET_CAP,
            })}
            onSave={async ({ costPerHead: cph, budgetCap: cap }) => {
              try {
                await setDoc(
                  doc(db, seatingItemPath(APP_ID, {
                    ownerUid, eventId, collection: 'seating', itemId: 'main',
                  })),
                  { costPerHead: cph, budgetCap: cap, updatedAt: Date.now() },
                  { merge: true },
                );
                setBudgetSheetOpen(false);
                showToast(
                  cap > 0
                    ? `已設定預算上限 ${formatHKD(cap, { short: true })} · 每人 ${formatHKD(cph)}`
                    : `已設定每人成本 ${formatHKD(cph)} (不設上限)`,
                );
              } catch (e) {
                console.error('[seating] saveBudget', e);
                showToast('儲存失敗，請重試');
              }
            }}
            onCancel={() => setBudgetSheetOpen(false)}
          />
        </Suspense>
      )}

      {/* P13.4.2 — Auto-assign sheet. Owner-only batch assistant.
          Lazy-loaded (P13.4.5 perf follow-up) — Suspense boundary
          shows a small spinner while the candidate-list chunk
          downloads. */}
      {autoAssignOpen && (() => {
        const assignedIds = new Set(assignments.map((a) => a.guestId));
        const unassigned = guests
          .filter((g) => g.id && !assignedIds.has(g.id))
          .map((g) => ({
            id: g.id,
            name: g.name,
            category: undefined,
            groupKey: g.partnerId
              ? `couple-${[g.id, g.partnerId].sort().join('-')}`
              : undefined,
          }));
        return (
          <Suspense fallback={<div style={modalBackdrop}><div style={{ ...modalCard, textAlign: 'center' }}>載入緊自動排位…</div></div>}>
            <AutoAssignSheet
              unassigned={unassigned}
              tables={normalizedTables}
              assignments={assignments}
              guestsById={guestsById}
              onPick={(g, t) => {
                saveAssignment(g.id, t.id, g.name).then((r) => {
                  if (r.ok) setAutoAssignOpen(false);
                });
              }}
              onPickAll={autoAssignAll}
              onCancel={() => setAutoAssignOpen(false)}
            />
          </Suspense>
        );
      })()}

      {/* P13.4.4 — Find-Seat QR sheet. Owner-only, generates a
          publicSeating token doc + URL guests can scan without
          signing in. Lazy-loaded (P13.4.5 perf) — Suspense
          boundary keeps the seating screen responsive while the
          QR sheet chunk downloads. */}
      {findSeatOpen && tables.length > 0 && (
        <Suspense fallback={<div style={modalBackdrop}><div style={{ ...modalCard, textAlign: 'center' }}>載入緊 QR sheet…</div></div>}>
          <FindSeatSheet
            ownerUid={ownerUid}
            eventId={eventId}
            meta={meta ?? {}}
            tables={normalizedTables}
            assignments={assignments}
            guests={guests}
            onClose={() => setFindSeatOpen(false)}
          />
        </Suspense>
      )}

      {/* P13.4.5 a11y follow-up — keyboard-shortcut legend.
          Owner-only. Either tap the ⌨️ button in the header or
          press "?" anywhere on the seating screen. Lazy-loaded
          (only paid for when first opened). */}
      {role === 'owner' && shortcutsOpen && (
        <Suspense
          fallback={
            <div style={modalBackdrop}>
              <div style={{ ...modalCard, textAlign: 'center' }}>
                載入緊快捷鍵一覽…
              </div>
            </div>
          }
        >
          <KeyboardShortcutsOverlay
            onClose={() => setShortcutsOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}

/* ---------- subcomponents ---------- */

/**
 * 2026-09-17 — P13.3 refactor: CoupleSeating is now a thin wrapper
 * around SeatingCanvas (above). The wrapper exists for two reasons:
 *   1. Stable import path — App.jsx imports './CoupleSeating' and
 *      doesn't need to know about the internal SeatingCanvas split.
 *   2. Future-proof — if the owner-only chrome (preset button,
 *      editor modal) grows enough to warrant extraction, only this
 *      wrapper changes; the canvas + helper screen stay untouched.
 */
export function CoupleSeating(props) {
  // Forward all props. role defaults to 'owner' inside SeatingCanvas.
  return <SeatingCanvas {...props} role={props.role || 'owner'} />;
}

function TableEditorModal({
  initial,
  filledCount = 0,
  costPerHead = DEFAULT_COST_PER_HEAD,
  onSave,
  onCancel,
  onDelete,
}) {
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [initial]);
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  return (
    <div
      role="dialog"
      aria-label="編輯枱"
      data-testid="seating-table-editor"
      style={modalBackdrop}
      onClick={onCancel}
    >
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0, color: '#0F766E' }}>{initial.id ? '編輯枱' : '新枱'}</h3>
        <label style={label}>
          標籤
          <input
            value={draft.label ?? ''}
            onChange={(e) => set('label', e.target.value)}
            data-testid="seating-table-label"
            style={input}
          />
        </label>
        <label style={label}>
          形狀
          <select
            value={draft.shape}
            onChange={(e) => set('shape', e.target.value)}
            data-testid="seating-table-shape"
            style={input}
          >
            <option value="round">圓枱（圍）</option>
            <option value="rect">長枱（西式）</option>
            <option value="long">超長枱（主家席）</option>
          </select>
        </label>
        <label style={label}>
          容量 (1-40)
          <input
            type="number"
            min={1}
            max={40}
            value={draft.capacity ?? 10}
            onChange={(e) => set('capacity', Number(e.target.value))}
            data-testid="seating-table-capacity"
            style={input}
          />
        </label>
        <label style={label}>
          類別
          <select
            value={draft.tableCategory}
            onChange={(e) => set('tableCategory', e.target.value)}
            data-testid="seating-table-category"
            style={input}
          >
            <option value="bride_groom">主家席</option>
            <option value="groomsmen">兄弟姊妹席</option>
            <option value="bridesmaid">姐妹席</option>
            <option value="elder_family">長輩席</option>
            <option value="friends">朋友席</option>
            <option value="kids">小朋友席</option>
            <option value="colleagues">同事席</option>
            <option value="ceremony">證婚席</option>
            <option value="other">其他</option>
          </select>
        </label>
        <label style={label}>
          旋轉（0/90/180/270）
          <input
            type="number"
            min={0}
            max={270}
            step={90}
            value={draft.rotation ?? 0}
            onChange={(e) => set('rotation', Number(e.target.value))}
            style={input}
          />
        </label>
        {/* P13.4.1 refine — per-table cost preview. Operators
            see live budget impact of capacity changes BEFORE
            saving. Cost scales with FILLED guests (current +
            potential). When filledCount === draft.capacity, the
            本枱已分配 row shows the running cost the operator is
            committing to right now; 本枱滿座 shows the floor
            they'd pay if everyone shows up. */}
        {costPerHead > 0 && (
          <div
            data-testid="per-table-cost-preview"
            data-current-cost={filledCount * costPerHead}
            data-max-cost={(draft.capacity ?? 10) * costPerHead}
            style={{
              marginTop: 12,
              padding: 12,
              background: '#F0FDF4',
              border: '1px solid #14B8A6',
              borderRadius: 8,
              fontSize: 12,
              color: '#0F766E',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>💰 本枱成本</div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <span>
                已分配{' '}
                <strong data-testid="per-table-filled-count">
                  {filledCount}
                </strong>{' '}
                人 ·{' '}
                <strong data-testid="per-table-current-cost">
                  {formatHKD(filledCount * costPerHead)}
                </strong>
              </span>
              <span style={{ color: '#64748B' }}>
                滿座{' '}
                <strong>{draft.capacity ?? 10}</strong> 人 ·{' '}
                <strong>
                  {formatHKD((draft.capacity ?? 10) * costPerHead)}
                </strong>{' '}
                (上限)
              </span>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
          <div>
            {onDelete && (
              <button onClick={onDelete} style={btnDanger}>刪除</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onCancel} style={btnGhost}>取消</button>
            <button
              onClick={() => onSave(draft)}
              data-testid="seating-table-save"
              style={btnPrimary}
            >
              💾 儲存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PresetSheet({ onPick, onCancel, roundCapacity, roundCount, onOptsChange }) {
  return (
    <div role="dialog" style={modalBackdrop} onClick={onCancel}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0, color: '#0F766E' }}>套用 preset</h3>
        <p style={{ color: '#64748B', fontSize: 13 }}>一鍵生成整個 floor plan 嘅骨架</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 12 }}>
          <PresetCard
            title="中式 N 圍"
            description={`主家席頂位 + ${roundCount} 圍圓枱環繞舞台（${roundCount} 人/圍）`}
            onClick={() => onPick('chinese')}
          />
          <PresetCard
            title="西式 8 long"
            description="Head table 上方 + 8 長枱分兩行 + 中央 dance floor"
            onClick={() => onPick('western')}
          />
          <PresetCard
            title="自訂空板"
            description="清空 + 一張空白 canvas 俾你由零開始"
            onClick={() => onPick('custom')}
          />
        </div>
        {/* P13.4.3 — Chinese preset options. Stepper for 圍 capacity
            (8/10/12) and 圍 count (8/10/12/15/18/20). Operators can
            preview the exact label "中式 15 圍 · 12人/圍" as they
            pick. The "自訂空板" card ignores these (always empty). */}
        <div
          data-testid="chinese-preset-options"
          style={{
            marginTop: 20,
            padding: 12,
            background: '#FAFAF9',
            border: '1px solid #E2E8F0',
            borderRadius: 8,
          }}
        >
          <div style={{ fontSize: 12, color: '#475569', marginBottom: 8, fontWeight: 600 }}>
            中式 preset 設定
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <StepperField
              label="每圍人數"
              value={roundCapacity}
              options={CHINESE_ROUND_CAPACITY_OPTIONS}
              onChange={(v) => onOptsChange({ roundCapacity: v })}
              testid="round-capacity-stepper"
            />
            <StepperField
              label="圍數"
              value={roundCount}
              options={CHINESE_ROUND_COUNT_OPTIONS}
              onChange={(v) => onOptsChange({ roundCount: v })}
              testid="round-count-stepper"
            />
            <span
              data-testid="preset-preview-label"
              style={{ fontSize: 12, color: '#0F766E', fontWeight: 600, marginLeft: 'auto' }}
            >
              中式 {roundCount} 圍 · {roundCapacity}人/圍
            </span>
          </div>
        </div>
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <button onClick={onCancel} style={btnGhost}>取消</button>
        </div>
      </div>
    </div>
  );
}

function StepperField({ label, value, options, onChange, testid }) {
  const idx = options.indexOf(value);
  const dec = () => {
    if (idx > 0) onChange(options[idx - 1]);
  };
  const inc = () => {
    if (idx < options.length - 1) onChange(options[idx + 1]);
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 12, color: '#64748B' }}>{label}</span>
      <button
        type="button"
        onClick={dec}
        disabled={idx <= 0}
        data-testid={`${testid}-dec`}
        style={{
          width: 24, height: 24, borderRadius: 4,
          border: '1px solid #CBD5E1', background: 'white',
          cursor: idx <= 0 ? 'not-allowed' : 'pointer',
          color: '#475569', fontSize: 14, lineHeight: '20px',
          padding: 0,
        }}
      >−</button>
      <span
        data-testid={testid}
        style={{
          minWidth: 36, textAlign: 'center', fontWeight: 700,
          color: '#0F766E', fontSize: 14,
        }}
      >{value}</span>
      <button
        type="button"
        onClick={inc}
        disabled={idx >= options.length - 1}
        data-testid={`${testid}-inc`}
        style={{
          width: 24, height: 24, borderRadius: 4,
          border: '1px solid #CBD5E1', background: 'white',
          cursor: idx >= options.length - 1 ? 'not-allowed' : 'pointer',
          color: '#475569', fontSize: 14, lineHeight: '20px',
          padding: 0,
        }}
      >+</button>
    </div>
  );
}

function PresetCard({ title, description, onClick }) {
  return (
    <button
      onClick={onClick}
      data-testid={`preset-${title}`}
      style={{
        cursor: 'pointer',
        background: '#F0FDFA',
        border: '1.5px solid #14B8A6',
        borderRadius: 12,
        padding: 12,
        textAlign: 'left',
        color: '#0F766E',
      }}
    >
      <strong style={{ display: 'block', marginBottom: 4 }}>{title}</strong>
      <span style={{ fontSize: 11, color: '#64748B' }}>{description}</span>
    </button>
  );
}


/* ---------- preset geometry ---------- */

function presetTables(style, opts = {}) {
  if (style === 'chinese') return chinesePresetFn(opts);
  if (style === 'western') return westernPresetFn();
  return []; // custom = empty board
}

function presetLabel(style, opts = {}) {
  if (style === 'chinese') {
    const cap = opts.roundCapacity ?? 10;
    const cnt = opts.roundCount ?? 12;
    return `中式 ${cnt} 圍 · ${cap}人/圍`;
  }
  if (style === 'western') return '西式 8 long';
  return '自訂空板';
}

// P13.4.5 perf — modal + button styles live in a shared
// module so BudgetSheet and AutoAssignSheet (which are
// lazy-loaded) can import them without each redefining the
// same constants. label/input stay local — only used by the
// inline GuestPanel and TableEditorModal, which aren't split.
import {
  btnPrimary,
  btnSecondary,
  btnGhost,
  btnDanger,
  modalBackdrop,
  modalCard,
} from './seatingModalStyles';

const label = {
  display: 'block',
  marginTop: 8,
  fontSize: 12,
  color: '#475569',
};

const input = {
  width: '100%',
  marginTop: 4,
  padding: '6px 8px',
  border: '1px solid #CBD5E1',
  borderRadius: 6,
  fontSize: 14,
};


/* ---------- P13.2: GuestPanel ---------- */

function GuestPanel({
  guests,
  assignments,
  normalizedTables,
  occ,
  onAssign,
  onUnassign,
  onSuggest,
}) {
  const [query, setQuery] = useState('');
  const [showOnlyUnassigned, setShowOnlyUnassigned] = useState(true);

  const guestsById = useMemo(() => {
    const m = {};
    for (const g of guests) m[g.id] = g;
    return m;
  }, [guests]);

  const assignedGuestIds = useMemo(
    () => new Set(assignments.map((a) => a.guestId)),
    [assignments],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return guests
      .filter((g) => {
        if (showOnlyUnassigned && assignedGuestIds.has(g.id)) return false;
        if (!q) return true;
        return String(g.name || '').toLowerCase().includes(q);
      })
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-HK'));
  }, [guests, query, showOnlyUnassigned, assignedGuestIds]);

  const handleDragStart = (e, guestId) => {
    try {
      e.dataTransfer.setData('text/guestId', guestId);
      e.dataTransfer.effectAllowed = 'move';
    } catch (_) {
      // some browsers (older Safari) throw on setData; safe to ignore
    }
  };

  return (
    <div
      data-testid="seating-guest-panel"
      style={{
        marginTop: 16,
        background: '#FFFFFF',
        border: '1px solid #E2E8F0',
        borderRadius: 12,
        padding: 12,
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <strong style={{ color: '#0F766E', fontSize: 14 }}>👥 賓客名單</strong>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜尋賓客…"
          data-testid="guest-search"
          style={{
            flex: 1,
            border: '1px solid #CBD5E1',
            borderRadius: 6,
            padding: '4px 8px',
            fontSize: 13,
          }}
        />
        <label style={{ fontSize: 12, color: '#475569', display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={showOnlyUnassigned}
            onChange={(e) => setShowOnlyUnassigned(e.target.checked)}
            data-testid="only-unassigned"
          />
          只顯示未分配
        </label>
      </div>

      {filtered.length === 0 && (
        <p style={{ color: '#94A3B8', fontSize: 12, margin: 0 }}>
          {guests.length === 0 ? '尚未有賓客 — 喺「賓客名單」加入先' : '冇符合嘅賓客'}
        </p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {filtered.map((g) => {
          const allergens = dietaryAllergens(g);
          return (
            <div
              key={g.id}
              draggable
              onDragStart={(e) => handleDragStart(e, g.id)}
              data-testid={`guest-chip-${g.id}`}
              data-allergens={allergens.join(',')}
              data-side={g.side || ''}
              title={allergens.length > 0 ? `過敏: ${allergens.join(', ')}` : g.name}
              style={{
                background: allergens.length > 0 ? '#FEF3C7' : '#F1F5F9',
                border: `1px solid ${allergens.length > 0 ? '#F59E0B' : '#CBD5E1'}`,
                borderRadius: 999,
                padding: '4px 10px',
                fontSize: 12,
                color: '#0F172A',
                cursor: 'grab',
                userSelect: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span>{g.name || '(無名)'}</span>
              {allergens.length > 0 && <span aria-label="過敏">⚠</span>}
              <button
                type="button"
                onClick={() => onSuggest(g.id)}
                data-testid={`suggest-for-${g.id}`}
                style={{
                  marginLeft: 4,
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  color: '#0F766E',
                  padding: 0,
                  fontSize: 12,
                }}
                aria-label={`自動建議枱給 ${g.name}`}
                title="自動建議合適嘅枱"
              >
                🎯
              </button>
            </div>
          );
        })}
      </div>

      {/* assigned list (only when toggled off) */}
      {!showOnlyUnassigned && assignments.length > 0 && (
        <div style={{ marginTop: 12, borderTop: '1px dashed #E2E8F0', paddingTop: 8 }}>
          <p style={{ fontSize: 11, color: '#64748B', margin: 0 }}>已分配 ({assignments.length})</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            {assignments.map((a) => {
              const g = guestsById[a.guestId];
              const t = normalizedTables.find((x) => x.id === a.tableId);
              return (
                <span
                  key={a.guestId}
                  style={{
                    background: '#ECFDF5',
                    border: '1px solid #6EE7B7',
                    borderRadius: 999,
                    padding: '2px 8px',
                    fontSize: 11,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  {g?.name || a.guestId} · {t?.label || a.tableId}
                  <button
                    type="button"
                    onClick={() => onUnassign(a.guestId)}
                    aria-label={`取消分配 ${g?.name || a.guestId}`}
                    style={{
                      marginLeft: 4,
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      color: '#B91C1C',
                      padding: 0,
                      fontSize: 11,
                    }}
                  >
                    ✕
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
