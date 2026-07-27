// Smoke test for PortfolioLightbox — focused on:
//   1. The index actually advances when the user navigates
//   2. addDoc is called exactly once per photo visit, NOT
//      per-arrow-key (the original bug: 10 photos × N keystrokes)
//   3. The displayed <img> renders the photo at the current index
//
// 2026-07-27 — regression guard for the consolidated-state and
// dedup-record-view fix. Renders the lightbox with 3 stub photos,
// walks through ArrowRight via the toolbar buttons (which the
// tests use to fire `click` events; React's keydown test path is
// flaky in jsdom), and verifies both the visible photo and the
// Firestore write count.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { addDoc } from 'firebase/firestore';

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    addDoc: vi.fn().mockResolvedValue({ id: 'doc-id' }),
    serverTimestamp: vi.fn(() => 'SERVER_TS'),
  };
});

// Stub the firebase singletons imported by PortfolioLightbox so
// the real `getFirestore(...)` chain doesn't blow up in jsdom.
// We can't fully mock `firebase/app` because the source imports
// a top-level `db` from '../../lib/firebase', which initializes
// the SDK at module load. The smoke test instead lets the SDK
// stub succeed at module load (no network calls happen until a
// snapshot listener fires; addDoc is intercepted above).
import { PortfolioLightbox } from './PortfolioLightbox';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const photos = [
  'https://cdn.example.com/p1.jpg',
  'https://cdn.example.com/p2.jpg',
  'https://cdn.example.com/p3.jpg',
];

const baseProps = {
  photos,
  initialIndex: 0,
  vendorSlug: 'vendor-1',
  viewerUid: 'viewer-1',
  onClose: vi.fn(),
};

describe('PortfolioLightbox', () => {
  it('shows the photo at the initial index', () => {
    render(<PortfolioLightbox {...baseProps} />);
    const imgs = screen.getAllByRole('img');
    // The <img> rendered into the lightbox should be p1.jpg.
    const hero = imgs.find((el) =>
      el.getAttribute('src') === photos[0],
    );
    expect(hero).toBeTruthy();
  });

  it('advances to the next photo on ArrowRight (toolbar button)', () => {
    render(<PortfolioLightbox {...baseProps} />);
    const nextBtn = screen.getByLabelText('下一張');
    fireEvent.click(nextBtn);
    const imgs2 = screen.getAllByRole('img');
    const hero = imgs2.find((el) =>
      el.getAttribute('src') === photos[1],
    );
    expect(hero).toBeTruthy();
  });

  it('advances backward on ArrowLeft (toolbar button)', () => {
    render(<PortfolioLightbox {...{ ...baseProps, initialIndex: 1 }} />);
    const prevBtn = screen.getByLabelText('上一張');
    fireEvent.click(prevBtn);
    const imgs = screen.getAllByRole('img');
    const hero = imgs.find((el) =>
      el.getAttribute('src') === photos[0],
    );
    expect(hero).toBeTruthy();
  });

  it('records exactly ONE analytics write per photo visit, not per click', () => {
    // open the lightbox → 1 write (initial photo)
    render(<PortfolioLightbox {...baseProps} />);
    expect(addDoc).toHaveBeenCalledTimes(1);

    // Advance twice via the next button: should be 3 writes total
    // (1 initial + 2 transitions). The pre-fix code wrote per
    // arrow + per click without deduping, so a long session
    // would create dozens of writes for the same image.
    fireEvent.click(screen.getByLabelText('下一張'));
    fireEvent.click(screen.getByLabelText('下一張'));
    expect(addDoc).toHaveBeenCalledTimes(3);

    // Going BACK once should not re-record the photo we landed on
    // (the new behaviour records once per visit; revisiting a
    // photo with the back button is intentionally NOT a "new visit").
    fireEvent.click(screen.getByLabelText('上一張'));
    expect(addDoc).toHaveBeenCalledTimes(3);
  });

  it('does not write analytics when the viewer is anonymous', () => {
    render(<PortfolioLightbox {...{ ...baseProps, viewerUid: undefined }} />);
    expect(addDoc).not.toHaveBeenCalled();
  });
});
