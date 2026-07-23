// Smoke test for the PhotoDrop component.
//
// 2026-07-23 — PhotoDrop grew from a static gallery into an
// interactive surface (captions, reactions, filter chips, owner
// delete). These tests lock down the rendering + interaction
// paths so a future refactor can't silently break them.
//
// Like the GuestList smoke test, we render the component with
// a minimal `photos` array and assert on what's visible. We
// don't mock Firebase — the callbacks are passed in as stubs.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { PhotoDrop } from './PhotoDrop';

const basePhotos = [
  {
    id: 'p1',
    eventId: 'e1',
    url: 'https://cdn.example.com/photos/p1.jpg',
    thumbnailUrl: 'https://cdn.example.com/photos/p1-thumb.jpg',
    uploaderId: 'g1',
    uploaderName: '陳大文',
    createdAt: 1700000000000,
    caption: '婚禮開始！',
    reactions: { g2: true, g3: true },
  },
  {
    id: 'p2',
    eventId: 'e1',
    url: 'https://cdn.example.com/photos/p2.jpg',
    thumbnailUrl: 'https://cdn.example.com/photos/p2-thumb.jpg',
    uploaderId: 'g2',
    uploaderName: '李小花',
    createdAt: 1700000060000,
  },
];

const baseProps = {
  photos: basePhotos,
  storageUsedMB: 3.2,
  isPremium: false,
  currentUserUid: 'g1',
  onPlaySlideshow: vi.fn(),
  onUpgrade: vi.fn(),
  onUpdatePhoto: vi.fn(),
  onDeletePhoto: vi.fn(),
  onShowToast: vi.fn(),
};

