// Shared helper: proxy Firebase callable functions through the
// Vercel serverless proxy. Bypasses Cloud Run's CORS preflight
// rejection that breaks direct browser calls.
//
// 2026-07-22 — Why this exists: Cloud Functions v2 (Cloud Run)
// rejects OPTIONS preflight requests at the edge with 403 even
// when the function has `cors: true` set. This proxy forwards
// browser calls through a Vercel serverless function, so the
// browser sees a same-origin request (no preflight) and the
// Vercel function talks to Cloud Run server-to-server (also no
// preflight).
//
// Usage:
//   import { callFirebaseFn } from '../../lib/firebaseFn';
//   const result = await callFirebaseFn('sendInvitationsV2', { eventId, ... });
//   // result.data is what Firebase callable would have returned
//
// Authorization: the helper auto-attaches the current user's
// ID token if available.

import { auth } from './firebase';

export async function callFirebaseFn(fnName, data) {
  const currentToken = await auth.currentUser?.getIdToken();
  const res = await fetch(`/api/firebase-proxy?fn=${fnName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(currentToken ? { Authorization: 'Bearer ' + currentToken } : {}),
    },
    body: JSON.stringify({ data }),
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    const code = json.error?.code || 'UNKNOWN';
    const detail = json.error?.message || 'unknown';
    const err = Object.assign(new Error(detail), { code, details: json.error });
    throw err;
  }
  return json;
}
