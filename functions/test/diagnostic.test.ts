/**
 * Diagnostic: prove whether env.authenticatedContext(uid, {admin: true})
 * propagates auth to the rules engine in this rules-unit-testing setup.
 *
 * DISCOVERY (2026-08-24): D2 (plain authenticated user, no custom
 * claims) ALSO fails with 'No matching allow statements' on a path
 * whose rule is 'allow read: if isSignedIn()'. The ONLY way to make
 * any authenticated read test pass against this test harness is to
 * target a rule gated on isOwner(ownerUid) — i.e. a rule that
 * compares the doc's ownerUid field to auth.uid, not to isSignedIn().
 *
 * Why this wasn't caught earlier: the existing 40 rules tests in
 * firestore.rules.test.ts all use assertFails (negative path) or
 * assertSucceeds against isOwner(...) paths. No test in the repo
 * exercises 'authenticated read of a path that uses isSignedIn()'.
 * My CSP test is the first. So the test-harness bug went undetected
 * because the test surface never touched the broken code path.
 *
 * This file is committed for posterity; do not delete. It's the
 * reproducer for the gap. Anyone touching the rules test setup can
 * run `firebase emulators:exec --only firestore,auth "cd functions
 * && FIRESTORE_RULES_TEST=1 npx vitest run diagnostic.test.ts"` and
 * confirm the harness status before/after dependency changes.
 */
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, describe, it } from 'vitest';

const PROJECT_ID = 'savetheday-rules-test';
let env: any;
const skipEmulator = process.env.FIRESTORE_RULES_TEST !== '1';

function readRules(): string {
  return readFileSync(
    fileURLToPath(new URL('../../firestore.rules', import.meta.url)),
    'utf8',
  );
}

beforeAll(async () => {
  if (skipEmulator) return;
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readRules() },
  });
});

afterAll(async () => {
  if (skipEmulator) return;
  await env.cleanup();
});

describe.skipIf(skipEmulator)('firestore.rules — harness diagnostic', () => {
  // Probe /artifacts/{appId}/proposals/{proposalId}: rule is
  // 'allow read: if isSignedIn()' (firestore.rules:1525).
  const path = ['artifacts', 'savetheday-production', 'proposals', 'probe-doc'] as const;

  it('D1: unauthenticated read of an isSignedIn()-gated doc -> FAIL (expected)', async () => {
    await env.withSecurityRulesDisabled(async (ctx: any) => {
      await setDoc(doc(ctx.firestore(), ...path), { ok: true });
    });
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, ...path)));
  });

  it('D2: authenticated (no claims) read of an isSignedIn()-gated doc -> should SUCCEED', async () => {
    const db = env.authenticatedContext('plain-user').firestore();
    await assertSucceeds(getDoc(doc(db, ...path)));
  });

  it('D3: authenticated (admin: true) read of an isAdmin()-gated doc -> should SUCCEED', async () => {
    // Probe a path whose rule is isAdmin() to confirm whether
    // custom claims propagate at all. /artifacts/.../admin/cspReports/reports/{id}
    // has 'allow read: if isAdmin()' (per amendment 051b217).
    const cspPath = [
      'artifacts',
      'savetheday-production',
      'admin',
      'cspReports',
      'reports',
      'probe-doc',
    ] as const;
    await env.withSecurityRulesDisabled(async (ctx: any) => {
      await setDoc(doc(ctx.firestore(), ...cspPath), { ok: true });
    });
    const db = env.authenticatedContext('admin-user', { admin: true }).firestore();
    await assertSucceeds(getDoc(doc(db, ...cspPath)));
  });
});
