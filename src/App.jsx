import { useEffect, useMemo, useState } from 'react';
import { Heart, LogOut, Users, MessageCircle, ChevronLeft } from 'lucide-react';
import {
     addDoc,
     collection,
     collectionGroup,
     deleteDoc,
     doc,
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
  MOCK_PROPOSALS,
  TASK_CATEGORIES,
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
import { useHelperAuth } from './hooks/useHelperAuth';
import { useFirestoreCollection } from './hooks/useFirestoreCollection';
import { useFirestoreDoc } from './hooks/useFirestoreDoc';
import { useToast } from './hooks/useToast';
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
import { AdminVendors } from './screens/AdminVendors';
import { AdminImportVendors } from './screens/AdminImportVendors';
import { VendorOnboarding } from './screens/VendorOnboarding';
import { VendorDashboard } from './screens/VendorDashboard';
import { VendorProfileEdit } from './screens/VendorProfileEdit';
import { ReceptionScanner } from './screens/ReceptionScanner';
import { HelperDashboard } from './screens/HelperDashboard';
import { WeddingDay } from './screens/WeddingDay';
import { ChatRoom } from './screens/ChatRoom';
import { Inbox } from './screens/Inbox';
import { PersonalGuestPortal } from './screens/PersonalGuestPortal';
import { InvitationEditor } from './screens/InvitationEditor';

import { RoleSimulator } from './components/RoleSimulator';
import { GuestBanner } from './components/GuestBanner';
import { TabNav } from './components/TabNav';
import { JoinAsVendorCTA } from './components/JoinAsVendorCTA';
import { UpgradeModal } from './components/modals/UpgradeModal';
import { PaymentModal } from './components/modals/PaymentModal';
import { QrCodeModal } from './components/modals/QrCodeModal';
import { EditGuestModal } from './components/modals/EditGuestModal';
import { VendorModal } from './components/modals/VendorModal';
import { MyVendorsPanel } from './components/MyVendorsPanel';
import { ProposalsModal } from './components/modals/ProposalsModal';
import { InviteModal } from './components/modals/InviteModal';
import { HelperManager } from './components/modals/HelperManager';
import { HelperWaitingScreen } from './screens/HelperWaitingScreen';
import { ScanResultModal } from './components/modals/ScanResultModal';
import { FullscreenSlideshow } from './components/modals/FullscreenSlideshow';
import { SignUpPromptModal } from './components/modals/SignUpPromptModal';

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
  } = useAuth();
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
    // eslint-disable-next-line no-console
    console.log('[App.jsx] modal-close effect', {
      isAnonymous,
      hasUser: Boolean(user),
      userIsAnon: user?.isAnonymous,
      showSignUpPrompt,
    });
    if (!isAnonymous && user && showSignUpPrompt) {
      // eslint-disable-next-line no-console
      console.log('[App.jsx] closing modal — user is no longer anonymous');
      setShowSignUpPrompt(false);
      setPendingCreateEventName(null);
    }
  }, [isAnonymous, user, showSignUpPrompt]);

  // Helper context (兄弟姊妹). Only meaningful when the user is signed in
  // (not anonymous) and NOT in guest-mode URL. The hook itself is safe to
  // call unconditionally — it no-ops if no user.
  const helperCtx = useHelperAuth();
  const [helperAccepting, setHelperAccepting] = useState(false);

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
  const [proposalsData, setProposalsData] = useState(MOCK_PROPOSALS);

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
  const [showInvitationEditor, setShowInvitationEditor] = useState(false);
  const [editingGuest, setEditingGuest] = useState(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showHelperManager, setShowHelperManager] = useState(false);
  const [viewingVendorProfile, setViewingVendorProfile] = useState(null);
  const [viewingQrCode, setViewingQrCode] = useState(null);
  const [viewingProposals, setViewingProposals] = useState(null);
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

  // ---- Firestore subscriptions (skip when in guest mode) ----
  const targetUid = guest.isGuestMode ? guest.qOwner : user?.uid;

  const { data: events } = useFirestoreCollection(
    guestDataReady && targetUid && !guest.isGuestMode
      ? collection(db, 'artifacts', appId, 'users', targetUid, 'events')
      : null,
    [targetUid, guest.isGuestMode, guestDataReady],
  );

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

   const { data: allGuests } = useFirestoreCollection(
       guestDataReady && targetUid
         ? query(
             collection(db, 'artifacts', appId, 'users', targetUid, 'guests'),
             // Firestore rules reference resource.data.eventId — the query must
             // include a where() filter matching that field or list queries are
             // denied. In guest mode we use guest.qEvent, in owner mode we use
             // the currently selected event ID.
             where('eventId', '==', guest.isGuestMode ? guest.qEvent : (currentEvent?.id || '__no_event__'))
           )
         : null,
       [targetUid, guestDataReady, guest.qEvent, currentEvent?.id],
     );

     // 2026-07-15 — scanLog subscription for the reception scanner's
     // "最近掃描" list. Bounded by eventId so we don't fetch scans from
     // other events the owner might own. Limited to the last 50 (Firestore
     // requires descending + limit for cost control).
     const { data: recentScans } = useFirestoreCollection(
       targetUid && !guest.isGuestMode && currentEvent
         ? query(
             collection(db, 'artifacts', appId, 'users', targetUid, 'scanLog'),
             where('eventId', '==', currentEvent.id),
             orderBy('scannedAt', 'desc'),
             limit(50),
           )
         : null,
       [targetUid, currentEvent?.id],
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
               // The collectionGroup doc path looks like
               // artifacts/{appId}/users/{ownerUid}/tasks/{taskId}
               ownerUid: d.ref.parent.parent?.id,
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
    });
  };

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
         try {
           const { getDocs } = await import('firebase/firestore');
           const tasksQ = query(
             collection(db, 'artifacts', appId, 'users', user.uid, 'tasks'),
             where('assignedContactId', '==', contact.id),
           );
           const snap = await getDocs(tasksQ);
           let count = 0;
           for (const t of snap.docs) {
             if (t.data().assignedVendorUid) continue;
             await updateDoc(
               doc(db, 'artifacts', appId, 'users', user.uid, 'tasks', t.id),
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


  const { data: allPhotos } = useFirestoreCollection(
    targetUid && (guest.isGuestMode || currentEvent)
      ? query(
          collection(db, 'artifacts', appId, 'users', targetUid, 'photos'),
          // Rules reference resource.data.eventId — must filter by it in queries.
          where('eventId', '==', guest.isGuestMode ? guest.qEvent : currentEvent.id)
        )
      : null,
    [targetUid, guest.isGuestMode, guest.qEvent, currentEvent?.id],
  );

  const { data: tasks } = useFirestoreCollection(
    targetUid && !guest.isGuestMode
      ? collection(db, 'artifacts', appId, 'users', targetUid, 'tasks')
      : null,
    [targetUid, guest.isGuestMode],
  );

  // ---- 2026-07-17: Big Day (大日統籌) suite (rundown / resources / teaCeremony / playlist).
  // All four collections live under /users/{ownerUid}/{name}. Read-only here;
  // writes go through the parent via callback props. Helper users do NOT see
  // these (rules allow owner-only).
  const { data: rundown } = useFirestoreCollection(
    targetUid && !guest.isGuestMode
      ? collection(db, 'artifacts', appId, 'users', targetUid, 'rundown')
      : null,
    [targetUid, guest.isGuestMode],
  );
  const { data: resources } = useFirestoreCollection(
    targetUid && !guest.isGuestMode
      ? collection(db, 'artifacts', appId, 'users', targetUid, 'resources')
      : null,
    [targetUid, guest.isGuestMode],
  );
  const { data: teaCeremony } = useFirestoreCollection(
    targetUid && !guest.isGuestMode
      ? collection(db, 'artifacts', appId, 'users', targetUid, 'teaCeremony')
      : null,
    [targetUid, guest.isGuestMode],
  );
  const { data: playlist } = useFirestoreCollection(
    targetUid && !guest.isGuestMode
      ? collection(db, 'artifacts', appId, 'users', targetUid, 'playlist')
      : null,
    [targetUid, guest.isGuestMode],
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
  useEffect(() => {
    if (!guest.isGuestMode) return;
    if (events?.length) {
      const ev = events.find((e) => e.id === guest.qEvent);
      if (ev) setCurrentEvent(ev);
    }
    if (allGuests?.length) {
      const g = allGuests.find((x) => x.guestId === guest.qGuest);
      if (g) setActiveGuestPortal(g);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guest.isGuestMode, events, allGuests]);

  // Expose for QrCodeModal fallback
  useEffect(() => {
    window.__ownerUid = user?.uid || '';
    window.__currentEventId = currentEvent?.id || '';
  }, [user?.uid, currentEvent?.id]);

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
    // eslint-disable-next-line no-console
    console.log('[App.jsx] handleCreateEvent called', { isAnonymous, newEventName });
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
    };
    await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'tasks'), newTask);
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

  const toggleTask = async (task, e) => {
    e.stopPropagation();
    if (!user || userRole !== 'owner') return;
    const taskRef = doc(db, 'artifacts', appId, 'users', user.uid, 'tasks', task.id);
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
    });
  };

  // Restore 2026-07-02: inline edit budget target from CoupleBudget EditableBudgetCard
  const handleSaveBudget = async (newBudget) => {
    if (!user || !currentEvent) return;
    const eventRef = doc(db, 'artifacts', appId, 'users', user.uid, 'events', currentEvent.id);
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
  const handleUpdateTaskCost = async (taskId, estimatedCost, actualCost) => {
    if (!user) return;
    const taskRef = doc(db, 'artifacts', appId, 'users', user.uid, 'tasks', taskId);
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
  const handleUpdateTask = async (taskId, updates) => {
    if (!user) return;
    const taskRef = doc(db, 'artifacts', appId, 'users', user.uid, 'tasks', taskId);
    const cleaned = {};
    Object.entries(updates).forEach(([k, v]) => {
      if (v !== undefined) cleaned[k] = v;
    });
    await updateDoc(taskRef, cleaned);
    setEditingTaskId(null);
    showToast('✅ 任務已更新');
  };

  const handleDeleteTask = async (task) => {
    if (!user) return;
    await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'tasks', task.id));
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
  const upsertWeddingDoc = async (name, data) => {
    if (!user || !data?.id) return;
    const ref = doc(db, 'artifacts', appId, 'users', user.uid, name, data.id);
    // Strip the id itself — Firestore stores it as the doc key
    const { id: _id, ...rest } = data;
    try {
      await setDoc(ref, { ...rest, eventId: currentEvent?.id || null, updatedAt: Date.now() }, { merge: true });
    } catch (err) {
      // 2026-07-18 — the error stays visible to the user via
      // the surrounding screen's UI fallbacks; we used to
      // console.log here while tracking down the original
      // `setDoc is not defined` ReferenceError. Now that
      // `setDoc` is properly imported (commit a08523d) we
      // can rethrow cleanly and stop spamming the dev console.
      throw err;
    }
  };
  const deleteWeddingDoc = async (name, id) => {
    if (!user || !id) return;
    await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, name, id));
  };

  // Per-collection wrappers — pass these to <WeddingDay/>:
  const handleUpsertRundown = (d) => upsertWeddingDoc('rundown', d);
  const handleDeleteRundown = (id) => deleteWeddingDoc('rundown', id);
  const handleReorderRundown = async (id, direction) => {
    // Lightweight re-order: shift the moved doc's startTime by ±15min
    // so the natural startTime-based sort in the screen changes.
    // Avoids a heavy "order" int field while still letting users
    // nudge conflicting slots. Not perfect but good enough for
    // event-day planning.
    if (!user || !id) return;
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
    const ref = doc(db, 'artifacts', appId, 'users', user.uid, 'rundown', id);
    await setDoc(ref, { startTime: `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}` }, { merge: true });
  };
  // 2026-07-22b — Bulk manualPosition setter for 大日流程 drag-
  // and-drop reorder. Writes all affected positions in parallel.
  const handleSetRundownPositions = async (writes) => {
    if (!user || !writes || writes.length === 0) return;
    const refs = writes.map(({ id, manualPosition }) =>
      setDoc(
        doc(db, 'artifacts', appId, 'users', user.uid, 'rundown', id),
        { manualPosition },
        { merge: true },
      ),
    );
    await Promise.all(refs);
  };
  const handleUpsertResource = (d) => upsertWeddingDoc('resources', d);
  const handleDeleteResource = (id) => deleteWeddingDoc('resources', id);
  const handleToggleResource = async (id, checked) => {
    if (!user) return;
    const ref = doc(db, 'artifacts', appId, 'users', user.uid, 'resources', id);
    await setDoc(ref, { checked }, { merge: true });
  };
  // 2026-07-22 — 物資 reorder. Same algorithm as playlist:
  // swap manualPosition between two adjacent items in the same
  // category. O(1) parallel writes.
  const handleReorderResource = async (idA, posA, idB, posB) => {
    if (!user || !idA || !idB) return;
    const a = doc(db, 'artifacts', appId, 'users', user.uid, 'resources', idA);
    const b = doc(db, 'artifacts', appId, 'users', user.uid, 'resources', idB);
    await Promise.all([
      setDoc(a, { manualPosition: posA }, { merge: true }),
      setDoc(b, { manualPosition: posB }, { merge: true }),
    ]);
  };
  // 2026-07-22b — Bulk manualPosition setter for drag-and-drop
  // reorder. Takes [{id, manualPosition}, ...] and writes them
  // in parallel. Used by both 物資 and 歌單.
  const handleSetResourcePositions = async (writes) => {
    if (!user || !writes || writes.length === 0) return;
    const refs = writes.map(({ id, manualPosition }) =>
      setDoc(
        doc(db, 'artifacts', appId, 'users', user.uid, 'resources', id),
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
  const handleReorderTeaCeremony = async (idA, orderA, idB, orderB) => {
    if (!user || !idA || !idB) return;
    const a = doc(db, 'artifacts', appId, 'users', user.uid, 'teaCeremony', idA);
    const b = doc(db, 'artifacts', appId, 'users', user.uid, 'teaCeremony', idB);
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
  const handleSetTeaCeremonyOrders = async (writes) => {
    if (!user || !writes || writes.length === 0) return;
    const refs = writes.map(({ id, order }) =>
      setDoc(
        doc(db, 'artifacts', appId, 'users', user.uid, 'teaCeremony', id),
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
  const handleReorderPlaylist = async (idA, posA, idB, posB) => {
    if (!user || !idA || !idB) return;
    const a = doc(db, 'artifacts', appId, 'users', user.uid, 'playlist', idA);
    const b = doc(db, 'artifacts', appId, 'users', user.uid, 'playlist', idB);
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
  const handleSetPlaylistPositions = async (writes) => {
    if (!user || !writes || writes.length === 0) return;
    const refs = writes.map(({ id, manualPosition }) =>
      setDoc(
        doc(db, 'artifacts', appId, 'users', user.uid, 'playlist', id),
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
    await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'guests'), newGuest);
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
    const guestsCol = collection(db, 'artifacts', appId, 'users', user.uid, 'guests');

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

  // Restore 2026-07-02: edit/delete single-row guest via EditGuestModal
  const handleSaveGuest = async (formData) => {
    if (!user || !editingGuest) return;
    const ownerUid = editingGuest.isGuestMode ? editingGuest.qOwner : user.uid;
    const ref = doc(db, 'artifacts', appId, 'users', ownerUid, 'guests', editingGuest.id);
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
    if (!user) return;
    const ownerUid = guestRow.isGuestMode ? guestRow.qOwner : user.uid;
    await deleteDoc(doc(db, 'artifacts', appId, 'users', ownerUid, 'guests', guestRow.id));
    setEditingGuest(null);
    showToast('🗑️ 嘉賓已刪除');
  };

  const handleGiveRedPacket = async (amount) => {
    if (!user || !activeGuestPortal) return;
    const ownerUid = guest.isGuestMode ? guest.qOwner : user.uid;
    const guestRef = doc(db, 'artifacts', appId, 'users', ownerUid, 'guests', activeGuestPortal.id);
    await updateDoc(guestRef, { hasGifted: true, giftAmount: amount });
    setShowPaymentModal(false);
    showToast(`🧧 成功發送 $${amount} 電子人情，感謝！`);
  };

  const handleSimulateReceptionScan = async (guestRow) => {
    if (!user) return;
    const ownerUid = guest.isGuestMode ? guest.qOwner : user.uid;
    const guestRef = doc(db, 'artifacts', appId, 'users', ownerUid, 'guests', guestRow.id);
    const now = Date.now();

    // Two writes: (1) flip hasAttended + stamp audit fields on guest row,
    // (2) append an immutable entry to scanLog. We do them in a batch so
    // either both land or neither does.
    const batch = writeBatch(db);
    batch.update(guestRef, {
      hasAttended: true,
      lastScannedBy: user.uid,
      lastScannedAt: now,
    });
    const logRef = doc(collection(db, 'artifacts', appId, 'users', ownerUid, 'scanLog'));
    batch.set(logRef, {
      guestId: guestRow.guestId || guestRow.id,
      guestName: guestRow.name || '',
      helperUid: user.uid,
      helperName: user.displayName || user.email || 'Anonymous',
      eventId: currentEvent?.id || '',
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

  const upgradeToPremium = async () => {
    if (!user || !currentEvent) return;
    const eventRef = doc(db, 'artifacts', appId, 'users', user.uid, 'events', currentEvent.id);
    await updateDoc(eventRef, { tier: 'premium' });
    setShowUpgradeModal(false);
    showToast('👑 已成功升級至 Premium！無限容量已開啟。');
  };

  // Photo upload — uploads to NAS via Tailscale Funnel (replaces Firebase
  // Storage to avoid Firebase egress/storage charges). After the upload
  // succeeds, we record the photo URL in Firestore so the owner's PhotoDrop
  // gallery picks it up via onSnapshot.
  const handleRealUpload = async (e) => {
    const file = e?.target?.files?.[0];
    if (!file || !user || !currentEvent || !activeGuestPortal) return;
    if (isStorageFull) {
      setShowUpgradeModal(true);
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
        onProgress: setUploadProgress,
      });
      // Persist the public URL + thumbnail URL in Firestore so the owner's
      // PhotoDrop screen can render it (uses onSnapshot for live updates).
      // thumbnailUrl is the smaller 256px version — the gallery uses it so
      // guests on slow wifi don't have to download full 4-8 MB phone photos.
      // 2026-07-23 — firestore.rules now allows isOwner(ownerUid) to
      // create photos (was only guests + helpers before). Photo upload
      // from the owner's own session was failing on addDoc.
      await addDoc(collection(db, 'artifacts', appId, 'users', targetUid, 'photos'), {
        eventId: currentEvent.id,
        url,
        thumbnailUrl: thumbnailUrl || url,  // fall back to full URL for legacy photos
        uploaderId: activeGuestPortal.guestId,
        uploaderName: activeGuestPortal.name,
        createdAt: Date.now(),
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
  const handleUpdatePhoto = async (photoId, patch) => {
    if (!user?.uid) throw new Error('請先登入');
    const photoRef = doc(
      db,
      'artifacts',
      appId,
      'users',
      user.uid,
      'photos',
      photoId,
    );
    await updateDoc(photoRef, patch);
  };

  const handleDeletePhoto = async (photoId) => {
    if (!user?.uid) throw new Error('請先登入');
    const photoRef = doc(
      db,
      'artifacts',
      appId,
      'users',
      user.uid,
      'photos',
      photoId,
    );
    await deleteDoc(photoRef);
  };

  const submitProposal = (jobId) => {
    setJobRequests(
      jobRequests.map((j) =>
        j.id === jobId ? { ...j, proposalsCount: j.proposalsCount + 1 } : j,
      ),
    );
    setProposalsData((prev) => ({
      ...prev,
      [jobId]: [
        { id: Date.now().toString(), vendorName: 'Visionary Capture', rating: 4.9, price: '待定', message: '商戶已發送初步報價，請聯絡商戶了解詳情。', date: '剛剛' },
        ...(prev[jobId] || []),
      ],
    }));
    showToast('✅ 報價已發送畀新人！');
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
            target === 'admin-vendors'
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
                  <h1
                    className="flex items-center gap-2 cursor-pointer min-w-0 flex-shrink-0"
                    onClick={() => {
                      // From outside a project, this navigates to the
                      // dashboard (no event → renders the picker).
                      // From inside a project, route to the role's
                      // landing view rather than dumping the user onto
                      // a blank screen — they always have at least one
                      // event when this header is shown.
                      if (!currentEvent) {
                        setCurrentView('events-dashboard');
                        return;
                      }
                      if (userRole === 'vendor') setCurrentView('vendor-dashboard');
                      else if (userRole === 'reception') setCurrentView('reception-scanner');
                      else setCurrentView('couple-checklist');
                    }}
                  >
                    <Heart className="w-6 h-6 fill-rose-500 text-rose-500 flex-shrink-0" />
                    <span className="hidden sm:inline text-xl font-black text-slate-800 whitespace-nowrap">
                      Save The Day
                    </span>
                    <span className="hidden sm:inline-flex text-xs font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded ml-2">
                      主控台
                    </span>
                  </h1>
                  <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                    {/* 2026-07-15 — inbox icon with unread badge.
                        Visible to owners + vendors (not reception/
                        guest_portal). Click navigates to the inbox. */}
                    {(userRole === 'owner' || userRole === 'vendor') && (
                      <button
                        onClick={() => {
                          setSelectedInquiry(null);
                          setCurrentView('inbox');
                        }}
                        className="relative text-slate-600 hover:text-slate-800 p-2 rounded-lg hover:bg-slate-100 transition-colors flex-shrink-0"
                        title="訊息收件匣"
                      >
                        <MessageCircle className="w-5 h-5" />
                        {totalUnread > 0 && (
                          <span className="absolute -top-0.5 -right-0.5 bg-rose-500 text-white text-[10px] font-black rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-tight ring-2 ring-white">
                            {totalUnread > 9 ? '9+' : totalUnread}
                          </span>
                        )}
                      </button>
                    )}
                    {/* Event name chip — truncates on mobile so it
                        doesn't push other buttons off-screen. */}
                    <div
                      className="text-sm font-bold text-slate-800 bg-rose-50 px-2 sm:px-3 py-1 rounded-lg border border-rose-100 truncate max-w-[100px] sm:max-w-[180px] min-w-0"
                      title={currentEvent.name}
                    >
                      {currentEvent.name}
                    </div>
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
                    <button
                      onClick={handleLogout}
                      className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 px-2 sm:px-3 py-1.5 rounded-lg border border-slate-200 transition-colors flex-shrink-0"
                      title="登出"
                      aria-label="登出"
                    >
                      <LogOut className="w-4 h-4" />
                      <span className="hidden sm:inline">登出</span>
                    </button>
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

            {userRole === 'owner' && currentEvent && currentView === 'couple-checklist' && (
              <CoupleChecklist
                tasks={eventTasks}
                vendors={vendors}
                activeCategory={activeCategory}
                activeVenue={activeVenue}
                editingTaskId={editingTaskId}
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
        onConfirm={upgradeToPremium}
      />
      <PaymentModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        onSend={handleGiveRedPacket}
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
        currentUser={user}
        currentUserRole={userRole}
      />
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
        proposals={viewingProposals ? proposalsData[viewingProposals] : null}
        onClose={() => setViewingProposals(null)}
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
