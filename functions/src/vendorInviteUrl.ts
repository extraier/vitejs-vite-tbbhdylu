/** Canonical public claim link. Bare `?signup` links still parse on the client. */
export function buildCanonicalVendorInviteUrl(
  baseUrl: string,
  slug: string,
  token: string,
): string {
  const base = (baseUrl || 'https://savetheday.io').replace(/\/+$/, '');
  const url = new URL(`${base}/`);
  url.searchParams.set('signup', '1');
  url.searchParams.set('venue', slug);
  url.searchParams.set('token', token);
  return url.toString();
}
