import { describe, expect, it } from 'vitest';
import {
  guestLinkDocPath,
  guestLinkIndexDocPath,
  readGuestLinkIndexPath,
} from '../src/guestLinkIndex.pure';

describe('guest link path index', () => {
  it('builds a direct doc path from the index', () => {
    expect(guestLinkIndexDocPath('savetheday-production', 'link1')).toBe(
      'artifacts/savetheday-production/guestLinkIndex/link1',
    );
    expect(guestLinkDocPath('savetheday-production', 'owner', 'link1')).toBe(
      'artifacts/savetheday-production/users/owner/guestLinks/link1',
    );
  });

  it('rejects an index doc that does not point at a guestLinks path', () => {
    expect(readGuestLinkIndexPath({ path: guestLinkDocPath('app', 'o', 'l') })).toBe(
      'artifacts/app/users/o/guestLinks/l',
    );
    expect(readGuestLinkIndexPath({ path: 'artifacts/app/users/o/events/e' })).toBeNull();
    expect(readGuestLinkIndexPath(null)).toBeNull();
  });
});
