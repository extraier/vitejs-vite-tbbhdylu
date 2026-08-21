// VendorTopBar.test.jsx
//
// 2026-08-21 — Manual bell audit follow-up. The main App header
// only renders when currentEvent is set (owners / co-owners).
// Vendors never had a currentEvent, so the header (and the bell
// inside it) disappeared on the vendor dashboard. The fix is a
// local sticky top bar in <VendorDashboard> that consolidates
// every vendor action + identity card + inbox badge into one
// visible chrome surface. This file guards the simple render
// rules:
//
//   1. Renders all four actions (manage, inbox, bell, logout)
//      when provided.
//   2. Renders the vendor name (left side) so the vendor always
//      knows which account is logged in.
//   3. Calls onManageProfile when the 管理專頁 button is clicked.
//   4. Calls onOpenInbox when the inbox icon is clicked.
//   5. Renders the inbox badge with the count when inboxCount > 0.
//   6. Caps the badge at "9+" for counts > 9.
//   7. Hides the badge entirely when inboxCount is 0.
//   8. Skips the 管理專頁 button when onManageProfile is null.
//   9. Skips the inbox button when onOpenInbox is null.
//  10. Skips the logout button when onLogout is null.
//  11. Renders nothing when every action is hidden \u2014 the
//      identity card alone is not enough to justify the bar.
//  12. Truncates very long names instead of overflowing the bar.
//
// Why consolidate everything into the top bar:
//   Previously the 管理專頁 + 登出 buttons + 當前登入商戶 identity
//   card lived in a dark "商戶接單大堂" panel at the bottom of the
//   dashboard, and the 客戶查詢收件箱 panel lived at the top of
//   the dashboard. Vendors had to scroll to find them. Consolidating
//   them into the top bar makes every action visible the moment
//   the vendor lands on the dashboard.

import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VendorTopBar } from './VendorTopBar';

const dummyBell = <button data-testid="dummy-bell">bell</button>;

describe('<VendorTopBar />', () => {
  it('renders all four actions (manage + inbox + bell + logout) when all are provided', () => {
    render(
      <VendorTopBar
        bell={dummyBell}
        onManageProfile={() => {}}
        onOpenInbox={() => {}}
        onLogout={() => {}}
      />,
    );
    expect(screen.getByTestId('vendor-top-bar')).toBeInTheDocument();
    expect(screen.getByTestId('dummy-bell')).toBeInTheDocument();
    expect(screen.getByTestId('vendor-top-bar-logout')).toBeInTheDocument();
    expect(screen.getByTestId('vendor-top-bar-manage')).toBeInTheDocument();
    expect(screen.getByTestId('vendor-top-bar-inbox')).toBeInTheDocument();
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

  it('fires onManageProfile when the 管理專頁 button is clicked', () => {
    const onManageProfile = vi.fn();
    render(
      <VendorTopBar
        bell={dummyBell}
        onManageProfile={onManageProfile}
      />,
    );
    fireEvent.click(screen.getByTestId('vendor-top-bar-manage'));
    expect(onManageProfile).toHaveBeenCalledTimes(1);
  });

  it('fires onOpenInbox when the inbox icon is clicked', () => {
    const onOpenInbox = vi.fn();
    render(
      <VendorTopBar
        bell={dummyBell}
        onOpenInbox={onOpenInbox}
      />,
    );
    fireEvent.click(screen.getByTestId('vendor-top-bar-inbox'));
    expect(onOpenInbox).toHaveBeenCalledTimes(1);
  });

  it('renders the inbox badge with the count when inboxCount > 0', () => {
    render(
      <VendorTopBar
        bell={dummyBell}
        onOpenInbox={() => {}}
        inboxCount={3}
      />,
    );
    const badge = screen.getByTestId('vendor-top-bar-inbox-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toBe('3');
  });

  it('caps the inbox badge at "9+" when the count exceeds 9', () => {
    render(
      <VendorTopBar
        bell={dummyBell}
        onOpenInbox={() => {}}
        inboxCount={42}
      />,
    );
    const badge = screen.getByTestId('vendor-top-bar-inbox-badge');
    expect(badge.textContent).toBe('9+');
  });

  it('hides the inbox badge when inboxCount is 0', () => {
    render(
      <VendorTopBar
        bell={dummyBell}
        onOpenInbox={() => {}}
        inboxCount={0}
      />,
    );
    expect(screen.getByTestId('vendor-top-bar-inbox')).toBeInTheDocument();
    expect(screen.queryByTestId('vendor-top-bar-inbox-badge')).not.toBeInTheDocument();
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

  it('does NOT render the 管理專頁 button when onManageProfile is null', () => {
    render(
      <VendorTopBar
        bell={dummyBell}
        onManageProfile={null}
      />,
    );
    expect(screen.getByTestId('vendor-top-bar')).toBeInTheDocument();
    expect(screen.getByTestId('dummy-bell')).toBeInTheDocument();
    expect(screen.queryByTestId('vendor-top-bar-manage')).not.toBeInTheDocument();
  });

  it('does NOT render the 管理專頁 button when showManageButton is false', () => {
    render(
      <VendorTopBar
        bell={dummyBell}
        onManageProfile={() => {}}
        showManageButton={false}
      />,
    );
    expect(screen.getByTestId('vendor-top-bar')).toBeInTheDocument();
    expect(screen.getByTestId('dummy-bell')).toBeInTheDocument();
    expect(screen.queryByTestId('vendor-top-bar-manage')).not.toBeInTheDocument();
  });

  it('does NOT render the inbox button when onOpenInbox is null', () => {
    render(
      <VendorTopBar
        bell={dummyBell}
        onOpenInbox={null}
      />,
    );
    expect(screen.getByTestId('vendor-top-bar')).toBeInTheDocument();
    expect(screen.getByTestId('dummy-bell')).toBeInTheDocument();
    expect(screen.queryByTestId('vendor-top-bar-inbox')).not.toBeInTheDocument();
  });

  it('does NOT render the inbox button when showInboxButton is false', () => {
    render(
      <VendorTopBar
        bell={dummyBell}
        onOpenInbox={() => {}}
        showInboxButton={false}
      />,
    );
    expect(screen.getByTestId('vendor-top-bar')).toBeInTheDocument();
    expect(screen.getByTestId('dummy-bell')).toBeInTheDocument();
    expect(screen.queryByTestId('vendor-top-bar-inbox')).not.toBeInTheDocument();
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

  it('renders nothing when every action is hidden (the identity card alone is not enough)', () => {
    const { container } = render(
      <VendorTopBar
        showManageButton={false}
        showInboxButton={false}
        showLogoutButton={false}
        vendorName="Testing Studio"
      />,
    );
    expect(container).toBeEmptyDOMElement();
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
