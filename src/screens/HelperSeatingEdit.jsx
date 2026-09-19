/**
 * src/screens/HelperSeatingEdit.jsx
 *
 * 2026-09-17 — P13.3 refactor (Phase 2.2 deliverable).
 *
 * Helper live-edit seating screen. Reuses the role-aware
 * SeatingCanvas core from CoupleSeating.jsx with role='helper',
 * which gates every owner-only write path:
 *   • preset selector button — hidden
 *   • tap-empty-creates-table — disabled
 *   • drag-table — disabled
 *   • editor modal — never opens
 *   • saveAssignment to owner-only table categories — refused
 *     with a clear zh-HK toast
 *
 * Helpers can still:
 *   • drag guest chips onto helper-writable tables
 *   • see the live attendance pill on each table
 *   • see the dietary chip when present
 *
 * Permissions:
 *   • Read all tables, tableAssignments, guests, seatingCheckIns
 *     (allowed by firestore.rules for any helper of the event).
 *   • Write to tableAssignments only when the destination table
 *     is in HELPER_WRITABLE_TABLE_CATEGORIES (rule-enforced;
 *     client-side pre-check in saveAssignment gives a clear
 *     toast if the user tries anyway).
 *
 * Route:
 *   Set by App.jsx when currentView === 'seating-edit'. Reached
 *   from HelperDashboard via the new 🪑 座位表 tab.
 */
import { SeatingCanvas } from './CoupleSeating';

export function HelperSeatingEdit({
  ownerUid,
  eventId,
  onBack,
  onOpenToast,
}) {
  return (
    <SeatingCanvas
      ownerUid={ownerUid}
      eventId={eventId}
      onBack={onBack}
      onOpenToast={onOpenToast}
      role="helper"
    />
  );
}

export default HelperSeatingEdit;
