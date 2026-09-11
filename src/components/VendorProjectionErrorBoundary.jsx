// 2026-09-11 — P12.3 per-event projection error boundary.
//
// Each <VendorRundownProjection> instance is mounted inside one
// of these boundaries so a synchronous render crash in a single
// per-event listener cannot take down the assigned-rows panel
// or the bell. The boundary renders `fallback` (default null)
// on caught error and forwards the error to an optional
// `onError` callback for diagnostic logging.
//
// Why a dedicated component (and not the existing
// <ErrorBoundary/> in src/components/ErrorBoundary.jsx)?
//   1. The existing boundary ALWAYS renders a full-page
//      "系統發生錯誤" diagnostic block. That would visually
//      blow up a vendor dashboard that is otherwise rendering
//      normally.
//   2. The existing boundary has no `fallback` prop and no
//      `onError` callback. We need both for the per-event
//      isolation pattern.
//
// The component is intentionally tiny — it's a thin wrapper
// around React.Component's `componentDidCatch` lifecycle. No
// state machine, no retry button (the projection listener
// auto-retries via Firestore's reconnect logic; the boundary
// just removes the failed subtree).

import React from 'react';

export class VendorProjectionErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Forward to the caller's diagnostic handler so App.jsx
    // can log + surface. We deliberately do not re-setState —
    // the boundary already transitions to the fallback render.
    if (typeof this.props.onError === 'function') {
      try {
        this.props.onError(error, info, this.props);
      } catch {
        // Never let an onError handler crash the boundary.
      }
    }
  }

  render() {
    if (this.state.hasError) {
      // Default fallback = null. The parent decides what to
      // render (a tiny placeholder, nothing, etc.).
      if (this.props.fallback !== undefined) {
        return this.props.fallback;
      }
      return null;
    }
    return this.props.children;
  }
}

export default VendorProjectionErrorBoundary;
