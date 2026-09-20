// 2026-09-20 — P13.4.5 perf: shared modal/button styles
// extracted from CoupleSeating.jsx so BudgetSheet and
// AutoAssignSheet can be lazy-loaded as separate chunks
// without each redefining the same style objects. The styles
// are pure data (no React hooks, no DOM), so they're safe
// to import from a code-split module — they contribute
// ~0 KB gz to the seating critical path after lazy().
//
// Anything that's NOT in this module is intentionally kept
// in CoupleSeating.jsx (e.g. label/input — used only by the
// inline GuestPanel and TableEditorModal that aren't
// lazy-loaded).

export const modalBackdrop = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
};

export const modalCard = {
  background: '#FFFFFF',
  borderRadius: 12,
  padding: 20,
  width: 360,
  maxWidth: '95vw',
  maxHeight: '90vh',
  overflow: 'auto',
  boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
};

export const btnPrimary = {
  padding: '8px 16px',
  background: '#14B8A6',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
  fontWeight: 600,
};

export const btnSecondary = {
  padding: '8px 12px',
  background: '#F0FDFA',
  color: '#0F766E',
  border: '1px solid #14B8A6',
  borderRadius: 8,
  cursor: 'pointer',
  fontWeight: 600,
};

export const btnGhost = {
  padding: '8px 12px',
  background: 'transparent',
  color: '#64748B',
  border: '1px solid #E2E8F0',
  borderRadius: 8,
  cursor: 'pointer',
};

export const btnDanger = {
  padding: '8px 12px',
  background: '#DC2626',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
};
