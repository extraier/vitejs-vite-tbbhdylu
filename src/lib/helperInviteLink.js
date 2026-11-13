// Helper-invite email links are opened on the invitee's device, not the
// owner's. localStorage written when the owner clicks "send" is therefore
// the wrong place to recover the email. The continue URL carries it, and
// Firebase nests that continue URL inside `continueUrl` on the link the
// inbox actually opens.

export function helperInviteContinueUrl(origin, email) {
  const base = String(origin || 'https://savetheday.io').replace(/\/+$/, '');
  const url = new URL(`${base}/`);
  url.searchParams.set('__heroinvite', '1');
  const normalized = normalizeEmail(email);
  if (normalized) url.searchParams.set('email', normalized);
  return url.toString();
}

export function resolveHelperInviteEmail(href, storedEmail) {
  const fromUrl = emailFromHref(href);
  if (fromUrl) return fromUrl;
  return normalizeEmail(storedEmail);
}

function emailFromHref(href) {
  if (!href) return '';
  let url;
  try {
    url = new URL(href, 'https://savetheday.io');
  } catch {
    return '';
  }
  const direct = normalizeEmail(url.searchParams.get('email'));
  if (direct) return direct;
  const cont = url.searchParams.get('continueUrl');
  if (!cont) return '';
  try {
    return normalizeEmail(new URL(cont).searchParams.get('email'));
  } catch {
    return '';
  }
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email.includes('@') ? email : '';
}
