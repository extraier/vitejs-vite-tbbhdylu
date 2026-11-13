import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nextVendorView } from './vendorRoute';

describe('nextVendorView', () => {
  it('sends a returning vendor from the couple dashboard to the vendor dashboard once', () => {
    expect(nextVendorView({
      isVendor: true,
      alreadyRouted: false,
      currentView: 'events-dashboard',
    })).toEqual({
      role: 'vendor',
      view: 'vendor-dashboard',
      routed: true,
    });
  });

  it('keeps the onboarding success screen and the profile editor', () => {
    expect(nextVendorView({
      isVendor: true,
      alreadyRouted: false,
      currentView: 'vendor-onboarding',
    }).view).toBe('vendor-onboarding');
    expect(nextVendorView({
      isVendor: true,
      alreadyRouted: false,
      currentView: 'vendor-profile',
    }).view).toBe('vendor-profile');
  });

  it('does not yank a vendor off their current screen when the token refreshes', () => {
    expect(nextVendorView({
      isVendor: true,
      alreadyRouted: true,
      currentView: 'vendor-profile',
    }).view).toBe('vendor-profile');
    expect(nextVendorView({
      isVendor: true,
      alreadyRouted: true,
      currentView: 'chat-room',
    }).view).toBe('chat-room');
  });

  it('does not route someone who is not a vendor', () => {
    expect(nextVendorView({
      isVendor: false,
      alreadyRouted: false,
      currentView: 'events-dashboard',
    })).toEqual({
      role: null,
      view: 'events-dashboard',
      routed: false,
    });
  });
});

describe('vendor auto-route wiring', () => {
  it('decides the next view instead of forcing the dashboard on every user change', () => {
    const src = readFileSync(join(process.cwd(), 'src/App.jsx'), 'utf8');
    expect(src).toContain('nextVendorView(');
    expect(src).toContain('vendorRouteRef.current.uid === user.uid');
    expect(src).not.toContain("if (currentView !== 'vendor-dashboard')");
  });
});
