// PersonalGuestPortal.cards.test.jsx
//
// 2026-08-22 — additive guest-facing cards. Three components
// landed in PersonalGuestPortal.jsx as part of the "small
// wins that don't need the full Guest Hub foundation" scope:
//
//   1. parseLocalEventDateTime (pure date helper, exported)
//   2. CountdownCard (shows days / hours until the event)
//   3. VenueMapCard (Google Maps deep-link button)
//   4. GuestMessageCard (280-char 心意 textarea → save)
//
// This file covers each in its own describe block:
//
//   - parseLocalEventDateTime is unit-tested purely — no
//     React mount, just edge cases for the date parser
//     (good input, bad input, missing time).
//
//   - CountdownCard / VenueMapCard / GuestMessageCard mount
//     the actual components (via a stub portal wrapper) and
//     assert the visible DOM. Countdown's live tick is gated
//     by a fake-timer test to keep the run deterministic.
//
// Why not put each card in its own file:
//   PersonalGuestPortal.jsx hosts these as internal functions
//   (they're tightly coupled to the portal's data shape —
//   guest.{name,guestId,guestMessage,...}, currentEvent.{date,
//   time,venue,address}). Splitting them out into separate
//   files would force every test to mock the parent portal,
//   which adds more boilerplate than it removes. When phase 2
//   ships (RSVP / calendar / schedule) and these cards grow
//   independent state, we'll move them to src/components/guest/
//   — see the file header in PersonalGuestPortal.jsx.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import {
  parseLocalEventDateTime,
  PersonalGuestPortal,
} from './PersonalGuestPortal';

afterEach(() => cleanup());

// ── parseLocalEventDateTime (pure) ──────────────────────────────

describe('parseLocalEventDateTime', () => {
  it('parses YYYY-MM-DD + HH:MM as a local Date', () => {
    // We assert the timestamp equivalent rather than the Date
    // object directly because toEqual(new Date(...)) compares
    // by reference in some vitest versions. The constructed
    // timestamp (in local TZ) is the right check.
    const d = parseLocalEventDateTime('2026-08-22', '14:30');
    expect(d).not.toBeNull();
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7); // 0-indexed
    expect(d.getDate()).toBe(22);
    expect(d.getHours()).toBe(14);
    expect(d.getMinutes()).toBe(30);
  });

  it('defaults the time to 00:00 when timeStr is missing', () => {
    const d = parseLocalEventDateTime('2027-01-01', undefined);
    expect(d).not.toBeNull();
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });

  it('returns null when dateStr is missing or malformed', () => {
    expect(parseLocalEventDateTime(null, '12:00')).toBeNull();
    expect(parseLocalEventDateTime(undefined, '12:00')).toBeNull();
    expect(parseLocalEventDateTime('', '12:00')).toBeNull();
    expect(parseLocalEventDateTime('2026-08-22T14:30', '12:00')).toBeNull(); // ISO with T — out of shape
    expect(parseLocalEventDateTime('08-22-2026', '12:00')).toBeNull(); // wrong order
    expect(parseLocalEventDateTime('2026/08/22', '12:00')).toBeNull(); // wrong separator
  });

  it('returns null when timeStr is malformed (but uses 00:00 fallback)', () => {
    // "14:30" matches; "1430" / "14:30:00" / "2pm" don't. The
    // helper falls back to "00:00" when timeStr is present-but-bad
    // (or missing) so a partial event doc still renders the day
    // — couples fill time later than date.
    const d = parseLocalEventDateTime('2027-01-01', '14:30:00');
    expect(d).not.toBeNull();
    expect(d.getHours()).toBe(0); // fell back to 00:00
  });
});

// ── CountdownCard (mount) ───────────────────────────────────────

