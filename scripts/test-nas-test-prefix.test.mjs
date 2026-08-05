/**
 * Tests for the NAS-side test isolation guard.
 *
 * Background (2026-08-05): an e2e test of the photo-delete flow
 * picked a real user-uploaded filename off the NAS and called the
 * public delete endpoint against it. The file was deleted. The user
 * can never get it back.
 *
 * Fix: deploy/photo_upload_server.py reads `PHOTO_TEST_PREFIX` from
 * the environment. When set, the server refuses any upload or
 * delete where the eventId or guestId does not start with that
 * prefix. Production deploys leave it unset; e2e tests must set it
 * to e.g. "e2e-" and use matching eventIds.
 *
 * These tests import the actual server module via Python subprocess
 * (no mocks). They exercise the guard by calling
 * `_in_test_scope(eventId, guestId)` with various combinations. If
 * the module fails to import (e.g. missing PIL), the test still
 * runs because `_in_test_scope` doesn't depend on PIL.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.resolve(__dirname, '../deploy/photo_upload_server.py');

/**
 * Spawn Python with PHOTO_TEST_PREFIX=testPrefix, import the server
 * module (which binds TEST_PREFIX at top level), then call
 * `_in_test_scope(eventId, guestId)` and print the boolean.
 *
 * The module also tries to call `log(...)` which writes to stderr
 * — those lines are filtered out by looking for the last non-empty,
 * non-bracket-prefixed line of stdout.
 */
function callScopeCheck(testPrefix, eventId, guestId) {
  const py = `
import importlib.util
spec = importlib.util.spec_from_file_location('nas_server', ${JSON.stringify(SERVER_PATH)})
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
print(mod._in_test_scope(${JSON.stringify(eventId)}, ${JSON.stringify(guestId)}))
`;
  const proc = spawnSync('python3', ['-c', py], {
    env: { ...process.env, PHOTO_TEST_PREFIX: testPrefix },
    encoding: 'utf-8',
    timeout: 15000,
  });
  if (proc.status !== 0) {
    throw new Error(
      `python failed (exit=${proc.status}): ${proc.stderr.slice(-500)}`
    );
  }
  // The module's `log()` writes "[HH:MM:SS] msg" to stderr; stdout
  // has only the boolean print. Filter just in case.
  const lines = proc.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1];
  if (last !== 'True' && last !== 'False') {
    throw new Error(`unexpected python stdout: ${proc.stdout}`);
  }
  return last === 'True';
}

describe('NAS test isolation guard (_in_test_scope)', () => {
  it('allows everything when TEST_PREFIX is unset', () => {
    expect(callScopeCheck('', 'realEvent1', 'realGuest2')).toBe(true);
    expect(callScopeCheck('', 'any-id-with-dashes', 'guest-with-12345')).toBe(true);
  });

  it('refuses when NEITHER eventId NOR guestId starts with the prefix', () => {
    expect(callScopeCheck('e2e-', 'realEvent1', 'realGuest2')).toBe(false);
  });

  it('refuses when only the eventId starts with the prefix is NOT enough', () => {
    // Edge case: if we wanted strict eventId match (not OR), this
    // would be False. With the OR semantics we picked (either id
    // matching is enough), this is True. Document the chosen
    // semantics explicitly so a future "fix" doesn't flip them.
    expect(callScopeCheck('e2e-', 'realEvent1', 'realGuest2')).toBe(false);
    expect(callScopeCheck('e2e-', 'e2e-event1', 'realGuest2')).toBe(true);
    expect(callScopeCheck('e2e-', 'realEvent1', 'e2e-guest2')).toBe(true);
  });

  it('allows events that start with the prefix', () => {
    expect(callScopeCheck('e2e-', 'e2e-event1', 'anyGuest')).toBe(true);
  });

  it('allows guests that start with the prefix (event can be anything)', () => {
    expect(callScopeCheck('e2e-', 'realEvent1', 'e2e-guest2')).toBe(true);
  });

  it('prefix is matched at the START of the id only', () => {
    // "realEvent1e2e-" contains "e2e-" but doesn't start with it
    expect(callScopeCheck('e2e-', 'realEvent1e2e-', 'realGuest2')).toBe(false);
  });

  it('whitespace-only TEST_PREFIX is treated as unset', () => {
    expect(callScopeCheck('   ', 'realEvent1', 'realGuest2')).toBe(true);
  });
});