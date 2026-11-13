import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const rules = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../storage.rules'),
  'utf8',
);

function block(startMarker, endMarker) {
  const start = rules.indexOf(startMarker);
  const end = rules.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return rules.slice(start, end);
}

describe('storage.rules deletes', () => {
  const uploads = [
    ['match /vendors/{vendorId}/portfolio/{fileName}', 'match /payment-receipts/'],
    ['match /payment-receipts/{ownerUid}/{fileName}', 'match /social-proofs/'],
    ['match /social-proofs/{ownerUid}/{fileName}', 'match /invitation-uploads/'],
    ['match /invitation-uploads/{ownerUid}/{fileName}', 'match /red-packets/'],
  ];

  it.each(uploads)('%s splits create/update from delete', (start, end) => {
    const body = block(start, end);
    expect(body).toMatch(/allow create, update:/);
    expect(body).toMatch(/allow delete:/);
    const deleteRule = body.slice(body.indexOf('allow delete:'));
    expect(deleteRule).not.toMatch(/request\.resource/);
  });

  it('does not loosen red-packet or payment-settings deletes', () => {
    const red = block('match /red-packets/', 'match /platform/payment-settings/');
    expect(red).toMatch(/allow delete: if false/);
    const pay = block('match /platform/payment-settings/', 'match /{path=**}');
    expect(pay).toMatch(/allow delete: if isAdmin\(\)/);
    expect(pay).not.toMatch(/allow delete: if true/);
  });
});
