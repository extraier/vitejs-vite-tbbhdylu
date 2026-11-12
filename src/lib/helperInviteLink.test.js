import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  helperInviteContinueUrl,
  resolveHelperInviteEmail,
} from './helperInviteLink';

describe('helperInviteContinueUrl', () => {
  it('puts the invitee email on the continue URL the other device will open', () => {
    const url = new URL(helperInviteContinueUrl('https://savetheday.io', 'Helper@Example.com'));
    expect(url.origin).toBe('https://savetheday.io');
    expect(url.searchParams.get('__heroinvite')).toBe('1');
    expect(url.searchParams.get('email')).toBe('helper@example.com');
  });
});

describe('resolveHelperInviteEmail', () => {
  it('reads a top-level email param', () => {
    expect(
      resolveHelperInviteEmail(
        'https://savetheday.io/?__heroinvite=1&email=helper%40example.com',
        '',
      ),
    ).toBe('helper@example.com');
  });

  it('reads the email Firebase nests inside continueUrl', () => {
    const continueUrl = helperInviteContinueUrl('https://savetheday.io', 'helper@example.com');
    const landing = `https://savetheday.io/?apiKey=abc&mode=signIn&oobCode=xyz&continueUrl=${encodeURIComponent(continueUrl)}`;
    expect(resolveHelperInviteEmail(landing, 'owner@example.com')).toBe('helper@example.com');
  });

  it('falls back to a same-browser stash only when the link has no email', () => {
    expect(
      resolveHelperInviteEmail(
        'https://savetheday.io/?apiKey=abc&mode=signIn&oobCode=xyz',
        'helper@example.com',
      ),
    ).toBe('helper@example.com');
  });

  it('returns empty when neither the link nor storage has an email', () => {
    expect(
      resolveHelperInviteEmail('https://savetheday.io/?mode=signIn&oobCode=xyz', ''),
    ).toBe('');
  });
});

describe('helper invite wiring', () => {
  it('sends the continue URL with the invitee email from the client and the mailer', () => {
    const root = process.cwd();
    const helper = readFileSync(join(root, 'src/components/modals/HelperManager.jsx'), 'utf8');
    const mail = readFileSync(join(root, 'functions/src/helpersMail.ts'), 'utf8');
    const auth = readFileSync(join(root, 'src/hooks/useAuth.js'), 'utf8');
    expect(helper).toContain('helperInviteContinueUrl(');
    expect(helper).not.toContain("url: 'https://savetheday.io/?__heroinvite=1'");
    expect(mail).toContain('helperInviteContinueUrl(');
    expect(mail).not.toContain('url: `${appBase}/?__heroinvite=1`');
    expect(auth).toContain('resolveHelperInviteEmail(');
  });
});
