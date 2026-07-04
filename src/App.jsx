import { useEffect, useMemo, useState } from 'react';
import { Heart, LogOut, Users } from 'lucide-react';
import {
     addDoc,
     collection,
     deleteDoc,
     doc,
     onSnapshot,
     query,
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
} from './lib/config';
import { parseGuestParams } from './lib/guestMode';
import { uploadPhotoToNas } from './lib/uploadToNas';
import { useAuth } from './hooks/useAuth';
import { useHelperAuth } from './hooks/useHelperAuth';
import { useFirestoreCollection } from './hooks/useFirestoreCollection';
import { useToast } from './hooks/useToast';
import { signInAnonymously } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from './lib/firebase';

import { LoginScreen } from './screens/LoginScreen';
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
import { VendorDashboard } from './screens/VendorDashboard';
import { VendorProfileEdit } from './screens/VendorProfileEdit';
import { ReceptionScanner } from './screens/ReceptionScanner';
import { PersonalGuestPortal } from './screens/PersonalGuestPortal';
import { InvitationEditor } from './screens/InvitationEditor';

import { RoleSimulator } from './components/RoleSimulator';
import { TabNav } from './components/TabNav';
import { UpgradeModal } from './components/modals/UpgradeModal';
import { PaymentModal } from './components/modals/PaymentModal';
import { QrCodeModal } from './components/modals/QrCodeModal';
import { EditGuestModal } from './components/modals/EditGuestModal';
import { VendorModal } from './components/modals/VendorModal';
import { ProposalsModal } from './components/modals/ProposalsModal';
import { InviteModal } from './components/modals/InviteModal';
import { HelperManager } from './components/modals/HelperManager';
import { HelperWaitingScreen } from './screens/HelperWaitingScreen';
import { ScanResultModal } from './components/modals/ScanResultModal';
import { FullscreenSlideshow } from './components/modals/FullscreenSlideshow';