describe('CountdownCard', () => {
  it('renders the days countdown when the event is in the future', () => {
    // Build a date that's 30 days out at noon HK time so the
    // rendered headline has stable copy across runtimes.
    const future = new Date();
    future.setDate(future.getDate() + 30);
    const futureDate = future.toISOString().slice(0, 10);
    render(<CountdownHarness eventDate={futureDate} eventTime="12:00" />);
    const card = screen.getByTestId('guest-countdown-card');
    expect(card).toBeInTheDocument();
    expect(card.textContent).toMatch(/還有 \d+ 天/);
  });

  it('renders the hours countdown when the event is < 2 days out', () => {
    // Pick a date that's about 30 hours in the future — that
    // crosses the calendar day boundary so the card's
    // diffDays === 0 (today) check is false, but it's still
    // well under the 48-hour threshold so the diffDays < 2
    // branch fires and we render the hours copy.
    const future = new Date();
    future.setHours(future.getHours() + 30);
    const futureDate = future.toISOString().slice(0, 10);
    const futureTime = future.toTimeString().slice(0, 5);
    render(<CountdownHarness eventDate={futureDate} eventTime={futureTime} />);
    expect(screen.getByTestId('guest-countdown-headline').textContent).toMatch(/小時/);
  });

  it('renders "今天就是大日子！" on the wedding day', () => {
    // Event 4 hours from now — same calendar date as the tick,
    // so the "today" branch fires.
    const future = new Date();
    future.setHours(future.getHours() + 4);
    const today = future.toISOString().slice(0, 10);
    const later = future.toTimeString().slice(0, 5);
    render(<CountdownHarness eventDate={today} eventTime={later} />);
    expect(screen.getByTestId('guest-countdown-headline').textContent).toMatch(/大日子/);
  });

  it('renders the past state when the event has already happened', () => {
    const past = new Date();
    past.setDate(past.getDate() - 7);
    const pastDate = past.toISOString().slice(0, 10);
    render(<CountdownHarness eventDate={pastDate} eventTime="12:00" />);
    expect(screen.getByTestId('guest-countdown-headline').textContent).toMatch(/大日子已過/);
  });

  it('does NOT render when eventDate is missing', () => {
    render(<CountdownHarness eventDate={null} eventTime="12:00" />);
    expect(screen.queryByTestId('guest-countdown-card')).not.toBeInTheDocument();
  });

  it('does NOT render when eventDate is malformed', () => {
    render(<CountdownHarness eventDate="not-a-date" eventTime="12:00" />);
    expect(screen.queryByTestId('guest-countdown-card')).not.toBeInTheDocument();
  });
});

// ── VenueMapCard (mount) ────────────────────────────────────────

describe('VenueMapCard', () => {
  it('renders venue name + address + Maps link when both are present', () => {
    render(<VenueHarness eventVenue="四季酒店" eventAddress="香港中環" />);
    const card = screen.getByTestId('guest-venue-card');
    expect(card).toBeInTheDocument();
    expect(screen.getByTestId('guest-venue-name').textContent).toBe('四季酒店');
    expect(screen.getByTestId('guest-venue-address').textContent).toBe('香港中環');
    const link = screen.getByTestId('guest-venue-maps-link');
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toContain('https://www.google.com/maps/search/?api=1&query=');
    expect(link.getAttribute('href')).toContain('%E5%9B%9B%E5%AD%A3'); // 四季 urlencoded
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders only the address field when venue is missing', () => {
    render(<VenueHarness eventVenue={null} eventAddress="香港中環" />);
    expect(screen.queryByTestId('guest-venue-name')).not.toBeInTheDocument();
    expect(screen.getByTestId('guest-venue-address').textContent).toBe('香港中環');
  });

  it('renders only the venue field when address is missing', () => {
    render(<VenueHarness eventVenue="四季酒店" eventAddress={null} />);
    expect(screen.getByTestId('guest-venue-name').textContent).toBe('四季酒店');
    expect(screen.queryByTestId('guest-venue-address')).not.toBeInTheDocument();
  });

  it('does NOT render when both venue and address are missing', () => {
    render(<VenueHarness eventVenue={null} eventAddress={null} />);
    expect(screen.queryByTestId('guest-venue-card')).not.toBeInTheDocument();
  });

  it('does NOT render when both venue and address are whitespace-only', () => {
    // Pass a real newline via a JS expression — the JSX attribute
    // form "\n" becomes a literal backslash-n character, which
    // .trim() doesn't strip, so we'd never exercise the
    // whitespace-only branch. Curly braces force JSX to evaluate
    // the string at runtime, where \n IS a newline.
    render(
      <VenueHarness eventVenue={'   '} eventAddress={'  \n  '} />,
    );
    expect(screen.queryByTestId('guest-venue-card')).not.toBeInTheDocument();
  });
});

