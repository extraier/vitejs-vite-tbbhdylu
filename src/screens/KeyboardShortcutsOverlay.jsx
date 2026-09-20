// 2026-09-20 — P13.4.5 a11y follow-up: keyboard-shortcut legend
// overlay. Owner can press "?" on the seating screen (or tap the
// keyboard icon in the header) to see every shortcut in one place.
// Lazy-loaded — operators rarely open it, so it doesn't need to
// be in the seating critical path. ~2 KB gz.

import { useEffect, useRef } from 'react';
import {
  SHORTCUTS,
  groupShortcuts,
  shouldHandleCanvasShortcut,
} from '../lib/seatingKeys';
import {
  modalBackdrop,
  modalCard,
  btnGhost,
} from './seatingModalStyles';

const CATEGORY_TITLES = {
  navigation: '🧭 導航',
  edit: '✏️ 編輯',
  view: '👁️ 檢視',
};

// Visual style for the keyboard cap. Inline to avoid leaking a
// constant set into the seating chunk — the overlay is the only
// place that needs it.
const keyCapStyle = {
  display: 'inline-block',
  minWidth: 28,
  padding: '2px 8px',
  margin: '0 2px',
  background: '#F1F5F9',
  border: '1px solid #CBD5E1',
  borderBottomWidth: 2,
  borderRadius: 4,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12,
  fontWeight: 600,
  color: '#0F172A',
  textAlign: 'center',
  lineHeight: '18px',
};

export default function KeyboardShortcutsOverlay({ onClose }) {
  const closeBtnRef = useRef(null);

  // Focus the close button on mount so the overlay is keyboard-
  // navigable immediately. Esc and the backdrop click both close.
  useEffect(() => {
    closeBtnRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const grouped = groupShortcuts(SHORTCUTS);
  // Preserve a deterministic category order even if the input
  // order drifts: navigation → edit → view → unknown.
  const order = ['navigation', 'edit', 'view'].filter((k) => grouped[k]?.length);
  const unknownKeys = Object.keys(grouped).filter((k) => !order.includes(k));
  const allOrder = [...order, ...unknownKeys];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
      data-testid="shortcuts-overlay"
      style={modalBackdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        style={{ ...modalCard, maxWidth: 560, padding: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #E2E8F0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <h3
            id="shortcuts-title"
            style={{ margin: 0, color: '#0F766E', fontSize: 16 }}
          >
            ⌨️ 快捷鍵一覽
          </h3>
          <button
            ref={closeBtnRef}
            onClick={onClose}
            data-testid="shortcuts-close"
            aria-label="關閉快捷鍵一覽"
            style={{
              ...btnGhost,
              padding: '4px 10px',
              fontSize: 14,
            }}
          >
            ✕
          </button>
        </div>

        {/* Body — grouped by category */}
        <div style={{ padding: '12px 20px', maxHeight: '60vh', overflowY: 'auto' }}>
          {allOrder.map((cat) => {
            const list = grouped[cat] || [];
            if (list.length === 0) return null;
            return (
              <section
                key={cat}
                data-testid={`shortcuts-group-${cat}`}
                style={{ marginBottom: 14 }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#64748B',
                    textTransform: 'uppercase',
                    letterSpacing: 1,
                    marginBottom: 6,
                  }}
                >
                  {CATEGORY_TITLES[cat] || cat}
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {list.map((s, i) => (
                    <li
                      key={`${cat}-${i}`}
                      data-testid={`shortcut-row-${s.keys.replace(/\s+/g, '-').toLowerCase()}`}
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: 10,
                        padding: '4px 0',
                        borderBottom:
                          i === list.length - 1 ? 'none' : '1px solid #F1F5F9',
                      }}
                    >
                      <div
                        style={{
                          minWidth: 110,
                          flexShrink: 0,
                        }}
                      >
                        {s.keys.split(' ').map((part, j, arr) => (
                          <span key={j}>
                            {part.split('').map((ch, k) => (
                              <kbd key={k} style={keyCapStyle}>{ch}</kbd>
                            ))}
                            {j < arr.length - 1 && (
                              <span style={{ color: '#94A3B8', fontSize: 10, margin: '0 2px' }}>+</span>
                            )}
                          </span>
                        ))}
                      </div>
                      <div style={{ flex: 1, fontSize: 13, color: '#0F172A' }}>
                        <strong style={{ display: 'block', fontWeight: 600 }}>
                          {s.label}
                        </strong>
                        <span style={{ color: '#64748B', fontSize: 12 }}>{s.hint}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          <div
            style={{
              marginTop: 12,
              padding: 8,
              background: '#F0FDF4',
              border: '1px solid #BBF7D0',
              borderRadius: 6,
              fontSize: 12,
              color: '#065F46',
            }}
          >
            💡 <strong>提示：</strong>有啲快捷鍵需要先用 Tab 揀一張枱先會生效（例如 Delete、方向鍵）。
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '10px 20px',
            borderTop: '1px solid #E2E8F0',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            onClick={onClose}
            data-testid="shortcuts-close-footer"
            style={btnGhost}
          >
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}

// Re-export for unit tests / direct consumers.
export { shouldHandleCanvasShortcut };
