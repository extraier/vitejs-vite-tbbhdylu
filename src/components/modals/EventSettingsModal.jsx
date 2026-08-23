// 2026-08-01 — EventSettingsModal.
//
// Modal opened from the lobby card's ⋯ menu → 新人名稱. Currently
// contains a single section: <OwnerNamesEditor> for editing the
// couple's display names per-event.
//
// Venue + date editors were intentionally deferred — the user
// asked for the 新人名稱 entry point specifically, and shipping
// one section well is better than three half-working ones.
//
// Props:
//   open            — boolean, mount only when true
//   onClose         — called when backdrop / 關閉 button clicked
//   currentUser     — passed to OwnerNamesEditor for subscription
//   currentEvent    — { id, ... } — `id` is required for the hook
//   onToast         — pass-through to OwnerNamesEditor
//
// 2026-08-01 (pivot) — OwnerNamesEditor now reads/writes via
// useEventOwnerNames(eventId, uid). Co-owners see + edit the same
// names because the data lives on the shared event doc, which
// both owner and co-owner have read access to.

import { X } from 'lucide-react';
import { OwnerNamesEditor } from '../OwnerNamesEditor';
// 2026-08-23 — Manus P2c: owner-facing publish trigger for the
// guestExperience/public projection. Pairs with the publishGuestExperience
// Cloud Function deployed in P2a.
import { GuestExperiencePublisher } from '../GuestExperiencePublisher';

export function EventSettingsModal({
  open,
  onClose,
  currentUser,
  currentEvent,
  onToast,
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="婚禮設定"
    >
      <div
        className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-black text-slate-800">婚禮設定</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉"
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <section className="mb-6">
          <OwnerNamesEditor
            currentUser={currentUser}
            eventId={currentEvent?.id}
            onToast={onToast}
          />
        </section>

        {/* 2026-08-23 — Manus P2c: guest-experience publish trigger.
            One button writes the privacy-filtered public doc that
            the guest portal reads. Without this publish, guests on
            legacy events see the canonical event doc (P2b fallback).
            Once published, the projection takes over and the privacy
            boundary holds (no guest list, no PII, no admin fields). */}
        <section className="mb-6">
          <GuestExperiencePublisher
            currentUser={currentUser}
            currentEvent={currentEvent}
            eventId={currentEvent?.id}
            onToast={onToast}
          />
        </section>

        {/* 2026-08-01 — Venue + date sections deferred. Follow-up
            commits add them; the user specifically requested the
            新人名稱 entry point. The modal scaffolding is in
            place so adding sections is a copy-paste of the
            <section className="mb-6"> wrapper. */}
      </div>
    </div>
  );
}
