import { describe, expect, it } from 'vitest';
import { shareTokenReuse } from '../src/shareTokenPure';

describe('shareTokenReuse', () => {
  it('allows the same uid to redeem again', () => {
    expect(shareTokenReuse([
      { id: 'guest-a', redeemedByUid: 'guest-a' },
    ], 'guest-a')).toBeNull();
  });

  it('rejects a token already bound to a different uid', () => {
    expect(shareTokenReuse([
      { id: 'guest-a', redeemedByUid: 'guest-a' },
    ], 'guest-b')).toBe('taken');
  });

  it('rejects a different uid even when the earlier link was revoked', () => {
    expect(shareTokenReuse([
      { id: 'guest-a', redeemedByUid: 'guest-a' },
    ], 'guest-b')).toBe('taken');
  });

  it('allows the first redemption', () => {
    expect(shareTokenReuse([], 'guest-a')).toBeNull();
  });
});
