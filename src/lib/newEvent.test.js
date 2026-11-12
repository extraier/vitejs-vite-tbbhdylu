import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildNewEventFields } from './newEvent';

describe('buildNewEventFields', () => {
  it('stamps the creator as the first co-owner', () => {
    const fields = buildNewEventFields('Our day', 'uid-1', 1000);
    expect(fields).toEqual({
      name: 'Our day',
      tier: 'free',
      budget: 350000,
      coOwners: ['uid-1'],
      createdAt: 1000,
    });
    expect(fields.date).toBeUndefined();
  });
});

describe('event create call sites', () => {
  it('uses the shared payload for both the direct create and the guest-upgrade replay', () => {
    const src = readFileSync(join(process.cwd(), 'src/App.jsx'), 'utf8');
    const uses = src.split('buildNewEventFields(').length - 1;
    expect(uses).toBe(2);
  });
});
