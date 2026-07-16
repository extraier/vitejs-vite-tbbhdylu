// contactLink.js — auto-link vendor contacts to a vendor's account
// once they sign up to the platform, and back-fill assignedVendorUid
// on any tasks pointing at the contact.
//
// 2026-07-15 — closes the loop on the "I know this vendor from
// Instagram, let me onboard them into my to-do list" flow.
//
// What it does
// ------------
// When a new user signs in with email X:
//   1. Query ALL vendorContacts across all owners whose
//      vendorEmail == X AND linkedVendorUid == null.
//      (Real-world: at most a handful of contacts across the
//      whole user base; collectionGroup is fine for this scale.)
//   2. For each match, set linkedVendorUid = auth.uid on that
//      contact.
//   3. For each contact updated, also back-fill assignedVendorUid
//      on every task in that owner's /tasks/ collection where
//      assignedContactId == contact.id AND assignedVendorUid ==
//      '' (the placeholder we write on task creation for
//      unlinked contacts).
//
// Idempotent
// ----------
// Safe to call on every login for the same user. The match
// query excludes already-linked contacts, so re-runs are no-ops.
// The task back-fill uses `assignedVendorUid == ''` as the
// discriminator so we don't overwrite older assignments.
//
// Firestore requirements
// ----------------------
//   - vendorContacts read across all owners  → collectionGroup
//     needs an index on (vendorEmail asc, linkedVendorUid asc).
//     (Firestore prompts the index URL on first run; click it.)
//   - Tasks read+write in /tasks/ subcollection → owner-only
//     read+write rules apply. The vendor's browser doesn't have
//     those perms. So: we run this client-side ONLY when the
//     couple's browser is logged in (the couple carries owner
//     perms for their own /tasks/). For the auto-link to find
//     the contacts across MULTIPLE couples, we'd need a backend.
//
// Two paths
// ---------
//   - 'vendor' — the new user is the vendor themselves. Triggers
//     once on their first vendor-aware login. Needs a backend to
//     discover cross-owner contacts. (See TODO.)
//   - 'couple' — the new user is a couple. Triggers on any
//     login. Limited to their own /vendorContacts. Their own
//     login isn't required for the auto-link to work; the
//     vendor's signup is enough IF a Cloud Function watches.
//
//   For this iteration we ship the simplest variant:
//     client-side, runs from the VENDOR's browser on first
//     login, queries their own owner-scope (their /vendors/{uid}
//     doc) for any stale links. Does NOT scan across couples,
//     so the couple will still need to re-open the contact (or
//     run a one-shot reflink) for the auto-link to populate.
//     Good enough for the demo; the Cloud Function path is
//     the production answer (TODO).

import {
  collection,
  collectionGroup,
  doc,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, appId } from './firebase';

