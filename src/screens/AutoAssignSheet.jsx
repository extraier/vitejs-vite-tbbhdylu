// 2026-09-20 — P13.4.5 perf: extracted from CoupleSeating.jsx
// so it can be lazy-loaded via React.lazy + Suspense.
//
// Behavior is unchanged from the inline version: shows
// unassigned guests (guests - assignments) along with the
// top 3 candidate tables for each, the operator can either
// tap one row at a time or hit "一鍵擺晒" to run autoAssign
// against the whole list. New assignments are written via
// the same path the drag-drop uses.

import {
  occupancy,
  suggestTargetTables,
} from '../lib/seatingPure';
import { modalBackdrop, modalCard, btnGhost, btnPrimary } from './seatingModalStyles';

export default function AutoAssignSheet({
  unassigned,
  tables,
  assignments,
  guestsById,
  onPick,
  onPickAll,
  onCancel,
}) {
  const totalCapacity = tables.reduce(
    (sum, t) => sum + (t.capacity > 0 ? t.capacity - (occupancy(
      tables, assignments, guestsById,
    )[t.id]?.filled ?? 0) : 0),
    0,
  );
  const overviews = unassigned.map((u) => {
    const candidates = suggestTargetTables(tables, assignments, {
      category: u.category,
      prefer: 'tightest',
    });
    return { guest: u, candidates: candidates.slice(0, 3) };
  });
  const orphansAfterFit = unassigned.length - Math.min(unassigned.length, totalCapacity);
  const hasOrphansPending = overviews.some((o) => o.candidates.length === 0);
  return (
    <div role="dialog" style={modalBackdrop} onClick={onCancel}>
      <div
        style={{ ...modalCard, maxWidth: 640, maxHeight: '80vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginTop: 0, color: '#0F766E' }}>🎯 自動排位</h3>
        <p style={{ color: '#64748B', fontSize: 13 }}>
          將 <strong>{unassigned.length}</strong> 位未分配嘅賓客自動擺入仍有空位嘅枱。
          {' '}
          目前總共仲有 <strong>{totalCapacity}</strong> 個空位。
          {orphansAfterFit > 0 && (
            <span style={{ color: '#DC2626' }}>
              {' '}如果全部賓客都嚟，仍會有 <strong>{orphansAfterFit}</strong> 位孤兒。
            </span>
          )}
        </p>

        {unassigned.length === 0 ? (
          <div
            data-testid="auto-assign-empty"
            style={{
              padding: 24,
              textAlign: 'center',
              color: '#94A3B8',
              background: '#F8FAFC',
              borderRadius: 8,
              margin: '16px 0',
            }}
          >
            全部賓客都已分配 🎉
          </div>
        ) : (
          <div
            data-testid="auto-assign-list"
            style={{ marginTop: 12, display: 'grid', gap: 8 }}
          >
            {overviews.map(({ guest: g, candidates }) => (
              <div
                key={g.id}
                data-testid={`auto-assign-row-${g.id}`}
                style={{
                  padding: 8,
                  border: '1px solid #E2E8F0',
                  borderRadius: 6,
                  background: candidates.length === 0 ? '#FEF2F2' : 'white',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>
                    <strong>{g.name || `賓客 ${g.id}`}</strong>
                    {g.category && (
                      <span
                        style={{
                          marginLeft: 6,
                          fontSize: 10,
                          padding: '0 4px',
                          background: '#E0F2FE',
                          color: '#0369A1',
                          borderRadius: 3,
                        }}
                      >
                        {g.category}
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: 11, color: '#64748B' }}>
                    {candidates.length === 0
                      ? '❌ 冇適合嘅枱'
                      : `${candidates.length} 張候選`}
                  </span>
                </div>
                {candidates.length > 0 && (
                  <ul
                    style={{
                      margin: '4px 0 0 0',
                      paddingLeft: 16,
                      fontSize: 12,
                      color: '#475569',
                    }}
                  >
                    {candidates.map((c) => (
                      <li key={c.table.id}>
                        {c.table.label} · 仲有{' '}
                        <strong style={{ color: c.remaining <= 2 ? '#EA580C' : '#0F766E' }}>
                          {c.remaining}
                        </strong>{' '}
                        位{' '}
                        {c.reasons.categoryMatch ? '' : '⚠️ 類別唔啱'}
                        <button
                          type="button"
                          data-testid={`auto-assign-pick-${g.id}-${c.table.id}`}
                          onClick={() => onPick(g, c.table)}
                          style={{
                            marginLeft: 8,
                            fontSize: 11,
                            padding: '2px 6px',
                            border: '1px solid #14B8A6',
                            background: 'white',
                            color: '#0F766E',
                            borderRadius: 3,
                            cursor: 'pointer',
                          }}
                        >
                          擺呢張
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={btnGhost}>取消</button>
          {unassigned.length > 0 && (
            <button
              onClick={onPickAll}
              data-testid="auto-assign-pick-all"
              disabled={totalCapacity <= 0}
              style={{
                ...btnPrimary,
                opacity: totalCapacity <= 0 ? 0.5 : 1,
                cursor: totalCapacity <= 0 ? 'not-allowed' : 'pointer',
              }}
            >
              🚀 一鍵擺晒 {hasOrphansPending && orphansAfterFit > 0
                ? `(${orphansAfterFit} 位孤兒)`
                : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
