// Public login-shell hash routes.
//
// `#signup` opens couple/planner sign-up.
// `#signup-as-vendor` opens vendor sign-up. Vendor-invite links put the
// slug inside the hash (`#signup-as-vendor?slug=…`), so it is not in
// location.search.

export function parseAuthEntry(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw) return { kind: null, slug: '' };
  const queryAt = raw.indexOf('?');
  const path = (queryAt === -1 ? raw : raw.slice(0, queryAt)).replace(/\/+$/, '');
  const params = new URLSearchParams(queryAt === -1 ? '' : raw.slice(queryAt + 1));
  if (path === 'signup-as-vendor') {
    return { kind: 'vendor', slug: params.get('slug') || '' };
  }
  if (path === 'signup') {
    return { kind: 'signup', slug: '' };
  }
  return { kind: null, slug: '' };
}

export function authEntryState(hash) {
  const entry = parseAuthEntry(hash);
  return {
    signingUpAs: entry.kind === 'vendor' ? 'vendor' : null,
    loginMode: entry.kind === 'signup' ? 'signup' : null,
    slug: entry.slug,
  };
}