// Try to auto-link this user's email with any unlinked contact.
// `currentUserUid` is the freshly-signed-in user's uid. Their
// email is read from the auth profile.
//
// `onLink` (optional) is called once per linked contact with the
// linked contact for UI feedback.
//
// Returns { linked: number, backfilled: number }.
export async function tryAutoLinkContacts(currentUserUid, currentUserEmail, onLink) {
  if (!currentUserUid || !currentUserEmail) {
    return { linked: 0, backfilled: 0 };
  }
  const email = currentUserEmail.toLowerCase().trim();

  // TODO: cross-owner discovery requires a Cloud Function. This
  // client-side implementation only scans contacts the vendor
  // already had access to via their own owner scope (which is
  // empty for a fresh vendor). For a real link, the couple's
  // app instance must be online OR a backend must scan. We
  // log a console hint so it's discoverable in dev.
  // eslint-disable-next-line no-console
  console.info(
    '[contactLink] cross-owner auto-link not yet wired client-side; ' +
      'manual link via MyVendorsPanel edit or Cloud Function required ' +
      'for full effect.',
  );

  let linked = 0;
  let backfilled = 0;

  // Phase 1: collectionGroup scan for any owner who has a
  // contact with this email AND no linkedVendorUid. Uses
  // (vendorEmail, linkedVendorUid) composite index.
  let cgQuery;
  try {
    cgQuery = query(
      collectionGroup(db, 'vendorContacts'),
      where('vendorEmail', '==', email),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[contactLink] collectionGroup query setup failed:', err?.message);
    return { linked: 0, backfilled: 0 };
  }

  // Read once via getDocs (no live subscription needed here).
  const { getDocs } = await import('firebase/firestore');
  let snap;
  try {
    snap = await getDocs(cgQuery);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[contactLink] contacts lookup failed (likely missing composite index):',
      err?.message,
    );
    return { linked: 0, backfilled: 0 };
  }

  if (snap.empty) {
    return { linked: 0, backfilled: 0 };
  }

  // Group contacts by ownerUid so we can batch updates per
  // owner (an owner's contacts + tasks share the same rules).
  const byOwner = new Map();
  for (const docSnap of snap.docs) {
    // path: artifacts/{appId}/users/{ownerUid}/vendorContacts/{id}
    const ownerUid = docSnap.ref.parent.parent?.id;
    if (!ownerUid) continue;
    // Skip already-linked contacts. (Index on linkedVendorUid
    // would let us filter server-side, but at this scale
    // skipping client-side is fine.)
    if (docSnap.data().linkedVendorUid) continue;
    if (!byOwner.has(ownerUid)) byOwner.set(ownerUid, []);
    byOwner.get(ownerUid).push({ id: docSnap.id, ref: docSnap.ref, data: docSnap.data() });
  }

  // Phase 2: per owner, batch-update contacts + tasks. We need
  // owner-scoped writes here. This client is the vendor, NOT
  // the owner; so per-owner writes will fail with PERMISSION
  // DENIED. To avoid spam from logged failures, we still attempt
  // — the failure is silent (no toast) and the todo is annotated
  // for the next round to handle via a backend callable.
  for (const [ownerUid, contacts] of byOwner) {
    try {
      const batch = writeBatch(db);
      for (const c of contacts) {
        batch.update(c.ref, {
          linkedVendorUid: currentUserUid,
          invitationAccepted: true,
        });
        linked++;
      }

      // Phase 3: back-fill tasks for these contacts. Each owner
      // has their own /tasks/ subcollection; we do a per-owner
      // query and append the tasks to the same batch.
      for (const c of contacts) {
        const tasksQ = query(
          collection(db, 'artifacts', appId, 'users', ownerUid, 'tasks'),
          where('assignedContactId', '==', c.id),
        );
        const tasksSnap = await getDocs(tasksQ);
        for (const t of tasksSnap.docs) {
          // Only back-fill if currently unassigned (empty string).
          if (t.data().assignedVendorUid) continue;
          batch.update(t.ref, {
            assignedVendorUid: currentUserUid,
            assignedVendorName:
              t.data().assignedVendorName || c.data().vendorName || '',
          });
          backfilled++;
        }
      }

      // The vendor's auth.uid does NOT have perms to write
      // another owner's /tasks/ subcollection. This batch will
      // fail with PERMISSION_DENIED. We swallow the error so
      // it doesn't break the login flow, but the link is not
      // persisted. The production fix is a Cloud Function
      // callable that runs with admin credentials.
      try {
        await batch.commit();
        // Success path — fire callbacks + log.
        for (const c of contacts) {
          onLink?.({
            contactId: c.id,
            ownerUid,
            vendorName: c.data.vendorName,
          });
        }
        // eslint-disable-next-line no-console
        console.info(
          `[contactLink] auto-linked ${linked} contact(s), back-filled ${backfilled} task(s)`,
        );
      } catch (commitErr) {
        // eslint-disable-next-line no-console
        console.warn(
          '[contactLink] cross-owner batch write blocked by rules; ' +
            'this is expected until a backend callable is wired:',
          commitErr?.message,
        );
        // Reset counters since the actual writes didn't land.
        linked = 0;
        backfilled = 0;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[contactLink] owner ${ownerUid} processing failed:`, err?.message);
    }
  }

  return { linked, backfilled };
}

// Helper: link a specific contact to a vendor uid. Called from
// MyVendorsPanel when the user manually edits a contact (or from
// a future "contact the vendor at this URL and they'll be linked"
// flow). This skips the cross-owner permission issue because the
// *couple* is calling it on their own owner-scoped data.
export async function linkSingleContact(ownerUid, contactId, vendorUid) {
  if (!ownerUid || !contactId || !vendorUid) {
    return { ok: false, reason: 'missing-args' };
  }
  const { updateDoc } = await import('firebase/firestore');
  try {
    await updateDoc(
      doc(db, 'artifacts', appId, 'users', ownerUid, 'vendorContacts', contactId),
      { linkedVendorUid: vendorUid },
    );
    return { ok: true };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[contactLink] linkSingleContact failed:', err?.message);
    return { ok: false, reason: err?.message };
  }
}
