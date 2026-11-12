// Views a vendor may already be on when the vendor claim is first
// observed, or when the ID token refreshes. Token refresh replaces the
// user object; that must not bounce them back to the dashboard.

const VIEWS_TO_KEEP = ['vendor-onboarding', 'vendor-profile'];

export function nextVendorView({ isVendor, alreadyRouted, currentView }) {
  if (!isVendor) {
    return { role: null, view: currentView, routed: false };
  }
  if (alreadyRouted) {
    return { role: 'vendor', view: currentView, routed: true };
  }
  const keep = VIEWS_TO_KEEP.includes(currentView);
  return {
    role: 'vendor',
    view: keep ? currentView : 'vendor-dashboard',
    routed: true,
  };
}
