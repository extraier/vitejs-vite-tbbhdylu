import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildNewEventFields } from './newEvent';

describe('buildNewEventFields', () => {
  it('does not let the client seed tier, coOwners, or userId', () => {
    const fields = buildNewEventFields('Our day', 'uid-1', 1000);
    expect(fields).toEqual({
      name: 'Our day',
      budget: 350000,
      createdAt: 1000,
    });
    expect(fields.tier).toBeUndefined();
    expect(fields.coOwners).toBeUndefined();
    expect(fields.userId).toBeUndefined();
    expect(fields.date).toBeUndefined();
  });

  it('rejects a create payload without an owner uid', () => {
    expect(() => buildNewEventFields('Our day', '', 1000)).toThrow(/ownerUid/);
  });
});

describe('event create call sites', () => {
  it('uses the shared payload for both the direct create and the guest-upgrade replay', () => {
    const src = readFileSync(join(process.cwd(), 'src/App.jsx'), 'utf8');
    const uses = src.split('buildNewEventFields(').length - 1;
    expect(uses).toBe(2);
  });
});
