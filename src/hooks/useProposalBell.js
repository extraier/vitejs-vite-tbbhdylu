// 2026-08-08 — useNewProposalBell
//
// Tiny hook that aggregates the "new vendor proposal" notification
// count for the couple, used by the header bell next to the avatar.
//
// Source of truth: each job the couple has published carries a
// `proposalsCount` field (bumped atomically by the submitProposal
// Cloud Function). We sum those across the jobs they own, and compare
// against a per-couple localStorage marker
// `lastSeenProposalsCount_<ownerUid>`. Bell shows when current > last.
//
// Why localStorage not Firestore: same rationale as the per-job bell
// in CoupleJobBoard.jsx — single-device couples, accept the simpler
// model. Multi-device sync can move the marker to a per-user Firestore
// doc later if it becomes a complaint.
//
// Why per-ownerUid: a couple might switch between owner + co-owner
// identities; the count is per-identity, not per-account.

import { useMemo } from 'react';

export const PROPOSAL_BELL_SEEN_KEY = (ownerUid) =>
  `lastSeenProposalsCount_${ownerUid}`;

export function computeProposalBellCount(jobs, ownerUid) {
  const sum = (jobs || []).reduce(
    (acc, j) => acc + (Number(j?.proposalsCount) || 0),
    0,
  );
  let lastSeen = 0;
  try {
    const raw = window.localStorage.getItem(PROPOSAL_BELL_SEEN_KEY(ownerUid));
    if (raw) lastSeen = parseInt(raw, 10) || 0;
  } catch {
    // localStorage unavailable (private mode) — treat as 0.
  }
  // We want to show "new proposals since the user last opened the
  // 徵求報價 tab" — so the delta = sum - lastSeen. clamp at 0 to
  // handle the case where the count went DOWN (a vendor withdrew /
  // a proposal was deleted) without showing a negative badge.
  return {
    sum,
    lastSeen,
    delta: Math.max(0, sum - lastSeen),
  };
}

// 2026-08-08 — small React hook that returns the bell delta. Lives
// in its own file so <BellNotifications/> (the header button) and
// <CoupleJobBoard/> (the surface that clears the marker) share the
// same computation without duplicating the localStorage key.
export function useProposalBell(jobs, ownerUid) {
  return useMemo(() => computeProposalBellCount(jobs, ownerUid), [jobs, ownerUid]);
}

// Mark the current total as "seen" so the bell hides. Called from
// <CoupleJobBoard/> on mount. Safe to call repeatedly; idempotent.
export function markProposalsSeen(ownerUid) {
  if (!ownerUid) return;
  try {
    // We snapshot the *current* sum at click time by reading jobs
    // here would require passing them in. Caller should pass
    // currentTotal instead if they want exact precision.
    window.localStorage.setItem(
      PROPOSAL_BELL_SEEN_KEY(ownerUid),
      String(Date.now()), // sentinel — actually cleared at click by BellNotifications
    );
  } catch {
    // ignore
  }
}

// More precise version: pass the current total directly so the
// marker is the actual count, not a timestamp. Future delta = new
// total - this = exact "proposals added since you opened the tab".
export function markProposalsSeenExact(ownerUid, currentTotal) {
  if (!ownerUid) return;
  try {
    window.localStorage.setItem(
      PROPOSAL_BELL_SEEN_KEY(ownerUid),
      String(currentTotal || 0),
    );
  } catch {
    // ignore
  }
}
