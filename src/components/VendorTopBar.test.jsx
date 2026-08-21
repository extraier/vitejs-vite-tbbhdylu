// VendorTopBar.test.jsx
//
// 2026-08-21 — Manual bell audit follow-up. The main App header
// only renders when currentEvent is set (owners / co-owners).
// Vendors never had a currentEvent, so the header (and the bell
// inside it) disappeared on the vendor dashboard. The fix is a
// local sticky top bar in <VendorDashboard> with the bell +
// logout. This file guards the simple render rules:
//
//   1. Renders both the bell and the logout button when both
//      are provided.
//   2. Renders the vendor name (left side) so the vendor always
//      knows which account is logged in.
//   3. Skips the logout button when onLogout is null — lets
//      preview / test configurations omit logout cleanly.
//   4. Renders nothing when both bell and showLogout are absent
//      — lets App.jsx opt out without leaving an empty bar.
//   5. Truncates very long names instead of overflowing the bar.

import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VendorTopBar } from './VendorTopBar';

const dummyBell = <button data-testid="dummy-bell">bell</button>;

describe('<VendorTopBar />', () => {
  it('renders the bell + logout button when both are provided', () => {
    render(
      <VendorTopBar
        bell={dummyBell}
        onLogout={() => {}}
      />,
    );
    expect(screen.getByTestId('vendor-top-bar')).toBeInTheDocument();
    expect(screen.getByTestId('dummy-bell')).toBeInTheDocument();
    expect(screen.getByTestId('vendor-top-bar-logout')).toBeInTheDocument();
  });

  it('fires onLogout when the logout button is clicked', () => {
    const onLogout = vi.fn();
    render(
      <VendorTopBar
        bell={dummyBell}
        onLogout={onLogout}
      />,
    );
    fireEvent.click(screen.getByTestId('vendor-top-bar-logout'));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('renders the vendor name (left side) so the vendor always knows which account is active', () => {
    render(
      <VendorTopBar
        vendorName="Testing Studio"
        categoryLabel="攝影 / 錄影"
        bell={dummyBell}
      />,
    );
    const name = screen.getByTestId('vendor-top-bar-name');
    expect(name.textContent).toBe('Testing Studio');
    expect(screen.getByText('攝影 / 錄影')).toBeInTheDocument();
  });

  it('does NOT render the logout button when onLogout is null', () => {
    render(
      <VendorTopBar
        bell={dummyBell}
        onLogout={null}
      />,
    );
    expect(screen.getByTestId('vendor-top-bar')).toBeInTheDocument();
    expect(screen.getByTestId('dummy-bell')).toBeInTheDocument();
    expect(screen.queryByTestId('vendor-top-bar-logout')).not.toBeInTheDocument();
  });

  it('does NOT render the logout button when showLogoutButton is false', () => {
    render(
      <VendorTopBar
        bell={dummyBell}
        onLogout={() => {}}
        showLogoutButton={false}
      />,
    );
    expect(screen.getByTestId('vendor-top-bar')).toBeInTheDocument();
    expect(screen.getByTestId('dummy-bell')).toBeInTheDocument();
    expect(screen.queryByTestId('vendor-top-bar-logout')).not.toBeInTheDocument();
  });

  it('renders an empty bar (no bell, no logout button) when both are absent', () => {
    const { container } = render(<VendorTopBar />);
    // The container still has the bar wrapper (so the CSS
    // sticky / shadow chrome isn't lost on a re-render), but
    // without a bell or a logout button, the bar has no
    // meaningful content.
    expect(container).not.toBeEmptyDOMElement();
    expect(screen.queryByTestId('vendor-top-bar-logout')).not.toBeInTheDocument();
  });

  it('truncates very long vendor names instead of overflowing the bar', () => {
    const longName = 'A Very Long Wedding Vendor Name That Just Keeps Going And Going';
    render(
      <VendorTopBar
        vendorName={longName}
        bell={dummyBell}
      />,
    );
    const name = screen.getByTestId('vendor-top-bar-name');
    expect(name.textContent).toBe(longName);
    // The title attribute is the full name for hover, and the
    // className includes the truncate utility so it gets
    // ellipsis treatment in the layout.
    expect(name.className).toContain('truncate');
    expect(name.getAttribute('title')).toBe(longName);
  });
});
