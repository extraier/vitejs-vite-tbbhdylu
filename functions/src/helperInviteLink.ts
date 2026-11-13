// Continue URL embedded in helper-invite magic links. The invitee opens
// this on their own device, so the email has to travel with the link.
// useAuth reads it back from the top-level param or from Firebase's
// nested continueUrl.

export function helperInviteContinueUrl(origin: string, email: string): string {
  const base = String(origin || 'https://savetheday.io')
    .replace(/[\s\n\r\t]+/g, '')
    .replace(/\/+$/, '') || 'https://savetheday.io';
  const url = new URL(`${base}/`);
  url.searchParams.set('__heroinvite', '1');
  const normalized = String(email || '').trim().toLowerCase();
  if (normalized.includes('@')) url.searchParams.set('email', normalized);
  return url.toString();
}
