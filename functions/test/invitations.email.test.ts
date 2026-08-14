// 2026-08-14 — Tests for the invitation-level metadata overrides
// (date/time/venue/address). The user can edit these directly in
// the Invitation Editor (InfoStep) and the override flows through
// to the email via `mergeOverride()` in src/invitationEmail.ts.
//
// We only test the pure-logic merge function. The renderEmailHtml
// HTML template is unchanged and the wire-through is a single line
// at the call site in invitations.ts:sendInvitationsV2 — covered
// by these merge semantics.

import { describe, it, expect } from 'vitest';
import { mergeOverride } from '../src/invitationEmail';

describe('mergeOverride — invitation metadata (2026-08-14)', () => {
  it('non-empty override wins over event value', () => {
    expect(mergeOverride('2027-06-15', '2027-01-01')).toBe('2027-06-15');
  });

  it('empty string override falls back to event value', () => {
    expect(mergeOverride('', '2027-01-01')).toBe('2027-01-01');
  });

  it('undefined override falls back (most common steady state)', () => {
    expect(mergeOverride(undefined, '2027-01-01')).toBe('2027-01-01');
  });

  it('null override falls back (defensive)', () => {
    expect(mergeOverride(null, '2027-01-01')).toBe('2027-01-01');
  });

  it('whitespace-only override falls back (defensive trim)', () => {
    expect(mergeOverride('   ', '2027-01-01')).toBe('2027-01-01');
  });

  it('time field flows through with the same semantics', () => {
    expect(mergeOverride('19:30', '18:00')).toBe('19:30');
    expect(mergeOverride('', '18:00')).toBe('18:00');
  });

  it('venue field flows through with the same semantics', () => {
    expect(mergeOverride('Grand Hyatt', '四季酒店')).toBe('Grand Hyatt');
    expect(mergeOverride('', '四季酒店')).toBe('四季酒店');
  });

  it('address field flows through with the same semantics', () => {
    expect(mergeOverride('九龍尖沙咀', '香港中環')).toBe('九龍尖沙咀');
    expect(mergeOverride('', '香港中環')).toBe('香港中環');
  });

  it('all four overrides empty → all four fall back to event values (steady state right after creating an invitation)', () => {
    expect(mergeOverride('', '2027-01-01')).toBe('2027-01-01');
    expect(mergeOverride('', '18:00')).toBe('18:00');
    expect(mergeOverride('', '四季酒店')).toBe('四季酒店');
    expect(mergeOverride('', '香港中環')).toBe('香港中環');
  });

  it('all four overrides set → all four use the override (user edited every field)', () => {
    expect(mergeOverride('2027-06-15', '2027-01-01')).toBe('2027-06-15');
    expect(mergeOverride('19:30', '18:00')).toBe('19:30');
    expect(mergeOverride('Grand Hyatt', '四季酒店')).toBe('Grand Hyatt');
    expect(mergeOverride('九龍尖沙咀', '香港中環')).toBe('九龍尖沙咀');
  });

  it('overrides are independent (editing date does not affect time/venue/address)', () => {
    // User sets date but leaves others alone. Each merge is
    // independent; the date override wins, the others fall back.
    expect(mergeOverride('2027-06-15', '2027-01-01')).toBe('2027-06-15');
    expect(mergeOverride('', '18:00')).toBe('18:00');
    expect(mergeOverride('', '四季酒店')).toBe('四季酒店');
    expect(mergeOverride('', '香港中環')).toBe('香港中環');
  });

  it('clearing an override (empty string) reverts to event value (round trip)', () => {
    // User sets an override then clears it (Enter on empty input
    // saves ''). Next render should show event value.
    expect(mergeOverride('', '2027-01-01')).toBe('2027-01-01');
  });
});