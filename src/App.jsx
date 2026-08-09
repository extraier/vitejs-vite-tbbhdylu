import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Heart, Users, MessageCircle, ChevronLeft } from 'lucide-react';
import {
     addDoc,
     collection,
     collectionGroup,
     deleteDoc,
     doc,
     getDoc,
     limit,
     onSnapshot,
     orderBy,
     query,
     serverTimestamp,
     setDoc,
     updateDoc,
     where,
     writeBatch,
     } from 'firebase/firestore';

import { db, appId } from './lib/firebase';

// ─── onSnapshot import retention (defensive, no longer load-bearing) ────
// Historical context: importing `onSnapshot` from `firebase/firestore` used
// to be required as a side effect of prototype-patching
// `CollectionReference.prototype.onSnapshot`. That prototype patch never
// existed in modular SDK v10.x (only the compat SDK) — the real bug was
// `useFirestoreCollection` calling `collectionRef.onSnapshot(...)` instead
// of `onSnapshot(collectionRef, ...)`. Now fixed in the hook itself.
//
// We keep the `globalThis` retention here so other code paths can verify
// `typeof globalThis.__firestore_onSnapshot === 'function'` if needed,
// but it is no longer required for the runtime to work.
if (typeof globalThis !== 'undefined') {
  globalThis.__firestore_onSnapshot = onSnapshot;
}
import {
  DEFAULT_VENDORS,
  FREE_TIER_LIMIT_MB,
  INITIAL_JOB_REQUESTS,
  getTaskCategoryLabel,
} from './lib/config';
import { parseGuestParams } from './lib/guestMode';
import { uploadPhotoToNas } from './lib/uploadToNas';
import { recordTaskStatusUpdate } from './lib/taskUpdates';
import {
  openInquiry,
  subscribeToInquiries,
  markInquiryRead,
  inquiryIdFor,
} from './lib/chat';
import { tryAutoLinkContacts } from './lib/contactLink';
import { useAuth } from './hooks/useAuth';
import { usePartnerInvitePreview } from './hooks/usePartnerInvitePreview';
import { useHelperAuth } from './hooks/useHelperAuth';
import { useFirestoreCollection } from './hooks/useFirestoreCollection';
import { useFirestoreDoc } from './hooks/useFirestoreDoc';
import { useUserProfile } from './hooks/useUserProfile';
import { useUploadPreferencesToken } from './hooks/useUploadPreferencesToken';
import { useEventOwnerNames } from './hooks/useEventOwnerNames';
import { useToast } from './hooks/useToast';
// 2026-07-26 — Co-owners (couples / partners) front-end bindings.
// See src/lib/partnerInvite.ts for the shapes; the Cloud Functions
// live at functions/src/partnerInvite.ts.
import {
  partnerInviteApi,
  clearPartnerTokenFromUrl,
} from './lib/partnerInvite';
import { signInAnonymously } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from './lib/firebase';
import { callFirebaseFn } from './lib/firebaseFn';

import { LoginScreen } from './screens/LoginScreen';
import { VendorSignupCard } from './components/VendorSignupCard';
import { EventsDashboard } from './screens/EventsDashboard';
import { CoupleChecklist } from './screens/CoupleChecklist';
import { CoupleBudget } from './screens/CoupleBudget';
import { CoupleJobBoard } from './screens/CoupleJobBoard';
import { GuestList } from './screens/GuestList';
import { PhotoDrop } from './screens/PhotoDrop';
import { DiscoverDirectory } from './screens/DiscoverDirectory';
import { VendorAnalytics } from './screens/VendorAnalytics';
import { AdminUsers } from './screens/AdminUsers';
import { AdminQueue } from './screens/AdminQueue';
import { AdminVendors } from './screens/AdminVendors';
import { AdminImportVendors } from './screens/AdminImportVendors';
import { AdminPaymentSettings } from './screens/AdminPaymentSettings';
import { VendorOnboarding } from './screens/VendorOnboarding';
import { VendorDashboard } from './screens/VendorDashboard';
import { VendorProfileEdit } from './screens/VendorProfileEdit';
import { MyProfile } from './screens/MyProfile';
import { ReceptionScanner } from './screens/ReceptionScanner';
import { HelperDashboard } from './screens/HelperDashboard';
import { WeddingDay } from './screens/WeddingDay';
import { ChatRoom } from './screens/ChatRoom';
import { Inbox } from './screens/Inbox';
import { PersonalGuestPortal } from './screens/PersonalGuestPortal';
import { InvitationEditor } from './screens/InvitationEditor';
import { RedPacketManager } from './screens/RedPacketManager';

import { RoleSimulator } from './components/RoleSimulator';
import { GuestBanner } from './components/GuestBanner';
import { TabNav } from './components/TabNav';
import { JoinAsVendorCTA } from './components/JoinAsVendorCTA';
import { UpgradeModal } from './components/modals/UpgradeModal';
import { PurchaseModal } from './components/PurchaseModal';
import { UserMenu } from './components/UserMenu';
import { ProjectHeader } from './components/ProjectHeader';
import { EventRenameModal } from './components/modals/EventRenameModal';
import { PaymentModal } from './components/modals/PaymentModal';
import { QrCodeModal } from './components/modals/QrCodeModal';
import { EditGuestModal } from './components/modals/EditGuestModal';
import { VendorModal } from './components/modals/VendorModal';
import { VendorInviteLinkModal } from './components/modals/VendorInviteLinkModal';
import { MyVendorsPanel } from './components/MyVendorsPanel';
import { ProposalsModal } from './components/modals/ProposalsModal';
import { SubmitProposalModal } from './components/modals/SubmitProposalModal';
import { BellNotifications } from './components/BellNotifications';
import { NotificationsCenter } from './components/NotificationsCenter';
import { markProposalsSeenExact } from './hooks/useProposalBell';
import { InviteModal } from './components/modals/InviteModal';
import { HelperManager } from './components/modals/HelperManager';
import { NotOnboardedEmailModal } from './components/modals/NotOnboardedEmailModal';
import { HelperWaitingScreen } from './screens/HelperWaitingScreen';
import { ScanResultModal } from './components/modals/ScanResultModal';
import { FullscreenSlideshow } from './components/modals/FullscreenSlideshow';
import { SignUpPromptModal } from './components/modals/SignUpPromptModal';
import { ChangePasswordModal } from './components/modals/ChangePasswordModal';
import { InvitePartnerModal } from './components/modals/InvitePartnerModal';
import { EventSettingsModal } from './components/modals/EventSettingsModal';

