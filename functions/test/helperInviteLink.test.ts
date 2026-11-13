import { describe, expect, it } from 'vitest';
import { helperInviteContinueUrl } from '../src/helperInviteLink';

describe('helperInviteContinueUrl', () => {
  it('includes the invitee email and ignores whitespace on the app base', () => {
    const url = new URL(helperInviteContinueUrl('https://savetheday.io/\n', 'Helper@Example.com'));
    expect(url.origin).toBe('https://savetheday.io');
    expect(url.searchParams.get('__heroinvite')).toBe('1');
    expect(url.searchParams.get('email')).toBe('helper@example.com');
  });
});
