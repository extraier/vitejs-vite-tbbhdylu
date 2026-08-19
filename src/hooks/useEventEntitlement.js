// 2026-08-19 — Manus P1.2: client-side hook for the canonical
// event-scoped entitlement resolver.
//
// Wraps the getEventEntitlement Cloud Function. Components
// that previously read `currentEvent.tier === 'premium'` or
// `unlocks.includes('custom-template')` should migrate to:
//
//   const { features, isPremium, storageLimitBytes, retentionClass,
//           source, receiptId, loading, error } = useEventEntitlement(eventId);
//
// The hook returns the same shape the server side computes
// (no remapping on the client). Re-fetches when:
//   - eventId changes
//   - the manual refresh key is bumped (e.g. after a payment
//     approval — caller should pass refreshKey or call
//     refresh() after the approval promise resolves)
//
// Caching: the hook does NOT cache across mounts. Each
// invocation is a fresh callable call. At the time of writing
// (2026-08-19) the call is < 200ms round-trip from HKG1,
// acceptable for the couple-side UX. After we observe
// `latency > 500ms` in the wild, add a per-eventId LRU with
// stale-while-revalidate.
//
// Future: this hook will be the canonical "is premium" source
// for App.jsx, replacing the currentEvent.tier check. Until
// then, callers SHOULD consult both signals and prefer this
// one as the new contract.

import { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';

const EMPTY_FEATURES = {
  customInvitation: false,
  watermarkRemoved: false,
  extraStorage: false,
  lifetimeRetention: false,
};

const DEFAULT_STATE = {
  scope: 'event',
  eventId: null,
  ownerUid: null,
  features: EMPTY_FEATURES,
  storageLimitBytes: 200 * 1024 * 1024,
  retentionClass: 'standard',
  source: 'none',
  receiptId: null,
  computedAt: 0,
  loading: true,
  error: null,
};

export function useEventEntitlement(eventId, { refreshKey = 0 } = {}) {
  const [state, setState] = useState({ ...DEFAULT_STATE, eventId: eventId || null });

  const fetchEntitlement = useCallback(async () => {
    if (!eventId) {
      setState({ ...DEFAULT_STATE, eventId: null, loading: false });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const fn = httpsCallable(functions, 'getEventEntitlement');
      const result = await fn({ eventId });
      setState({ ...(result.data || DEFAULT_STATE), eventId, loading: false, error: null });
    } catch (err) {
      // 2026-08-19 — Don't crash the screen on a failed
      // entitlement fetch. Fall back to the default (free)
      // entitlement; the caller can still gate features
      // conservatively. The error is surfaced so the caller
      // can show a toast if they want.
      console.error('[useEventEntitlement] fetch failed:', err);
      setState({
        ...DEFAULT_STATE,
        eventId,
        loading: false,
        error: err?.message || 'fetch failed',
      });
    }
  }, [eventId]);

  useEffect(() => {
    fetchEntitlement();
  }, [fetchEntitlement, refreshKey]);

  return {
    ...state,
    refresh: fetchEntitlement,
    // Convenience computed booleans so callers don't have to
    // destructure features.
    isPremium: state.features.customInvitation
      || state.features.watermarkRemoved
      || state.features.extraStorage
      || state.features.lifetimeRetention,
  };
}
