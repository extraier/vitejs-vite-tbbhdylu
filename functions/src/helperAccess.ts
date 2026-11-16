/**
 * listMyHelperAssignments — the signed-in helper's own invites and
 * assignments.
 *
 * The client used to run collectionGroup('pendingInvites') before
 * collectionGroup('helpers'). Rules allow pendingInvites reads only
 * for the owner or co-owner, and the same collection id also exists
 * under /vendors/{slug}/pendingInvites. Firestore rules are not
 * filters, so the invitee's query is denied and the helpers query
 * never ran. Active helpers disappeared with the invites.
 *
 * An email-keyed client rule would have to allow that query on every
 * pendingInvites path, including vendor outreach. This callable reads
 * with the Admin SDK and returns only path-checked helper rows.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import {
  dedupeHelperAssignments,
  projectHelperAssignmentForCaller,
} from './helperInvitePure';

const APP_ID = 'savetheday-production';

export const listMyHelperAssignments = onCall(
  { cors: true, region: 'us-central1' },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const authEmail = req.auth.token.email?.trim().toLowerCase();
    if (!authEmail) {
      throw new HttpsError('failed-precondition', 'Sign in with an email to see helper invites.');
    }
    const authUid = req.auth.uid;
    const db = getFirestore();

    const [pending, helpers] = await Promise.all([
      db.collectionGroup('pendingInvites')
        .where('email', '==', authEmail)
        .where('kind', '==', 'helper')
        .get(),
      db.collectionGroup('helpers')
        .where('helperUid', '==', authUid)
        .get(),
    ]);

    const views = [];
    for (const doc of [...pending.docs, ...helpers.docs]) {
      const view = projectHelperAssignmentForCaller({
        id: doc.id,
        path: doc.ref.path,
        data: doc.data() as Record<string, unknown>,
        authUid,
        authEmail,
        expectedAppId: APP_ID,
      });
      if (view) views.push(view);
    }

    return { assignments: dedupeHelperAssignments(views) };
  },
);
