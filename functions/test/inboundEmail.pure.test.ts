import { createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  parsePlusAddress,
  recipientToAddress,
  verifyMailgunSignature,
} from '../src/inboundEmail.pure';

describe('verifyMailgunSignature', () => {
  it('accepts a valid signature', () => {
    const signingKey = 'topsecret';
    const timestamp = '1743513600';
    const token = 'abcdef1234567890';
    const signature = createHmac('sha256', signingKey).update(timestamp + token).digest('hex');
    expect(verifyMailgunSignature({ timestamp, token, signature, signingKey })).toBe(true);
  });

  it('rejects a tampered signature', () => {
    const signingKey = 'topsecret';
    const timestamp = '1743513600';
    const token = 'abcdef1234567890';
    const valid = createHmac('sha256', signingKey).update(timestamp + token).digest('hex');
    const tampered = valid.replace(/^./, 'f');
    expect(verifyMailgunSignature({ timestamp, token, signature: tampered, signingKey })).toBe(false);
  });

  it('fails closed when fields are missing', () => {
    expect(verifyMailgunSignature({})).toBe(false);
    expect(verifyMailgunSignature({
      timestamp: '1',
      token: 't',
      signature: 's',
      signingKey: null,
    })).toBe(false);
  });
});

describe('parsePlusAddress', () => {
  it('has no tag for a plain local part', () => {
    expect(parsePlusAddress('Support')).toEqual({ base: 'support', tag: null });
  });

  it('extracts and lowercases a plus tag', () => {
    expect(parsePlusAddress('Support+ThreadABC123')).toEqual({
      base: 'support',
      tag: 'threadabc123',
    });
  });

  it('treats an empty plus tag as null', () => {
    expect(parsePlusAddress('support+')).toEqual({ base: 'support', tag: null });
  });
});

describe('recipientToAddress', () => {
  it('reads an address inside a display name', () => {
    expect(recipientToAddress('Savetheday Support <support+abc123@savetheday.io>')).toEqual({
      local: 'support+abc123',
      domain: 'savetheday.io',
    });
  });

  it('reads a bare address', () => {
    expect(recipientToAddress('support@savetheday.io')).toEqual({
      local: 'support',
      domain: 'savetheday.io',
    });
  });

  it('returns null for input that is not an address', () => {
    expect(recipientToAddress('not-an-address')).toBeNull();
  });

  it('extracts a thread id from plus addressing', () => {
    const recipient = recipientToAddress('Savetheday Support <support+7f3a2b1c@savetheday.io>');
    const parsed = parsePlusAddress(recipient!.local);
    expect(parsed.base).toBe('support');
    expect(parsed.tag).toBe('7f3a2b1c');
  });
});
