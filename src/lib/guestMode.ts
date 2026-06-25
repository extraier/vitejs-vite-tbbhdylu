// Guest portal URL params. StackBlitz has no router — we detect guest mode
// by looking at ?o= (owner uid), ?e= (event id), ?g= (guest id).

export type GuestParams = {
  qOwner: string | null;
  qEvent: string | null;
  qGuest: string | null;
  isGuestMode: boolean;
};

export function parseGuestParams(search: string): GuestParams {
  const params = new URLSearchParams(search);
  const qOwner = params.get('o');
  const qEvent = params.get('e');
  const qGuest = params.get('g');
  return {
    qOwner,
    qEvent,
    qGuest,
    isGuestMode: Boolean(qOwner && qEvent && qGuest),
  };
}
