// Smoke tests for EventSettingsModal.
//
// Covers:
//   1. Renders the 新人名稱 heading from inside OwnerNamesEditor
//   2. Pre-fills 新郎/新娘 from useEventOwnerNames
//   3. Calls onClose when the close button is clicked
//   4. Renders nothing when open=false
//
// 2026-08-01 — Initial release. Modal exposes OwnerNamesEditor
// for the couple's display names. Venue + date sections deferred
// to follow-up commits per user direction.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { EventSettingsModal } from './EventSettingsModal';

// Mock useEventOwnerNames so tests can control what the editor sees.
// The real hook is smoke-tested at
// src/hooks/useEventOwnerNames.smoke.test.jsx.
const mockOwnerNames = { boyName: '志明', girlName: '春嬌' };
const mockSaveOwnerNames = vi.fn().mockResolvedValue({ ok: true });
const mockUseEventOwnerNames = vi.fn(() => ({
  ownerNames: mockOwnerNames,
  saveOwnerNames: mockSaveOwnerNames,
  loading: false,
}));

vi.mock('../../hooks/useEventOwnerNames', () => ({
  useEventOwnerNames: (...args) => mockUseEventOwnerNames(...args),
}));

beforeEach(() => {
  cleanup();
  mockOwnerNames.boyName = '志明';
  mockOwnerNames.girlName = '春嬌';
  mockSaveOwnerNames.mockClear();
  mockSaveOwnerNames.mockResolvedValue({ ok: true });
  mockUseEventOwnerNames.mockClear();
  mockUseEventOwnerNames.mockImplementation(() => ({
    ownerNames: mockOwnerNames,
    saveOwnerNames: mockSaveOwnerNames,
    loading: false,
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
});

const baseProps = {
  open: true,
  onClose: vi.fn(),
  currentUser: { uid: 'test-uid' },
  currentEvent: { id: 'evt-1', name: '我們的婚禮' },
  onToast: vi.fn(),
};

describe('EventSettingsModal', () => {
  it('renders the 新人名稱 heading', () => {
    render(<EventSettingsModal {...baseProps} />);
    expect(screen.getByText('新人名稱')).toBeTruthy();
  });

  it('pre-fills 新郎/新娘 from useEventOwnerNames', () => {
    render(<EventSettingsModal {...baseProps} />);
    expect(screen.getByLabelText('新郎').value).toBe('志明');
    expect(screen.getByLabelText('新娘').value).toBe('春嬌');
  });

  it('renders nothing when open=false', () => {
    const { container } = render(
      <EventSettingsModal {...baseProps} open={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<EventSettingsModal {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('關閉'));
    expect(onClose).toHaveBeenCalled();
  });

  it('passes currentUser.uid and currentEvent.id into useEventOwnerNames', () => {
    render(
      <EventSettingsModal
        {...baseProps}
        currentUser={{ uid: 'uid-XYZ' }}
        currentEvent={{ id: 'evt-42', name: '大婚之日' }}
      />,
    );
    expect(mockUseEventOwnerNames).toHaveBeenCalledWith('evt-42', 'uid-XYZ');
  });
});
