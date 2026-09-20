// 2026-09-20 — P13.4.5 a11y follow-up: pure helpers for the
// seating-screen keyboard shortcuts. Kept in src/lib/ so the
// KeyboardShortcutsOverlay component (lazy-loaded) and the
// seating canvas's onSvgKeyDown handler both pull from a
// single source of truth — adding a new shortcut means
// updating the SHORTCUTS array, nothing else.
//
// Why a separate module:
//   - Testable without jsdom (the dispatcher only does math
//     and object construction).
//   - Single source of truth: the overlay's "what shortcuts
//     exist?" list and the canvas's "what does each key do?"
//     dispatcher can never drift.
//   - Tiny (~70 LOC) so it doesn't bloat the seating chunk.

export interface Shortcut {
  keys: string;
  label: string;
  hint: string;
  category: 'navigation' | 'edit' | 'view' | string;
}

export type ShortcutGroup = Record<string, Shortcut[]>;

/**
 * Canonical list of seating-screen keyboard shortcuts.
 *
 * Each entry has:
 *   keys:    string — the printable key combo, e.g. "Tab",
 *            "Shift + Tab", "←", "Shift + ←", "?", "Esc"
 *   label:   string — short Chinese label for the overlay
 *   hint:    string — one-line description
 *   category: string — "navigation" | "edit" | "view"
 *
 * The order here is the order shown in the overlay.
 */
export const SHORTCUTS: Shortcut[] = [
  {
    keys: 'Tab',
    label: '下一張枱',
    hint: '循環跳到下一張枱（用 Tab focus 預覽）',
    category: 'navigation',
  },
  {
    keys: 'Shift + Tab',
    label: '上一張枱',
    hint: '循環跳到上一張枱',
    category: 'navigation',
  },
  {
    keys: '↑ ↓ ← →',
    label: '微調位置',
    hint: '以 10px 為單位移動當前選中嘅枱',
    category: 'edit',
  },
  {
    keys: 'Shift + ↑↓←→',
    label: '快速移動',
    hint: '以 40px 為單位移動當前選中嘅枱',
    category: 'edit',
  },
  {
    keys: 'Enter',
    label: '編輯枱',
    hint: '打開枱嘅編輯器（人數、容量、標籤…）',
    category: 'edit',
  },
  {
    keys: 'Delete',
    label: '刪除枱',
    hint: '刪除當前選中嘅枱（賓客會變成未分配）',
    category: 'edit',
  },
  {
    keys: 'Esc',
    label: '取消 focus',
    hint: '放棄當前枱嘅 focus',
    category: 'navigation',
  },
  {
    keys: '?',
    label: '快捷鍵一覽',
    hint: '顯示呢個 overlay',
    category: 'view',
  },
];

/**
 * Group shortcuts by category for the overlay rendering.
 * Pure: same input → same output.
 */
export function groupShortcuts(shortcuts: Shortcut[] = SHORTCUTS): ShortcutGroup {
  const out: ShortcutGroup = { navigation: [], edit: [], view: [] };
  for (const s of shortcuts) {
    if (!out[s.category]) out[s.category] = [];
    out[s.category].push(s);
  }
  return out;
}

interface KeyboardEventLike {
  target?: { closest?: (sel: string) => unknown };
}

/**
 * Should the seating canvas treat the current key event as a
 * shortcut, or as text input? We let through any event whose
 * target is an `<input>`, `<textarea>`, or `contenteditable`
 * element — so typing "?" into the search box doesn't open
 * the overlay. Returns true when the event should be handled
 * by the canvas dispatcher.
 */
export function shouldHandleCanvasShortcut(e: KeyboardEventLike | null | undefined): boolean {
  if (!e || !e.target || typeof e.target.closest !== 'function') return true;
  const target = e.target;
  if (target.closest('input, textarea, [contenteditable="true"]')) return false;
  return true;
}
