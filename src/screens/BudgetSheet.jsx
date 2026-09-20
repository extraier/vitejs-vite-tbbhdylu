// 2026-09-20 — P13.4.5 perf: extracted from CoupleSeating.jsx
// so it can be lazy-loaded via React.lazy + Suspense.
//
// Behavior is unchanged from the inline version: shows the
// cost-per-head + budget-cap form, with HK-style preset chips
// for the cap ($50k / $100k / $150k / $200k / $300k), a 自訂
// toggle that focuses the number input, and a live budget
// summary that flips from green to red when the operator
// types over the cap.

import { useState } from 'react';
import { computeBudget, formatHKD } from '../lib/seatingPure';
import { modalBackdrop, modalCard, btnGhost, btnPrimary } from './seatingModalStyles';

const PRESETS = [50000, 100000, 150000, 200000, 300000];

export default function BudgetSheet({
  costPerHead,
  budgetCap,
  summary,
  onSave,
  onCancel,
}) {
  const [cph, setCph] = useState(costPerHead);
  const [cap, setCap] = useState(budgetCap);
  // Live re-compute as the operator types. We pass empty
  // tables/assignments because we only care about the math
  // against cph/cap (the actual data lives in the `summary`
  // prop above).
  const live = computeBudget([], [], { costPerHead: cph, budgetCap: cap });
  const save = () => onSave({ costPerHead: cph, budgetCap: cap });
  return (
    <div role="dialog" style={modalBackdrop} onClick={onCancel}>
      <div
        style={{ ...modalCard, maxWidth: 480 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginTop: 0, color: '#0F766E' }}>💰 預算設定</h3>
        <p style={{ color: '#64748B', fontSize: 13 }}>
          設定每位賓客成本同預算上限。已分配嘅賓客數 × 成本 = 預估支出。
        </p>
        <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
          <label style={{ display: 'block' }}>
            <span style={{ fontSize: 12, color: '#475569', display: 'block', marginBottom: 4 }}>
              每人成本 (HKD)
            </span>
            <input
              type="number"
              min="0"
              step="50"
              data-testid="budget-cph-input"
              value={cph}
              onChange={(e) => setCph(Math.max(0, Number(e.target.value) || 0))}
              style={{
                width: '100%', padding: '8px 10px', fontSize: 14,
                border: '1px solid #CBD5E1', borderRadius: 6,
                boxSizing: 'border-box',
              }}
            />
            <span style={{ fontSize: 11, color: '#94A3B8' }}>
              預設 $800 (HK 中式婚宴標準)
            </span>
          </label>
          <label style={{ display: 'block' }}>
            <span style={{ fontSize: 12, color: '#475569', display: 'block', marginBottom: 4 }}>
              預算上限 (HKD) — 留 0 = 不設上限
            </span>
            {/* P13.4.1 refine — preset cap chips. Most HK banquet
                costs land in $50-200k. One tap sets the cap
                instead of typing. 自訂 toggle reveals the number
                input. The chips affect only budgetCap; costPerHead
                stays editable above. */}
            <div
              data-testid="budget-cap-chips"
              style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}
            >
              {PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  data-testid={`budget-cap-chip-${preset / 1000}k`}
                  onClick={() => setCap(preset)}
                  style={{
                    padding: '4px 10px',
                    fontSize: 12,
                    fontWeight: 600,
                    border: cap === preset ? '1.5px solid #0F766E' : '1px solid #CBD5E1',
                    background: cap === preset ? '#0F766E' : 'white',
                    color: cap === preset ? 'white' : '#475569',
                    borderRadius: 6,
                    cursor: 'pointer',
                  }}
                >
                  {formatHKD(preset, { short: true })}
                </button>
              ))}
              <button
                type="button"
                data-testid="budget-cap-chip-custom"
                onClick={() => {
                  const inp = document.getElementById('budget-cap-number-input');
                  if (inp) inp.focus();
                }}
                style={{
                  padding: '4px 10px',
                  fontSize: 12,
                  fontWeight: 600,
                  border: !PRESETS.includes(cap) && cap > 0
                    ? '1.5px solid #0F766E'
                    : '1px solid #CBD5E1',
                  background: !PRESETS.includes(cap) && cap > 0
                    ? '#0F766E'
                    : 'white',
                  color: !PRESETS.includes(cap) && cap > 0
                    ? 'white'
                    : '#475569',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                自訂
              </button>
            </div>
            <input
              id="budget-cap-number-input"
              type="number"
              min="0"
              step="1000"
              data-testid="budget-cap-input"
              value={cap}
              onChange={(e) => setCap(Math.max(0, Number(e.target.value) || 0))}
              style={{
                width: '100%', padding: '8px 10px', fontSize: 14,
                border: '1px solid #CBD5E1', borderRadius: 6,
                boxSizing: 'border-box',
              }}
            />
          </label>
          <div
            data-testid="budget-summary"
            style={{
              padding: 12,
              background: live.overBudget ? '#FEF2F2' : '#F0FDF4',
              border: '1px solid ' + (live.overBudget ? '#DC2626' : '#14B8A6'),
              borderRadius: 8,
              fontSize: 13,
            }}
          >
            <div>
              <strong>已分配 {summary.totalFilled} 人</strong>
              <span style={{ color: '#64748B' }}>
                {' '}/ {summary.totalCapacity} 位
              </span>
            </div>
            <div style={{ marginTop: 4 }}>
              預估支出:{' '}
              <strong>{formatHKD(summary.projectedCost)}</strong>
            </div>
            {cap > 0 && (
              <div style={{ marginTop: 4, color: live.overBudget ? '#991B1B' : '#065F46' }}>
                {live.overBudget ? '⚠️ 超支' : '✓ 在預算內'} · 餘額{' '}
                {formatHKD(Math.abs(live.remaining))} ({100 - live.percentUsed}%)
              </div>
            )}
          </div>
        </div>
        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={btnGhost}>取消</button>
          <button
            onClick={save}
            data-testid="budget-save"
            style={btnPrimary}
          >
            💾 儲存
          </button>
        </div>
      </div>
    </div>
  );
}
