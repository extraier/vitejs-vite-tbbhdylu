import { parseAuthEntry } from './authEntry';

/**
 * Canonical claim link. `signup=1` is explicit. Older mail used a bare
 * `?signup` flag (`URLSearchParams.get('signup') === ''`); both are accepted.
 */
export function buildCanonicalVendorInviteUrl(origin, { slug, token }) {
  const base = String(origin || 'https://savetheday.io').replace(/\/+$/, '');
  const url = new URL(`${base}/`);
  url.searchParams.set('signup', '1');
  url.searchParams.set('venue', slug);
  url.searchParams.set('token', token);
  return url.toString();
}

export function signupFlagIsPresent(params) {
  if (!params.has('signup')) return false;
  const value = params.get('signup');
  return value === '' || value === '1' || value === 'true';
}

function hashParts(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  const queryAt = raw.indexOf('?');
  const path = (queryAt === -1 ? raw : raw.slice(0, queryAt)).replace(/\/+$/, '');
  const params = new URLSearchParams(queryAt === -1 ? '' : raw.slice(queryAt + 1));
  return { path, params };
}

/**
 * Read a vendor invite from the query string or the hash, then return
 * the URL pieces with the invitation token removed.
 */
export function captureVendorInvite({ search = '', hash = '' } = {}) {
  const searchParams = new URLSearchParams(
    String(search || '').replace(/^\?/, ''),
  );
  const hashInfo = hashParts(hash);
  const entry = parseAuthEntry(hash);

  let slug = '';
  let token = '';
  let source = '';

  if (signupFlagIsPresent(searchParams)) {
    slug = (searchParams.get('venue') || searchParams.get('slug') || '').trim();
    token = (searchParams.get('token') || '').trim();
    if (slug) source = 'search';
  }

  const hashSlug = (entry.slug || hashInfo.params.get('venue') || '').trim();
  const hashToken = (entry.token || hashInfo.params.get('token') || '').trim();
  if (!slug && hashSlug && (entry.kind === 'vendor' || hashInfo.path === 'signup-as-vendor')) {
    slug = hashSlug;
    token = hashToken;
    source = 'hash';
  } else if (slug && !token && hashToken) {
    token = hashToken;
  }

  const invite = slug
    ? { slug, token, source }
    : null;

  if (source === 'search' || searchParams.has('token') || searchParams.has('signup')) {
    searchParams.delete('signup');
    searchParams.delete('venue');
    searchParams.delete('slug');
    searchParams.delete('token');
  }
  hashInfo.params.delete('token');

  const hashQuery = hashInfo.params.toString();
  const nextHash = hashInfo.path
    ? `#${hashInfo.path}${hashQuery ? `?${hashQuery}` : ''}`
    : '';
  const nextSearch = searchParams.toString();

  return {
    invite,
    nextSearch: nextSearch ? `?${nextSearch}` : '',
    nextHash,
  };
}

export function shouldClaimSeededVendor(pending) {
  return Boolean(pending && pending.slug && pending.token);
}

export function pendingInviteRecord(invite, now = Date.now()) {
  if (!invite?.slug) return null;
  return {
    slug: invite.slug,
    token: invite.token || '',
    capturedAt: now,
  };
}