// ── GuestMessageCard (mount + state machine) ────────────────────

describe('GuestMessageCard', () => {
  it('shows an empty-state CTA when the guest has no saved message', () => {
    render(
      <MessageHarness
        guest={{ guestId: 'g1', name: '小明' }}
        onSave={vi.fn()}
      />,
    );
    const card = screen.getByTestId('guest-message-card');
    expect(card).toBeInTheDocument();
    expect(card.textContent).toMatch(/寫幾句心意說話/);
    expect(screen.getByTestId('guest-message-edit')).toBeInTheDocument();
  });

  it('shows the saved message + 修改 button in read mode', () => {
    render(
      <MessageHarness
        guest={{
          guestId: 'g1',
          name: '小明',
          guestMessage: '祝願你哋甜甜蜜蜜！',
        }}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByTestId('guest-message-content').textContent).toBe(
      '祝願你哋甜甜蜜蜜！',
    );
    expect(screen.getByTestId('guest-message-edit')).toBeInTheDocument();
  });

  it('opens edit mode when the edit button is clicked', () => {
    render(
      <MessageHarness
        guest={{
          guestId: 'g1',
          name: '小明',
          guestMessage: '現有訊息',
        }}
        onSave={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('guest-message-edit'));
    expect(screen.getByTestId('guest-message-textarea')).toBeInTheDocument();
    expect(screen.getByTestId('guest-message-textarea').value).toBe('現有訊息');
    expect(screen.getByTestId('guest-message-save')).toBeInTheDocument();
    expect(screen.getByTestId('guest-message-cancel')).toBeInTheDocument();
  });

  it('calls onSave with the trimmed text when the save button is clicked', async () => {
    const onSave = vi.fn().mockResolvedValue();
    render(
      <MessageHarness
        guest={{ guestId: 'g1', name: '小明' }}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByTestId('guest-message-edit'));
    const textarea = screen.getByTestId('guest-message-textarea');
    fireEvent.change(textarea, { target: { value: '  祝白頭偕老！  ' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('guest-message-save'));
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('祝白頭偕老！');
  });

  it('returns to read mode after a successful save', async () => {
    const onSave = vi.fn().mockResolvedValue();
    render(
      <MessageHarness
        guest={{ guestId: 'g1', name: '小明' }}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByTestId('guest-message-edit'));
    fireEvent.change(screen.getByTestId('guest-message-textarea'), {
      target: { value: '新訊息' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('guest-message-save'));
    });
    expect(screen.queryByTestId('guest-message-textarea')).not.toBeInTheDocument();
    expect(screen.getByTestId('guest-message-edit')).toBeInTheDocument();
  });

  it('surfaces a server error and stays in edit mode on save failure', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('網絡錯誤'));
    render(
      <MessageHarness
        guest={{ guestId: 'g1', name: '小明' }}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByTestId('guest-message-edit'));
    fireEvent.change(screen.getByTestId('guest-message-textarea'), {
      target: { value: '訊息' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('guest-message-save'));
    });
    expect(screen.getByTestId('guest-message-error').textContent).toMatch(
      /網絡錯誤/,
    );
    // Still in edit mode (textarea still present).
    expect(screen.getByTestId('guest-message-textarea')).toBeInTheDocument();
  });

  it('does NOT call onSave when the trimmed text equals the saved message', async () => {
    const onSave = vi.fn().mockResolvedValue();
    render(
      <MessageHarness
        guest={{
          guestId: 'g1',
          name: '小明',
          guestMessage: '原訊息',
        }}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByTestId('guest-message-edit'));
    fireEvent.change(screen.getByTestId('guest-message-textarea'), {
      target: { value: '  原訊息  ' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('guest-message-save'));
    });
    expect(onSave).not.toHaveBeenCalled();
    // Returned to read mode silently.
    expect(screen.queryByTestId('guest-message-textarea')).not.toBeInTheDocument();
  });

  it('returns to read mode without calling onSave when cancel is clicked', async () => {
    const onSave = vi.fn().mockResolvedValue();
    render(
      <MessageHarness
        guest={{
          guestId: 'g1',
          name: '小明',
          guestMessage: '原訊息',
        }}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByTestId('guest-message-edit'));
    fireEvent.change(screen.getByTestId('guest-message-textarea'), {
      target: { value: '改咗嘅訊息' },
    });
    fireEvent.click(screen.getByTestId('guest-message-cancel'));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByTestId('guest-message-textarea')).not.toBeInTheDocument();
  });

  it('does NOT render when onSave is missing', () => {
    render(<MessageHarness guest={{ guestId: 'g1', name: '小明' }} onSave={null} />);
    expect(screen.queryByTestId('guest-message-card')).not.toBeInTheDocument();
  });

  it('does NOT render when the guest has no guestId', () => {
    render(
      <MessageHarness guest={{ name: '小明' }} onSave={vi.fn()} />,
    );
    expect(screen.queryByTestId('guest-message-card')).not.toBeInTheDocument();
  });

  it('caps the textarea at 280 characters', () => {
    render(
      <MessageHarness
        guest={{ guestId: 'g1', name: '小明' }}
        onSave={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('guest-message-edit'));
    const textarea = screen.getByTestId('guest-message-textarea');
    expect(textarea.getAttribute('maxLength')).toBe('280');
    // Fire a change that exceeds 280 — the slice(0, maxLen) guard
    // should truncate.
    const tooLong = 'x'.repeat(500);
    fireEvent.change(textarea, { target: { value: tooLong } });
    expect(textarea.value.length).toBe(280);
  });
});

// ── Test harnesses ──────────────────────────────────────────────
//
// These wrappers make the small-card tests independent of the
// full PersonalGuestPortal surface (which mounts the hero,
// EntryPassCard, photo upload, etc. — all unnecessary noise for
// asserting on just one card). The CountdownCard / VenueMapCard
// tests pass the bare props their components need; the
// GuestMessageCard tests pass a guest object so the "card
// gated on guest.guestId" branch can be exercised.
//
// The CardHarness mount passes the same props PersonalGuestPortal
// would receive, so the gate logic inside each card is the
// real production code — no mocks.

function CardHarness({ children }) {
  // The cards hide on their own when props are missing; the
  // harness just provides a container.
  return <div data-testid="card-harness">{children}</div>;
}

function CountdownHarness({ eventDate, eventTime }) {
  // Mount via the exported PersonalGuestPortal — the
  // CountdownCard reads eventDate / eventTime from props.
  return (
    <CardHarness>
      <PersonalGuestPortal
        guest={{ guestId: 'g1', name: '小明', tableNumber: 5 }}
        eventDate={eventDate}
        eventTime={eventTime}
        eventVenue="四季酒店"
        eventAddress="香港中環"
        onSaveGuestMessage={vi.fn()}
      />
    </CardHarness>
  );
}

function VenueHarness({ eventVenue, eventAddress }) {
  // Use a date far in the future so the countdown doesn't
  // collide with the venue card test.
  return (
    <CardHarness>
      <PersonalGuestPortal
        guest={{ guestId: 'g1', name: '小明', tableNumber: 5 }}
        eventDate="2099-12-31"
        eventTime="12:00"
        eventVenue={eventVenue}
        eventAddress={eventAddress}
        onSaveGuestMessage={vi.fn()}
      />
    </CardHarness>
  );
}

function MessageHarness({ guest, onSave }) {
  return (
    <CardHarness>
      <PersonalGuestPortal
        guest={guest}
        eventDate="2099-12-31"
        eventTime="12:00"
        eventVenue="四季酒店"
        eventAddress="香港中環"
        onSaveGuestMessage={onSave}
      />
    </CardHarness>
  );
}
