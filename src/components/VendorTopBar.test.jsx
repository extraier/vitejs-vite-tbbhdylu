// VendorTopBar.test.jsx
//
// 2026-08-21 — Manual bell audit follow-up. The main App header
// only renders when currentEvent is set (owners / co-owners).
// Vendors never had a currentEvent, so the header (and the bell
// inside it) disappeared on the vendor dashboard. The fix is a
// local sticky top bar in <VendorDashboard> that consolidates
// every vendor action + identity card into one visible chrome
// surface. This file guards the simple render rules:
//
//   1. Renders all three actions (manage, bell, logout) when
//      provided.
//   2. Renders the vendor name (left side) so the vendor always
//      knows which account is logged in.
//   3. Calls onManageProfile when the 管理專頁 button is clicked.
//   4. Skips the 管理專頁 button when onManageProfile is null.
//   5. Skips the logout button when onLogout is null.
//   6. Renders nothing when every action is hidden \u2014 the
//      identity card alone is not enough to justify the bar.
//   7. Truncates very long names instead of overflowing the bar.
//
// Why consolidate everything into the top bar:
//   Previously the 管理專頁 + 登出 buttons + 當前登入商戶 identity
//   card lived in a dark "商戶接單大堂" panel at the bottom of the
//   dashboard. Vendors had to scroll to find them. Consolidating
//   them into the top bar makes every action visible the moment
//   the vendor lands on the dashboard.

import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VendorTopBar } from './VendorTopBar';

const dummyBell = <button data-testid="dummy-bell">bell</button>;

describe('<VendorTopBar />', () => {
  it('renders all three actions (manage + bell + logout) when all are provided', () => {
    render(
      <VendorTopBar
        bell={dummyBell}
        onManageProfile={() => {}}
        onLogout={() => {}}
      />,
    );
    expect(screen.getByTestId('vendor-top-bar')).toBeInTheDocument();
    expect(screen.getByTestId('dummy-bell')).toBeInTheDocument();
    expect(screen.getByTestId('vendor-top-bar-logout')).toBeInTheDocument();
    expect(screen.getByTestId('vendor-top-bar-manage')).toBeInTheDocument();
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
