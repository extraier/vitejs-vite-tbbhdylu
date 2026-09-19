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
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
} from '../lib/seatingPure';
import { invalidateScannerTablesCache } from '../lib/scannerTablesCache';

const APP_ID = 'savetheday-production';

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

  // Refs
  const svgRef = useRef(null);
  const metaRef = useRef(null);
  metaRef.current = meta;

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
        showToast(id ? '已更新' : '已新增');
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
  const applyPreset = useCallback(
    async (preset) => {
      if (!ownerUid || !eventId) return;
      // Sanity: confirm if user already has tables
      if (tablesRef.current.length > 0) {
        const ok = typeof window !== 'undefined' && window.confirm(
          '繼續會清空現有嘅枱同座位。確定要套用新 preset 嗎？',
        );
        if (!ok) return;
      }
      const batch = writeBatch(db);
      const seed = presetTables(preset);

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
        showToast(`已套用 ${presetLabel(preset)} preset`);
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

  /* ---------- rendering ---------- */
  const dim = useMemo(() => {
    const w = meta?.canvasWidth ?? 1200;
    const h = meta?.canvasHeight ?? 800;
    return { w, h };
  }, [meta]);

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
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {/* Owner-only chrome (preset selector). Helper live-edit
              hides this — helpers can move/reassign only. */}
          {role === 'owner' && (
            <button onClick={() => setPresetsOpen(true)} style={btnSecondary}>
              ⚙️ 套用 preset
            </button>
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

          {/* tables */}
          {normalizedTables.map((t) => {
            const isRound = t.shape === 'round';
            const w = isRound ? 80 : 160;
            const h = isRound ? 80 : 60;
            const o = occ[t.id];
            const filled = o ? o.filled : 0;
            const overflow = o && o.overflow > 0;
            const isDragging = dragState && dragState.tableId === t.id && dragState.moved;
            // P13.3 — live attendance pill (e.g. "已入座 7/8/12")
            const liveBadge = liveBadgeByTable[t.id];
            const livePill = formatLivePill(liveBadge);
            return (
              <g
                key={t.id}
                transform={`translate(${t.x}, ${t.y}) rotate(${t.rotation ?? 0} ${w / 2} ${h / 2})`}
                data-testid={`seating-table-${t.id}`}
                data-filled={filled}
                data-overflow={overflow ? 'true' : 'false'}
                style={{ cursor: isDragging ? 'grabbing' : 'grab', userSelect: 'none' }}
                onPointerDown={(e) => onTablePointerDown(e, t)}
                onDragOver={(e) => {
                  // Required so the drop event fires.
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const guestId = e.dataTransfer.getData('text/guestId');
                  if (!guestId) return;
                  onAssign(guestId, t.id, guestsById[guestId]?.name);
                }}
              >
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
                  y={h / 2 - 4}
                  fontSize={isRound ? "13" : "14"}
                  fontWeight="600"
                  fill="#0F766E"
                  textAnchor="middle"
                >
                  {t.label}
                </text>
                {/* Two-pill stack BELOW the table body (v4,
                    2026-09-18). User feedback after v3 shipped:
                    the inside-stack layout caused the pills to
                    visually crowd the label on round tables.
                    v4 mirrors the dietary-chip pattern: pills live
                    outside the table body, anchored below it. The
                    label takes the full center of the table for
                    breathing room; the count + category pills hang
                    off the bottom edge like a name tag.

                    Layout on round 80×80 (h=80):
                      y=36: label "T-01" (centered, 13px)
                      y=82: count pill (h=18) — sits just below
                            the south pole of the ellipse
                      y=102: category pill (h=14)
                      y=116: bottom edge of category pill
                      80→116 = 36px canvas padding consumed.

                    Layout on long 180×80 (h=80):
                      y=36: label "T-05" (centered, 14px)
                      y=82: count pill (h=20)
                      y=106: category pill (h=18)
                      y=124: bottom edge of category pill
                      80→124 = 44px canvas padding consumed.

                    The total height is 36px (round) and 44px (long)
                    which is more than the previous inside-table
                    layout but gives the label room to breathe.
                    Other tables in the floor plan typically have
                    ≥60px vertical separation so this fits. */}
                {(() => {
                  const countLabel = `${filled}/${t.capacity} 座位`;
                  const catLabel = t.tableCategory;
                  // Char-width estimator (PingFang TC at 10px):
                  // CJK=10, Latin/digit=5.5, punct=3, padding 12.
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
                  // Round tables get smaller pills because the
                  // canvas layout typically has tighter spacing;
                  // long tables get bigger pills for legibility.
                  const countH = isRound ? 18 : 20;
                  const catH = isRound ? 14 : 18;
                  const fontPx = isRound ? 10 : 11;
                  const catFontPx = isRound ? 9 : 10;
                  // Cap pill width: round can fit ~64px max
                  // inside its visible canvas footprint; long
                  // tables get the full label width.
                  const pillMaxW = isRound
                    ? Math.min(72, w)
                    : Math.min(140, w);
                  // Width per pill: round UP to nearest 4px so
                  // the border renders crisp at any zoom.
                  const countEstW = estW(countLabel);
                  const countW = Math.min(pillMaxW, Math.ceil(countEstW / 4) * 4);
                  const catEstW = estW(catLabel);
                  const catW = Math.min(pillMaxW, Math.ceil(catEstW / 4) * 4);
                  // Vertical position: anchored just below the
                  // table body's bottom edge (y = h). Small 2px
                  // gap to avoid touching the table border.
                  const countY = h + 2;
                  const catY = countY + countH + 2;
                  // Center horizontally.
                  const countX = (w - countW) / 2;
                  const catX = (w - catW) / 2;
                  return (
                    <>
                      {/* Count pill (row 1, below table) */}
                      <foreignObject
                        x={countX}
                        y={countY}
                        width={countW}
                        height={countH}
                      >
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
                      <foreignObject
                        x={catX}
                        y={catY}
                        width={catW}
                        height={catH}
                      >
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
                    </>
                  );
                })()}
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
                {/* Live attendance pill (P13.3, repositioned 2026-09-18
                    to option D — top-left inside the table body,
                    mirroring the dietary chip's top-right placement).
                    Only renders when at least one checked-in guest
                    exists for this table. The 4px inset keeps the
                    pill clear of the table body's stroke and, on
                    round tables, just inside the upper-left arc. */}
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
        />
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

function TableEditorModal({ initial, onSave, onCancel, onDelete }) {
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

function PresetSheet({ onPick, onCancel }) {
  return (
    <div role="dialog" style={modalBackdrop} onClick={onCancel}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0, color: '#0F766E' }}>套用 preset</h3>
        <p style={{ color: '#64748B', fontSize: 13 }}>一鍵生成整個 floor plan 嘅骨架</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 12 }}>
          <PresetCard
            title="中式 12 圍"
            description="主家席頂位 + 12 圍圓枱環繞舞台"
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
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <button onClick={onCancel} style={btnGhost}>取消</button>
        </div>
      </div>
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

function presetTables(style) {
  if (style === 'chinese') return chinesePreset();
  if (style === 'western') return westernPreset();
  return []; // custom = empty board
}

function chinesePreset() {
  // 1 head table + 12 圍 圓枱 arranged in a fan around the stage
  const rows = [];
  // 主家席 (small rectangle at top)
  rows.push({ id: 'p-c-bride', label: '主家席', shape: 'long', capacity: 12, tableCategory: 'bride_groom', x: 500, y: 80, rotation: 0 });
  // 證婚席
  rows.push({ id: 'p-c-ceremony', label: '證婚席', shape: 'rect', capacity: 8, tableCategory: 'ceremony', x: 540, y: 200, rotation: 0 });
  // 12 圍 around the dance floor
  const cx = 600, cy = 500;
  const ring = 240;
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2 - Math.PI / 2; // start from 12 o'clock
    const x = cx + Math.cos(angle) * ring - 40;
    const y = cy + Math.sin(angle) * ring * 0.7 - 40;
    rows.push({
      id: `p-c-${i + 1}`,
      label: `第 ${i + 1} 圍`,
      shape: 'round',
      capacity: 10,
      tableCategory: 'friends',
      x: Math.round(x), y: Math.round(y), rotation: 0,
    });
  }
  return rows;
}

function westernPreset() {
  const rows = [];
  // Head table
  rows.push({ id: 'p-w-head', label: 'Head Table', shape: 'long', capacity: 8, tableCategory: 'bride_groom', x: 700, y: 100, rotation: 0 });
  // Sweetheart
  rows.push({ id: 'p-w-sweet', label: '新郎新娘', shape: 'round', capacity: 2, tableCategory: 'bride_groom', x: 780, y: 220, rotation: 0 });
  // 8 long tables in 2 rows of 4
  const ys = [380, 600];
  ys.forEach((y, row) => {
    for (let c = 0; c < 4; c++) {
      rows.push({
        id: `p-w-${row}-${c}`,
        label: `T-${row * 4 + c + 1}`,
        shape: 'rect',
        capacity: 10,
        tableCategory: row === 0 && c === 0 ? 'groomsmen' : 'friends',
        x: 200 + c * 320, y, rotation: 0,
      });
    }
  });
  // Dance floor
  rows.push({ id: 'p-w-dance', label: '舞池', shape: 'rect', capacity: 0, tableCategory: 'ceremony', x: 720, y: 400, rotation: 0 });
  return rows;
}

function presetLabel(style) {
  if (style === 'chinese') return '中式 12 圍';
  if (style === 'western') return '西式 8 long';
  return '自訂空板';
}

/* ---------- styles ---------- */

const btnPrimary = {
  padding: '8px 16px',
  background: '#14B8A6',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
  fontWeight: 600,
};

const btnSecondary = {
  padding: '8px 12px',
  background: '#F0FDFA',
  color: '#0F766E',
  border: '1px solid #14B8A6',
  borderRadius: 8,
  cursor: 'pointer',
  fontWeight: 600,
};

const btnGhost = {
  padding: '8px 12px',
  background: 'transparent',
  color: '#64748B',
  border: '1px solid #E2E8F0',
  borderRadius: 8,
  cursor: 'pointer',
};

const btnDanger = {
  padding: '8px 12px',
  background: '#DC2626',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
};

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

const modalBackdrop = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
};

const modalCard = {
  background: '#FFFFFF',
  borderRadius: 12,
  padding: 20,
  width: 360,
  maxWidth: '95vw',
  maxHeight: '90vh',
  overflow: 'auto',
  boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
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