export default function App() {
  // Auth
  const {
    user,
    authChecked,
    isAdmin,
    isVendor,
    isAnonymous,
    loginWithGoogle,
    loginWithEmail,
    registerWithEmail,
    continueAsGuest,
    linkAnonymousWithEmail,
    logout,
    // 2026-08-05 — opt the anonymous session in after the share
    // redeem in lines 880-905 signs in anonymously. Without this,
    // useAuth.onAuthStateChanged sees currentUser.isAnonymous &&
    // !allowAnonymous and STORES the user as null, so the upload
    // handler at App.jsx 2507 sees `!user` and fails with
    // "登入狀態已過期" — exactly what the previous screenshot showed.
    acceptAnonymousSession,
  } = useAuth();
  // 2026-07-26 — Partner-invite pre-fill. Detects ?t=<token> in URL,
  // calls previewPartnerInvite CF, and exposes the partnerEmail + eventName
  // so the LoginScreen can pre-fill the form and show a welcome message.
  // See src/hooks/usePartnerInvitePreview.js for the full flow.
  const { invite: partnerInvite, validatedToken: partnerValidatedToken } = usePartnerInvitePreview();
  // 2026-07-26 — Co-owners (couples / partners) auto-redeem.
  // The partner's magic-link email contains ?t=<token>. When they
  // click it, the front-end detects the token on mount, calls
  // redeemPartnerInvite, and switches to the joined event. The
  // token is then cleared from the URL bar.
  //
  // 2026-08-02 (round 3) — the redeem source is now partnerValidatedToken
  // (set by the hook ONLY after server-side preview success) instead of
  // the old sessionStorage/URL hand-off. The old design had the hook
  // writing sessionStorage at effect-start so App.jsx's parallel effect
  // could find the token after auth — but that meant the redeem could
  // fire BEFORE the preview validated the token, producing a parallel
  // 403 on dead tokens. validatedToken serialises the flow: preview
  // validates first, then App.jsx redeems. Dead tokens never make it
  // past the gate. See src/hooks/usePartnerInvitePreview.js for the
  // full reasoning.
  // We also handle the "user isn't signed in yet" case: stash the
  // token and replay it after they sign in/up. Without this,
  // the partner would have to keep the email tab open through
  // the whole sign-up flow.
  //
  // IMPORTANT: this useEffect is at the TOP of the function
  // (right after useAuth) so it can fire as early as possible.
  // The dependency array deliberately does NOT include
  // `userRole` — that state is declared further down the
  // function body, and reading it here would hit the
  // Temporal Dead Zone (TDZ), crashing the entire app with
  // "Cannot access 'X' before initialization". We read the
  // current userRole via a ref instead.
  const userRoleRef = useRef(null);
  // 2026-07-03 — guest signup prompt state. Triggered by either the
  // GuestBanner CTA, the "create event" button, or any other write-
  // capable action when the user is anonymous. On successful link,
  // isAnonymous flips false and the modal self-closes via parent re-render.
  const [showSignUpPrompt, setShowSignUpPrompt] = useState(false);
  // Stash the create-event form input so we can replay the create after
  // a successful anonymous→email link. Set by handleCreateEvent when
  // it bails on isAnonymous, cleared by handleLinkGuestAccount on success.
  const [pendingCreateEventName, setPendingCreateEventName] = useState(null);

  // 2026-07-14 — 'signing up as' toggle. null = regular login, 'vendor' =
  // show the dedicated VendorSignupCard instead. Set when the user clicks
  // the green 'I'm a Vendor' CTA on the public main page, cleared when
  // they click 'back to sign in' on the vendor card.
  const [signingUpAs, setSigningUpAs] = useState(null);

  // 2026-07-14 — defensive modal close. If the user signs in (Google or
  // email) WHILE the signup prompt is open, the modal stays open unless
  // something explicitly closes it. handleLinkGuestAccount closes it on
  // successful anonymous→email link, but Google login and the regular
  // email sign-in flow don't go through that path. This effect catches
  // every "user is no longer anonymous" transition and closes the modal.
  useEffect(() => {
    if (!isAnonymous && user && showSignUpPrompt) {
      setShowSignUpPrompt(false);
      setPendingCreateEventName(null);
    }
  }, [isAnonymous, user, showSignUpPrompt]);

  // Helper context (兄弟姊妹). Only meaningful when the user is signed in
  // (not anonymous) and NOT in guest-mode URL. The hook itself is safe to
  // call unconditionally — it no-ops if no user.
  const helperCtx = useHelperAuth();
  const [helperAccepting, setHelperAccepting] = useState(false);

  // 2026-08-01 (TDZ hotfix) — pulled into useUserProfile() below,
  // immediately after the `currentEvent` declaration. The owner
  // names subscription needs `currentEvent?.id`, but `currentEvent`
  // is declared ~150 lines further down — reading it here would
  // trigger Temporal Dead Zone ReferenceError and blank out the
  // root. The call is therefore deferred to line ~360.
  const { ownerNames: legacyOwnerNames, unlocks: userUnlocks } = useUserProfile(user);
  // (useEventOwnerNames hook call moved — see below.)

  // 2026-08-02 — Upload preferences token (Option 1, watermark).
  // The hook call is intentionally below the currentEvent/dataOwnerUid
  // declarations. Keeping this note next to the user-unlocks source
  // makes the dependency explicit without evaluating a later const
  // during the first render (which would trigger a TDZ crash).
  const _userUnlocksForUpload = userUnlocks;

  // 2026-07-15 — auto-route vendors to their dashboard. When the user
  // signs in and has the `vendor: true` custom claim (set by
  // applyAsVendor), we flip userRole to 'vendor' and route them to the
  // vendor dashboard. Without this, returning vendors would land on
  // the couple events-dashboard and see the "I'm a Vendor" CTA again.
  //
  // The role check also runs on every isVendor change, so when the
  // claim flips true mid-session (after submitting the wizard) we
  // auto-route instead of leaving the user stuck on a stale screen.
  useEffect(() => {
    if (!user || user.isAnonymous) return;
    if (!isVendor) return;
    setUserRole('vendor');
    if (currentView !== 'vendor-dashboard') {
      setCurrentView('vendor-dashboard');
    }
  }, [isVendor, user]);

  // NOTE: helper auto-route is intentionally NOT here — moving it
  // next to the vendor one would create a Temporal Dead Zone
  // because `helperActiveAssignment` is declared below this point
  // (it depends on `helperCtx` which is grouped with the other
  // data hooks). The auto-route useEffect is co-located with the
  // `helperActiveAssignment` definition further down. See hook
  // order for context.

  // 2026-07-14 — post-login intent routing. If the user clicked the
  // 'I'm a Vendor' CTA on the LoginScreen before signing up, the screen
  // stashed 'vendor-onboarding' in sessionStorage. On login, we route
  // them straight into the wizard. Cleared after consumption so they
  // don't get auto-routed back to the wizard on subsequent visits.
  useEffect(() => {
    if (!user || user.isAnonymous) return;
    let intent;
    try {
      intent = sessionStorage.getItem('postLoginIntent');
    } catch {
      return;
    }
    if (intent === 'vendor-onboarding') {
      try {
        sessionStorage.removeItem('postLoginIntent');
      } catch {
        // ignore
      }
      setCurrentView('vendor-onboarding');
    }
  }, [user]);

  // 2026-07-20 — vendor invitation deep-link. If the user opened a
  // `?signup&venue=<slug>&token=<token>` link, we stash the (slug,
  // token) into sessionStorage so the vendor onboarding wizard can
  // submit through claimAndApplyAsVendor instead of applyAsVendor.
  //
  // Two effects (not one): the first captures the query string the
  // moment the page loads — it must run BEFORE the user exists, so
  // it does NOT route into the wizard itself. The second effect
  // (right below) watches for `user` becoming truthy and routes
  // them in if a pending invite is stashed.
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get('signup') !== '1') return;
      const venue = sp.get('venue');
      const token = sp.get('token');
      if (!venue || !token) return;
      sessionStorage.setItem(
        'pendingVendorInvite',
        JSON.stringify({ slug: venue, token, capturedAt: Date.now() }),
      );
      // Strip the query so the URL doesn't keep advertising the
      // token on every nav. history.replaceState keeps the page
      // from reloading.
      const url = new URL(window.location.href);
      url.searchParams.delete('signup');
      url.searchParams.delete('venue');
      url.searchParams.delete('token');
      window.history.replaceState({}, '', url.toString());
    } catch {
      // ignore — query string capture is a soft path. If sessionStorage
      // is disabled the user can still manually navigate to the wizard.
    }
  }, []); // mount-only

  // When the user signs in (during or after the visit that brought
  // them here), route into the wizard if a pending invite is stashed.
  useEffect(() => {
    if (!user || user.isAnonymous) return;
    try {
      const raw = sessionStorage.getItem('pendingVendorInvite');
      if (!raw) return;
      const pending = JSON.parse(raw);
      if (!pending?.slug || !pending?.token) {
        // stale or malformed — drop it
        sessionStorage.removeItem('pendingVendorInvite');
        return;
      }
      setCurrentView('vendor-onboarding');
    } catch {
      // ignore
    }
  }, [user]);

  // Hermes 2026-07-03: helperPerms is derived once currentEvent is declared
  // (below, around line 107). The declaration is placed there because
  // JavaScript's temporal dead zone forbids referencing consts before they
  // are initialised — and yes, the earlier patch accidentally placed the
  // derivation above currentEvent's declaration, which threw at render time
  // and left #root empty.

  // Guest-mode URL params
  const guest = parseGuestParams(
    typeof window !== 'undefined' ? window.location.search : '',
  );

  // 2026-08-05 — Stash URL-derived owner/event ids on window
  // SYNCHRONOUSLY (before any useEffect fires) so the
  // PersonalGuestPortal's EntryPassCard can build the entry-pass
  // URL on the first render. The useEffect below (line 1598)
  // also re-syncs these once currentEvent resolves from
  // Firestore, but the sync assignment here is what makes the
  // card render correctly during the brief window between
  // guest-mode sign-in and the event doc subscription.
  // QrCodeModal also reads window.__ownerUid / __currentEventId
  // the same way.
  if (typeof window !== 'undefined') {
    window.__ownerUid = window.__ownerUid || guest.qOwner || '';
    window.__currentEventId =
      window.__currentEventId || guest.qEvent || '';
  }

  // 2026-08-05 — One-shot self-heal for the partner-invite banner
  // bug. If the user has a stale `__heropartnerinvite_token`
  // sitting in localStorage from a previously-failed redeem, the
  // hook will replay it on every page load (via readStashedToken)
  // and the 💍 婚禮共同籌備邀請 banner will keep popping up.
  //
  // Safe heuristic: a REAL invite always has ?t=<token> in the
  // URL on first receipt (usePartnerInvitePreview reads URL first,
  // localStorage only as resume). If the user lands on the page
  // WITHOUT ?t= in the URL AND a stash exists, it's a leftover
  // from a dead/failed/cleared flow → safe to clear.
  //
  // Guarded by a window flag so we run exactly once per page load.
  // After this runs once, future failures can't create a new
  // orphan (processToken clears the stash unconditionally now).
  if (
    typeof window !== 'undefined' &&
    !window.__partnerInviteSelfHealApplied
  ) {
    try {
      if (!window.location.search.includes('t=')) {
        window.localStorage.removeItem('__heropartnerinvite_token');
      }
    } catch {}
    window.__partnerInviteSelfHealApplied = true;
  }

  // Toast
  const { toast, showToast } = useToast();

  // Role / view
  const [userRole, setUserRole] = useState(guest.isGuestMode ? 'guest_portal' : 'owner');
  const [currentView, setCurrentView] = useState(
    guest.isGuestMode ? 'guest-portal' : 'events-dashboard',
  );

  // 2026-07-15 — chat state. selectedInquiry holds the conversation
  // the user is currently viewing in ChatRoom; null when on the inbox.
  const [selectedInquiry, setSelectedInquiry] = useState(null);

  // Current selection
  const [currentEvent, setCurrentEvent] = useState(null);
  const [activeCategory, setActiveCategory] = useState(null);

  // 2026-08-01 (TDZ hotfix) — owner-names subscription moved here
  // from line 217, because `currentEvent` is declared above this
  // point. The hook reads `currentEvent?.id` + `user?.uid`. The
  // legacyOwnerNames fallback (from useUserProfile) covers users
  // who set their names before the pivot shipped — it'll be
  // removed in Commit 2 migration. Reads get filtered through the
  // dedup-with-`?? ''` pattern so consumers never see undefined.
  const { ownerNames } = useEventOwnerNames(
    currentEvent?.id,
    user?.uid,
    legacyOwnerNames,
  );

  // 2026-07-26 — Co-owners (couples / partners) auto-redeem. This
  // is split out from the top-of-function declaration so it can
  // safely reference setCurrentEvent, setUserRole, setCurrentView,
  // and showToast — all of which are declared below the top.
  // (Putting this useEffect up top with userRole in the deps
  // caused a TDZ crash because the deps array was evaluated
  // before userRole was initialised.)
  // 2026-08-02 (round 3) — simplified. The hook now owns the token
  // lifecycle: it resolves the token from URL or localStorage,
  // fires previewPartnerInvite, and ONLY on server-side success
  // sets partnerValidatedToken. We wait for that signal here, so
  // we never redeem a dead token. We do NOT read sessionStorage
  // or extractPartnerTokenFromUrl() anymore — both used to race
  // with the preview (the old sessionStorage write happened before
  // the preview fired, so App.jsx's parallel effect could redeem
  // a not-yet-validated token).
  //
  // Edge case: user signs in BEFORE the preview returns success.
  // Old design handled this by App.jsx writing URL token to
  // sessionStorage (line 383) and the hook writing sessionStorage
  // unconditionally (line 127 of the hook, removed in round 3).
  // New design: partnerValidatedToken is null until preview
  // resolves, so the redeem simply waits. The user sees the
  // LoginScreen with the welcome card for a few hundred ms longer
  // before being routed to the event page. Acceptable trade-off
  // for never-firing-a-403-on-a-dead-token.
  useEffect(() => {
    if (!partnerValidatedToken) return;
    if (!user) return;
    return processToken(partnerValidatedToken, user, userRole);
    // partnerValidatedToken is the trigger. user?.uid is the gate.
    // userRole is read via the ref (NOT in deps) so role changes
    // don't re-fire the redeem — see the comment at processToken.
  }, [partnerValidatedToken, user?.uid]);
  // (NOT [user?.uid, userRole] — that would re-run the redeem on
  // every role change, which is wrong. The body reads userRole
  // from the current closure; the ref keeps it fresh.)

  function processToken(token, user, userRole) {
    // Keep the ref in sync so the TDZ-safe version of this
    // effect (if we need it) can read the latest userRole.
    userRoleRef.current = userRole;
    // Signed in — redeem now
    let cancelled = false;
    (async () => {
      // 2026-08-05 — Always clear the stashed token up front,
      // regardless of whether the redeem succeeds or fails.
      // Previously the clear only happened on the success path
      // (after `redeemPartnerInviteV2` returned), so a failed
      // redeem (wrong signed-in account, network blip, server
      // 5xx, expired token, etc.) would leave the token in
      // localStorage. Then every future page load replayed it
      // via readStashedToken() → preview succeeded → the
      // 💍 婚禮共同籌備邀請 banner came back on every visit.
      //
      // Now we clear unconditionally: if the redeem genuinely
      // succeeded, great; if it failed, the user gets a clean
      // state and can re-engage only with a fresh invite link
      // (matching the server's single-use semantics).
      try { localStorage.removeItem('__heropartnerinvite_token'); } catch {}
      try {
        const result = await partnerInviteApi.redeem({ token });
        if (cancelled) return;
        clearPartnerTokenFromUrl();
        try { sessionStorage.removeItem('pendingPartnerToken'); } catch {}
        // 2026-08-02 (round 3) — sessionStorage was the old
        // hand-off key written by usePartnerInvitePreview at
        // effect-start. That write was removed in round 3
        // (replaced by partnerValidatedToken state), but we keep
        // this removeItem as defensive cleanup in case any
        // stale tab still has a leftover key from the old
        // round-1/2 design — one tab-load and it's gone.
        //
        // (localStorage stash cleared above, before the await,
        // so we don't repeat it here.)
        const eventDocRef = doc(
          db,
          'artifacts',
          appId,
          'users',
          result.ownerUid,
          'events',
          result.eventId,
        );
        const eventDoc = await getDoc(eventDocRef);
        if (cancelled) return;
        if (eventDoc.exists()) {
          setCurrentEvent({ id: eventDoc.id, ...eventDoc.data() });
          if (userRole === 'guest_portal') {
            setUserRole('owner');
          }
          setCurrentView('couple-checklist');
          showToast?.(`💍 你已加入「${result.event.name}」！歡迎一起籌備婚禮。`);
        } else {
          showToast?.('⚠️ 邀請已接受，但找不到對應的婚禮資料。請聯絡你的另一半。');
        }
      } catch (err) {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error('[partnerInvite] redeem failed:', err);
        clearPartnerTokenFromUrl();
        const msg = (err && err.message) || String(err);
        showToast?.('❌ 接受邀請失敗：' + msg);
        // 2026-08-05 — Also clear the hook's invite state so the
        // 💍 banner on the LoginScreen goes away immediately, not
        // on the next page load. The hook reads from localStorage
        // only on mount, but `invite` is held in React state and
        // would otherwise survive until a hard reload. We can't
        // call clearInvite directly here (it's a hook return
        // value, not in this scope), so we dispatch a
        // window-level event the hook listens to. See
        // usePartnerInvitePreview.js for the listener.
        try {
          window.dispatchEvent(new CustomEvent('partner-invite-clear'));
        } catch {}
      }
    })();
    return () => { cancelled = true; };
  }

  // Hermes 2026-07-03: derive helperPerms for the current event so the
  // GuestList (and any other per-event consumer) can read capabilities.
  // Resolves to null when the user is not a helper for this wedding — which
  // is the correct "no special perms" shape consumed by GuestList / EditGuest.
  const helperPerms = currentEvent?.userId
    ? helperCtx.getPerms(currentEvent.userId)
    : null;

  // 2026-07-19 — `helperActiveAssignment` for the helper dashboard.
  // In helper mode there's no currentEvent (the helper doesn't own any
  // wedding), so we derive an "assignment" object the `<HelperDashboard>`
  // can render against. Picks the first active assignment when there
  // are multiple (today they're rarely >1; in future this could be a
  // dropdown of "switch wedding").
  const helperActiveAssignment = useMemo(() => {
    if (!helperCtx.assignments) return null;
    const a = helperCtx.assignments.find(
      (x) => x.status === 'active' && x.ownerUid,
    );
    if (!a) return null;
    return {
      id: a.id,
      ownerUid: a.ownerUid,
      ownerName: a.displayName || a.email || null,
      perms: a.perms || {},
    };
  }, [helperCtx.assignments]);

  // 2026-07-19 — auto-route active helpers (兄弟姊妹) to their
  // dashboard. Co-located with `helperActiveAssignment` because
  // referring to it from an earlier useEffect would crash
  // (`const` declarations are not hoisted — the deps array is
  // evaluated when useEffect is called, putting the reference in
  // TDZ). Vendor role takes precedence; helper waiting screen
  // earlier in the render path handles the "active-not-yet" case.
  useEffect(() => {
    if (!user || user.isAnonymous) return;
    if (helperCtx.loading) return;
    if (!helperActiveAssignment) return;
    if (isAdmin) return;
    if (isVendor) return;
    if (userRole === 'helper' && currentView === 'helper-dashboard') return;
    setUserRole('helper');
    setCurrentView('helper-dashboard');
  }, [
    helperCtx.loading,
    helperActiveAssignment,
    user,
    isVendor,
    isAdmin,
    userRole,
    currentView,
  ]);
  const [activeVenue, setActiveVenue] = useState(null);
  const [activeGuestPortal, setActiveGuestPortal] = useState(null);

  // Vendors — 2026-07-20 was static DEFAULT_VENDORS. Now also
  // subscribes to the live /vendors collection so couples browsing
  // the 商戶指南 see the 668 imported heychoices vendors alongside
  // the 4 demo entries. The live list is filtered to status !==
  // 'rejected' / 'suspended' so bad docs don't leak into the
  // catalog. The merge dedupes by doc.id so the same vendor
  // doesn't appear twice (rare but possible if a vendor was added
  // both to DEFAULT_VENDORS and as a seeded Firestore doc).
  const [vendorsStatic] = useState(DEFAULT_VENDORS);
  const [vendorsLive, setVendorsLive] = useState([]);
  const [vendorsLiveLoading, setVendorsLiveLoading] = useState(true);
  useEffect(() => {
    const ref = collection(db, 'vendors');
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const list = snap.docs
          .map((d) => {
            const x = d.data();
            // Filter out rejected/suspended vendors — they shouldn't
            // appear in the public catalog. Default to 'approved'
            // for legacy docs (pre-onboarding vendors without a
            // status field are treated as approved per existing
            // AdminVendors logic).
            const status = x.status || 'approved';
            if (status === 'rejected' || status === 'suspended') return null;
            return {
              id: d.id,                 // doc id (vendorUid/slug)
              vendorUid: d.id,
              name: x.name || d.id,
              category: x.category || 'other',
              subcategory: x.subcategory || null,
              rating: typeof x.rating === 'number' ? x.rating : 0,
              // Imported vendors don't carry price — show a friendly
              // placeholder so the UI doesn't render empty cells.
              price: x.price || '請查詢',
              tags: Array.isArray(x.tags) ? x.tags : [],
              description: x.description || '',
              portfolio: Array.isArray(x.portfolio) ? x.portfolio : [],
              portfolioCount: typeof x.portfolioCount === 'number' ? x.portfolioCount : (Array.isArray(x.portfolio) ? x.portfolio.length : 0),
              featured: !!x.featured,
              createdAt: x.createdAt?.toMillis?.() ?? Date.parse(x.createdAt) ?? 0,
              signupStatus: x.signupStatus || 'uninvited',
              source: x.source || null,
              // 2026-07-21 — city enrichment. The
              // scripts/enrich-vendor-cities.cjs script derives
              // these from name/description/address for any
              // imported vendor and writes them back. Live
              // vendors may also set serviceAreaCity manually.
              serviceAreaCity: x.serviceAreaCity || null,
              serviceAreaDistrict: x.serviceAreaDistrict || null,
              // 2026-07-20 — popularity counter, maintained by the
              // onVendorImageViewCreated cloud function + daily
              // sweep. We prefer the 7d count as the default
              // 'popularity' metric — it smooths out daily noise
              // while staying fresh enough to highlight trending
              // vendors. Falls back to 30d if 7d is missing.
              popularity: x.popularity || null,
              viewCount:
                (x.popularity?.viewCount7d ?? 0) ||
                (x.popularity?.viewCount30d ?? 0) ||
                (x.popularity?.viewCountTotal ?? 0),
              isLive: true,
            };
          })
          .filter(Boolean);
        setVendorsLive(list);
        setVendorsLiveLoading(false);
      },
      (err) => {
        console.warn('[discover vendors] subscribe failed:', err?.message || err);
        setVendorsLiveLoading(false);
      },
    );
    return () => unsub();
  }, []);

  // Merged list: live vendors first (newest), then static demo
  // entries (any not already in live — rare but possible). Couples
  // see all 672+ vendors in the catalog.
  const vendors = useMemo(() => {
    const liveIds = new Set(vendorsLive.map((v) => v.id));
    const merged = [
      ...vendorsLive,
      ...vendorsStatic
        .filter((v) => !liveIds.has(v.id))
        .map((v) => ({ ...v, isLive: false })),
    ];
    return merged;
  }, [vendorsStatic, vendorsLive]);
  const [discoverFilter, setDiscoverFilter] = useState('all');
  const [jobRequests, setJobRequests] = useState(INITIAL_JOB_REQUESTS);
  // 2026-08-08 — proposals removed from in-memory React state.
  // Proposals now live in Firestore (/proposals). The vendor's submitProposal
  // opens <SubmitProposalModal/> which calls the submitProposal CF; the couple's
  // <ProposalsModal/> reads its own /proposals via onSnapshot. The previous
  // `proposalsData` (backed by MOCK_PROPOSALS) was the cause of the
  // "vendor sends proposal → couple sees nothing" bug.

  // Forms
  const [newEventName, setNewEventName] = useState('');
  const [newTaskForm, setNewTaskForm] = useState({
    // 2026-07-15 — split category picker into two steps:
    //   categoryTop = top-level vendor category key (e.g. 'venue')
    //   categorySub = sub-service key (e.g. 'banquet_hall'), or '' for
    //                 "all of the top category"
    // The legacy `categoryKey` is still set on save for backwards
    // compat with existing task docs (e.g. 'venue.banquet_hall' or
    // 'venue' for the top-level match).
    categoryTop: '',
    categorySub: '',
    categoryKey: 'other',
    // 2026-07-15 — assigned vendor contact (optional). References a
    // doc in /users/{uid}/vendorContacts/{contactId}. When the
    // contact signs up + auto-links, tasks get a derived
    // assignedVendorUid so the vendor can see them in their
    // vendor dashboard. Empty string = unassigned.
    assignedContactId: '',
    customTitle: '',
    venue: '',
    dueDate: '2026-12-31',
    // 2026-07-17 — optional HH:MM for finer-grained deadlines (e.g.
    // "下午茶 14:30"). Empty string = date-only (existing behavior).
    // Format will match <input type="time"> emission: "HH:MM".
    dueTime: '',
    estimatedCost: '',
    taskType: 'vendor',
    // 2026-07-17 — helper (兄弟姊妹) assignment, mirrors the vendor
    // assignment fields below. `assignedHelperMode` is 'pick' to
    // show the dropdown sourced from users/{uid}/helpers, or
    // 'custom' to show a free-form text input for cases where the
    // couple hasn't formally invited the helper yet.
    assignedHelperId: '',
    assignedHelperName: '',
    assignedHelperUid: '',
    assignedHelperMode: 'pick',
  });
  const [newGuestForm, setNewGuestForm] = useState({
    name: '',
    group: '男家親戚',
    headCount: 1,
    // 2026-07-18 — UX: leave tableNumber empty in the form so the user
    // sees a blank input rather than the placeholder string "未分配".
    // We coerce empty → '未分配' at write time so the data layer stays
    // consistent (WeddingDay filter + GuestList rendering both rely on
    // the literal string '未分配').
    tableNumber: '',
  });
  // Restore 2026-07-02: family-form state for household expandable rows
  const [familyForm, setFamilyForm] = useState({
    name: '',
    email: '',
    group: '男家親戚',
    tableNumber: '',
    members: [''],
  });
  const [newJobForm, setNewJobForm] = useState({
    serviceNeeded: '場地佈置',
    venueInput: '',
    budget: '',
    details: '',
  });
  const [inviteForm, setInviteForm] = useState({ name: '', email: '' });

  // Modals
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  // 2026-07-30 — Phase 5's purchase modal lifted here so the
  // header UserMenu (and MyProfile) can open it from outside
  // EventsDashboard. State was previously local to EventsDashboard,
  // which meant the lobby's CTA worked but no other screen could
  // open it. The dashboard still works — it now reads this state
  // as a prop instead of owning it.
  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false);
  // 2026-07-31 — change/set-password modal. MyProfile decides 'change' vs
  // 'set' based on hasPasswordProvider() and passes the mode in.
  const [changePasswordModalOpen, setChangePasswordModalOpen] = useState(false);
  const [changePasswordMode, setChangePasswordMode] = useState('change'); // 'change' | 'set'
  const [headerRenameOpen, setHeaderRenameOpen] = useState(false);
  const [showInvitationEditor, setShowInvitationEditor] = useState(false);
  const [editingGuest, setEditingGuest] = useState(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showHelperManager, setShowHelperManager] = useState(false);
  // 2026-07-26 — Co-owners (couples / partners). The "Invite
  // Partner" modal lives at the dashboard level; the dashboard
  // surfaces a "邀請另一半" button that flips this flag.
  const [showInvitePartner, setShowInvitePartner] = useState(false);
  const [viewingVendorProfile, setViewingVendorProfile] = useState(null);
  // 2026-08-02 — couple-side invite flow. When a couple clicks
  // "✉️ 邀請商戶上線" in VendorModal's BrowseOnlyNotice, we close
  // VendorModal (to avoid modal-on-modal stacking) and set this so
  // VendorInviteLinkModal opens with the same vendor. Title is
  // overridden to "邀請 {name} 上線" to make the couple-side intent
  // clear (onboarding nudge, not re-invite).
  const [coupleInvitingVendor, setCoupleInvitingVendor] = useState(null);
  const [viewingQrCode, setViewingQrCode] = useState(null);
  // 2026-08-07 — Couple-side "invite not-yet-onboarded vendor" state.
  // TrendingVendors strips mounted inside MyVendorsPanel → AddVendorPicker
  // → PickExistingVendor call onVendorNotOnboarded(vendor) when a couple
  // taps 邀請查詢 on an unclaimed trending card. App.jsx owns the
  // state so the same modal can be opened from multiple surfaces
  // (catalog picker on the checklist, plus the EventsDashboard which
  // owns its own copy). Lifting here means the catalog-picker path
  // doesn't need to thread state through 3 nested components.
  const [notOnboardedVendor, setNotOnboardedVendor] = useState(null);
  // 2026-08-01 (pivot) — event-level settings modal. Stores the
  // selected event so the modal can mount with the right scope.
  // null = closed. The CF (updateOwnerNames) accepts both the
  // owner (event._ownerUid === user.uid) and any co-owner
  // (user.uid in event.coOwners), so the modal is shown for both
  // owner + co-owner cards.
  const [eventSettingsTarget, setEventSettingsTarget] = useState(null);
  const [viewingProposals, setViewingProposals] = useState(null);

  // 2026-08-09 — bell notification deep-link. When the owner clicks
  // a comment/status notification, we set this so the checklist view
  // can scroll to the right task and open its comments panel. Cleared
  // by the checklist view on mount (or by the next click).
  const [focusedTaskId, setFocusedTaskId] = useState(null);

  // 2026-08-01 — sync the new 'event-settings' tab to the modal state.
  // When the owner clicks the ⚙️ 婚禮設定 tab (added in tabs.ts), we
  // mirror currentView into eventSettingsTarget so the existing
  // modal render path (line ~3284) opens the modal. This avoids
  // duplicating the modal markup for the tab vs. the lobby ⋯ menu
  // — both entry points feed the same modal state.
  //
  // Hook order: declared here AFTER eventSettingsTarget so the
  // setter is in scope. The effect reads currentView + currentEvent
  // which are all declared above this block.
  useEffect(() => {
    if (currentView !== 'event-settings') return;
    if (!currentEvent) {
      // Edge case: tab clicked while no wedding is selected. Fall
      // back to the lobby so the user isn't stranded on a tab with
      // no modal. Guards against the user's tab click landing
      // before their events-dashboard has loaded.
      setCurrentView('events-dashboard');
      return;
    }
    if (!eventSettingsTarget) {
      setEventSettingsTarget(currentEvent);
    }
  }, [currentView, currentEvent, eventSettingsTarget]);
  const [scanResult, setScanResult] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Upload progress (guest portal)
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // ---- Hermes 2026-07-03: redeem HMAC share token ----
  // When the page loads with ?o=...&e=...&g=...&token=... (the email link),
  // we sign in anonymously, then call verifyShareToken callable to write
  // guestLinks/{auth.uid} so subsequent Firestore reads pass
  // hasValidGuestLink() in firestore.rules.
  const [redeemStatus, setRedeemStatus] = useState('pending');
  useEffect(() => {
    if (!guest.isGuestMode) {
      setRedeemStatus('ok');
      return;
    }
    const token = guest.qToken;
    if (!token) {
      // No token in URL — likely a direct preview or stale link. Allow
      // page to attempt load; Firestore rules will gate actual reads.
      setRedeemStatus('ok');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Anonymous sign-in is required so the callable can write
        // guestLinks/{auth.uid} (firestore.rules keys this doc by uid).
        if (!auth.currentUser) {
          await signInAnonymously(auth);
        }
        // 2026-08-05 — opt the anonymous session in via useAuth so
        // onAuthStateChanged keeps `user` populated. Without this,
        // the upload handler at App.jsx 2507 sees `!user` and fails
        // with "登入狀態已過期". (Previous symptom: defensive toast
        // visible on every photo upload attempt from guest mode.)
        acceptAnonymousSession();
        if (cancelled) return;
        const verify = httpsCallable(functions, 'verifyShareToken');
        await verify({ token });
        if (!cancelled) setRedeemStatus('ok');
      } catch (e) {
        console.error('[redeem] failed:', e);
        if (!cancelled) setRedeemStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [guest.isGuestMode, guest.qToken]);

  // Wait for redemption before doing the Firestore reads — otherwise the
  // page shows "loading" forever because rules hasValidGuestLink fails.
  const guestDataReady = redeemStatus === 'ok';

    // 2026-07-26 — Co-owners: derive the data owner uid for the
  // current event. This is the uid the event's subcollections
  // (guests, vendors, tasks, redPackets, photos, ...) live
  // under. Normally this is the signed-in user's uid, but for
  // a co-owned event it points to the ORIGINAL owner (because
  // the data stays in their /users/{uid}/ tree). All subcollection
  // reads AND writes should use this value instead of `user.uid`
  // or `targetUid` directly. Defined early (before targetUid) so
  // it can be used in the Firestore subscriptions below.
  // 2026-08-04 — In guest mode, the URL provides qOwner (the original
  // owner of the wedding data). Use it directly instead of waiting for
  // currentEvent._ownerUid, because:
  //   (a) In guest mode there's no signed-in user, so user?.uid is
  //       undefined and dataOwnerUid was returning undefined,
  //   (b) currentEvent only gets set AFTER the events subscription
  //       populates, but the events subscription is gated on
  //       !guest.isGuestMode (line 837), so it never fires for guests,
  //   (c) Result: dataOwnerUid stayed undefined → the allGuests
  //       subscription at line 1014 never ran → activeGuestPortal never
  //       resolved → guest was stuck on "正在載入您的專屬電子喜帖..."
  //       forever. Setting dataOwnerUid from guest.qOwner unblocks the
  //       subscriptions immediately on guest-mode page load.
  const dataOwnerUid = useMemo(() => {
    if (guest.isGuestMode && guest.qOwner) return guest.qOwner;
    if (!currentEvent) return user?.uid;
    // currentEvent has _ownerUid if it came from the events list
    // (own or co-owned). If somehow it doesn't, fall back to
    // the signed-in user's uid (the original-owner case).
    return currentEvent._ownerUid || user?.uid;
  }, [currentEvent, user?.uid, guest.isGuestMode, guest.qOwner]);

  // 2026-08-09 — Comment-path resolvers for <ItemComments/>. The
  // component takes a Firestore CollectionReference and subscribes
  // via onSnapshot, so we MUST return the actual `collection(db, ...)`
  // ref, not a string. Both rundown and resources comments live
  // under the owner's event-scoped tree:
  //
  //   artifacts/{appId}/users/{ownerUid}/events/{eventId}/
  //     rundown/{entryId}/comments/{commentId}
  //     resources/{itemId}/comments/{commentId}
  //
  // Mirrors the same rule gating as the parent items so anyone who
  // can READ the rundown entry can also READ its comments.
  // Returns null when we don't have enough context yet, which
  // gracefully degrades the comment UI to "path not ready" in
  // <WeddingDay/> rather than throwing.
  const rundownCommentPathFor = useCallback(
    (entryId) => {
      if (!db || !appId || !dataOwnerUid || !currentEvent?.id || !entryId) return null;
      return collection(
        db,
        'artifacts',
        appId,
        'users',
        dataOwnerUid,
        'events',
        currentEvent.id,
        'rundown',
        entryId,
        'comments',
      );
    },
    [dataOwnerUid, currentEvent?.id],
  );
  const resourceCommentPathFor = useCallback(
    (itemId) => {
      if (!db || !appId || !dataOwnerUid || !currentEvent?.id || !itemId) return null;
      return collection(
        db,
        'artifacts',
        appId,
        'users',
        dataOwnerUid,
        'events',
        currentEvent.id,
        'resources',
        itemId,
        'comments',
      );
    },
    [dataOwnerUid, currentEvent?.id],
  );

  // 2026-08-02 — Upload preferences token (Option 1, watermark).
  // This must stay AFTER dataOwnerUid is initialized. The hook mints
  // a short-lived token when the owner has `watermark-removed`; the
  // token is attached to uploads from this event (owner + guests) so
  // the Vercel proxy can ask the NAS to skip the watermark step.
  // If minting fails, the hook leaves the token null and uploads keep
  // the safe default-on watermark behavior.
  const { prefsToken: uploadPrefsToken } = useUploadPreferencesToken({
    ownerUid: dataOwnerUid,
    eventId: currentEvent?.id,
    unlocks: _userUnlocksForUpload,
  });

// ---- Firestore subscriptions (skip when in guest mode) ----
  const targetUid = guest.isGuestMode ? guest.qOwner : user?.uid;

  const { data: ownEvents } = useFirestoreCollection(
    guestDataReady && targetUid && !guest.isGuestMode
      ? collection(db, 'artifacts', appId, 'users', targetUid, 'events')
      : null,
    [targetUid, guest.isGuestMode, guestDataReady],
  );

  // 2026-07-26 — Co-owners: also pull events where the current
  // user is a CO-OWNER (not just owner). These come from the
  // `coOwners` array on each event. We use a collectionGroup
  // query with a where('coOwners', 'array-contains', user.uid)
  // filter.
  //
  // IMPORTANT: this query can fail with "Missing or insufficient
  // permissions" if ANY event in the user's collection set fails
  // the read rule (e.g. legacy events without a coOwners field
  // where the rule short-circuits unexpectedly). The error is
  // caught at the App level — see `coOwnedEventsError` below —
  // and we fall back to showing just the user's own events.
  const { data: coOwnedEvents, error: coOwnedEventsError } = useFirestoreCollection(
    !guest.isGuestMode && user && !user.isAnonymous
      ? query(
          collectionGroup(db, 'events'),
          where('coOwners', 'array-contains', user.uid),
        )
      : null,
    [user?.uid, guest.isGuestMode],
  );

  // If the coOwnedEvents query fails, log once and degrade
  // gracefully (use only own events). We don't want the
  // dashboard to break just because the cross-owner picker
  // isn't available yet — better to show fewer events than
  // to show none.
  useEffect(() => {
    if (coOwnedEventsError) {
      // eslint-disable-next-line no-console
      console.warn(
        '[coOwnedEvents] collectionGroup query denied; falling back to own events only.',
        coOwnedEventsError?.message,
      );
    }
  }, [coOwnedEventsError]);

  // Merge own events + co-owned events. The dashboard doesn't
  // care which is which for the picker — it just shows the
  // combined list. We also strip out duplicates (defensive: if
  // somehow the same event shows up in both, the userUid is
  // equal to user.uid AND coOwners contains user.uid).
  const events = useMemo(() => {
    if (!ownEvents && !coOwnedEvents) return [];
    // Soft-deleted events stay in Firestore for restore, but are not
    // shown in the active project picker.
    const activeOwnEvents = (ownEvents || []).filter((e) => !e.deletedAt);
    const ownWithOwner = activeOwnEvents.map((e) => ({
      ...e,
      _ownerUid: targetUid,
    }));
    // For co-owned events, the collectionGroup doc ref contains
    // the ownerUid. extract via .ref.path.
    // /artifacts/{appId}/users/{ownerUid}/events/{eventId}
    const coOwnedWithOwner = (coOwnedEvents || [])
      .filter((e) => !e.deletedAt)
      .map((e) => {
      const pathParts = (e._ref || e.ref?.path || '').split('/');
      // path = ['artifacts', appId, 'users', ownerUid, 'events', eventId]
      const ownerUid = pathParts[3];
      return { ...e, _ownerUid: ownerUid };
    });
    // Filter: own events where the user ISN'T already in coOwners
    // (avoid duplicates); and co-owned events where the user
    // ISN'T the original owner (avoid duplicates again).
    const seen = new Set();
    const merged = [];
    for (const e of ownWithOwner) {
      const key = `${e._ownerUid}/${e.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(e);
    }
    for (const e of coOwnedWithOwner) {
      const key = `${e._ownerUid}/${e.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(e);
    }
    return merged;
  }, [ownEvents, coOwnedEvents, targetUid]);

  const deletedEvents = useMemo(() => {
    if (!ownEvents) return [];
    return ownEvents
      .filter((event) => Boolean(event.deletedAt))
      .map((event) => ({ ...event, _ownerUid: targetUid }));
  }, [ownEvents, targetUid]);

  const handleRestoreEvent = async (event) => {
    if (!event?._ownerUid || !event?.id) return;
    try {
      await setDoc(
        doc(db, 'artifacts', appId, 'users', event._ownerUid, 'events', event.id),
        { deletedAt: null, updatedAt: Date.now() },
        { merge: true },
      );
      showToast('✅ 婚禮專案已還原。');
    } catch (err) {
      console.warn('[App] restore event failed:', err?.code, err?.message);
      showToast('❌ 還原失敗，請稍後再試。');
    }
  };

  // 2026-07-15 — Auto-link any vendor contacts (across owners)
  // whose vendorEmail matches the currently signed-in user's email
  // and which are unlinked.
  //
  // Primary path: call the `autoLinkVendorContacts` Cloud Function
  // (functions/src/vendors.ts). It runs with admin credentials and
  // can safely write to other owners' /tasks/ subcollections. This
  // is the only path that actually persists when the vendor signs
  // up — the couple's browser may not be online simultaneously.
  //
  // Fallback path: tryAutoLinkContacts (client-side, scans contacts
  // the couple already has scoped perms for). Useful while
  // developing without a deployed Cloud Function. Silent on failure
  // once the Cloud Function succeeds.
  useEffect(() => {
      if (!user || user.isAnonymous) return undefined;
      let cancelled = false;
      const t = setTimeout(async () => {
        if (cancelled) return;
        // 1) Cloud Function — primary path.
        try {
          // 2026-07-22 — Vercel proxy bypasses Cloud Run CORS preflight.
          // Pass {} as data — Firebase callable functions require the
          // {data:...} wrapper even with empty args; sending
          // {data: undefined} causes 400 INVALID_ARGUMENT.
          const result = await callFirebaseFn('autoLinkVendorContactsV2', {});
          const { linked, backfilled } = result?.data || {};
          if (!cancelled && (linked || backfilled)) {
            showToast?.(
              `🔗 已連結 ${linked || 0} 個商戶、${backfilled || 0} 個任務`,
            );
          }
        } catch (cfErr) {
          // eslint-disable-next-line no-console
          console.warn(
            'autoLinkVendorContacts (CF) failed, falling back to client-side:',
            cfErr?.message,
          );
          // 2) Fallback — client-side. Best-effort, may not persist
          // for cross-owner writes due to Firestore rules.
          tryAutoLinkContacts(
            user.uid,
            user.email,
            (linked) => {
              if (cancelled) return;
              showToast?.(`🔗 已連結商戶：${linked.vendorName}`);
            },
          ).catch((err) => {
            // eslint-disable-next-line no-console
            console.warn('tryAutoLinkContacts (client) failed:', err?.message);
          });
        }
      }, 1500);
      return () => {
        cancelled = true;
        clearTimeout(t);
      };
    }, [user?.uid, user?.email]);

   // 2026-07-27 — Migrated to event-scoped path: /users/{ownerUid}/events/{eventId}/guests.
     // The old path used a where('eventId', '==') filter, which kept
     // the data scoped but was fragile (rules had to allowlist the
     // field on every operation). Moving the path makes the scope
     // structural and rules uniform.
     const { data: allGuests } = useFirestoreCollection(
         guestDataReady && dataOwnerUid && currentEvent
           ? collection(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', currentEvent.id, 'guests')
           : (guestDataReady && dataOwnerUid && guest.isGuestMode && guest.qEvent
               ? collection(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', guest.qEvent, 'guests')
               : null),
         [targetUid, guestDataReady, guest.qEvent, currentEvent?.id],
       );

     // 2026-07-15 — scanLog subscription for the reception scanner's
     // "最近掃描" list. Bounded by eventId so we don't fetch scans from
     // other events the owner might own. Limited to the last 50 (Firestore
     // requires descending + limit for cost control).
     // 2026-07-27 — Migrated to event-scoped path: /users/{ownerUid}/events/{eventId}/scanLog.
         // Old owner-scoped path required a where('eventId') filter at query
         // time; now the path itself scopes the query.
         const { data: recentScans } = useFirestoreCollection(
           dataOwnerUid && !guest.isGuestMode && currentEvent
             ? query(
                 collection(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', currentEvent.id, 'scanLog'),
                 orderBy('scannedAt', 'desc'),
                 limit(50),
               )
             : null,
           [dataOwnerUid, currentEvent?.id],
         );

   // 2026-07-15 — chat inquiries subscription. Couples and vendors
   // both subscribe so the inbox is shared (each side sees the same
   // top-level collection, filtered by their uid field). Vendor
   // role needs the actual /vendors/{vendorUid} uid, not the
   // owner's uid; for vendors, user.uid IS the vendor uid. So we
   // re-use user?.uid with role-based field filtering.
   const [inquiries, setInquiries] = useState([]);
   useEffect(() => {
     if (!user || user.isAnonymous) {
       setInquiries([]);
       return undefined;
     }
     const role = userRole === 'vendor' ? 'vendor' : 'couple';
     const unsub = subscribeToInquiries(user.uid, role, setInquiries);
     return unsub;
   }, [user?.uid, userRole]);

   // 2026-08-09 — Vendor list for VendorPicker (大日流程 / 物資
   // assignment). Source: couple's `inquiries` (vendors they've
   // started a chat with). Couples may also tag vendors they haven't
   // contacted yet — that path uses the VendorPicker free-text
   // fallback so we don't need a separate vendor-master subscription.
   // Memoized so WeddingDay's memoization doesn't churn on every
   // inquiry read.
   //
   // 2026-08-09 — TDZ-fix: this hook MUST live AFTER the `inquiries`
   // declaration above. Putting it earlier (next to dataOwnerUid)
   // caused `Cannot access 'inquiries' before initialization` because
   // the deps array reads the variable at hook-eval time, before
   // any subsequent useState/useEffect in the same component has
   // run. Symptom: app crashes on first render with a minified
   // "Cannot access 'Ye' before initialization" — see Hermes
   // session 2026-08-09.
   const vendorsForPicker = useMemo(() => {
     const seen = new Set();
     const out = [];
     for (const i of inquiries || []) {
       if (!i || !i.vendorUid) continue;
       if (seen.has(i.vendorUid)) continue;
       seen.add(i.vendorUid);
       out.push({
         uid: i.vendorUid,
         name: i.vendorName || i.vendorDisplayName || '商戶',
       });
     }
     return out;
   }, [inquiries]);

   // 2026-07-15 — assigned tasks for the current vendor. Uses a
   // collectionGroup query on /tasks subcollections, filtered by
   // assignedVendorUid == current user uid. Requires a Firestore
   // composite index (will be auto-suggested in the console on
   // first error). Owner-scoped rule lets vendors read only tasks
   // assigned to them.
   const [assignedTasks, setAssignedTasks] = useState([]);
   useEffect(() => {
     if (!user || userRole !== 'vendor' || user.isAnonymous) {
       setAssignedTasks([]);
       return undefined;
     }
     let cancelled = false;
     (async () => {
       try {
         const tasksQuery = query(
           collectionGroup(db, 'tasks'),
           where('assignedVendorUid', '==', user.uid),
         );
         const unsub = onSnapshot(
           tasksQuery,
           (snap) => {
             if (cancelled) return;
             const list = snap.docs.map((d) => ({
               id: d.id,
               ...d.data(),
               // collectionGroup doc path:
               //   artifacts/{appId}/users/{ownerUid}/events/{eventId}/tasks/{taskId}
               // d.ref = tasks/{taskId}
               // d.ref.parent = events/{eventId}    → id is eventId
               // d.ref.parent.parent = users/{ownerUid} → id is ownerUid
               ownerUid: d.ref.parent.parent?.id,
               // 2026-08-09 — surface eventId from the parent path so
               // the vendor dashboard can group / dedupe by wedding
               // when the same vendor is assigned across multiple
               // events. (eventName / eventDate come from the doc
               // body via denormalized fields — see App.jsx upsert
               // helpers.)
               eventId: d.ref.parent.id,
             }));
             list.sort((a, b) => {
               // Incomplete first, then by dueDate asc, then most-recent
               if (!!a.isCompleted !== !!b.isCompleted) {
                 return a.isCompleted ? 1 : -1;
               }
               return (a.dueDate || '').localeCompare(b.dueDate || '');
             });
             setAssignedTasks(list);
           },
           (err) => {
             // eslint-disable-next-line no-console
             console.warn(
               'assignedTasks subscribe failed (likely missing index):',
               err?.message,
             );
           },
         );
         if (cancelled) unsub();
         return unsub;
       } catch (err) {
         // eslint-disable-next-line no-console
         console.warn('assignedTasks setup failed:', err?.message);
         return undefined;
       }
     })();
     return () => {
       cancelled = true;
     };
   }, [user?.uid, userRole]);

  // 2026-07-17 — vendor updates the status of a task the couple assigned
  // to them. Writes are restricted by firestore.rules to ONLY the three
  // status keys (status / statusUpdatedAt / statusNote). When the vendor
  // marks a task done, we also flip `isCompleted = true` so the couple's
  // checklist checkbox stays the single source of truth (the couple can
  // still override by un-checking).
  const handleUpdateAssignedTaskStatus = async (task, newStatusId, statusNote) => {
    if (!user || !task?.ownerUid || !task?.id) return;
    const ref = doc(db, 'artifacts', appId, 'users', task.ownerUid, 'tasks', task.id);
    const update = {
      status: newStatusId,
      statusUpdatedAt: Date.now(),
      statusNote: statusNote || null,
    };
    if (newStatusId === 'done') {
      update.isCompleted = true;
    }
    await setDoc(ref, update, { merge: true });
    // 2026-07-19 — also append to the per-task audit trail so the
    // activity timeline reflects this status change. Vendor-side
    // path; the byRole is hardcoded to 'vendor' because this
    // handler is only mounted on the vendor dashboard.
    recordTaskStatusUpdate({
      ownerUid: task.ownerUid,
      taskId: task.id,
      fromStatus: task.status || null,
      toStatus: newStatusId,
      byUid: user.uid,
      byName: vendor?.name || user.displayName || user.email || null,
      byRole: 'vendor',
      reason: statusNote || null,
      // 2026-08-09 — denormalize access-control fields so the top-level
      // /{path=**}/statusUpdates collectionGroup rule can gate reads.
      // Vendor-role writes: the byUid is the vendor, but the owner
      // (and any other assigned vendor/helper) must still see the
      // trail. Pass them through from the parent task.
      assignedVendorUid: task.assignedVendorUid || user.uid,
      assignedHelperUid: task.assignedHelperUid || null,
    });
  };

  // 2026-08-09 — Vendor-assigned 大日流程 + 物資. Mirrors the
  // collectionGroup pattern used for assignedTasks above. Each
  // rundown entry / resource item lives at
  //   /users/{ownerUid}/events/{eventId}/{rundown|resources}/{id}
  // and we filter on `assignedVendorUid == auth.uid`. The
  // collectionGroup query works at any depth, so a single query
  // enumerates every event the vendor is assigned to.
  const [assignedRundown, setAssignedRundown] = useState([]);
  const [assignedResources, setAssignedResources] = useState([]);
  useEffect(() => {
    if (!user || userRole !== 'vendor' || user.isAnonymous) {
      setAssignedRundown([]);
      setAssignedResources([]);
      return undefined;
    }
    let cancelled = false;
    const subscribe = (groupName, setter) => {
      try {
        const q = query(
          collectionGroup(db, groupName),
          where('assignedVendorUid', '==', user.uid),
        );
        return onSnapshot(
          q,
          (snap) => {
            if (cancelled) return;
            const list = snap.docs.map((d) => {
              // collectionGroup doc path:
              //   artifacts/{appId}/users/{ownerUid}/events/{eventId}/{groupName}/{id}
              // d.ref = .../{groupName}/{id}         (the doc itself)
              // d.ref.parent = .../events/{eventId} → .id is eventId
              // d.ref.parent.parent = .../users/{ownerUid} → .id is ownerUid
              // d.ref.parent.parent.parent = .../artifacts/{appId} → .id is appId
              // (Three-segment chain, NOT four — earlier versions had
              // an extra .parent that walked up to the appId and
              // silently stamped the appId string as the "ownerUid",
              // which made the commentPath resolver target a
              // non-existent user doc and silently fail.)
              const ownerUid = d.ref.parent.parent?.id;
              const eventId = d.ref.parent.id;
              return {
                id: d.id,
                ...d.data(),
                ownerUid,
                eventId,
                // build a comment path resolver in App.jsx-owned scope so
                // <ItemComments/> in the vendor dashboard subscribes
                // to the same `/comments/` subcollection the couple
                // writes to.
                commentPath:
                  ownerUid && eventId
                    ? collection(
                        db,
                        'artifacts',
                        appId,
                        'users',
                        ownerUid,
                        'events',
                        eventId,
                        groupName,
                        d.id,
                        'comments',
                      )
                    : null,
              };
            });
            list.sort((a, b) => {
              const at = a.startTime || a.dueDate || '';
              const bt = b.startTime || b.dueDate || '';
              return at.localeCompare(bt);
            });
            setter(list);
          },
          (err) => {
            // eslint-disable-next-line no-console
            console.warn(
              `[assigned${groupName}] subscribe failed (likely missing index):`,
              err?.message,
            );
          },
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[assigned${groupName}] setup failed:`, err?.message);
        return undefined;
      }
    };
    const u1 = subscribe('rundown', setAssignedRundown);
    const u2 = subscribe('resources', setAssignedResources);
    return () => {
      cancelled = true;
      u1 && u1();
      u2 && u2();
    };
  }, [user?.uid, userRole]);

   // Aggregate unread count for the header inbox badge.
   const totalUnread = inquiries.reduce((sum, inq) => {
     return sum + (userRole === 'vendor' ? inq.vendorUnread || 0 : inq.coupleUnread || 0);
   }, 0);

   // 2026-07-15 — vendor contacts subscription (主理新人's personal
   // address-book of vendors they know from Instagram / friends /
   // etc.). Lives at /users/{userUid}/vendorContacts. Empty array
   // for vendors / non-owners.
   const [vendorContacts, setVendorContacts] = useState([]);
   const [vendorContactsLoading, setVendorContactsLoading] = useState(true);
   useEffect(() => {
     if (!user || user.isAnonymous || guest.isGuestMode) {
       setVendorContacts([]);
       setVendorContactsLoading(false);
       return undefined;
     }
     setVendorContactsLoading(true);
     const q = query(
       collection(db, 'artifacts', appId, 'users', user.uid, 'vendorContacts'),
       orderBy('addedAt', 'desc'),
     );
     const unsub = onSnapshot(
       q,
       (snap) => {
         setVendorContacts(
           snap.docs.map((d) => ({
             id: d.id,
             ...d.data(),
             addedAt: d.data().addedAt?.toMillis?.() || 0,
           })),
         );
         setVendorContactsLoading(false);
       },
       (err) => {
         // Silent failure — empty state still renders fine
         // eslint-disable-next-line no-console
         console.warn('vendorContacts subscribe failed:', err?.message);
         setVendorContactsLoading(false);
       },
     );
     return unsub;
   }, [user?.uid, guest.isGuestMode]);

   // 2026-07-18 — Couple's helpers + pending invites (兄弟姊妹
   // including those who haven't accepted yet). Two sources, both
   // keyed off the owner's uid:
   //   - /users/{uid}/helpers/{helperUid}        : uid-keyed (when
   //                                                the email was
   //                                                already
   //                                                registered). Has
   //                                                helperUid.
   //   - /users/{uid}/pendingInvites/{email}    : email-keyed (when
   //                                                the invitee
   //                                                hasn't signed up
   //                                                yet). No
   //                                                helperUid.
   // Both collections support status='active' (accepted) or
   // status='invited' (pending). Merging them here means the
   // wedding-task / rundown / resources pickers can list EVERYONE
   // the owner has invited, not just the ones already accepted.
   const [helpers, setHelpers] = useState([]);
   const [helpersLoading, setHelpersLoading] = useState(true);
   useEffect(() => {
     if (!user || user.isAnonymous || guest.isGuestMode) {
       setHelpers([]);
       setHelpersLoading(false);
       return undefined;
     }
     setHelpersLoading(true);

     // 2026-07-18 — Tag each doc with `_src` so the picker can
     // distinguish an email-only pendingInvite (helperUid === null)
     // from a registered email that's still pending acceptance
     // (helperUid set, status='invited'). Stored on the runtime
     // object only; never written back to Firestore.
     const merge = (snap, src) =>
       snap.docs.map((d) => ({ id: d.id, _src: src, ...d.data() }));

     const helpersQ = collection(
       db,
       'artifacts',
       appId,
       'users',
       user.uid,
       'helpers',
     );
     const pendingQ = collection(
       db,
       'artifacts',
       appId,
       'users',
       user.uid,
       'pendingInvites',
     );

     let activeDocs = [];
     let pendingDocs = [];

     const apply = () => {
       // Drop 'revoked' ones. Merge active + pending into one
       // alphabetical list (by displayName) so the HelperPicker
       // dropdown shows everyone, with active ones first.
       const all = [
         ...activeDocs.filter((h) => h.status === 'active'),
         ...pendingDocs.filter((h) => h.status === 'invited'),
         ...activeDocs.filter((h) => h.status === 'invited'),
       ];
       all.sort((a, b) =>
         (a.displayName || a.email || '').localeCompare(
           b.displayName || b.email || '',
         ),
       );
       // Dedup by displayName+email — same person can show up on
       // both lists if a registration race happens.
       const seen = new Set();
       const deduped = [];
       for (const h of all) {
         const key = (h.email || h.id || '').toLowerCase();
         if (!key || seen.has(key)) continue;
         seen.add(key);
         deduped.push(h);
       }
       setHelpers(deduped);
       setHelpersLoading(false);
     };

     const unsubHelpers = onSnapshot(
       helpersQ,
       (snap) => {
         activeDocs = merge(snap, 'helpers');
         apply();
       },
       (err) => {
         // eslint-disable-next-line no-console
         console.warn('helpers subscribe failed:', err?.message);
         setHelpersLoading(false);
       },
     );

     const unsubPending = onSnapshot(
       pendingQ,
       (snap) => {
         pendingDocs = merge(snap, 'pendingInvites');
         apply();
       },
       (err) => {
         // Soft-fail — pendingInvites is empty for most owners.
         // eslint-disable-next-line no-console
         console.warn('pendingInvites subscribe failed:', err?.message);
         pendingDocs = [];
         apply();
       },
     );

     return () => {
       unsubHelpers();
       unsubPending();
     };
   }, [user?.uid, guest.isGuestMode]);

   // 2026-07-17 — Couple's favorited vendors (🔍 商戶指南 ❤️ 我的最愛).
   // Lives at /users/{userUid}/favorites/{vendorId}. Each doc body
   // stores a tiny snapshot so the favorites list survives Firestore
   // outages on the public vendors collection.
   const [favorites, setFavorites] = useState([]);
   useEffect(() => {
     if (!user || user.isAnonymous || guest.isGuestMode) {
       setFavorites([]);
       return undefined;
     }
     const q = query(
       collection(db, 'artifacts', appId, 'users', user.uid, 'favorites'),
     );
     const unsub = onSnapshot(
       q,
       (snap) => {
         setFavorites(
           snap.docs.map((d) => ({
             id: d.id,
             ...d.data(),
             createdAt: d.data().createdAt?.toMillis?.() || 0,
           })),
         );
       },
       (err) => {
         // eslint-disable-next-line no-console
         console.warn('favorites subscribe failed:', err?.message);
       },
     );
     return unsub;
   }, [user?.uid, guest.isGuestMode]);

   const favoriteIds = useMemo(
     () => new Set(favorites.map((f) => Number(f.vendorId) || f.id)),
     [favorites],
   );

   const handleToggleFavorite = async (vendor) => {
     if (!user || !vendor) return;
     const vid = String(vendor.id);
     const favRef = doc(
       db,
       'artifacts',
       appId,
       'users',
       user.uid,
       'favorites',
       vid,
     );
     const already = favoriteIds.has(vendor.id);
     try {
       if (already) {
         await deleteDoc(favRef);
       } else {
         await setDoc(favRef, {
           vendorId: vid,
           vendorName: vendor.name || '',
           vendorCategory: vendor.category || '',
           vendorSubcategory: vendor.subcategory || '',
           vendorSnapshot: {
             price: vendor.price || '',
             rating: vendor.rating || 0,
             portfolio: (vendor.portfolio || []).slice(0, 2),
           },
           createdAt: serverTimestamp(),
         });
       }
     } catch (err) {
       // eslint-disable-next-line no-console
       console.warn('toggleFavorite failed:', err?.message);
       showToast(`✗ 最愛切換失敗：${err?.message || '未知錯誤'}`);
     }
   };

   // ---- Vendor contact CRUD (主理新人 personal address book) ----
   const handleAddVendorContact = async (data) => {
     if (!user) return;
     await addDoc(
       collection(db, 'artifacts', appId, 'users', user.uid, 'vendorContacts'),
       {
         ...data,
         addedAt: serverTimestamp(),
         linkedVendorUid: null,
         invitationSentAt: null,
         invitationAccepted: false,
       },
     );
     showToast('✅ 已新增商戶');
   };
   const handleUpdateVendorContact = async (contact) => {
     if (!user || !contact?.id) return;
     const { id, addedAt, ...rest } = contact;
     await updateDoc(
       doc(db, 'artifacts', appId, 'users', user.uid, 'vendorContacts', id),
       rest,
     );
     showToast('✅ 已更新');
   };
   const handleDeleteVendorContact = async (contactId) => {
       if (!user || !contactId) return;
       await deleteDoc(
         doc(db, 'artifacts', appId, 'users', user.uid, 'vendorContacts', contactId),
       );
       showToast('🗑️ 已刪除');
     };

     // 2026-07-15 — Manually link a contact to a vendor uid (used
     // when the vendor has signed up and we know their uid; or when
     // a couple wants to correct an auto-link). Writes from the
     // couple's owner-scoped account so perms are satisfied.
     // After the link lands, also back-fills assignedVendorUid on
     // every task in this owner's /tasks/ where assignedContactId
     // matches — same logic the auto-linker applies cross-owner.
     const handleLinkContact = async (contact) => {
       if (!user || !contact?.id) return;
       const raw = window.prompt(
         `連結「${contact.vendorName}」到商戶 Firebase Auth UID：\n\n` +
           `（商戶註冊後嘅 uid，例如 「abc123XYZ...」；\n` +
           `聯絡商戶攞，或由商戶登入後查詢 /vendor-profile 嘅 URL）`,
         contact.linkedVendorUid || '',
       );
       if (!raw) return;
       const vendorUid = raw.trim();
       if (!vendorUid) return;
       try {
         const { linkSingleContact } = await import('./lib/contactLink');
         const result = await linkSingleContact(user.uid, contact.id, vendorUid);
         if (!result.ok) {
           showToast(`✗ 連結失敗：${result.reason}`);
           return;
         }
         // Back-fill tasks for this contact in this owner scope.
         // 2026-07-27 — Migrated to event-scoped path.
                 try {
                   const { getDocs } = await import('firebase/firestore');
                   const tasksQ = query(
                     collection(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', currentEvent.id, 'tasks'),
                     where('assignedContactId', '==', contact.id),
                   );
                   const snap = await getDocs(tasksQ);
                   let count = 0;
                   for (const t of snap.docs) {
                     if (t.data().assignedVendorUid) continue;
                     await updateDoc(
                       doc(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', currentEvent.id, 'tasks', t.id),
               {
                 assignedVendorUid: vendorUid,
                 assignedVendorName:
                   t.data().assignedVendorName || contact.vendorName || '',
               },
             );
             count++;
           }
           showToast(
             `🔗 已連結！${count > 0 ? `同步咗 ${count} 個指派任務` : ''}`,
           );
         } catch (e) {
           // eslint-disable-next-line no-console
           console.warn('task back-fill failed:', e?.message);
           showToast('🔗 已連結 (任務同步失敗)');
         }
       } catch (err) {
         // eslint-disable-next-line no-console
         console.warn('handleLinkContact failed:', err?.message);
         showToast(`✗ 連結失敗：${err?.message || '未知錯誤'}`);
       }
     };


  // 2026-07-27 — Migrated to event-scoped path: /users/{ownerUid}/events/{eventId}/photos.
  // 2026-08-05 — Added guestDataReady to the guard. Without it, the
  // subscription fires the moment dataOwnerUid + guest.qEvent are
  // populated (synchronous), but verifyShareToken hasn't written
  // guestLinks/{auth.uid} yet. hasValidGuestLink in firestore.rules
  // returns false (the doc doesn't exist), the read throws
  // "Missing or insufficient permissions", and the user sees a
  // permissions error in the console before the token is redeemed.
  // allGuests had the same fix applied earlier; this catches the
  // photos subscription which was missed.
  const { data: allPhotos } = useFirestoreCollection(
    guestDataReady && dataOwnerUid && (guest.isGuestMode ? guest.qEvent : currentEvent)
      ? collection(db, 'artifacts', appId, 'users', dataOwnerUid, 'events',
                   guest.isGuestMode ? guest.qEvent : currentEvent.id, 'photos')
      : null,
    [dataOwnerUid, guestDataReady, guest.isGuestMode, guest.qEvent, currentEvent?.id],
  );

  // 2026-07-27 — Migrated to event-scoped path: /users/{ownerUid}/events/{eventId}/tasks.
  // Old owner-scoped path leaked tasks from sibling events.
  const { data: tasks } = useFirestoreCollection(
    dataOwnerUid && !guest.isGuestMode && currentEvent
      ? collection(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', currentEvent.id, 'tasks')
      : null,
    [dataOwnerUid, guest.isGuestMode, currentEvent?.id],
  );

  // ---- 2026-07-17: Big Day (大日統籌) suite (rundown / resources / teaCeremony / playlist).
  // 2026-07-27 — Migrated from /users/{ownerUid}/{name} to
  // /users/{ownerUid}/events/{eventId}/{name} (event-scoped).
  // Old owner-scoped path was shared across all events the owner
  // owns — sneakerciaga opening a brand-new empty event was seeing
  // rundown items from her other event "test again and again". Same
  // path shape as redPackets (which was already event-scoped).
  // Helper users do NOT see these (rules allow owner-only).
  const { data: rundown } = useFirestoreCollection(
    dataOwnerUid && !guest.isGuestMode && currentEvent
      ? collection(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', currentEvent.id, 'rundown')
      : null,
    [dataOwnerUid, guest.isGuestMode, currentEvent?.id],
  );
  const { data: resources } = useFirestoreCollection(
    dataOwnerUid && !guest.isGuestMode && currentEvent
      ? collection(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', currentEvent.id, 'resources')
      : null,
    [dataOwnerUid, guest.isGuestMode, currentEvent?.id],
  );
  const { data: teaCeremony } = useFirestoreCollection(
    dataOwnerUid && !guest.isGuestMode && currentEvent
      ? collection(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', currentEvent.id, 'teaCeremony')
      : null,
    [dataOwnerUid, guest.isGuestMode, currentEvent?.id],
  );
  const { data: playlist } = useFirestoreCollection(
    dataOwnerUid && !guest.isGuestMode && currentEvent
      ? collection(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', currentEvent.id, 'playlist')
      : null,
    [dataOwnerUid, guest.isGuestMode, currentEvent?.id],
  );

  // 2026-07-15 — VendorDashboard live data. Previously the dashboard
  // hardcoded "Visionary Capture" as the vendor name and used the
  // static INITIAL_JOB_REQUESTS array for listings. Now both come from
  // Firestore:
  //   • vendorProfile — live doc subscription to /vendors/{uid}
  //   • liveJobRequests — live query of the public /jobRequests
  //     collection (any signed-in user can read per firestore.rules).
  // The vendorProfile hook is gated on userRole so we don't pay for
  // the subscription unless the user is actually a vendor.
  const vendorDocRef =
    user && userRole === 'vendor' ? doc(db, 'vendors', user.uid) : null;
  const { data: vendorProfile, loading: vendorProfileLoading } = useFirestoreDoc(
    vendorDocRef,
    [user?.uid, userRole],
  );
  // 2026-07-23 — Run for all signed-in users, not just vendors.
  // Previously the query was gated on `userRole === 'vendor'`, which
  // meant couples saw an empty list and couldn't find their own
  // posts in 我發佈過嘅求救記錄. The couple-side UI filters to
  // `j.coupleUid === user.uid` itself, so the query result is safe
  // to share — a couple never sees another couple's posts.
  const { data: liveJobRequests, loading: jobRequestsLoading } = useFirestoreCollection(
    user
      ? query(collection(db, 'jobRequests'), where('status', '==', 'open'))
      : null,
    [user?.uid],
  );

  // Sync current event from URL params when in guest mode
  // 2026-08-04 — The events subscription above (line 836) is gated on
  // !guest.isGuestMode so it never fires for guests. The fallback
  // `events.find(...)` was therefore always undefined, leaving
  // currentEvent unset. Fetch the single event directly for guests.
  const { data: guestModeEvent } = useFirestoreDoc(
    guest.isGuestMode && guest.qOwner && guest.qEvent
      ? doc(db, 'artifacts', appId, 'users', guest.qOwner, 'events', guest.qEvent)
      : null,
    [guest.isGuestMode, guest.qOwner, guest.qEvent],
  );
  useEffect(() => {
    if (!guest.isGuestMode) return;
    if (guestModeEvent) setCurrentEvent(guestModeEvent);
    if (allGuests?.length) {
      const g = allGuests.find((x) => x.guestId === guest.qGuest);
      if (g) setActiveGuestPortal(g);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guest.isGuestMode, guestModeEvent, allGuests]);

  // Expose for QrCodeModal fallback (and PersonalGuestPortal's
  // EntryPassCard).
  //
  // 2026-08-05 — In guest mode the user is NOT signed in
  // (`user` is null), so `user?.uid` is empty. Fall back to the
  // URL params (`guest.qOwner` / `guest.qEvent`) so the entry-pass
  // QR card in PersonalGuestPortal can build its link on first
  // render, before the Firestore subscription resolves.
  useEffect(() => {
    window.__ownerUid =
      user?.uid || guest.qOwner || '';
    window.__currentEventId =
      currentEvent?.id || guest.qEvent || '';
  }, [user?.uid, currentEvent?.id, guest.qOwner, guest.qEvent]);

  // ---- Derived data ----
  const eventTasks = useMemo(
    () => tasks.filter((t) => t.eventId === currentEvent?.id),
    [tasks, currentEvent],
  );
  const eventGuests = useMemo(
    () => allGuests.filter((g) => g.eventId === currentEvent?.id),
    [allGuests, currentEvent],
  );
  const eventPhotos = useMemo(
    () =>
      allPhotos
        .filter((p) => p.eventId === currentEvent?.id)
        .sort((a, b) => b.createdAt - a.createdAt),
    [allPhotos, currentEvent],
  );

  const totalBudget = currentEvent?.budget || 350000;
  // 2026-07-24 — deduct budget for tasks that are NOT 已確認 (已付款),
  // not just completed ones. Previously only completed tasks with
  // actualCost counted, which left the user blind to committed-but-not-
  // yet-paid amounts (e.g. deposits, vendor quotes). Now we sum:
  //   - isCompleted tasks: actualCost (what was actually paid)
  //   - non-completed tasks: estimatedCost (the planned/quoted amount)
  // Both are still "real money the couple owes" and should reduce the
  // remaining headroom. We also expose totalPaid and totalCommitted
  // separately so the budget screen can show both numbers.
  const totalSpent = eventTasks.reduce(
    (sum, t) => sum + (t.isCompleted ? t.actualCost || 0 : t.estimatedCost || 0),
    0,
  );
  const totalPaid = eventTasks.reduce(
    (sum, t) => sum + (t.isCompleted ? t.actualCost || 0 : 0),
    0,
  );
  const totalCommitted = eventTasks.reduce(
    (sum, t) => sum + (t.isCompleted ? 0 : t.estimatedCost || 0),
    0,
  );
  const storageUsedMB = eventPhotos.length * 1.5;
  const isPremium = currentEvent?.tier === 'premium';
  const isStorageFull = !isPremium && storageUsedMB >= FREE_TIER_LIMIT_MB;

  // Slideshow state
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  useEffect(() => {
    if (!isFullscreen || allPhotos.length === 0) return undefined;
    const interval = setInterval(() => {
      setCurrentSlideIndex((prev) => (prev + 1) % allPhotos.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [isFullscreen, allPhotos.length]);

  // ---- Handlers ----
  const handleLogout = async () => {
    await logout();
    setCurrentEvent(null);
    setCurrentView('events-dashboard');
  };

  // Vendor logout — clears the user (the app falls back to LoginScreen
  // when user === null) instead of routing to events-dashboard (which
  // is owner-only).
  const handleVendorLogout = async () => {
    const ok = window.confirm('確定要登出嗎？');
    if (!ok) return;
    await logout();
    setCurrentEvent(null);
    // No currentView change needed — when user becomes null, App.jsx
    // renders <LoginScreen> automatically (see line 854).
  };

  const handleCreateEvent = async (e) => {
    e.preventDefault();
    if (!user || !newEventName) return;
    // 2026-07-03 — guest-flow gate. Anonymous users CAN explore (we
    // let them click around) but writes are blocked until they upgrade.
    // We pop the signup modal here instead of failing silently — the
    // modal's onLink callback (App.jsx:showSignUpPrompt) calls back into
    // handleLinkGuestAccount which completes the create after a
    // successful link. We stash the form input so we can replay it
    // post-signup without forcing the user to retype.
    //
    // 2026-07-27 — removed the prior debug console.log that fired
    // every create attempt (leaked isAnonymous state to the dev
    // console and on every render of an authenticated user who
    // produced an anonymous through the helper UI). The modal-
    // close effect at App.jsx:180 already covers the "what changed?"
    // observability need without leaking state.
    if (isAnonymous) {
      setPendingCreateEventName(newEventName);
      setShowSignUpPrompt(true);
      return;
    }
    const newEvent = {
      name: newEventName,
      date: '2027-01-01',
      tier: 'free',
      budget: 350000,
      // 2026-07-26 — Co-owners (couples/partners). The creator's
      // uid is always the first entry. When a partner accepts an
      // invite, the partner's uid gets pushed onto this array
      // (see acceptPartnerInvite Cloud Function). Used by the
      // Firestore rules (isEventCoOwner, isCoOwnerOfEventDoc) to
      // grant equal CRUD access to the partner.
      coOwners: [user.uid],
      createdAt: Date.now(),
    };
    const docRef = await addDoc(
      collection(db, 'artifacts', appId, 'users', user.uid, 'events'),
      newEvent,
    );
    setNewEventName('');
    showToast('🎉 婚禮專案建立成功！');
    setCurrentEvent({ id: docRef.id, ...newEvent });
    setCurrentView('couple-checklist');
  };

  // 2026-07-03 — post-link handler for the create-event flow. Called by
  // SignUpPromptModal's onLink after a successful anonymous→email link.
  // Completes the create that was deferred in handleCreateEvent.
  const handleLinkGuestAccount = async (email, password) => {
    await linkAnonymousWithEmail(email, password);
    // After link, isAnonymous flips to false (Firebase re-fires
    // onAuthStateChanged and our useAuth hook updates). We close the
    // modal and replay any deferred create. If no event was queued
    // (user just clicked the banner without trying to create), we
    // just close the modal.
    setShowSignUpPrompt(false);
    if (pendingCreateEventName) {
      const name = pendingCreateEventName;
      setPendingCreateEventName(null);
      // user.uid is the SAME UID we had pre-link — Firebase preserved
      // it during linkWithCredential. So the write goes to the same
      // path; nothing to migrate.
      const newEvent = {
        name,
        date: '2027-01-01',
        tier: 'free',
        budget: 350000,
        createdAt: Date.now(),
      };
      const docRef = await addDoc(
        collection(db, 'artifacts', appId, 'users', user.uid, 'events'),
        newEvent,
      );
      setNewEventName('');
      showToast('🎉 婚禮專案建立成功！');
      setCurrentEvent({ id: docRef.id, ...newEvent });
      setCurrentView('couple-checklist');
    } else {
      showToast('🎉 帳號已建立，你之前的資料都保存咗！');
    }
  };

  const handleAddTask = async (e) => {
    e.preventDefault();
    if (!user || !currentEvent) return;
    // 2026-07-15 — derive the stored category from the two-step
    // picker. Priority:
    //   1. customTitle  if user picked 'other'
    //   2. {top}.{sub}  if user picked a sub-service
    //   3. {top}        if user picked a top-level only (sub === '')
    // The category field stays a single string for backwards compat
    // with existing task docs and the activeCategory filter.
    let categoryKey = 'other';
    let title = '';
    if (newTaskForm.categoryKey === 'other') {
      categoryKey = 'other';
      title = newTaskForm.customTitle;
    } else if (newTaskForm.categoryTop) {
      categoryKey = newTaskForm.categorySub
        ? `${newTaskForm.categoryTop}.${newTaskForm.categorySub}`
        : newTaskForm.categoryTop;
      title = getTaskCategoryLabel(categoryKey);
    } else {
      // No category selected — keep the legacy 'other' fallback so
      // the user can still submit a custom title.
      categoryKey = 'other';
      title = newTaskForm.customTitle;
    }

    // Resolve the chosen contact → uid (if already linked). For
    // unlinked contacts, the task still gets assignedContactId but
    // no assignedVendorUid until the vendor signs up; we back-fill
    // that on link (handled by handleLinkContactToVendor below).
    const chosenContact = vendorContacts.find(
      (c) => c.id === newTaskForm.assignedContactId,
    );

    // 2026-07-17 — Resolve chosen helper for the task doc. In 'pick'
    // mode we look up by id; in 'custom' mode the helper is a free-form
    // typed name (no id, no auth uid yet — they haven't been invited).
    let chosenHelperId = '';
    let chosenHelperName = '';
    let chosenHelperUid = '';
    if (newTaskForm.assignedHelperMode === 'pick') {
      const h = helpers.find((x) => x.id === newTaskForm.assignedHelperId);
      chosenHelperId = h?.id || '';
      chosenHelperName = h?.displayName || h?.name || '';
      chosenHelperUid = h?.helperUid || '';
    } else {
      chosenHelperName = newTaskForm.assignedHelperName || '';
    }

    const newTask = {
      eventId: currentEvent.id,
      title,
      category: categoryKey,
      isCompleted: false,
      venue: newTaskForm.venue,
      dueDate: newTaskForm.dueDate,
      // 2026-07-17 — pass through optional time. Empty string is
      // fine; the display layer (TaskDeadline) treats empty = date-only.
      dueTime: newTaskForm.dueTime || '',
      estimatedCost: Number(newTaskForm.estimatedCost) || 0,
      actualCost: Number(newTaskForm.estimatedCost) || 0,
      taskType: 'vendor',
      // 2026-07-15 — vendor-assignment fields. Either or both may
      // be empty; vendor reads use assignedVendorUid to filter.
      assignedContactId: chosenContact?.id || '',
      assignedVendorName: chosenContact?.vendorName || '',
      assignedVendorUid: chosenContact?.linkedVendorUid || '',
      // 2026-07-17 — helper (兄弟姊妹) assignment fields. Same
      // parallel pattern as vendor above. We always store
      // `assignedHelperName` (so the chip never goes blank); we
      // store `assignedHelperId` only when picked from the dropdown
      // (so we can switch to the linked helper UI later); we store
      // `assignedHelperUid` only when the helper has been linked to
      // an auth uid (post-invite-acceptance).
      assignedHelperId: chosenHelperId,
      assignedHelperName: chosenHelperName,
      assignedHelperUid: chosenHelperUid,
      // 2026-08-09 — denormalize event name + date so the vendor's
      // collectionGroup('tasks').where('assignedVendorUid'==...) read
      // can show which wedding this task is for. See upsertWeddingDoc
      // for the full rationale (per-event read rule denies non-owners).
      eventName: currentEvent?.name || null,
      eventDate: currentEvent?.date || null,
    };
    // 2026-07-27 — Migrated to event-scoped path.
    await addDoc(collection(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', currentEvent.id, 'tasks'), newTask);
    setNewTaskForm({
      categoryTop: '',
      categorySub: '',
      categoryKey: 'other',
      assignedContactId: '',
      customTitle: '',
      venue: '',
      dueDate: '2026-12-31',
      dueTime: '',
      estimatedCost: '',
      taskType: 'vendor',
      assignedHelperId: '',
      assignedHelperName: '',
      assignedHelperUid: '',
      assignedHelperMode: 'pick',
    });
    showToast('✅ 任務已新增');
  };

  // 2026-07-27 — Migrated to event-scoped path.
  const toggleTask = async (task, e) => {
    e.stopPropagation();
    if (!user || userRole !== 'owner' || !currentEvent?.id) return;
    const taskRef = doc(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', currentEvent.id, 'tasks', task.id);
    await updateDoc(taskRef, {
      isCompleted: !task.isCompleted,
      actualCost: !task.isCompleted ? task.estimatedCost : 0,
    });
    // 2026-07-19 — append to the per-task audit trail so the
    // activity timeline picks up the check/uncheck as a status
    // change ('done' <-> previous). Task already had a `status`
    // field; we map isCompleted back to one of the TASK_STATUSES
    // ids for the trail.
    recordTaskStatusUpdate({
      ownerUid: user.uid,
      taskId: task.id,
      fromStatus: task.status || null,
      toStatus: !task.isCompleted ? 'done' : task.status || 'todo',
      byUid: user.uid,
      byName: user.displayName || user.email || '主理新人',
      byRole: 'owner',
      // 2026-08-09 — denormalize access-control fields so the top-level
      // /{path=**}/statusUpdates collectionGroup rule can gate reads.
      // Owner-role: only the owner (the user themselves) writes here,
      // but the assigned vendor/helper must still be able to see this
      // update in their bell. Pass them through from the parent task.
      assignedVendorUid: task.assignedVendorUid || null,
      assignedHelperUid: task.assignedHelperUid || null,
    });
  };

  // Restore 2026-07-02: inline edit budget target from CoupleBudget EditableBudgetCard
  const handleSaveBudget = async (newBudget) => {
    if (!user || !currentEvent) return;
    const eventRef = doc(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', currentEvent.id);
    await updateDoc(eventRef, { budget: Number(newBudget) });
    // Optimistic local update so the UI reflects the change immediately
    setCurrentEvent({ ...currentEvent, budget: Number(newBudget) });
    showToast('✅ 總預算已更新');
    return Number(newBudget);
  };

  // Restore 2026-07-02: inline edit task cost from CoupleChecklist
  const [editingTaskId, setEditingTaskId] = useState(null);
  // 2026-07-23 — Fixed signature mismatch. TaskCostEditor in
  // CoupleChecklist calls onSave(task.id, est, act) — three args.
  // The old signature (task, newCost) only took 2 and ignored the
  // actual cost, plus `task.id` was a string so `doc(... 'tasks',
  // undefined)` would either throw a permission error or write to
  // the wrong path. Now matches the caller: takes (taskId, est, act)
  // and writes both fields so totals stay correct.
  // 2026-07-27 — Migrated to event-scoped path.
  const handleUpdateTaskCost = async (taskId, estimatedCost, actualCost) => {
    if (!user || !currentEvent?.id) return;
    const taskRef = doc(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', currentEvent.id, 'tasks', taskId);
    await updateDoc(taskRef, {
      estimatedCost: Number(estimatedCost) || 0,
      actualCost: Number(actualCost) || 0,
    });
    setEditingTaskId(null);
    showToast('✅ 任務金額已更新');
  };

  // 2026-07-24 — full task edit. Previously only cost was editable.
  // Now owners can change title, category, venue, due date, vendor,
  // helper, and costs from the same place via <TaskFullEditor>.
  // 2026-07-27 — Migrated to event-scoped path.
  const handleUpdateTask = async (taskId, updates) => {
    if (!user || !currentEvent?.id) return;
    const taskRef = doc(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', currentEvent.id, 'tasks', taskId);
    const cleaned = {};
    Object.entries(updates).forEach(([k, v]) => {
      if (v !== undefined) cleaned[k] = v;
    });
    await updateDoc(taskRef, cleaned);
    setEditingTaskId(null);
    showToast('✅ 任務已更新');
  };

  // 2026-07-27 — Migrated to event-scoped path.
  const handleDeleteTask = async (task) => {
    if (!user || !currentEvent?.id) return;
    await deleteDoc(doc(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', currentEvent.id, 'tasks', task.id));
    setActiveCategory(null);
  };

  // ---- 2026-07-17: Big Day (大日統籌) (WeddingDay suite) CRUD handlers.
  // Each handler owns one of the four collections:
  //   rundown / resources / teaCeremony / playlist
  // Writes are direct against Firestore — owner-only rules gate the
  // writes client-side, so no Cloud Function is required. The screen
  // passes an `id`; on create the id is prefixed with the collection
  // so re-builds from CSV / seed scripts don't collide.
  const weddingCol = (name) => collection(db, 'artifacts', appId, 'users', user?.uid || '_', name);

  // 2026-07-18 — Fix #1174: the previous version of this function
  // had its second parameter literally named `doc`, which SHADOWED
  // the imported `doc()` helper from firebase/firestore. So
  // `doc(db, 'artifacts', ...)` was actually calling the data
  // object as a function and throwing TypeError on every playlist
  // add / rundown add / resources add / tea-ceremony add. Renaming
  // to `data` (and same for deleteWeddingDoc) restores the calls
  // — see git blame if you're curious why all four tabs were
  // silently failing to persist writes today.
  // Per-collection wrappers — pass these to <WeddingDay/>:
  // 2026-07-27 — Migrated from /users/{ownerUid}/{name} to
  // /users/{ownerUid}/events/{eventId}/{name}. Per-collection wrapper
  // refuses to write when no currentEvent is selected, instead of
  // writing to the old owner-scoped slot.
  const upsertWeddingDoc = async (name, data) => {
    if (!user || !data?.id || !currentEvent?.id) return;
    const ref = doc(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', currentEvent.id, name, data.id);
    // Strip the id itself — Firestore stores it as the doc key
    const { id: _id, ...rest } = data;
    try {
      // 2026-08-09 — denormalize event name + date onto every
      // wedding-day doc so the vendor's collectionGroup read can
      // show "which wedding is this for" without a separate
      // event-doc fetch (which the per-event read rule would deny
      // for non-owners). Covers rundown / resources / teaCeremony /
      // playlist because all four go through this helper. The two
      // fields are stable for the lifetime of the event; if the
      // couple renames or reschedules, the next upsert overwrites.
      await setDoc(
        ref,
        {
          ...rest,
          eventId: currentEvent.id,
          eventName: currentEvent.name || null,
          eventDate: currentEvent.date || null,
          updatedAt: Date.now(),
        },
        { merge: true },
      );
    } catch (err) {
      throw err;
    }
  };
  const deleteWeddingDoc = async (name, id) => {
    if (!user || !id || !currentEvent?.id) return;
    await deleteDoc(doc(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', currentEvent.id, name, id));
  };

  // Per-collection wrappers — pass these to <WeddingDay/>:
  const handleUpsertRundown = (d) => upsertWeddingDoc('rundown', d);
  const handleDeleteRundown = (id) => deleteWeddingDoc('rundown', id);
  // 2026-07-27 — Migrated to event-scoped path.
  const handleReorderRundown = async (id, direction) => {
    if (!user || !id || !currentEvent?.id) return;
    const snap = (rundown || []).find((e) => e.id === id);
    if (!snap) return;
    const cur = snap.startTime || '12:00';
    const [h, m] = cur.split(':').map((n) => parseInt(n, 10));
    const delta = direction === 'up' ? -15 : 15;
    let total = h * 60 + m + delta;
    if (total < 0) total = 0;
    if (total > 24 * 60 - 1) total = 24 * 60 - 1;
    const nh = Math.floor(total / 60);
    const nm = total % 60;
    const ref = doc(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', currentEvent.id, 'rundown', id);
    await setDoc(ref, { startTime: `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}` }, { merge: true });
  };
  // 2026-07-22b — Bulk manualPosition setter for 大日流程 drag-
  // and-drop reorder. Writes all affected positions in parallel.
  // 2026-07-27 — Migrated to event-scoped path.
  const handleSetRundownPositions = async (writes) => {
    if (!user || !writes || writes.length === 0 || !currentEvent?.id) return;
    const refs = writes.map(({ id, manualPosition }) =>
      setDoc(
        doc(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', currentEvent.id, 'rundown', id),
        { manualPosition },
        { merge: true },
      ),
    );
    await Promise.all(refs);
  };
  const handleUpsertResource = (d) => upsertWeddingDoc('resources', d);
  const handleDeleteResource = (id) => deleteWeddingDoc('resources', id);
  // 2026-07-27 — Migrated to event-scoped path.
  const handleToggleResource = async (id, checked) => {
    if (!user || !currentEvent?.id) return;
    const ref = doc(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', currentEvent.id, 'resources', id);
    await setDoc(ref, { checked }, { merge: true });
  };
  // 2026-07-22 — 物資 reorder. Same algorithm as playlist:
  // swap manualPosition between two adjacent items in the same
  // category. O(1) parallel writes.
  // 2026-07-27 — Migrated to event-scoped path.
  const handleReorderResource = async (idA, posA, idB, posB) => {
    if (!user || !idA || !idB || !currentEvent?.id) return;
    const a = doc(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', currentEvent.id, 'resources', idA);
    const b = doc(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', currentEvent.id, 'resources', idB);
    await Promise.all([
      setDoc(a, { manualPosition: posA }, { merge: true }),
      setDoc(b, { manualPosition: posB }, { merge: true }),
    ]);
  };
  // 2026-07-22b — Bulk manualPosition setter for drag-and-drop
  // reorder. Takes [{id, manualPosition}, ...] and writes them
  // in parallel. Used by both 物資 and 歌單.
  // 2026-07-27 — Migrated to event-scoped path.
  const handleSetResourcePositions = async (writes) => {
    if (!user || !writes || writes.length === 0 || !currentEvent?.id) return;
    const refs = writes.map(({ id, manualPosition }) =>
      setDoc(
        doc(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', currentEvent.id, 'resources', id),
        { manualPosition },
        { merge: true },
      ),
    );
    await Promise.all(refs);
  };
  const handleUpsertTeaCeremony = (d) => upsertWeddingDoc('teaCeremony', d);
  const handleDeleteTeaCeremony = (id) => deleteWeddingDoc('teaCeremony', id);
  // 2026-07-22 — 敬茶名單 reorder. Swaps the existing `order`
  // field on two adjacent people in the same group. Both writes
  // are O(1) — no renumbering of subsequent rows needed.
  // 2026-07-27 — Migrated to event-scoped path.
  const handleReorderTeaCeremony = async (idA, orderA, idB, orderB) => {
    if (!user || !idA || !idB || !currentEvent?.id) return;
    const a = doc(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', currentEvent.id, 'teaCeremony', idA);
    const b = doc(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', currentEvent.id, 'teaCeremony', idB);
    await Promise.all([
      setDoc(a, { order: orderA }, { merge: true }),
      setDoc(b, { order: orderB }, { merge: true }),
    ]);
  };
  // 2026-07-22b — Single-row order setter. Used by drag-and-drop
  // reorder, which can affect N rows at once when the user drags
  // a row across the list (everyone in between shifts by one).
  // We batch the writes into Promise.all for a single network
  // round-trip. The swap-pair handler above is kept for any
  // callers still using the older ▲▼ semantics.
  // 2026-07-27 — Migrated to event-scoped path.
  const handleSetTeaCeremonyOrders = async (writes) => {
    if (!user || !writes || writes.length === 0 || !currentEvent?.id) return;
    const refs = writes.map(({ id, order }) =>
      setDoc(
        doc(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', currentEvent.id, 'teaCeremony', id),
        { order },
        { merge: true },
      ),
    );
    await Promise.all(refs);
  };
  const handleUpsertPlaylist = (d) => upsertWeddingDoc('playlist', d);
  const handleDeletePlaylist = (id) => deleteWeddingDoc('playlist', id);
  // 2026-07-22 — playlist reorder. Couples tap ▲▼ in the manual
  // sort mode of the 歌單 tab. We write manualPosition on the two
  // swapped songs. Idempotent: re-running the swap with the same
  // args is a no-op (setDoc with merge=true on unchanged data).
  // 2026-07-27 — Migrated to event-scoped path.
  const handleReorderPlaylist = async (idA, posA, idB, posB) => {
    if (!user || !idA || !idB || !currentEvent?.id) return;
    const a = doc(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', currentEvent.id, 'playlist', idA);
    const b = doc(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', currentEvent.id, 'playlist', idB);
    // Parallel writes — both should succeed independently. If one
    // fails (e.g. network glitch) the UI will rerender on the next
    // subscription tick from the partial state, and a fresh ▲/▼
    // tap can re-synchronize. We don't try to batch them in a
    // transaction because the cost (lock contention) outweighs the
    // benefit (consistency in a UI the user is actively clicking).
    await Promise.all([
      setDoc(a, { manualPosition: posA }, { merge: true }),
      setDoc(b, { manualPosition: posB }, { merge: true }),
    ]);
  };
  // 2026-07-22b — Bulk manualPosition setter for 歌單 drag-and-
  // drop reorder. Same parallel-write pattern as the others.
  // 2026-07-27 — Migrated to event-scoped path.
  const handleSetPlaylistPositions = async (writes) => {
    if (!user || !writes || writes.length === 0 || !currentEvent?.id) return;
    const refs = writes.map(({ id, manualPosition }) =>
      setDoc(
        doc(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', currentEvent.id, 'playlist', id),
        { manualPosition },
        { merge: true },
      ),
    );
    await Promise.all(refs);
  };

  const handleAddGuest = async (e) => {
    e.preventDefault();
    if (!user || !currentEvent || !newGuestForm.name) return;
    const guestId = Math.random().toString(36).substring(2, 8).toUpperCase();
    // 2026-07-18 — Coerce empty tableNumber → '未分配' at write time so
    // the data layer stays consistent. Form shows blank, doc stores the
    // sentinel.
    const tableNumber = newGuestForm.tableNumber.trim() || '未分配';
    const newGuest = {
      eventId: currentEvent.id,
      guestId,
      ...newGuestForm,
      tableNumber,
      hasAttended: false,
      hasGifted: false,
      giftAmount: 0,
    };
    // 2026-08-03 — Diagnostic for "unable to add guest" report.
    // Logs the actual values the rule will see (path-ownerUid,
    // current-event coOwners, signed-in user uid) so we can tell
    // whether the rejection is `request.auth.uid != ownerUid` or
    // `coOwners` missing. Safe to remove after the bug is fixed.
    // eslint-disable-next-line no-console
    console.info('[addGuest-debug] path-ownerUid=', dataOwnerUid, 'event.id=', currentEvent.id, 'auth.uid=', user.uid, 'event._ownerUid=', currentEvent._ownerUid, 'event.coOwners=', currentEvent.coOwners, 'payload.eventId=', newGuest.eventId);
    // 2026-07-27 — Migrated to event-scoped path.
    try {
      await addDoc(collection(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', currentEvent.id, 'guests'), newGuest);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[addGuest-debug] FAILED', {
        code: err && err.code,
        message: err && err.message,
        path: `artifacts/${appId}/users/${dataOwnerUid}/events/${currentEvent.id}/guests`,
        signedInUid: user.uid,
        pathOwnerUid: dataOwnerUid,
        eventOwnerUid: currentEvent._ownerUid,
        eventCoOwners: currentEvent.coOwners,
        payload: newGuest,
      });
      showToast('❌ 新增失敗：' + ((err && err.message) || 'Unknown error') + (err && err.code ? ` (${err.code})` : ''));
      return;
    }
    setNewGuestForm({ name: '', group: '男家親戚', headCount: 1, tableNumber: '' });
    showToast('✅ 嘉賓已加入名單，已生成專屬 QR Code！');
  };

  /**
   * Restore 2026-07-02: handleAddFamily — atomic batch write of 1 parent + N members.
   * Schema:
   *   parent row: { householdId: <own guestId>, isHouseholdParent: true, name, email, ... }
   *   member rows: { householdId: <parent guestId>, name } (no email — parent's email is the contact)
   * Migration-safe: rows without householdId behave exactly like legacy single rows.
   */
  const handleAddFamily = async (e) => {
    e.preventDefault();
    if (!user || !currentEvent) return;
    const f = familyForm;
    const memberNames = (f.members || []).map((m) => m.trim()).filter(Boolean);
    if (!f.name.trim()) return;
    if (memberNames.length === 0) {
      showToast('⚠️ 至少要加一位家庭成員');
      return;
    }

    // Parent gets its own random guestId; children reference it.
    const parentGuestId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const batch = writeBatch(db);
    // 2026-07-27 — Migrated to event-scoped path.
    const guestsCol = collection(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', currentEvent.id, 'guests');

    // Parent row (carries household-level fields: contact email, head count)
    const parentRef = doc(guestsCol);
    batch.set(parentRef, {
      eventId: currentEvent.id,
      guestId: parentGuestId,
      householdId: parentGuestId,       // self-reference = "I am the parent"
      isHouseholdParent: true,
      name: f.name.trim(),
      email: f.email.trim(),
      group: f.group,
      tableNumber: f.tableNumber,
      headCount: memberNames.length + 1,
      hasAttended: false,
      hasGifted: false,
      giftAmount: 0,
      createdAt: Date.now(),
    });

    // Member rows (one per actual attendee)
    for (const mName of memberNames) {
      const childGuestId = Math.random().toString(36).substring(2, 8).toUpperCase();
      const childRef = doc(guestsCol);
      batch.set(childRef, {
        eventId: currentEvent.id,
        guestId: childGuestId,
        householdId: parentGuestId,       // points at parent
        name: mName,
        group: f.group,
        tableNumber: f.tableNumber,
        headCount: 1,
        hasAttended: false,
        hasGifted: false,
        giftAmount: 0,
        createdAt: Date.now(),
      });
    }

    try {
      await batch.commit();
      showToast(`✅ 已加入「${f.name}」家庭（${memberNames.length + 1}人）`);
      setFamilyForm({ name: '', email: '', group: '男家親戚', tableNumber: '', members: [''] });
    } catch (err) {
      showToast('✗ 加入失敗：' + (err?.message || '未知錯誤'));
    }
  };

  // 2026-07-02 — edit/delete single-row guest via EditGuestModal
  // 2026-08-04 — Migrated all four guest writers below to the
  // event-scoped path /users/{ownerUid}/events/{eventId}/guests. The
  // reads at line ~1011, the add at ~2117, and the addFamily at ~2159
  // were already on the event-scoped path; the writes below were the
  // remaining stragglers still using the legacy owner-scoped path,
  // which is no longer readable/writable under the deployed rules
  // (the rules block was deleted in the 2026-07-27 collectionGroup
  // migration). Symptoms: EditGuestModal "儲存" → 403; red-packet
  // update → 403; reception scan → 403. eventId resolution: prefer
  // the doc body's own eventId field (set by Firestore when the row
  // was written under the new path); fall back to currentEvent.id
  // for the typical owner-flow case; fall back to guest.qEvent when
  // acting on behalf of a guest-mode viewer.
  const resolveGuestDocOwner = (row) => {
    if (row?.isGuestMode && row.qOwner) return row.qOwner;
    return dataOwnerUid || user?.uid;
  };
  const resolveGuestEventId = (row) => {
    if (row?.eventId) return row.eventId;
    if (guest.isGuestMode && guest.qEvent) return guest.qEvent;
    return currentEvent?.id;
  };

  const handleSaveGuest = async (formData) => {
    if (!user || !editingGuest) return;
    const ownerUid = resolveGuestDocOwner(editingGuest);
    const eventId = resolveGuestEventId(editingGuest);
    if (!ownerUid || !eventId) {
      showToast('✗ 儲存失敗：搵唔到所屬活動');
      return;
    }
    const ref = doc(
      db,
      'artifacts', appId,
      'users', ownerUid,
      'events', eventId,
      'guests', editingGuest.id,
    );
    await updateDoc(ref, {
      name: formData.name,
      email: formData.email || '',
      group: formData.group,
      tableNumber: formData.tableNumber,
      headCount: formData.headCount,
    });
    setEditingGuest(null);
    showToast('✅ 嘉賓資料已更新');
  };

  const handleDeleteGuest = async (guestRow) => {
    if (!user || !guestRow) return;
    const ownerUid = resolveGuestDocOwner(guestRow);
    const eventId = resolveGuestEventId(guestRow);
    if (!ownerUid || !eventId) {
      showToast('✗ 刪除失敗：搵唔到所屬活動');
      return;
    }
    await deleteDoc(
      doc(db, 'artifacts', appId, 'users', ownerUid, 'events', eventId, 'guests', guestRow.id),
    );
    setEditingGuest(null);
    showToast('🗑️ 嘉賓已刪除');
  };

  const handleGiveRedPacket = async (amount) => {
    if (!user || !activeGuestPortal) return;
    const ownerUid = resolveGuestDocOwner(activeGuestPortal);
    const eventId = resolveGuestEventId(activeGuestPortal);
    if (!ownerUid || !eventId) {
      showToast('✗ 發送失敗：搵唔到所屬活動');
      return;
    }
    const guestRef = doc(
      db, 'artifacts', appId,
      'users', ownerUid,
      'events', eventId,
      'guests', activeGuestPortal.id,
    );
    await updateDoc(guestRef, { hasGifted: true, giftAmount: amount });
    setShowPaymentModal(false);
    showToast(`🧧 成功發送 $${amount} 電子人情，感謝！`);
  };

  const handleSimulateReceptionScan = async (guestRow) => {
    if (!user || !guestRow) return;
    const ownerUid = resolveGuestDocOwner(guestRow);
    const eventId = resolveGuestEventId(guestRow);
    if (!ownerUid || !eventId) {
      showToast('✗ 掃描失敗：搵唔到所屬活動');
      return;
    }
    const guestRef = doc(
      db, 'artifacts', appId,
      'users', ownerUid,
      'events', eventId,
      'guests', guestRow.id,
    );
    const now = Date.now();

    // Two writes: (1) flip hasAttended + stamp audit fields on guest row,
    // (2) append an immutable entry to scanLog. We do them in a batch so
    // either both land or neither does.
    // 2026-08-04 — scanLog also moved to event-scoped path; the
    // owner-scoped /scanLog/ rule was deleted in the 2026-07-27
    // migration. Without this fix, the batch.commit() throws 403 on
    // the logRef.set() and the guest's hasAttended is silently NOT
    // applied.
    const batch = writeBatch(db);
    batch.update(guestRef, {
      hasAttended: true,
      lastScannedBy: user.uid,
      lastScannedAt: now,
    });
    const logRef = doc(
      collection(db, 'artifacts', appId, 'users', ownerUid, 'events', eventId, 'scanLog'),
    );
    batch.set(logRef, {
      guestId: guestRow.guestId || guestRow.id,
      guestName: guestRow.name || '',
      helperUid: user.uid,
      helperName: user.displayName || user.email || 'Anonymous',
      eventId,
      scannedAt: now,
    });
    await batch.commit();

    setScanResult(guestRow);
    setTimeout(() => setScanResult(null), 3000);
  };

  const simulateScanQrCode = () => {
    const unAttendedGuests = eventGuests.filter((g) => !g.hasAttended);
    if (unAttendedGuests.length === 0) return showToast('✅ 所有嘉賓已成功報到！');
    const randomGuest = unAttendedGuests[Math.floor(Math.random() * unAttendedGuests.length)];
    handleSimulateReceptionScan(randomGuest);
  };

  // 2026-07-15 — opens or fetches the conversation between the
  // current user (must be a couple or vendor with a real account)
  // and the other party, then routes to ChatRoom.
  //   couple → vendor: vendorUid is the vendor's uid; coupleUid is the user's
  //   vendor → couple: coupleUid is the couple's uid; vendorUid is the user's
  const handleOpenChat = async ({ otherUid, otherName, eventId }) => {
    if (!user || !otherUid) return;
    const isVendor = userRole === 'vendor';
    const vendorUid = isVendor ? user.uid : otherUid;
    const coupleUid = isVendor ? otherUid : user.uid;
    const vendorName = isVendor
      ? vendorProfile?.name || user.displayName || user.email || '商戶'
      : otherName || '商戶';
    const coupleName = isVendor
      ? otherName || currentEvent?.name || '新人'
      : currentEvent?.name || user.displayName || user.email || '新人';
    try {
      const id = await openInquiry({
        vendorUid,
        coupleUid,
        vendorName,
        coupleName,
        eventId: eventId || currentEvent?.id || '',
      });
      // Find the local copy of the inquiry (may already be in the
      // subscription cache) so ChatRoom has the vendorName/coupleName.
      const local = inquiries.find((i) => i.id === id) || {
        id,
        vendorUid,
        coupleUid,
        vendorName,
        coupleName,
        eventId: eventId || currentEvent?.id || '',
      };
      setSelectedInquiry(local);
      setCurrentView('chat-room');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('openInquiry failed:', err);
      showToast('✗ 開啟對話失敗');
    }
  };

  const handleSelectInquiry = (inq) => {
    setSelectedInquiry(inq);
    setCurrentView('chat-room');
    // Clear unread for the current side.
    const role = userRole === 'vendor' ? 'vendor' : 'couple';
    markInquiryRead(inq.id, role).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('markInquiryRead failed:', err?.message);
    });
  };

  // 2026-08-07 — DELETED upgradeToPremium. It used to write
  // tier:'premium' directly to Firestore when the couple tapped
  // 立即付款 HK$99 解鎖 in UpgradeModal — no payment, just an
  // immediate "已成功升級至 Premium" toast. Couples got premium
  // for free. UpgradeModal's onConfirm now opens <PurchaseModal>
  // instead, which goes through the real payment path
  // (PayMe/FPS receipt → submitPaymentReceipt → adminVerifyPayment
  // → grantUnlock). See src/App.jsx around line 3322 (the
  // <UpgradeModal> mount) for the new wiring.

  // Photo upload — uploads to NAS via Tailscale Funnel (replaces Firebase
  // Storage to avoid Firebase egress/storage charges). After the upload
  // succeeds, we record the photo URL in Firestore so the owner's PhotoDrop
  // gallery picks it up via onSnapshot.
  //
  // 2026-08-05 — replaced silent returns with toast errors.
  // Previously the guard `if (!file || !user || !currentEvent ||
  // !activeGuestPortal) return;` would silently drop the upload
  // when currentEvent was null (which happens when the guest-mode
  // event-doc read fails on the rules), and the user saw nothing.
  // Now we toast which guard fired so future bugs are visible.
  const handleRealUpload = async (e) => {
    const file = e?.target?.files?.[0];
    if (!file) {
      // (no toast — usually means the user opened the picker and
      // cancelled, which is normal and shouldn't spam toasts)
      if (e?.target) e.target.value = '';
      return;
    }
    if (!activeGuestPortal) {
      showToast('❌ 上載失敗：尚未載入嘉賓資料，請稍後再試');
      if (e?.target) e.target.value = '';
      return;
    }
    if (!currentEvent) {
      showToast('❌ 上載失敗：尚未載入婚禮資料，請稍後再試');
      if (e?.target) e.target.value = '';
      return;
    }
    if (!user) {
      showToast('❌ 上載失敗：登入狀態已過期，請重新整理頁面');
      if (e?.target) e.target.value = '';
      return;
    }
    if (isStorageFull) {
      setShowUpgradeModal(true);
      if (e?.target) e.target.value = '';
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    const targetUid = guest.isGuestMode ? guest.qOwner : user.uid;
    try {
      const { url, thumbnailUrl } = await uploadPhotoToNas({
        file,
        eventId: currentEvent.id,
        guestId: activeGuestPortal.guestId,
        uploaderName: activeGuestPortal.name,
        // 2026-08-02 — Attach the owner's preferences token so
        // the NAS skips the watermark step when the owner has
        // the `watermark-removed` unlock. null when the owner
        // doesn't have the unlock (or while the token is still
        // being fetched). The upload still succeeds in either
        // case — it just lands with or without the watermark.
        prefsToken: uploadPrefsToken,
        onProgress: setUploadProgress,
      });
      // Persist the public URL + thumbnail URL in Firestore so the owner's
      // PhotoDrop screen can render it (uses onSnapshot for live updates).
      // thumbnailUrl is the smaller 256px version — the gallery uses it so
      // guests on slow wifi don't have to download full 4-8 MB phone photos.
      // 2026-07-23 — firestore.rules now allows isOwner(ownerUid) to
      // create photos (was only guests + helpers before). Photo upload
      // from the owner's own session was failing on addDoc.
      // 2026-07-27 — Migrated to event-scoped path.
      // 2026-08-05 — Persist `uploadAuthUid` (the Firebase Auth UID
      // at upload time) on the photo doc so the rule can verify
      // guest self-delete later. We use `auth.currentUser?.uid`
      // because for guest sessions this is the anonymous UID, and
      // for the owner's session this is the owner's auth.uid —
      // either way it's the auth.uid we need to compare against
      // `request.auth.uid` in the rule. For owner-uploaded photos
      // both owner + co-owner tiers still apply, so this field is
      // effectively unused there, but recording it consistently
      // simplifies the rule path. (Owner delete goes through the
      // `isOwnerOrAnyCoOwner` tier, which never reads this field.)
      await addDoc(collection(db, 'artifacts', appId, 'users', dataOwnerUid, 'events', currentEvent.id, 'photos'), {
        eventId: currentEvent.id,
        url,
        thumbnailUrl: thumbnailUrl || url,  // fall back to full URL for legacy photos
        uploaderId: activeGuestPortal.guestId,
        uploaderName: activeGuestPortal.name,
        createdAt: Date.now(),
        uploadAuthUid: auth.currentUser?.uid ?? null,
      });
      showToast('📸 相片已成功上載至大螢幕！');
    } catch (err) {
      console.error('Upload failed:', err);
      // 2026-07-23 — surface the most common cause with a
      // Chinese hint that matches the user's vocabulary.
      // "Missing or insufficient permissions" on the photo
      // addDoc usually means the guestLinks/{auth.uid} doc
      // has an expired expiresAt (long-lived session, old
      // share-link token) or the guest's auth.uid changed
      // since verifyShareToken ran. Re-sign-in via the
      // share link is the recovery.
      const isPermError = err?.code === 'permission-denied' ||
        /Missing or insufficient permissions/i.test(err?.message || '');
      const hint = isPermError
        ? '（請重新整理相簿 QR code 連結）'
        : '';
      showToast(`❌ ${err.message || '上載失敗，請重試！'}${hint}`);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      // Reset the input so selecting the same file twice still triggers onChange
      if (e?.target) e.target.value = '';
    }
  };

  const handleJobSubmit = async (e) => {
    e.preventDefault();
    if (!newJobForm.budget) return;
    // 2026-07-23 — Route through the postJobRequest Cloud Function
    // instead of writing directly to Firestore. The /jobRequests
    // collection lives at the top level but firestore.rules only
    // defines a match block under /artifacts/{appId}/jobRequests, so
    // direct client writes fail with "Missing or insufficient
    // permissions". The callable uses the Admin SDK (service account)
    // and bypasses rules entirely.
    //
    // Validation matches what the callable enforces server-side:
    //   - budget: required string, ≤ 100 chars
    //   - details: optional string, ≤ 1000 chars
    try {
      const venuesArr = newJobForm.venueInput
        ? newJobForm.venueInput
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean)
            .slice(0, 20)
        : [];
      await callFirebaseFn('postJobRequest', {
        serviceNeeded: newJobForm.serviceNeeded,
        venues: venuesArr,
        budget: newJobForm.budget,
        details: newJobForm.details,
        eventName: currentEvent?.name || '',
        weddingDate: currentEvent?.date || '',
      });
      setNewJobForm({ serviceNeeded: '場地佈置', venueInput: '', budget: '', details: '' });
      showToast('✅ 求救 Post 已成功發佈！');
    } catch (err) {
      console.error('[handleJobSubmit] failed:', err);
      showToast(`❌ 發佈失敗：${err?.message || '未知錯誤'}`);
    }
  };

  // 2026-07-23 — PhotoDrop callbacks. Owners can edit caption /
  // reactions and delete their own photos. firestore.rules already
  // permits update+delete by isOwner(ownerUid) so we can write
  // directly from the client (no Cloud Function needed).
  //
  // 2026-08-05 — handleUpdatePhoto path was on the legacy
  // `users/{ownerUid}/photos/{photoId}` collection (pre the
  // 2026-07-27 collectionGroup migration). Photos now live at
  // `users/{ownerUid}/events/{eventId}/photos/{photoId}`.
  // Without eventId in the path the doc doesn't exist and
  // updateDoc / deleteDoc silently 404. Fixed here for both
  // update + delete — the previous handleDeletePhoto was
  // doubly broken (wrong path AND the Trash button never
  // showed because the isOwner prop was mislabeled).
  const handleUpdatePhoto = async (photoId, patch) => {
    if (!user?.uid) throw new Error('請先登入');
    if (!currentEvent?.id) throw new Error('No active event');
    const photoRef = doc(
      db,
      'artifacts',
      appId,
      'users',
      dataOwnerUid,
      'events',
      currentEvent.id,
      'photos',
      photoId,
    );
    await updateDoc(photoRef, patch);
  };

  // 2026-08-05 — Photo-delete end-to-end. Two deletes must
  // happen, in this order:
  //
  //   1. Delete the file on the NAS (cdn.savetheday.io). The
  //      Firestore doc is just metadata; without step 1 the
  //      bytes sit in /volume1/flight-scanner/wedding-photos/
  //      forever. We call the CF mintPhotoDeleteToken to mint
  //      a server-verified HMAC token (CF checks the caller
  //      is allowed to delete — owner/co-owner/uploader),
  //      then POST to /api/photo-delete which mints a fresh
  //      NAS-bound token and forwards the actual DELETE.
  //
  //   2. Delete the Firestore doc. firestore.rules permits
  //      delete for the same three tiers as the CF; this is
  //      the last write so the UI sees the row disappear.
  //
  // If step 1 fails, we abort and DON'T delete the Firestore
  // doc — otherwise we end up with a doc pointing at a 404'd
  // file (orphan). The UI shows the row with the trash
  // button enabled and the user can retry.
  //
  // Idempotency: both deletes are safe to retry (NAS returns
  // 204 even if the file is already gone; Firestore deleteDoc
  // is a no-op on a missing doc).
  const handleDeletePhoto = async (photoId) => {
    if (!user?.uid) throw new Error('請先登入');
    if (!currentEvent?.id) throw new Error('No active event');

    // (a) Look up the photo doc so we have the photoUrl for
    // the NAS-side delete. Reads the same path the rules use.
    const photoRef = doc(
      db,
      'artifacts',
      appId,
      'users',
      dataOwnerUid,
      'events',
      currentEvent.id,
      'photos',
      photoId,
    );
    const photoSnap = await getDoc(photoRef);
    if (!photoSnap.exists()) {
      // Already gone — treat as success so the UI can clear.
      return;
    }
    const photoData = photoSnap.data() || {};
    const photoUrl = photoData.url;

    // (b) Mint the CF delete token. The CF verifies the caller
    // against the photo's ownerUid / coOwnerUIDs /
    // uploadAuthUid (see functions/src/photoDeleteToken.ts).
    const mintFn = httpsCallable(functions, 'mintPhotoDeleteToken');
    const mintRes = await mintFn({
      ownerUid: dataOwnerUid,
      eventId: currentEvent.id,
      photoDocId: photoId,
    });
    const { token: deleteToken } = mintRes.data || {};
    if (!deleteToken) {
      throw new Error('Delete token mint returned no token');
    }

    // (c) Call the Vercel proxy. The proxy re-verifies the
    // token, mints an NAS-bound HMAC token, and forwards the
    // DELETE to cdn.savetheday.io.
    const proxyRes = await fetch('/api/photo-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: currentEvent.id,
        photoUrl,
        photoDocId: photoId,
        deleteToken,
      }),
    });
    if (!proxyRes.ok) {
      const errBody = await proxyRes.text();
      console.error('[handleDeletePhoto] proxy failed:', proxyRes.status, errBody);
      throw new Error(`Delete failed (${proxyRes.status}): ${errBody.slice(0, 120)}`);
    }

    // (d) NAS file is gone. Now remove the Firestore doc —
    // rules permit delete for owner/co-owner/uploader.
    await deleteDoc(photoRef);
  };

  // 2026-08-08 — submitProposal: vendor opens the proposal
  // composer modal. The actual write to Firestore happens via the
  // submitProposal Cloud Function, called from inside
  // <SubmitProposalModal/>. The previous implementation only mutated
  // in-memory React state — couple never saw anything.
  const [proposalJob, setProposalJob] = useState(null); // {id, serviceNeeded, ...}
  const submitProposal = (jobId) => {
    const job = (liveJobRequests || []).find((j) => j.id === jobId);
    if (!job) {
      showToast('❌ 搵唔到呢個 job，可能已經被刪除。');
      return;
    }
    setProposalJob(job);
  };

  const handleInvite = (e) => {
    e.preventDefault();
    if (!inviteForm.name) return;
    showToast(`✅ 邀請電郵已發送至 ${inviteForm.email || '該成員'}`);
    setShowInviteModal(false);
    setInviteForm({ name: '', email: '' });
  };

  // ---- Render ----
  if (authChecked && !user && !guest.isGuestMode) {
    // 2026-07-14 — dedicated vendor signup card when the user clicked
    // the green 'I'm a Vendor' CTA. Stays on this card until they hit
    // the back link or complete sign-up.
    if (signingUpAs === 'vendor') {
      return (
        <VendorSignupCard
          onGoogleLogin={loginWithGoogle}
          onEmailRegister={registerWithEmail}
          onBack={() => {
            try { sessionStorage.removeItem('postLoginIntent'); } catch {}
            setSigningUpAs(null);
          }}
        />
      );
    }
    return (
      <LoginScreen
        onGoogleLogin={loginWithGoogle}
        onEmailLogin={loginWithEmail}
        onEmailRegister={registerWithEmail}
        onContinueAsGuest={continueAsGuest}
        onVendorSignup={() => setSigningUpAs('vendor')}
        defaultEmail={partnerInvite?.partnerEmail}
        defaultMode={partnerInvite ? 'signup' : undefined}
        inviteMessage={
          partnerInvite
            ? `你已被邀請一同籌備「${partnerInvite.eventName}」婚禮。請用 ${partnerInvite.partnerEmail} 建立帳戶以加入。\n(You've been invited to co-plan the "${partnerInvite.eventName}" wedding. Sign up with ${partnerInvite.partnerEmail} to join.)`
            : undefined
        }
        readOnlyEmail={Boolean(partnerInvite)}
      />
    );
  }
  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        系統連接中...
      </div>
    );
  }

  // ---- Helper waiting screen ----
  // If the user is signed in (non-anonymous), NOT in guest-mode, and is NOT
  // an active helper anywhere — show the waiting screen. Owner sees the
  // normal app because they always have at least one event of their own.
  // Vendors ALSO skip — they have their own dashboard route; the helper
  // waiting screen is only for the "signed in but no role assigned yet"
  // case (typically a couple's friend who got invited but hasn't accepted).
  //
  // 2026-07-15 — admins also skip. Without the !isAdmin gate, an admin
  // user who clicks the 兄弟姊妹 pill (which routes to userRole='reception')
  // falls through to this screen and sees "尚未收到邀請", which is wrong
  // — admins have full access via the role-switcher bar, they don't need
  // a helper invite. The 兄弟姊妹 pill is a preview, not an assignment.
  //
  // Skip for anonymous users: they'd loop forever waiting for invites that
  // can't exist (no email on file).
  if (
    !guest.isGuestMode &&
    user &&
    !user.isAnonymous &&
    user.email &&
    !helperCtx.loading &&
    !helperCtx.isHelper &&
    !isAdmin &&
    userRole !== 'owner' &&
    userRole !== 'vendor'
  ) {
    return (
      <HelperWaitingScreen
        assignments={helperCtx.assignments}
        loading={helperCtx.loading}
        accepting={helperAccepting}
        onAccept={async () => {
          setHelperAccepting(true);
          try {
            await helperCtx.acceptInvite();
            showToast('✓ 已接受邀請');
          } catch (err) {
            showToast(`✗ 接受失敗: ${err.message}`);
          } finally {
            setHelperAccepting(false);
          }
        }}
        onLogout={logout}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-10">
      {toast && (
        // 2026-07-24 — moved toast from top-4 to bottom-20 to avoid
        // overlapping the PersonalGuestPortal's ← 返回嘉賓列表
        // button (top-right) and the photo viewer's X button. The
        // toast is now anchored to the bottom of the screen so it
        // never sits on top of any top-bar UI. Added aria-live
        // for screen readers and removed the slide-in animation
        // (iOS Safari has historical bugs animating fixed-position
        // elements that combine transform + pointer-events:none).
        <div
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[200] bg-slate-900 text-white px-6 py-3 rounded-full shadow-2xl font-bold animate-in fade-in slide-in-from-bottom-4 pointer-events-none"
          role="status"
          aria-live="polite"
        >
          {toast}
        </div>
      )}

      {/* 2026-07-03 — GuestBanner is shown ABOVE the regular header so it
          stays visible no matter how the user scrolls. The sticky `top-0`
          keeps it pinned during scroll. NOT dismissable (per design
          decision — dismissing defeats the nag). Skipped for actual
          guest-portal URL visitors (they're not "trying out" the app). */}
      {isAnonymous && !guest.isGuestMode && (
        <GuestBanner
          onSignUp={() => setShowSignUpPrompt(true)}
          onLogout={handleLogout}
        />
      )}

      <RoleSimulator
        userRole={userRole}
        activeGuestPortal={activeGuestPortal}
        isAdmin={isAdmin}
        currentView={currentView}
        // Simulator is an admin / dev tool — only show to platform admins
        // (users with the admin custom claim). Helpers and regular owners
        // should never see this bar; it lets you impersonate other roles
        // and jump to admin-only views.
        show={Boolean(user) && !user.isAnonymous && isAdmin}
        onSwitch={(target) => {
          // Admin pills pass a view key directly instead of a role.
          if (
            target === 'vendor-analytics' ||
            target === 'admin-users' ||
            target === 'admin-vendors' ||
            target === 'admin-queue' ||
            target === 'admin-payment-settings'
          ) {
            // Stay in owner role; just swap the view. Clear any guest-portal
            // overlay so the admin screen has the full header / tab area.
            setUserRole('owner');
            setActiveGuestPortal(null);
            setCurrentView(target);
            return;
          }
          const role = target;
          if (role === 'owner') {
            setUserRole('owner');
            // 2026-07-15 — always route to events-dashboard when switching
            // to owner role. Previously the handler only updated
            // currentView when there was an activeGuestPortal, leaving
            // currentView stale (e.g. 'vendor-dashboard' after the user
            // clicked 商戶 then 主理新人). The stale view would fail
            // every render guard and the page would go blank.
            setCurrentView('events-dashboard');
            setActiveGuestPortal(null);
          } else if (role === 'reception') {
            setUserRole('reception');
            setActiveGuestPortal(null);
            setCurrentView('reception-scanner');
          } else if (role === 'helper') {
            // 2026-07-19 — active helpers land on their dashboard. Distinct
            // from 'reception' which is a one-perm QR-only role.
            setUserRole('helper');
            setActiveGuestPortal(null);
            setCurrentView('helper-dashboard');
          } else if (role === 'vendor') {
            setUserRole('vendor');
            setActiveGuestPortal(null);
            setCurrentView('vendor-dashboard');
          }
        }}
      />

      {(guest.isGuestMode || userRole === 'guest_portal') ? (
        <PersonalGuestPortal
          guest={activeGuestPortal}
          eventName={currentEvent?.name}
          isUploading={isUploading}
          uploadProgress={uploadProgress}
          isStorageFull={isStorageFull}
          // 2026-08-05 — Pass the guest's own uploaded photos
          // so they can see what they've shared. Filtered by
          // uploaderId == activeGuestPortal.guestId from
          // eventPhotos (already filtered by eventId). Empty
          // array until the photos subscription fires.
          myPhotos={activeGuestPortal
            ? eventPhotos.filter((p) => p.uploaderId === activeGuestPortal.guestId)
            : []}
          // 2026-08-05 — Pass the same handleDeletePhoto the
          // owner-side PhotoDrop screen uses. The CF
          // mintPhotoDeleteToken gates on the three tiers
          // (owner / co-owner / uploader); a guest deleting
          // their own upload takes the uploader tier because
          // photo.uploadAuthUid === auth.currentUser.uid
          // (written at upload time, see App.jsx:2606).
          onDeletePhoto={handleDeletePhoto}
          onUpload={handleRealUpload}
          onRequestRedPacket={() => setShowPaymentModal(true)}
          // 2026-07-18 — Owner preview-as-guest path now has an exit
          // handler. In real guest mode (URL ?o=&e=&g=&token=) we still
          // let the guest sign out via existing flow; in owner preview
          // mode the user must be able to return to the guest list.
          onExitPreview={
            userRole === 'guest_portal' && !guest.isGuestMode
              ? () => {
                  setActiveGuestPortal(null);
                  setUserRole('owner');
                  setCurrentView('couple-guests');
                }
              : undefined
          }
        />
      ) : (
        <>
          {currentEvent && (
            <header className="bg-white shadow-sm sticky top-0 z-40 border-b border-slate-200">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between items-center py-4 gap-2">
                  {/* 2026-07-23 — Mobile-friendly header.
                      The logo previously wrapped to 3 lines because the
                      "Save The Day" text was inline with the heart icon
                      and the 主控台 badge, and there was no min-w-0 on the
                      container so siblings squeezed it. On mobile we now
                      show just the heart icon (the brand is recognizable
                      by shape alone). The 主控台 badge is hidden on mobile
                      because it's redundant when there's only one view
                      anyway — tapping the heart goes to the role's
                      landing. */}
                  <ProjectHeader
                    event={currentEvent}
                    onRename={() => setHeaderRenameOpen(true)}
                    onBrandClick={() => {
                      if (!currentEvent) {
                        setCurrentView('events-dashboard');
                        return;
                      }
                      if (userRole === 'vendor') setCurrentView('vendor-dashboard');
                      else if (userRole === 'reception') setCurrentView('reception-scanner');
                      else setCurrentView('couple-checklist');
                    }}
                  />
                  <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                    {userRole === 'owner' && (
                      <button
                        onClick={() => setShowHelperManager(true)}
                        className="flex items-center gap-1 text-sm font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2 sm:px-3 py-1.5 rounded-lg border border-indigo-200 transition-colors flex-shrink-0"
                        title="管理兄弟姊妹 (邀請、權限、撤銷)"
                        aria-label="管理兄弟姊妹"
                      >
                        <Users className="w-4 h-4" />
                        <span className="hidden sm:inline">兄弟姊妹</span>
                      </button>
                    )}
                    {/* 2026-07-26 — Co-owners (couples/partners). Sits
                        next to the 兄弟姊妹 button. Only the
                        original owner can invite a partner (the
                        partner can NEVER re-invite themselves in
                        their own email). Hidden on mobile to keep
                        the header compact; the desktop label is
                        "邀請另一半". */}
                    {userRole === 'owner' && (
                      <button
                        onClick={() => setShowInvitePartner(true)}
                        className="flex items-center gap-1 text-sm font-bold text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 px-2 sm:px-3 py-1.5 rounded-lg border border-rose-200 transition-colors flex-shrink-0"
                        title="邀請另一半共同管理婚禮"
                        aria-label="邀請另一半"
                      >
                        <Heart className="w-4 h-4" />
                        <span className="hidden sm:inline">邀請另一半</span>
                      </button>
                    )}
                    {/* 2026-07-19 — helper pill: visible whenever the
                        current user is an active helper somewhere.
                        Jumps them to the helper dashboard. Distinct
                        from the owner-only "兄弟姊妹 管理" pill to its
                        left. Hidden for non-helpers. */}
                    {helperActiveAssignment && userRole !== 'owner' && userRole !== 'vendor' && (
                      <button
                        onClick={() => {
                          setUserRole('helper');
                          setCurrentView('helper-dashboard');
                        }}
                        className={`flex items-center gap-1 text-sm font-bold px-2 sm:px-3 py-1.5 rounded-lg border transition-colors flex-shrink-0 ${
                          userRole === 'helper'
                            ? 'text-amber-700 bg-amber-100 border-amber-300'
                            : 'text-amber-700 bg-amber-50 hover:bg-amber-100 border-amber-200'
                        }`}
                        title="切換到助手控制台"
                        aria-label="助手控制台"
                      >
                        🤝<span className="hidden sm:inline ml-1">助手控制台</span>
                      </button>
                    )}
                    {/* 2026-07-22 — Back-to-總大堂 button. Lives in
                        the header (between 兄弟姊妹/助手控制台 and
                        登出) so it's always reachable, not just
                        inside the checklist view. Same handler as
                        the in-page back button — clears currentEvent,
                        flips to events-dashboard, resets active-
                        category/venue so the dashboard renders cleanly.
                        Only shown when we're actually inside a project;
                        otherwise the events dashboard is the current
                        view and the button would be redundant. */}
                    {currentEvent && currentView !== 'events-dashboard' && (
                      <button
                        onClick={() => {
                          setCurrentEvent(null);
                          setCurrentView('events-dashboard');
                          setActiveCategory(null);
                          setActiveVenue('');
                        }}
                        className="flex items-center gap-1 text-sm font-bold text-rose-700 hover:text-rose-900 bg-rose-50 hover:bg-rose-100 px-2 sm:px-3 py-1.5 rounded-lg border border-rose-200 transition-colors flex-shrink-0"
                        title="返回 Save The Day · 總大堂"
                        aria-label="返回 Save The Day · 總大堂"
                      >
                        <ChevronLeft className="w-4 h-4" />
                        <span className="hidden sm:inline">返回總大堂</span>
                      </button>
                    )}
                    {/* 2026-08-08 — header buttons moved next to the user
                        profile icon. Order is: 🔔 商戶報價 bell (owners
                        only) → 💬 訊息收件匣 (owners + vendors) → UserMenu.
                        Both bells sit tight against the avatar so the
                        couple sees "you have new stuff" at a glance. */}
                    {userRole === 'owner' && (
                      <BellNotifications
                        ownerUid={dataOwnerUid}
                        coupleUid={user?.uid}
                        selfUid={user?.uid}
                        eventId={currentEvent?.id}
                        onOpenProposal={(jobId) => setViewingProposals(jobId)}
                        onOpenComment={(meta) => {
                          // 2026-08-09 — bell notification click: scroll
                          // to the comment's task. Sets the focused task
                          // so the checklist view + TaskComments component
                          // both open at the right row.
                          if (meta?.eventId && currentEvent?.id !== meta.eventId) {
                            setCurrentEvent({ id: meta.eventId });
                          }
                          setFocusedTaskId(meta?.taskId || null);
                          setCurrentView('couple-checklist');
                        }}
                        onOpenStatus={(meta) => {
                          if (meta?.eventId && currentEvent?.id !== meta.eventId) {
                            setCurrentEvent({ id: meta.eventId });
                          }
                          setFocusedTaskId(meta?.taskId || null);
                          setCurrentView('couple-checklist');
                        }}
                        onOpenInvite={() => setCurrentView('helpers')}
                        onOpenDashboard={() => setCurrentView('notifications-center')}
                      />
                    )}
                    {(userRole === 'owner' || userRole === 'vendor') && (
                      <button
                        onClick={() => {
                          setSelectedInquiry(null);
                          setCurrentView('inbox');
                        }}
                        className="relative text-slate-600 hover:text-slate-800 p-2 rounded-lg hover:bg-slate-100 transition-colors flex-shrink-0"
                        title="訊息收件匣"
                        aria-label="訊息收件匣"
                      >
                        <MessageCircle className="w-5 h-5" />
                        {totalUnread > 0 && (
                          <span className="absolute -top-0.5 -right-0.5 bg-rose-500 text-white text-[10px] font-black rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-tight ring-2 ring-white">
                            {totalUnread > 9 ? '9+' : totalUnread}
                          </span>
                        )}
                      </button>
                    )}
                    {/* 2026-07-30 — UserMenu. Avatar + dropdown header
                        widget. Replaces the two standalone buttons
                        (Phase A: 我的資料 + 登出) with a single avatar
                        that opens a compact dropdown. The dropdown
                        contains: email + tier strip, 我的資料, 登出.
                        Click-outside and Escape close it. */}
                    <UserMenu
                      user={user}
                      onOpenProfile={() => setCurrentView('profile')}
                      onUpgrade={() => setPurchaseModalOpen(true)}
                    />
                  </div>
                </div>
                <TabNav
                  userRole={userRole}
                  currentView={currentView}
                  isPremium={isPremium}
                  onNavigate={setCurrentView}
                />
              </div>
            </header>
          )}

          <main className="max-w-7xl mx-auto px-4">
            {/* Notifications center — full list (no 20-item cap). Owner-only.
                Reached from the bell dropdown's 查看全部 button. */}
            {userRole === 'owner' && currentView === 'notifications-center' && (
              <NotificationsCenter
                ownerUid={dataOwnerUid}
                coupleUid={user?.uid}
                selfUid={user?.uid}
                eventId={currentEvent?.id}
                onBack={() => setCurrentView(
                  currentEvent ? 'couple-checklist' : 'events-dashboard',
                )}
                onOpenProposal={(jobId) => {
                  setCurrentView('couple-jobboard');
                  setViewingProposals(jobId);
                }}
                onOpenComment={(meta) => {
                  if (meta?.eventId && currentEvent?.id !== meta.eventId) {
                    setCurrentEvent({ id: meta.eventId });
                  }
                  setFocusedTaskId(meta?.taskId || null);
                  setCurrentView('couple-checklist');
                }}
                onOpenInvite={() => setCurrentView('helpers')}
              />
            )}

            {!currentEvent && currentView === 'events-dashboard' && (
              <EventsDashboard
                events={events}
                newEventName={newEventName}
                onNewEventNameChange={setNewEventName}
                onCreate={handleCreateEvent}
                onSelectEvent={(ev) => {
                  setCurrentEvent(ev);
                  // Route to the role-appropriate landing view for this event.
                  if (userRole === 'vendor') {
                    setCurrentView('vendor-dashboard');
                  } else if (userRole === 'reception') {
                    setCurrentView('reception-scanner');
                  } else {
                    setCurrentView('couple-checklist');
                  }
                }}
                // 2026-07-30 — App.jsx owns the shared purchase modal.
                onPurchaseModalOpen={() => setPurchaseModalOpen(true)}
                // 2026-07-20 — wire trending strip on events
                // dashboard. Couples see what's hot in the
                // catalog even before they pick/create an event.
                vendors={vendors}
                onSelectVendor={setViewingVendorProfile}
                onGoDiscover={() => setCurrentView('discover-vendors')}
                // 2026-07-21 — pass through for the
                // <TrendingVendors> claim CTA.
                user={user}
                currentEvent={currentEvent}
                // 2026-07-31 — Lobby card actions (rename + delete).
                // onClearCurrentEvent kicks the user back to the
                // lobby if they delete the event they're currently
                // inside. onToast shows a confirmation after the
                // action completes.
                onClearCurrentEvent={() => {
                  setCurrentEvent(null);
                  setCurrentView('events-dashboard');
                }}
                // 2026-08-01 (pivot) — owner-names editor lives in
                // EventSettingsModal. Open it scoped to the clicked
                // card's event. The modal also closes any toast
                // path so the user sees the success message in the
                // same surface where they triggered the action.
                onOpenEventSettings={(ev) => setEventSettingsTarget(ev)}
                onToast={showToast}
                onOpenChat={(vendor) =>
                  handleOpenChat({
                    otherUid: vendor.id || vendor.uid,
                    otherName: vendor.name,
                  })
                }
              />
            )}

            {/* "我是商戶" CTA — shown to signed-in non-vendor users on the
                events dashboard. The CTA is hidden for users who already
                have a vendor: true custom claim (they're past onboarding).
                Admins see it too — admins need a way to preview/test the
                wizard without going through Firebase Console, and it's
                useful for them to see the flow as a real vendor would. */}
            {user && userRole !== 'vendor' && !currentEvent && currentView === 'events-dashboard' && (
              <div className="mt-6">
                <JoinAsVendorCTA
                  user={user}
                  onJoin={() => setCurrentView('vendor-onboarding')}
                />
              </div>
            )}

            {/* 2026-07-30 — MyProfile screen. Available to any signed-in
                user (couple, owner, vendor, helper). Routes back to
                events-dashboard. The upgrade CTA inside opens
                PurchaseModal via the existing purchaseModalOpen state. */}
            {user && currentView === 'profile' && (
              <MyProfile
                currentUser={user}
                onBack={() => setCurrentView('events-dashboard')}
                onUpgrade={() => setPurchaseModalOpen(true)}
                // 2026-07-30 — change-password opener. MyProfile decides
                // 'change' vs 'set' based on user.providerData.
                onChangePassword={(mode) => {
                  setChangePasswordMode(mode);
                  setChangePasswordModalOpen(true);
                }}
                // 2026-07-31 — showToast for the "已發送驗證信" /
                // "嘗試次數太多" / "發送失敗" messages. Same prop
                // pattern as CoupleChecklist.
                showToast={showToast}
                deletedEvents={deletedEvents}
                onRestoreEvent={handleRestoreEvent}
              />
            )}

            {userRole === 'owner' && currentEvent && currentView === 'couple-checklist' && (
              <CoupleChecklist
                tasks={eventTasks}
                vendors={vendors}
                activeCategory={activeCategory}
                activeVenue={activeVenue}
                editingTaskId={editingTaskId}
                // 2026-08-01 — owner (couple) names so the regular
                // to-do list task editor can offer 新人自己 as an
                // assignment alongside the 兄弟姊妹. Same ownerNames
                // the 大日流程 HelperPicker already uses.
                ownerNames={ownerNames}
                onClearEditingTask={(id) => {
                  // 2026-07-24 — pass id so the per-row edit button
                  // can open the editor for that specific task.
                  // Passing null/undefined closes the editor.
                  setEditingTaskId(id || null);
                }}
                currentUser={user}
                onSelectCategory={(cat, venue) => {
                  setActiveCategory(cat);
                  setActiveVenue(venue);
                }}
                onToggleTask={toggleTask}
                onDeleteTask={handleDeleteTask}
                onUpdateTaskCost={handleUpdateTaskCost}
                onUpdateTask={handleUpdateTask}
                newTaskForm={newTaskForm}
                onNewTaskFormChange={setNewTaskForm}
                onAddTask={handleAddTask}
                onClearActiveCategory={() => setActiveCategory(null)}
                onGoDiscover={() => setCurrentView('discover-vendors')}
                onGoJobBoard={() => {
                  setCurrentView('couple-jobboard');
                  setActiveCategory(null);
                }}
                onOpenChat={(vendor) =>
                  handleOpenChat({
                    otherUid: vendor.id || vendor.uid,
                    otherName: vendor.name,
                  })
                }
                // 2026-07-21 — pass user + currentEvent through to
                // CoupleChecklist so <TrendingVendors> can run its
                // claim CTA (openInquiry + auto-message) for
                // uninvited vendors.
                user={user}
                currentEvent={currentEvent}
                // 2026-07-22 — back button now lives in the global
                // header (between 兄弟姊妹 and 登出), reachable
                // from every couple screen. No longer passed here.
                // 2026-07-20 — TrendingVendors click handler. Opens
                // the vendor profile modal via the existing
                // viewingVendorProfile state — couples can then
                // send an inquiry (if onboarded) or browse the
                // portfolio.
                onSelectVendor={setViewingVendorProfile}
                myVendorsPanel={
                  <MyVendorsPanel
                    contacts={vendorContacts}
                    loading={vendorContactsLoading}
                    onAddContact={handleAddVendorContact}
                    onUpdateContact={handleUpdateVendorContact}
                    onDeleteContact={handleDeleteVendorContact}
                    onLinkContact={handleLinkContact}
                    onChatContact={(contact) =>
                      handleOpenChat({
                        otherUid: contact.linkedVendorUid,
                        otherName: contact.vendorName,
                      })
                    }
                    // 2026-07-22 — wire catalog + handlers so the
                    // trending strip shows at the top of the catalog
                    // picker modal. Same data + handlers used by
                    // TrendingVendors elsewhere on this screen.
                    catalog={vendors}
                    onSelectVendor={setViewingVendorProfile}
                    onGoDiscover={() => setCurrentView('discover-vendors')}
                    user={user}
                    currentEvent={currentEvent}
                    onOpenChat={(vendor) =>
                      handleOpenChat({
                        otherUid: vendor.id || vendor.uid,
                        otherName: vendor.name,
                      })
                    }
                    // 2026-08-07 — Couple-side "invite not-yet-onboarded
                    // vendor" callback. Forwards through
                    // MyVendorsPanel → AddVendorPicker →
                    // PickExistingVendor → TrendingVendors so the
                    // 邀請查詢 CTA inside the catalog picker opens
                    // NotOnboardedEmailModal. App.jsx owns the
                    // modal state since the modal can also be
                    // opened from elsewhere on the screen.
                    onVendorNotOnboarded={setNotOnboardedVendor}
                  />
                }
                vendorContacts={vendorContacts}
                helpers={helpers}
                helpersLoading={helpersLoading}
              />
            )}

            {userRole === 'owner' && currentEvent && currentView === 'couple-budget' && (
              <CoupleBudget
                tasks={eventTasks}
                totalBudget={totalBudget}
                totalSpent={totalSpent}
                totalPaid={totalPaid}
                totalCommitted={totalCommitted}
                canEdit={userRole === 'owner'}
                onSaveBudget={handleSaveBudget}
                onToggleTask={toggleTask}
                onSelectTask={(taskId) => {
                  setCurrentView('couple-checklist');
                }}
              />
            )}

            {userRole === 'owner' && currentView === 'discover-vendors' && (
              <DiscoverDirectory
                vendors={vendors}
                filter={discoverFilter}
                onFilterChange={setDiscoverFilter}
                onViewProfile={setViewingVendorProfile}
                user={user}
                favoriteIds={favoriteIds}
                onToggleFavorite={handleToggleFavorite}
              />
            )}

            {/* Admin-only: vendor analytics for monthly membership sales */}
            {isAdmin && currentView === 'vendor-analytics' && (
              <VendorAnalytics user={user} isAdmin={isAdmin} />
            )}

            {/* Admin-only: master user list with admin/disable toggles */}
            {isAdmin && currentView === 'admin-users' && (
              <AdminUsers user={user} isAdmin={isAdmin} />
            )}

            {/* 2026-07-29 — Admin Queue (Phase 4). Triage pending
                submissions across the 3 unlock paths (social proof,
                referral, payment receipt) in one screen. */}
            {isAdmin && currentView === 'admin-queue' && (
              <AdminQueue
                user={user}
                isAdmin={isAdmin}
                onBack={() => setCurrentView('events-dashboard')}
              />
            )}

            {/* Admin-only: vendor CRUD (list / edit / delete) */}
            {isAdmin && currentView === 'admin-vendors' && (
              <AdminVendors
                user={user}
                isAdmin={isAdmin}
                onOpenImportVendors={() => setCurrentView('admin-import-vendors')}
              />
            )}

            {/* Admin-only: batch vendor CSV import (entry from admin-vendors) */}
            {isAdmin && currentView === 'admin-import-vendors' && (
              <AdminImportVendors
                user={user}
                isAdmin={isAdmin}
                onBack={() => setCurrentView('admin-vendors')}
              />
            )}

            {/* 2026-08-07 — Admin payment settings (PayMe QR + FPS
                banking). Mounted as a top-level admin screen so it
                gets the full header / tab area. Reached via the
                RoleSimulator "💳 收款設定" pill. */}
            {isAdmin && currentView === 'admin-payment-settings' && (
              <AdminPaymentSettings user={user} isAdmin={isAdmin} />
            )}

            {(userRole === 'owner' || userRole === 'reception') &&
              currentEvent &&
              currentView === 'couple-guests' && (
                <GuestList
                  guests={eventGuests}
                  userRole={userRole}
                  helperPerms={helperPerms}
                  searchQuery={''}
                  onSearchChange={() => {}}
                  newGuestForm={newGuestForm}
                  onNewGuestFormChange={setNewGuestForm}
                  onAddGuest={handleAddGuest}
                  familyForm={familyForm}
                  onFamilyFormChange={setFamilyForm}
                  onAddFamily={handleAddFamily}
                  onPreviewAsGuest={(g) => {
                    setActiveGuestPortal(g);
                    setUserRole('guest_portal');
                    setCurrentView('guest-portal');
                  }}
                  onShowQr={setViewingQrCode}
                  onCheckIn={handleSimulateReceptionScan}
                  onOpenInvitationEditor={() => setShowInvitationEditor(true)}
                  onEditGuest={setEditingGuest}
                />
              )}

            {userRole === 'owner' && currentEvent && currentView === 'photo-drop' && (
              <PhotoDrop
                photos={eventPhotos}
                storageUsedMB={storageUsedMB}
                isPremium={isPremium}
                currentUserUid={user?.uid}
                onPlaySlideshow={() => setIsFullscreen(true)}
                onUpgrade={() => setShowUpgradeModal(true)}
                onUpdatePhoto={handleUpdatePhoto}
                onDeletePhoto={handleDeletePhoto}
                onShowToast={showToast}
              />
            )}

            {userRole === 'owner' && currentEvent && currentView === 'wedding-day' && (
              <WeddingDay
                rundown={rundown}
                resources={resources}
                teaCeremony={teaCeremony}
                playlist={playlist}
                onUpsertRundown={handleUpsertRundown}
                onDeleteRundown={handleDeleteRundown}
                onReorderRundown={handleReorderRundown}
                // 2026-07-22b — drag-and-drop reorder for
                // 大日流程.
                onSetRundownPositions={handleSetRundownPositions}
                onUpsertResource={handleUpsertResource}
                onDeleteResource={handleDeleteResource}
                onToggleResource={handleToggleResource}
                onReorderResource={handleReorderResource}
                // 2026-07-22b — drag-and-drop reorder for 物資.
                onSetResourcePositions={handleSetResourcePositions}
                onUpsertTeaCeremony={handleUpsertTeaCeremony}
                onDeleteTeaCeremony={handleDeleteTeaCeremony}
                // 2026-07-22b — Bulk order setter for drag-and-drop
                // reorder in the 敬茶 tab. Writes all affected
                // orders in parallel.
                onSetTeaCeremonyOrders={handleSetTeaCeremonyOrders}
                onUpsertPlaylist={handleUpsertPlaylist}
                onDeletePlaylist={handleDeletePlaylist}
                onReorderPlaylist={handleReorderPlaylist}
                // 2026-07-22b — drag-and-drop reorder for 歌單.
                onSetPlaylistPositions={handleSetPlaylistPositions}
                currentUser={user}
                // 2026-07-18 — pass the active helpers list down so
                // 大日流程/物資 can offer a 兄弟姊妹 picker. Already
                // subscribed in App.jsx (line 610) for use by the
                // wedding-tasks panel — just plumb it through.
                helpers={helpers}
                // 2026-08-01 — Owner names (新郎 / 新娘) so the
                // 大日流程 HelperPicker can offer the couple as
                // assignees alongside the 兄弟姊妹. Live-updates
                // when the user edits the names in MyProfile.
                ownerNames={ownerNames}
                // 2026-07-24 — pass the toast hook so the new edit
                // save confirmations in 物資/歌單 can show "✅ 已更新".
                showToast={showToast}
                // 2026-08-09 — Vendor assignment + comments for
                // 大日流程 / 物資. The <ItemComments> panel needs a
                // real Firestore collection reference (not a path
                // string) because it subscribes via onSnapshot.
                // We derive it here from dataOwnerUid + currentEvent
                // so the comments live under the owner's tree.
                ownerUid={dataOwnerUid}
                eventId={currentEvent?.id}
                // Vendors for VendorPicker: derives from inquiries
                // (the couple has chatted with them). Memoized so
                // WeddingDay's memoization doesn't churn.
                vendors={vendorsForPicker}
                // (entryId) => CollectionReference | null
                rundownCommentPathFor={rundownCommentPathFor}
                resourceCommentPathFor={resourceCommentPathFor}
              />
            )}

            {/* 2026-07-24 — 電子人情 (e-Red-Packet) manager. Lets
                the owner upload PayMe / FPS / AlipayHK QR codes
                that the PersonalGuestPortal's PaymentModal reads
                to display the actual scan targets. */}
            {userRole === 'owner' && currentEvent && currentView === 'red-packet' && (
              <RedPacketManager
                // 2026-07-27 — Use dataOwnerUid (resolved via the
                // events list's _ownerUid, which comes from the
                // collectionGroup query path) instead of
                // currentEvent.userId || user?.uid. The latter two
                // are wrong for coOwner sessions:
                //   - currentEvent.userId is not set on event docs
                //     (the field is in the path, not the doc)
                //   - user?.uid is the coOwner's OWN uid, not the
                //     original event owner's uid. Subscribing to
                //     /users/{coOwnerUid}/events/{eid}/redPackets
                //     returns 0 docs when the actual data is under
                //     /users/{originalOwnerUid}/events/{eid}/redPackets.
                // Verified live 2026-07-27 23:54 — both partners
                // uploaded to their OWN path instead of the shared
                // event path, so neither could see the other's QRs.
                ownerUid={dataOwnerUid}
                eventId={currentEvent.id}
                showToast={showToast}
              />
            )}

            {userRole === 'owner' && currentEvent && currentView === 'couple-jobboard' && (
              <CoupleJobBoard
                // 2026-07-23 — Read from live Firestore query, not
                // local React state. Previously the job was only
                // added to `jobRequests` (in-memory); vendors query
                // `liveJobRequests` and never saw it. Now we write
                // directly to Firestore, and the owner reads from
                // the same live query so both views stay in sync.
                // Filter to the current couple's own posts so a
                // shared-rules visitor doesn't see someone else's.
                jobRequests={(liveJobRequests || []).filter(
                  (j) => !user?.uid || j.coupleUid === user.uid,
                )}
                newJobForm={newJobForm}
                onNewJobFormChange={setNewJobForm}
                onSubmitJob={handleJobSubmit}
                onShowProposals={setViewingProposals}
              />
            )}

            {userRole === 'reception' && currentEvent && currentView === 'reception-scanner' && (
              <ReceptionScanner
                eventGuests={eventGuests}
                recentScans={recentScans || []}
                onCheckIn={handleSimulateReceptionScan}
                onManualCheckIn={handleSimulateReceptionScan}
              />
            )}

            {/* 2026-07-19 — Helper dashboard. Active helpers
                (兄弟姊妹/助手) get a perm-driven tabbed UI: tasks with
                the new Activity Timeline + status picker, plus
                optional 賓客 / 預算 / 相片 / 接待 tabs based on
                what perms the couple granted. The header above the
                tab strip shows which owner they're working for and
                which perms they have. */}
            {userRole === 'helper' && currentView === 'helper-dashboard' && helperActiveAssignment && (
              <HelperDashboard
                helperAssignment={helperActiveAssignment}
                currentUser={user}
                eventGuests={eventGuests}
                recentScans={recentScans || []}
                onCheckIn={handleSimulateReceptionScan}
                onManualCheckIn={handleSimulateReceptionScan}
              />
            )}

            {/* 2026-07-15 — chat views. Inbox is shared between
                couple + vendor; ChatRoom is shared too. Access
                gated on userRole so admins don't accidentally
                land here (they should use the inbox icon in the
                header instead). */}
            {currentView === 'inbox' && (userRole === 'couple' || userRole === 'owner' || userRole === 'vendor') && (
              <Inbox
                inquiries={inquiries}
                loading={!user}
                userUid={user?.uid}
                userRole={userRole === 'vendor' ? 'vendor' : 'couple'}
                onSelectInquiry={handleSelectInquiry}
                // 2026-08-08 — Vendors land here from the dashboard
                // and previously had no way back. Wire only the
                // vendor case so we don't show a back button on the
                // couple's main inbox (couples already have the home
                // tab in the bottom nav). For `owner` users (who
                // also reach this via the chat bubble), default to
                // the events dashboard.
                onBack={
                  userRole === 'vendor'
                    ? () => setCurrentView('vendor-dashboard')
                    : userRole === 'owner'
                    ? () => setCurrentView('events-dashboard')
                    : undefined
                }
              />
            )}

            {currentView === 'chat-room' && selectedInquiry && (userRole === 'couple' || userRole === 'owner' || userRole === 'vendor') && (
              <ChatRoom
                inquiry={selectedInquiry}
                userUid={user?.uid}
                userRole={userRole === 'vendor' ? 'vendor' : 'couple'}
                onBack={() => {
                  setSelectedInquiry(null);
                  setCurrentView('inbox');
                }}
              />
            )}

            {userRole === 'vendor' && currentView === 'vendor-dashboard' && (
              <VendorDashboard
                user={user}
                vendor={vendorProfile}
                jobRequests={liveJobRequests || []}
                loading={vendorProfileLoading || jobRequestsLoading}
                onSubmitProposal={submitProposal}
                onManageProfile={() => setCurrentView('vendor-profile')}
                onLogout={handleVendorLogout}
                assignedTasks={assignedTasks}
                assignedRundown={assignedRundown}
                assignedResources={assignedResources}
                isAdminPreview={isAdmin && !isVendor}
                onUpdateTaskStatus={handleUpdateAssignedTaskStatus}
                // 2026-07-20 — inquiry inbox routing. The
                // VendorInquiriesPanel hands back a selected inquiry
                // and we wire it to the same ChatRoom the couple
                // uses (shared component).
                onOpenInquiry={(inq) => {
                  setSelectedInquiry(inq);
                  setCurrentView('chat-room');
                }}
              />
            )}

            {userRole === 'vendor' && currentView === 'vendor-profile' && (
              // 2026-07-15 — pass the LIVE vendorProfile doc (read via
              // useFirestoreDoc on /vendors/{user.uid}) instead of the
              // static DEFAULT_VENDORS constant. The profile form
              // needs the user's actual UID to write back, and the
              // current vendor's data to pre-fill the fields.
              <VendorProfileEdit
                vendor={vendorProfile}
                user={user}
                onBack={() => setCurrentView('vendor-dashboard')}
              />
            )}

            {/* Vendor onboarding wizard — reachable from any signed-in user.
                Re-uses the same RoleSimulator/admin layout but does not
                require userRole === 'vendor' (you can't be a vendor before
                applying). */}
            {user && currentView === 'vendor-onboarding' && (
              <VendorOnboarding
                user={user}
                // 2026-07-15 — after the wizard submits, applyAsVendor sets the
                              // `vendor: true` custom claim server-side. We refresh the
                              // ID token so the local session picks it up, then route
                              // to the vendor dashboard. Without the explicit refresh
                              // here, the user sees the couple events-dashboard
                              // (stale token, no vendor claim) and is confused.
                              onComplete={async () => {
                                try {
                                  if (user?.getIdToken) {
                                    await user.getIdToken(true);
                                  }
                                } catch (e) {
                                  // eslint-disable-next-line no-console
                                  console.warn('[App] token refresh after vendor apply failed:', e?.message);
                                }
                                setUserRole('vendor');
                                setCurrentView('vendor-dashboard');
                              }}
                              onCancel={() => setCurrentView('events-dashboard')}
              />
            )}
          </main>
        </>
      )}

      <UpgradeModal
        isOpen={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        // 2026-08-07 — 立即付款 HK$99 解鎖 used to call
        // upgradeToPremium() which wrote tier:'premium' to
        // Firestore DIRECTLY without any payment. That's why
        // tapping it closed the modal and immediately toasted
        // "已成功升級至 Premium！無限容量已開啟。". Couples
        // got premium without paying anything.
        //
        // Fix: the same "升級 Premium" entry point now opens
        // <PurchaseModal>, which is the fully-built payment
        // surface (Stripe / PayMe / FPS + receipt screenshot →
        // submitPaymentReceipt CF → adminVerifyPayment →
        // grantUnlock). The receipt starts as 'pending' and is
        // granted only after admin reviews the PayMe/FPS
        // screenshot — matching the existing unlocks flow.
        //
        // Locked types aren't passed (undefined → defaults to
        // []), which makes PurchaseModal default to the 'premium'
        // option at $99 — exactly what UpgradeModal promised.
        onConfirm={() => {
          setShowUpgradeModal(false);
          setPurchaseModalOpen(true);
        }}
      />
      <PurchaseModal
        isOpen={purchaseModalOpen}
        onClose={() => setPurchaseModalOpen(false)}
        ownerUid={user?.uid || ''}
        onSuccess={() => {
          // Modal closes itself on success.
        }}
      />
      {changePasswordModalOpen && (
        <ChangePasswordModal
          mode={changePasswordMode}
          onClose={() => setChangePasswordModalOpen(false)}
          onSuccess={() => setChangePasswordModalOpen(false)}
        />
      )}
      {headerRenameOpen && currentEvent && (
        <EventRenameModal
          event={currentEvent}
          onClose={() => setHeaderRenameOpen(false)}
          onSaved={(newName) => {
            setCurrentEvent((event) => event ? { ...event, name: newName } : event);
            showToast(`✏️ 已改名為「${newName}」`);
          }}
        />
      )}
      {eventSettingsTarget && (() => {
        // 2026-08-01 (pivot + co-owner fix) — events live under
        // the original owner's user doc, not the co-owner's.
        // Both the Firestore subscription
        // (useEventOwnerNames → /users/{uid}/events/{eventId}) AND
        // the CF write target (/users/{uid}/events/{eventId})
        // are scoped to the event's ownerUid, which is the
        // `event._ownerUid` we already stamped on every event in
        // the events[] merge (App.jsx:794-813). The caller's
        // uid is irrelevant for path resolution — the CF's
        // assertEventAccess checks the caller's identity against
        // the event doc's userId / coOwners, so the right thing
        // happens either way.
        const ownerUid = eventSettingsTarget._ownerUid || user?.uid;
        // 2026-08-01 — when the modal was opened from the new
        // ⚙️ 婚禮設定 tab (currentView === 'event-settings'), close
        // routes the user back to the wedding's default view
        // (couple-checklist). When opened from the lobby ⋯ menu,
        // currentView is 'events-dashboard' and we leave it alone.
        const openedFromTab = currentView === 'event-settings';
        return (
          <EventSettingsModal
            open={true}
            currentUser={{ ...user, uid: ownerUid }}
            currentEvent={eventSettingsTarget}
            onToast={showToast}
            onClose={() => {
              setEventSettingsTarget(null);
              if (openedFromTab) {
                setCurrentView('couple-checklist');
              }
            }}
          />
        );
      })()}
      <PaymentModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        onSend={handleGiveRedPacket}
        // 2026-07-24 — pass the owner's uid so the modal can
        // subscribe to /artifacts/{appId}/users/{ownerUid}/
        // events/{eventId}/redPackets and display the actual QR
        // codes the couple uploaded in RedPacketManager.
        //
        // 2026-07-27 — added eventId prop (event-scoped refactor).
        // Both the owner AND any coOwner of the same event get the
        // same QR list. Path is event-scoped, not owner-scoped.
        //
        // 2026-07-24b — bug fix. Previously used
        // `currentEvent?.userId` but in guest mode `currentEvent`
        // is NOT set (guests come in via URL ?o=&e=&g=&token= with
        // no EventStore selection). The owner uid is instead on
        // the guest object as `qOwner`. Mirror the same pattern
        // the rest of the app uses (targetUid on line 573, plus
        // the many uses on lines 1794, 1809, 1817, 1826, 1938).
        //
        // 2026-07-25b — three-way fallback. The user's log
        // showed `ownerUid: undefined` even with the previous
        // fix. Turns out there are THREE valid contexts:
        //   1. Real guest (URL ?o=&e=&g=): guest.isGuestMode=true
        //      → use guest.qOwner
        //   2. Owner preview-as-guest (clicked "preview as guest"
        //      from couple-guests): guest.isGuestMode=false,
        //      currentEvent may or may not be set
        //      → fall back to user?.uid (the owner IS logged in)
        //   3. Owner dashboard (somehow viewing modal): same as 2
        // Without the user?.uid fallback, context 2 returns
        // undefined whenever currentEvent is null (e.g. right
        // after navigation, before the event store hydrates).
        ownerUid={guest.isGuestMode
          ? guest.qOwner
          : (dataOwnerUid || user?.uid)}
        // eventId: currentEvent.id in owner mode, guest.qEvent in
        // guest mode (no currentEvent is set). qEvent is the eventId
        // pulled from the guest's URL params.
        eventId={guest.isGuestMode
          ? guest.qEvent
          : currentEvent?.id}
      />
      <QrCodeModal
        guest={viewingQrCode}
        eventId={currentEvent?.id}
        eventName={currentEvent?.name}
        onClose={() => setViewingQrCode(null)}
        onCopy={() => showToast('✅ 網址已複製！')}
      />
      <VendorModal
        vendor={viewingVendorProfile}
        onClose={() => setViewingVendorProfile(null)}
        // 2026-08-02 — couples invite flow. BrowseOnlyNotice calls
        // onOpenInvite(vendor) when the couple taps the "✉️ 邀請商戶上線"
        // button. We close VendorModal first to avoid modal-on-modal
        // stacking, then open VendorInviteLinkModal with the same vendor.
        onOpenInvite={(vendor) => {
          setViewingVendorProfile(null);
          setCoupleInvitingVendor(vendor);
        }}
        currentUser={user}
        currentUserRole={userRole}
      />
      {coupleInvitingVendor && (
        <VendorInviteLinkModal
          vendor={{
            vendorUid:
              coupleInvitingVendor.id ||
              coupleInvitingVendor.vendorUid ||
              coupleInvitingVendor.slug,
            name: coupleInvitingVendor.name,
            signupStatus: coupleInvitingVendor.signupStatus,
          }}
          onClose={() => setCoupleInvitingVendor(null)}
          title={`邀請 ${coupleInvitingVendor.name || coupleInvitingVendor.id} 上線`}
        />
      )}
      {/* 2026-08-07 — "invite not-yet-onboarded vendor" modal. Opened
          by TrendingVendors strips inside MyVendorsPanel →
          AddVendorPicker → PickExistingVendor when the couple taps
          邀請查詢 on an unclaimed card. NotOnboardedEmailModal
          writes /vendors/{slug}/pendingInvites via Firestore rules
          (no admin gate) and gives the couple a copyable signup
          link + WhatsApp share button so they can ping the vendor
          themselves right away. The EventsDashboard owns its own
          copy of this state (same modal pattern, different surface). */}
      {notOnboardedVendor && (
        <NotOnboardedEmailModal
          vendor={notOnboardedVendor}
          onClose={() => setNotOnboardedVendor(null)}
        />
      )}
      {/* 2026-07-24 — only mount FullscreenSlideshow when isFullscreen
          is true. The original code rendered it unconditionally and
          relied on the component returning null when photos.length
          was 0, but as soon as ANY photo existed the fullscreen
          black overlay covered the entire page. The X button's
          onClose set isFullscreen=false, but it was already false,
          so the modal stayed open forever. User reported the
          "photo popup" and "cannot click X" — this was the cause. */}
      {isFullscreen && (
        <FullscreenSlideshow
          photos={eventPhotos}
          currentIndex={currentSlideIndex}
          onClose={() => setIsFullscreen(false)}
        />
      )}
      <ProposalsModal
        jobId={viewingProposals}
        coupleUid={user?.uid}
        onClose={() => setViewingProposals(null)}
        onOpenChat={async (payload) => {
          // 2026-08-08 — couple nudges from a proposal card
          // straight into the chat thread with the vendor.
          // Close the modal first so the chat room mounts
          // cleanly on top.
          setViewingProposals(null);
          await handleOpenChat(payload);
        }}
      />
      <SubmitProposalModal
        job={proposalJob}
        vendorName={vendorProfile?.name}
        onClose={() => setProposalJob(null)}
        onSubmitted={() => setProposalJob(null)}
        showToast={showToast}
      />
      <ScanResultModal guest={scanResult} onClose={() => setScanResult(null)} />
      <InviteModal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        onInvite={handleInvite}
      />
      {showHelperManager && user?.uid && (
        <HelperManager
          ownerUid={user.uid}
          onClose={() => setShowHelperManager(false)}
        />
      )}

      {showInvitationEditor && user?.uid && currentEvent && (
        <InvitationEditor
          isOpen={showInvitationEditor}
          ownerUid={user.uid}
          eventId={currentEvent.id}
          event={currentEvent}
          guests={eventGuests}
          ownerTier={currentEvent.tier || 'free'}
          isAdmin={isAdmin}
          onClose={() => setShowInvitationEditor(false)}
        />
      )}

      <EditGuestModal
        isOpen={Boolean(editingGuest)}
        guest={editingGuest}
        onClose={() => setEditingGuest(null)}
        onSave={handleSaveGuest}
        onDelete={handleDeleteGuest}
      />

      {/* 2026-07-03 — guest signup modal. Triggered by:
            - GuestBanner CTA ("註冊以保存 →")
            - handleCreateEvent when isAnonymous (stashes the form input
              in pendingCreateEventName so it can replay after link)
          After a successful link, isAnonymous flips false and this
          modal self-closes (the show prop becomes false). */}
      <SignUpPromptModal
        isOpen={showSignUpPrompt}
        onClose={() => {
          setShowSignUpPrompt(false);
          setPendingCreateEventName(null); // user opted out — forget the queued create
        }}
        onLink={handleLinkGuestAccount}
        onSignIn={async (email, password) => {
          // If the email is already taken, the user picks "sign in
          // instead". This abandons the anonymous work and switches to
          // the existing account. The anonymous UID is signed out.
          setShowSignUpPrompt(false);
          setPendingCreateEventName(null);
          await loginWithEmail(email, password);
        }}
      />

      {/* 2026-07-26 — Co-owners (couples / partners) modal. Owner
          opens this from a button in the wedding dashboard. The
          modal calls sendPartnerInvite and the partner receives a
          magic-link email; on accept they're added to the event's
          coOwners array and gain full CRUD access via the Firestore
          rules. */}
      <InvitePartnerModal
        isOpen={showInvitePartner}
        onClose={() => setShowInvitePartner(false)}
        ownerUid={user?.uid}
        eventId={currentEvent?.id}
        eventName={currentEvent?.name}
        showToast={showToast}
      />

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
      `,
        }}
      />
    </div>
  );
}


// 2026-07-21 v0.4.0 cache bust — forces a fresh bundle hash on
// redeploy so mobile clients pick up the new /vendors subscription.
const VERSION_TAG = 'v0.4.0-20260721';
