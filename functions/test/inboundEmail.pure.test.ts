import { createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  attachmentsWithinLimits,
  autoReplyGate,
  autoReplyRateDecision,
  AUTO_REPLY_GLOBAL_MAX_PER_WINDOW,
  AUTO_REPLY_MIN_INTERVAL_MS,
  INBOUND_MAX_FILE_BYTES,
  INBOUND_MAX_FILES,
  INBOUND_MAX_TOTAL_BYTES,
  parsePlusAddress,
  recipientToAddress,
  verifyMailgunSignature,
} from '../src/inboundEmail.pure';

describe('verifyMailgunSignature', () => {
  const nowMs = 1743513600 * 1000;

  it('accepts a valid signature', () => {
    const signingKey = 'topsecret';
    const timestamp = '1743513600';
    const token = 'abcdef1234567890';
    const signature = createHmac('sha256', signingKey).update(timestamp + token).digest('hex');
    expect(verifyMailgunSignature({ timestamp, token, signature, signingKey, nowMs })).toBe(true);
  });

  it('rejects a tampered signature', () => {
    const signingKey = 'topsecret';
    const timestamp = '1743513600';
    const token = 'abcdef1234567890';
    const valid = createHmac('sha256', signingKey).update(timestamp + token).digest('hex');
    const tampered = valid.replace(/^./, valid[0] === 'f' ? 'a' : 'f');
    expect(verifyMailgunSignature({ timestamp, token, signature: tampered, signingKey, nowMs })).toBe(false);
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

  it('returns false for a non-hex signature instead of throwing', () => {
    const signingKey = 'topsecret';
    const timestamp = '1743513600';
    const token = 'abcdef1234567890';
    expect(verifyMailgunSignature({
      timestamp,
      token,
      signature: 'z'.repeat(64),
      signingKey,
      nowMs,
    })).toBe(false);
    expect(verifyMailgunSignature({
      timestamp,
      token,
      signature: 'abcd',
      signingKey,
      nowMs,
    })).toBe(false);
  });

  it('rejects a stale timestamp (replay)', () => {
    const signingKey = 'topsecret';
    const timestamp = '1743513600';
    const token = 'abcdef1234567890';
    const signature = createHmac('sha256', signingKey).update(timestamp + token).digest('hex');
    const later = nowMs + 16 * 60 * 1000;
    expect(verifyMailgunSignature({ timestamp, token, signature, signingKey, nowMs: later })).toBe(false);
  });
});

describe('attachment limits', () => {
  it('accepts a small batch', () => {
    expect(attachmentsWithinLimits([{ size: 10 }, { size: 20 }])).toBe(true);
  });

  it('rejects too many files, an oversized file, and an oversized total', () => {
    const tooMany = Array.from({ length: INBOUND_MAX_FILES + 1 }, () => ({ size: 1 }));
    expect(attachmentsWithinLimits(tooMany)).toBe(false);
    expect(attachmentsWithinLimits([{ size: INBOUND_MAX_FILE_BYTES + 1 }])).toBe(false);
    expect(attachmentsWithinLimits([
      { size: INBOUND_MAX_TOTAL_BYTES - 10 },
      { size: 11 },
    ])).toBe(false);
  });
});

describe('auto-reply gate and rate limit', () => {
  it('allows a first-contact mailbox whose envelope sender matches', () => {
    expect(autoReplyGate({
      fromHeader: 'Couple <couple@example.com>',
      envelopeSender: 'couple@example.com',
    })).toEqual({ ok: true, toEmail: 'couple@example.com' });
  });

  it('refuses a spoofed From, a bounce, and bulk mail', () => {
    expect(autoReplyGate({
      fromHeader: 'Victim <victim@example.com>',
      envelopeSender: 'attacker@evil.test',
    }).ok).toBe(false);
    expect(autoReplyGate({
      fromHeader: 'Mailer-Daemon <mailer-daemon@example.com>',
      envelopeSender: 'mailer-daemon@example.com',
    }).ok).toBe(false);
    expect(autoReplyGate({
      fromHeader: 'couple@example.com',
      envelopeSender: 'couple@example.com',
      messageHeaders: 'Auto-Submitted: auto-replied',
    }).ok).toBe(false);
  });

  it('allows the first reply and then enforces the per-address cooldown and global cap', () => {
    const now = 1_700_000_000_000;
    expect(autoReplyRateDecision({ lastSentAtMs: null, recentGlobalSends: 0, nowMs: now }).allow).toBe(true);
    expect(autoReplyRateDecision({
      lastSentAtMs: now - 1000,
      recentGlobalSends: 0,
      nowMs: now,
    }).allow).toBe(false);
    expect(autoReplyRateDecision({
      lastSentAtMs: now - AUTO_REPLY_MIN_INTERVAL_MS,
      recentGlobalSends: 0,
      nowMs: now,
    }).allow).toBe(true);
    expect(autoReplyRateDecision({
      lastSentAtMs: null,
      recentGlobalSends: AUTO_REPLY_GLOBAL_MAX_PER_WINDOW,
      nowMs: now,
    }).allow).toBe(false);
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
