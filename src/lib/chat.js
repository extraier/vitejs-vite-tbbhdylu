// chat.js — Firestore helpers for the vendor ↔ couple chat system.
//
// Data model:
//   artifacts/{appId}/vendorInquiries/{inquiryId}/
//     - vendorUid, coupleUid       (the two parties; inquiry is keyed by sorted {vendorUid}_{coupleUid})
//     - vendorName, coupleName
//     - eventId                     (which wedding this is about)
//     - createdAt, lastMessageAt
//     - coupleUnread, vendorUnread  (counter for unread badge)
//     - lastMessagePreview
//
//   artifacts/{appId}/vendorInquiries/{inquiryId}/messages/{messageId}/
//     - senderUid, senderRole        ('vendor' | 'couple')
//     - text
//     - createdAt
//
// Lives at the top-level 'vendorInquiries' collection (NOT under
// either user's path) so both parties can read+write via Firestore
// rules without complex cross-user checks.

import {
  collection,
  doc,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  increment,
  getDocs,
} from 'firebase/firestore';
import { db, appId } from './firebase';

const COL = `artifacts/${appId}/vendorInquiries`;

// Deterministic inquiry id so couple + vendor both know which thread
// they're talking to. The id is sorted so pair order is canonical.
export function inquiryIdFor(vendorUid, coupleUid) {
  return [vendorUid, coupleUid].sort().join('__');
}

// ---- Create or fetch an inquiry ----
// Returns the inquiry id (caller can then navigate to /chat-room/:id).
export async function openInquiry({ vendorUid, coupleUid, vendorName, coupleName, eventId }) {
  const id = inquiryIdFor(vendorUid, coupleUid);
  const ref = doc(db, COL, id);
  await setDoc(
    ref,
    {
      vendorUid,
      coupleUid,
      vendorName: vendorName || '',
      coupleName: coupleName || '',
      eventId: eventId || '',
      createdAt: serverTimestamp(),
      lastMessageAt: serverTimestamp(),
      lastMessagePreview: '',
      coupleUnread: 0,
      vendorUnread: 0,
    },
    { merge: true },
  );
  return id;
}

// ---- Send a message ----
// Atomically:
//   1. Append message to messages subcollection
//   2. Bump lastMessageAt + lastMessagePreview on parent
//   3. Increment unread counter for the recipient
// Note: we do these in sequence (not a batch) because the parent
// update references dynamic values. The chance of partial failure is
// low; if the message lands but the counter doesn't, the unread
// badge is just slightly off until the next message.
export async function sendMessage({ inquiryId, senderUid, senderRole, text }) {
  if (!text || !text.trim()) return;
  const clean = text.trim();
  const inquiryRef = doc(db, COL, inquiryId);
  const messagesRef = collection(db, COL, inquiryId, 'messages');

  // 1. Append the message
  await addDoc(messagesRef, {
    senderUid,
    senderRole,
    text: clean,
    createdAt: serverTimestamp(),
  });

  // 2. Bump parent counters. Recipient is the OTHER party.
  const isFromCouple = senderRole === 'couple';
  await updateDoc(inquiryRef, {
    lastMessageAt: serverTimestamp(),
    lastMessagePreview: clean.length > 80 ? clean.slice(0, 80) + '...' : clean,
    // Increment unread for the OTHER side
    coupleUnread: isFromCouple ? 0 : increment(1),
    vendorUnread: isFromCouple ? increment(1) : 0,
  });
}

// ---- Subscribe to a single inquiry's messages ----
// Returns the unsubscribe function.
export function subscribeToMessages(inquiryId, callback) {
  const q = query(
    collection(db, COL, inquiryId, 'messages'),
    orderBy('createdAt', 'asc'),
  );
  return onSnapshot(q, (snap) => {
    callback(
      snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
        // serverTimestamp is null until server confirms; fall back to now
        createdAt: d.data().createdAt?.toMillis?.() || Date.now(),
      })),
    );
  });
}

// ---- Subscribe to all inquiries for a user (vendor or couple) ----
// Returns the unsubscribe function. List is sorted client-side by
// lastMessageAt desc (Firestore would need a composite index otherwise).
export function subscribeToInquiries(userUid, role, callback) {
  // role is 'vendor' or 'couple' — pick the right field.
  const field = role === 'vendor' ? 'vendorUid' : 'coupleUid';
  const q = query(collection(db, COL), where(field, '==', userUid));
  return onSnapshot(q, (snap) => {
    const all = snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
      createdAt: d.data().createdAt?.toMillis?.() || 0,
      lastMessageAt: d.data().lastMessageAt?.toMillis?.() || 0,
    }));
    all.sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
    callback(all);
  });
}

// ---- Mark all messages in an inquiry as read for one side ----
// Zeros out the unread counter for the side that just viewed it.
export async function markInquiryRead(inquiryId, role) {
  const ref = doc(db, COL, inquiryId);
  await updateDoc(ref, {
    coupleUnread: role === 'couple' ? 0 : undefined,
    vendorUnread: role === 'vendor' ? 0 : undefined,
  });
}

// ---- Aggregate unread count for a user ----
// (used to power the header inbox badge)
export async function fetchUnreadCount(userUid, role) {
  const field = role === 'vendor' ? 'vendorUid' : 'coupleUid';
  const counterField = role === 'vendor' ? 'vendorUnread' : 'coupleUnread';
  const q = query(collection(db, COL), where(field, '==', userUid));
  const snap = await getDocs(q);
  let total = 0;
  for (const d of snap.docs) {
    total += d.data()[counterField] || 0;
  }
  return total;
}