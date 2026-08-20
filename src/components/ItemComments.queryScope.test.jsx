import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.resolve(process.cwd(), 'src/components/ItemComments.jsx'),
  'utf8',
);

describe('ItemComments vendor subscription scope', () => {
  it('uses an equality query on the assigned vendor ID', () => {
    expect(source).toContain("currentRole === 'vendor'");
    expect(source).toContain("where('parentAssignedVendorUid', '==', currentUser.uid)");
  });

  it('resubscribes when the role or authenticated user changes', () => {
    expect(source).toContain('currentRole,');
    expect(source).toContain('currentUser?.uid,');
  });
});

// 2026-08-20 — Manus: regression tests for the bell-alert deep-link
// behaviour (focusedCommentId prop). These are source-grep tests like
// the ones above because the actual scrollIntoView + ring-highlight
// side effect requires a real DOM with reflow, which jsdom supports
// but is brittle to assert against. The contract is captured here so
// future edits can't silently break the hookup.
describe('ItemComments bell deep-link (focusedCommentId)', () => {
  it('accepts a focusedCommentId prop', () => {
    expect(source).toContain('focusedCommentId = null');
  });

  it('renders each comment with a stable data-comment-id attribute', () => {
    expect(source).toContain('data-comment-id={c.id}');
  });

  it('queries the DOM via [data-comment-id] selector in the deep-link effect', () => {
    expect(source).toContain('[data-comment-id="${safeId}"]');
  });

  it('uses CSS.escape with a regex fallback for non-browser test envs', () => {
    expect(source).toContain('typeof CSS.escape === \'function\'');
    expect(source).toContain('replace(/([^\\w-])/g,');
  });

  it('applies a rose-tinted highlight ring via Tailwind utilities', () => {
    expect(source).toContain('ring-rose-400');
    expect(source).toContain('bg-rose-50');
  });

  it('removes the highlight after a bounded timeout', () => {
      // Match `el.classList.remove(...)` followed within a few lines by
      // `}, 3000);` (the setTimeout that clears the highlight).
      expect(source).toMatch(/el\.classList\.remove\([\s\S]*?\}, 3000\);/);
    });
});