export default function App() {
  // Auth
  const { user, authChecked, isAdmin, loginWithGoogle, loginWithEmail, registerWithEmail, continueAsGuest, logout } = useAuth();

  // Helper context (兄弟姊妹). Only meaningful when the user is signed in
  // (not anonymous) and NOT in guest-mode URL. The hook itself is safe to
  // call unconditionally — it no-ops if no user.
  const helperCtx = useHelperAuth();
  const [helperAccepting, setHelperAccepting] = useState(false);

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
  const [activeVenue, setActiveVenue] = useState(null);
  const [activeGuestPortal, setActiveGuestPortal] = useState(null);

  // Vendors — static for now
  const [vendors] = useState(DEFAULT_VENDORS);
  const [discoverFilter, setDiscoverFilter] = useState('all');
  const [jobRequests, setJobRequests] = useState(INITIAL_JOB_REQUESTS);
  const [proposalsData, setProposalsData] = useState(MOCK_PROPOSALS);

  // Forms
  const [newEventName, setNewEventName] = useState('');
  const [newTaskForm, setNewTaskForm] = useState({
    categoryKey: 'other',
    customTitle: '',
    venue: '',
    dueDate: '2026-12-31',
    estimatedCost: '',
    taskType: 'vendor',
  });
  const [newGuestForm, setNewGuestForm] = useState({
    name: '',
    group: '男家親戚',
    headCount: 1,
    tableNumber: '未分配',
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
  const totalSpent = eventTasks.reduce(
    (sum, t) => sum + (t.isCompleted ? t.actualCost || 0 : 0),
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

  const handleCreateEvent = async (e) => {
    e.preventDefault();
    if (!user || !newEventName) return;
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

  const handleAddTask = async (e) => {
    e.preventDefault();
    if (!user || !currentEvent) return;
    const title =
      newTaskForm.categoryKey === 'other'
        ? newTaskForm.customTitle
        : TASK_CATEGORIES[newTaskForm.categoryKey] || newTaskForm.customTitle;
    const newTask = {
      eventId: currentEvent.id,
      title,
      category: newTaskForm.categoryKey,
      isCompleted: false,
      venue: newTaskForm.venue,
      dueDate: newTaskForm.dueDate,
      estimatedCost: Number(newTaskForm.estimatedCost) || 0,
      actualCost: Number(newTaskForm.estimatedCost) || 0,
      taskType: 'vendor',
    };
    await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'tasks'), newTask);
    setNewTaskForm({ categoryKey: 'other', customTitle: '', venue: '', dueDate: '2026-12-31', estimatedCost: '', taskType: 'vendor' });
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
  const handleUpdateTaskCost = async (task, newCost) => {
    if (!user) return;
    const taskRef = doc(db, 'artifacts', appId, 'users', user.uid, 'tasks', task.id);
    await updateDoc(taskRef, {
      estimatedCost: Number(newCost),
      // If task is already complete, also update actualCost so totals stay consistent
      ...(task.isCompleted ? { actualCost: Number(newCost) } : {}),
    });
    setEditingTaskId(null);
    showToast('✅ 任務金額已更新');
  };

  const handleDeleteTask = async (task) => {
    if (!user) return;
    await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'tasks', task.id));
    setActiveCategory(null);
  };

  const handleAddGuest = async (e) => {
    e.preventDefault();
    if (!user || !currentEvent || !newGuestForm.name) return;
    const guestId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const newGuest = {
      eventId: currentEvent.id,
      guestId,
      ...newGuestForm,
      hasAttended: false,
      hasGifted: false,
      giftAmount: 0,
    };
    await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'guests'), newGuest);
    setNewGuestForm({ name: '', group: '男家親戚', headCount: 1, tableNumber: '未分配' });
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
      showToast(`❌ ${err.message || '上載失敗，請重試！'}`);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      // Reset the input so selecting the same file twice still triggers onChange
      if (e?.target) e.target.value = '';
    }
  };

  const handleJobSubmit = (e) => {
    e.preventDefault();
    if (!newJobForm.budget) return;
    const newJob = {
      id: `job-${Date.now()}`,
      coupleName: currentEvent?.name || '新人',
      weddingDate: currentEvent?.date || '',
      serviceNeeded: newJobForm.serviceNeeded,
      venues: newJobForm.venueInput ? newJobForm.venueInput.split(',').map((v) => v.trim()) : [],
      budget: newJobForm.budget,
      details: newJobForm.details,
      status: 'open',
      proposalsCount: 0,
      postedAt: '剛剛',
    };
    setJobRequests([newJob, ...jobRequests]);
    setNewJobForm({ serviceNeeded: '場地佈置', venueInput: '', budget: '', details: '' });
    showToast('✅ 求救 Post 已成功發佈！');
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
    return (
      <LoginScreen
        onGoogleLogin={loginWithGoogle}
        onEmailLogin={loginWithEmail}
        onEmailRegister={registerWithEmail}
        onContinueAsGuest={continueAsGuest}
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
    userRole !== 'owner'
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
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-[100] bg-slate-900 text-white px-6 py-3 rounded-full shadow-2xl font-bold animate-in fade-in slide-in-from-top-4">
          {toast}
        </div>
      )}

      <RoleSimulator
        userRole={userRole}
        activeGuestPortal={activeGuestPortal}
        isAdmin={isAdmin}
        currentView={currentView}
        // Simulator is a dev tool — only show to event owners (signed-in
        // users who aren't helpers on someone else's wedding). Helpers
        // have a single fixed role on the platform.
        show={
          Boolean(user) &&
          !user.isAnonymous &&
          !helperCtx.isHelper
        }
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
            if (activeGuestPortal) setCurrentView('couple-guests');
            setActiveGuestPortal(null);
          } else if (role === 'reception') {
            setUserRole('reception');
            setActiveGuestPortal(null);
            setCurrentView('reception-scanner');
          } else if (role === 'vendor') {
            setUserRole('vendor');
            setActiveGuestPortal(null);
            setCurrentView('vendor-dashboard');
          }
        }}
      />

      {guest.isGuestMode ? (
        <PersonalGuestPortal
          guest={activeGuestPortal}
          eventName={currentEvent?.name}
          isUploading={isUploading}
          uploadProgress={uploadProgress}
          isStorageFull={isStorageFull}
          onUpload={handleRealUpload}
          onRequestRedPacket={() => setShowPaymentModal(true)}
        />
      ) : (
        <>
          {currentEvent && (
            <header className="bg-white shadow-sm sticky top-0 z-40 border-b border-slate-200">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between items-center py-4">
                  <h1
                    className="text-xl font-black text-slate-800 flex items-center gap-2 cursor-pointer"
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
                    <Heart className="w-6 h-6 fill-rose-500 text-rose-500" /> 囍程
                    <span className="text-xs font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded ml-2">
                      主控台
                    </span>
                  </h1>
                  <div className="flex items-center gap-4">
                    <div className="text-sm font-bold text-slate-800 bg-rose-50 px-3 py-1 rounded-lg border border-rose-100">
                      {currentEvent.name}
                    </div>
                    {userRole === 'owner' && (
                      <button
                        onClick={() => setShowHelperManager(true)}
                        className="flex items-center gap-1 text-sm font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg border border-indigo-200 transition-colors"
                        title="管理兄弟姊妹 (邀請、權限、撤銷)"
                      >
                        <Users className="w-4 h-4" /> 兄弟姊妹
                      </button>
                    )}
                    <button
                      onClick={handleLogout}
                      className="text-slate-400 hover:text-slate-600"
                    >
                      <LogOut className="w-5 h-5" />
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
              />
            )}

            {userRole === 'owner' && currentEvent && currentView === 'couple-checklist' && (
              <CoupleChecklist
                tasks={eventTasks}
                vendors={vendors}
                activeCategory={activeCategory}
                activeVenue={activeVenue}
                editingTaskId={editingTaskId}
                onClearEditingTask={() => setEditingTaskId(null)}
                onSelectCategory={(cat, venue) => {
                  setActiveCategory(cat);
                  setActiveVenue(venue);
                }}
                onToggleTask={toggleTask}
                onDeleteTask={handleDeleteTask}
                onUpdateTaskCost={handleUpdateTaskCost}
                newTaskForm={newTaskForm}
                onNewTaskFormChange={setNewTaskForm}
                onAddTask={handleAddTask}
                onClearActiveCategory={() => setActiveCategory(null)}
                onGoDiscover={() => setCurrentView('discover-vendors')}
                onGoJobBoard={() => {
                  setCurrentView('couple-jobboard');
                  setActiveCategory(null);
                }}
              />
            )}

            {userRole === 'owner' && currentEvent && currentView === 'couple-budget' && (
              <CoupleBudget
                tasks={eventTasks}
                totalBudget={totalBudget}
                totalSpent={totalSpent}
                canEdit={userRole === 'owner'}
                onSaveBudget={handleSaveBudget}
                onSelectTask={(taskId) => {
                  setCurrentView('couple-checklist');
                }}
              />
            )}

            {userRole === 'owner' && currentEvent && currentView === 'discover-vendors' && (
              <DiscoverDirectory
                vendors={vendors}
                filter={discoverFilter}
                onFilterChange={setDiscoverFilter}
                onViewProfile={setViewingVendorProfile}
                user={user}
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
              <AdminVendors user={user} isAdmin={isAdmin} />
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
                onPlaySlideshow={() => setIsFullscreen(true)}
                onUpgrade={() => setShowUpgradeModal(true)}
              />
            )}

            {userRole === 'owner' && currentEvent && currentView === 'couple-jobboard' && (
              <CoupleJobBoard
                jobRequests={jobRequests}
                newJobForm={newJobForm}
                onNewJobFormChange={setNewJobForm}
                onSubmitJob={handleJobSubmit}
                onShowProposals={setViewingProposals}
              />
            )}

            {userRole === 'reception' && currentEvent && currentView === 'reception-scanner' && (
              <ReceptionScanner onSimulateScan={simulateScanQrCode} />
            )}

            {userRole === 'vendor' && currentView === 'vendor-dashboard' && (
              <VendorDashboard
                jobRequests={jobRequests}
                onSubmitProposal={submitProposal}
              />
            )}

            {userRole === 'vendor' && currentView === 'vendor-profile' && (
              <VendorProfileEdit vendor={vendors[0]} />
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
      />
      <FullscreenSlideshow
        photos={eventPhotos}
        currentIndex={currentSlideIndex}
        onClose={() => setIsFullscreen(false)}
      />
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
