// 2026-08-20 — Manus bell observability handoff (audit §vendor-bell).
//
// Wraps the vendor dashboard's header bell so a render exception
// produces a retryable warning button instead of removing the bell
// entirely (which the user can't recover from without a page reload).
//
// Why a dedicated boundary (not the global ErrorBoundary.jsx)?
//   - resetKey is per-user-role (uid + role + enabled flag), so
//     navigating between owner/vendor dashboards re-mounts cleanly.
//   - onDiagnostic callback carries bell-specific context
//     (selfUid, role, enabled) for triage without exposing
//     notification text / invite tokens / raw Firestore docs.
//   - The global ErrorBoundary is for catastrophic crashes that
//     hide the whole shell; the bell boundary is for a single
//     component that we still want visible.
//
// React error boundaries only catch render + lifecycle + constructor
// exceptions. They DO NOT catch event-handler exceptions. For those,
// see handleItemClick in BellNotifications.jsx which wraps each
// click in try/catch and emits its own diagnostic.

import React from 'react';

// 2026-08-20 — diagnostic payload shape. Deliberately narrow:
// never include notification text, invite tokens, raw Firestore
// docs, or any user-generated content. Triage signal only.
function toDiagnostic(error, info, context) {
  return {
    area: 'vendor-notification-bell',
    stage: 'render',
    at: new Date().toISOString(),
    uid: context?.selfUid || null,
    role: context?.role || null,
    enabled: context?.enabled ?? null,
    message: error?.message ? String(error.message).slice(0, 240) : null,
    componentStack: info?.componentStack
      ? String(info.componentStack).split('\n').slice(0, 6).join(' | ')
      : null,
  };
}

export class VendorBellErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    const diagnostic = toDiagnostic(error, info, this.props.context);
    // eslint-disable-next-line no-console
    console.error('[vendor-bell] render failure', diagnostic);
    if (this.props.onDiagnostic) this.props.onDiagnostic(diagnostic);
  }

  // Reset when the parent signals a context change (uid/role/enabled
  // all flipped) — typical of navigating between owner dashboards,
  // switching role, or signing back in.
  componentDidUpdate(previousProps) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <button
        type="button"
        className="relative p-2 rounded-lg text-amber-700 bg-amber-50 hover:bg-amber-100"
        aria-label="通知暫時無法載入，按此重試"
        title="通知暫時無法載入，按此重試"
        onClick={() => this.setState({ error: null })}
      >
        <span aria-hidden="true">⚠️</span>
      </button>
    );
  }
}

export default VendorBellErrorBoundary;