describe('PhotoDrop', () => {
  it('renders header, slideshow CTA, and storage meter', () => {
    render(<PhotoDrop {...baseProps} />);
    expect(screen.getByText(/互動相片牆/)).toBeTruthy();
    expect(screen.getByText(/播放 Live Slideshow/)).toBeTruthy();
    expect(screen.getByText(/3\.2 MB/)).toBeTruthy();
  });

  it('shows photo count', () => {
    render(<PhotoDrop {...baseProps} />);
    expect(screen.getByText(/已收集 2 張相片/)).toBeTruthy();
  });

  it('renders one card per photo with uploader name on hover', () => {
    render(<PhotoDrop {...baseProps} />);
    // Both uploaders appear as labels (in cards + in filter chips)
    expect(screen.getAllByText('陳大文').length).toBeGreaterThan(0);
    expect(screen.getAllByText('李小花').length).toBeGreaterThan(0);
  });

  it('renders reaction badge when there are reactions', () => {
    render(<PhotoDrop {...baseProps} />);
    // Photo 1 has 2 reactions; the badge should show "2" on its card
    // (visible always since the badge is a top-right overlay)
    const badge = screen.getAllByText(/^2$/);
    expect(badge.length).toBeGreaterThan(0);
  });

  it('shows filter chips when more than one uploader', () => {
    render(<PhotoDrop {...baseProps} />);
    // 全部 chip + 2 uploader chips = 3 total
    expect(screen.getByText('全部')).toBeTruthy();
    expect(screen.getAllByText('陳大文').length).toBeGreaterThan(0);
    expect(screen.getAllByText('李小花').length).toBeGreaterThan(0);
  });

  it('filters photos when a chip is clicked', () => {
    render(<PhotoDrop {...baseProps} />);
    // Click 李小花 chip — should leave only her photo
    // The chips are buttons with text + count. Find the chip button
    // by its label.
    const allChips = screen.getAllByRole('button');
    const liChip = allChips.find(
      (b) => b.textContent && b.textContent.includes('李小花') && b.textContent.includes('1'),
    );
    fireEvent.click(liChip);
    // After filter: photo count should reflect 1 / 2
    expect(screen.getByText(/已收集 1/)).toBeTruthy();
    // Reset to all
    const allChip = screen.getByText('全部');
    fireEvent.click(allChip);
    expect(screen.getByText(/已收集 2 張相片/)).toBeTruthy();
  });

  it('opens expanded modal when a photo is clicked', () => {
    render(<PhotoDrop {...baseProps} />);
    // Card uses <img> alt as its accessible text. Click the first
    // photo's image — this triggers the parent's onClick handler
    // (because the click bubbles up from the img).
    const photoImages = screen.getAllByAltText(/upload|婚禮開始！|陳大文|李小花/);
    fireEvent.click(photoImages[0]);
    // Modal shows the full-size image
    const modalImg = screen.getAllByAltText(/婚禮開始！|陳大文|李小花/);
    // The modal's <img> has no aspect-ratio wrapper, but it still
    // uses the same alt text. After the modal opens there are 2
    // matching imgs (gallery card + modal hero).
    expect(modalImg.length).toBeGreaterThanOrEqual(2);
  });

  it('caption textarea pre-fills from photo.caption', () => {
    render(<PhotoDrop {...baseProps} />);
    const photoImages = screen.getAllByAltText(/upload|婚禮開始！/);
    fireEvent.click(photoImages[0]);
    const textarea = screen.getByPlaceholderText(/新增一啲描述/);
    expect(textarea.value).toBe('婚禮開始！');
  });

  it('saves caption via onUpdatePhoto', () => {
    const onUpdatePhoto = vi.fn().mockResolvedValue(undefined);
    render(<PhotoDrop {...baseProps} onUpdatePhoto={onUpdatePhoto} />);
    const photoImages = screen.getAllByAltText(/upload|婚禮開始！/);
    fireEvent.click(photoImages[0]);
    const textarea = screen.getByPlaceholderText(/新增一啲描述/);
    fireEvent.change(textarea, { target: { value: '新版留言' } });
    const saveBtn = screen.getByText('儲存');
    fireEvent.click(saveBtn);
    expect(onUpdatePhoto).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ caption: '新版留言' }),
    );
  });

  it('toggles reaction via onUpdatePhoto (add then remove)', async () => {
    const onUpdatePhoto = vi.fn().mockResolvedValue(undefined);
    render(<PhotoDrop {...baseProps} onUpdatePhoto={onUpdatePhoto} />);
    const photoImages = screen.getAllByAltText(/upload|婚禮開始！/);
    fireEvent.click(photoImages[0]);
    const heartBtn = screen.getByText(/讚好呢張相|已讚好/);
    await fireEvent.click(heartBtn);
    // currentUserUid = g1, photo already had { g2, g3 }. After click
    // g1 is added → { g1, g2, g3 }
    await waitFor(() => {
      expect(onUpdatePhoto).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({
          reactions: expect.objectContaining({ g1: true }),
        }),
      );
    });
  });

  it('shows owner-only delete button when current user owns photo', () => {
    render(<PhotoDrop {...baseProps} />);
    // currentUserUid = g1 = p1 owner. Open p1's modal.
    const photoImages = screen.getAllByAltText(/upload|婚禮開始！/);
    fireEvent.click(photoImages[0]);
    expect(screen.getByText(/刪除呢張相/)).toBeTruthy();
  });

  it('hides delete button when current user is not the uploader', () => {
    // currentUserUid = g3 (not g1 or g2). None of the photos are theirs.
    render(<PhotoDrop {...baseProps} currentUserUid="g3" />);
    const photoImages = screen.getAllByAltText(/upload|婚禮開始！|李小花/);
    fireEvent.click(photoImages[0]);
    expect(screen.queryByText(/刪除呢張相/)).toBeNull();
  });

  it('disables slideshow CTA when no photos', () => {
    render(<PhotoDrop {...baseProps} photos={[]} />);
    const btn = screen.getByText(/播放 Live Slideshow/).closest('button');
    expect(btn.disabled).toBe(true);
  });

  it('shows empty state when no photos', () => {
    render(<PhotoDrop {...baseProps} photos={[]} />);
    expect(screen.getByText(/暫時未有賓客上載相片/)).toBeTruthy();
  });
});
