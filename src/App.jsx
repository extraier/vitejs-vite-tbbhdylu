import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  CheckCircle2, Circle, MapPin, Heart, ArrowRight, 
  Briefcase, Send, Calendar, DollarSign, AlertCircle, 
  Trash2, Plus, Clock, ArrowUpDown, Search, UserPlus, 
  Users, MessageSquare, Mail, Wallet, Star, PieChart, X,
  Image as ImageIcon, Upload, LayoutGrid, Info, QrCode, 
  ScanLine, UserCheck, Camera, Monitor, Smartphone, Crown, CreditCard, LogOut
} from 'lucide-react';

// --- Firebase Imports ---
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, addDoc, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';

// --- Firebase Initialization (終極防白畫面修復版) ---
const customFirebaseConfig = {
  apiKey: "AIzaSyA-HGRqFqNRp3t4xKjXgnjSZoqUoWZmEXs",
  authDomain: "savetheday-2377a.firebaseapp.com",
  projectId: "savetheday-2377a",
  storageBucket: "savetheday-2377a.firebasestorage.app", 
  messagingSenderId: "1076306848030",
  appId: "1:1076306848030:web:067794edd31cb2cdb3410f",
  measurementId: "G-LH4S4CEBK1"
};

let parsedFirebaseConfig = customFirebaseConfig;
try {
  if (typeof __firebase_config !== 'undefined' && __firebase_config) {
    const tempConfig = JSON.parse(__firebase_config);
    if (Object.keys(tempConfig).length > 0) {
      parsedFirebaseConfig = tempConfig;
    }
  }
} catch (error) {
  console.warn("Using custom firebase config due to Canvas environment override.");
}

// 防崩潰機制：避免 Vite HMR 重複初始化 Firebase
const app = getApps().length === 0 ? initializeApp(parsedFirebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'savetheday-production';

// --- Routing & Parameters ---
const queryParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
const qOwner = queryParams.get('o');
const qEvent = queryParams.get('e');
const qGuest = queryParams.get('g');
const isGuestMode = Boolean(qOwner && qEvent && qGuest);

// --- Constants ---
const TASK_CATEGORIES = {
  ceremony_venue: '證婚場地', banquet_venue: '出門及晚宴場地', deco: '場地佈置',
  lawyer: '證婚律師', photography: '婚禮攝影及錄影', mua: '新娘化妝師 (MUA)',
  bridesmaid_mua: '姊妹化妝', mc: '婚禮司儀 (MC)', chaperone: '大妗姐', planner: '婚禮統籌',
  rings: '結婚戒指', wedding_dress: '婚紗及晚裝', groom_suit: '男裝禮服',
  bridal_party_attire: '姊妹裙及兄弟衫', parents_attire: '四大長老服飾',
  rituals: '過大禮物資', photobooth: 'Photo booth', gifts: '回禮禮物',
  transport: '花車及旅遊巴', invitation: '喜帖', honeymoon: '蜜月旅行', other: '自訂項目'
};

const FREE_TIER_LIMIT_MB = 100;

// Default Vendors for the Discover and Smart Match tabs
const DEFAULT_VENDORS = [
  { id: 101, name: 'Visionary Capture', category: 'photography', rating: 4.9, price: '$18,000+', tags: ['伯大尼', 'Ritz Carlton', '紀實唯美'], description: '超過10年頂級酒店及教堂拍攝經驗，擅長捕捉自然流露的情感與光影。', portfolio: ['https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=400&q=80', 'https://images.unsplash.com/photo-1606800052052-a08af7148866?auto=format&fit=crop&w=400&q=80'] },
  { id: 102, name: 'Light & Shadow Studio', category: 'photography', rating: 4.7, price: '$15,000+', tags: ['伯大尼'], description: '自然唯美風格，專注海外及本地特色教堂拍攝。', portfolio: ['https://images.unsplash.com/photo-1537368910025-700350fe46c7?auto=format&fit=crop&w=400&q=80'] },
  { id: 103, name: 'FairyTale Floral', category: 'deco', rating: 4.8, price: '$25,000+', tags: ['Ritz Carlton', '奢華花藝'], description: '專為五星級酒店設計的頂尖佈置團隊，提供全方位 3D 模擬圖。', portfolio: ['https://images.unsplash.com/photo-1469334031218-e382a71b716b?auto=format&fit=crop&w=400&q=80'] },
  { id: 104, name: 'Bethanie Charm Deco', category: 'deco', rating: 4.6, price: '$8,000+', tags: ['伯大尼', '小清新'], description: '專為伯大尼教堂設計的佈置套餐。', portfolio: ['https://images.unsplash.com/photo-1519225421980-715cb0215aed?auto=format&fit=crop&w=400&q=80'] }
];

const INITIAL_JOB_REQUESTS = [
  { id: 'job-1', coupleName: 'Chantal & Fiance', weddingDate: '2027年1月', serviceNeeded: '場地佈置', venues: ['Ritz Carlton'], budget: '$20,000 - $30,000', details: '需要做過Ritz Carlton嘅佈置，有特高樓底設計經驗優先。', status: 'open', proposalsCount: 2, postedAt: '2小時前' },
  { id: 'job-2', coupleName: 'Mandy & Kevin', weddingDate: '2026年11月', serviceNeeded: '婚禮攝影及錄影', venues: ['伯大尼小教堂'], budget: '$8,000 - $12,000', details: '需要半日伯大尼教堂行禮拍攝。必須要有伯大尼拍攝經驗。', status: 'open', proposalsCount: 0, postedAt: '1日前' }
];

const MOCK_PROPOSALS = {
  'job-1': [
    { id: 'p1', vendorName: 'FairyTale Floral', rating: 4.8, price: '$22,000', message: '我哋對 Ritz Carlton 嘅特高樓底非常有經驗，白綠色系小清新加香檳金絕對做到你要嘅效果。', date: '1小時前' },
    { id: 'p2', vendorName: 'Elegance Wedding', rating: 4.6, price: '$28,500', message: '可以安排睇真實 Reference 相片。', date: '30分鐘前' }
  ]
};

export default function App() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [userRole, setUserRole] = useState(isGuestMode ? 'guest_portal' : 'owner'); 
  const [currentView, setCurrentView] = useState(isGuestMode ? 'guest-portal' : 'events-dashboard'); 
  const [toast, setToast] = useState(null);
  
  // Data States
  const [events, setEvents] = useState([]);
  const [currentEvent, setCurrentEvent] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [guests, setGuests] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [vendors] = useState(DEFAULT_VENDORS);
  const [jobRequests, setJobRequests] = useState(INITIAL_JOB_REQUESTS);
  const [proposalsData, setProposalsData] = useState(MOCK_PROPOSALS);
  const [teamMembers, setTeamMembers] = useState([{ id: 'u1', name: '伴娘 Mandy', role: 'bridesmaid' }]);
  
  // UI States
  const [searchQuery, setSearchQuery] = useState('');
  const [guestSearchQuery, setGuestSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState(null);
  const [activeVenue, setActiveVenue] = useState(null);
  const [discoverFilter, setDiscoverFilter] = useState('all');
  const [activeGuestPortal, setActiveGuestPortal] = useState(null); 
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Forms
  const [newEventName, setNewEventName] = useState('');
  const [newTaskForm, setNewTaskForm] = useState({ categoryKey: 'other', customTitle: '', venue: '', dueDate: '2026-12-31', estimatedCost: '', taskType: 'vendor' });
  const [newGuestForm, setNewGuestForm] = useState({ name: '', group: '男家親戚', headCount: 1, tableNumber: '未分配' });
  const [newJobForm, setNewJobForm] = useState({ serviceNeeded: '場地佈置', venueInput: '', budget: '', details: '' });
  const [inviteForm, setInviteForm] = useState({ name: '', email: '' });

  // Modals
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [viewingVendorProfile, setViewingVendorProfile] = useState(null);
  const [viewingQrCode, setViewingQrCode] = useState(null);
  const [scanResult, setScanResult] = useState(null);
  const [viewingProposals, setViewingProposals] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          // 無縫兼容 Canvas 環境，一秒自動登入
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Auth error:", error);
      }
    };
    initAuth();
    
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthChecked(true);
    });
    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
    setCurrentEvent(null);
    setCurrentView('events-dashboard');
  };

  const handleGoogleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      showToast('✅ 成功登入 Save The Day 囍程！');
    } catch (error) {
      console.error("Popup login failed:", error);
      await signInAnonymously(auth);
      showToast('✅ 已使用訪客身分登入體驗！');
    }
  };

  useEffect(() => {
    if (!user || !authChecked) return;
    
    const targetUid = isGuestMode ? qOwner : user.uid;

    const eventsRef = collection(db, 'artifacts', appId, 'users', targetUid, 'events');
    const unsubEvents = onSnapshot(eventsRef, (snapshot) => {
      const allEvents = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setEvents(allEvents);
      if (isGuestMode) {
        const ev = allEvents.find(e => e.id === qEvent);
        if (ev) setCurrentEvent(ev);
      }
    }, console.error);

    const guestsRef = collection(db, 'artifacts', appId, 'users', targetUid, 'guests');
    const unsubGuests = onSnapshot(guestsRef, (snapshot) => {
      const allGuests = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setGuests(allGuests);
      if (isGuestMode) {
        const g = allGuests.find(g => g.guestId === qGuest);
        if (g) setActiveGuestPortal(g);
      }
    }, console.error);

    const photosRef = collection(db, 'artifacts', appId, 'users', targetUid, 'photos');
    const unsubPhotos = onSnapshot(photosRef, (snapshot) => {
      setPhotos(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, console.error);

    let unsubTasks = () => {};
    if (!isGuestMode) {
      const tasksRef = collection(db, 'artifacts', appId, 'users', targetUid, 'tasks');
      unsubTasks = onSnapshot(tasksRef, (snapshot) => {
        setTasks(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }, console.error);
    }

    return () => { unsubEvents(); unsubGuests(); unsubPhotos(); unsubTasks(); };
  }, [user, authChecked]);

  const eventTasks = useMemo(() => tasks.filter(t => t.eventId === currentEvent?.id), [tasks, currentEvent]);
  const eventGuests = useMemo(() => guests.filter(g => g.eventId === currentEvent?.id), [guests, currentEvent]);
  const eventPhotos = useMemo(() => photos.filter(p => p.eventId === currentEvent?.id).sort((a,b) => b.createdAt - a.createdAt), [photos, currentEvent]);

  const totalBudget = currentEvent?.budget || 350000;
  const totalSpent = eventTasks.reduce((sum, task) => sum + (task.isCompleted ? (task.actualCost || 0) : 0), 0);
  const storageUsedMB = eventPhotos.length * 1.5; 
  const isPremium = currentEvent?.tier === 'premium';
  const isStorageFull = !isPremium && storageUsedMB >= FREE_TIER_LIMIT_MB;

  const filteredVendors = useMemo(() => {
    if (!activeCategory) return [];
    let matched = vendors.filter(v => v.category === activeCategory);
    if (activeVenue) {
      matched.sort((a, b) => {
        const aHas = a.tags.some(tag => activeVenue.includes(tag) || tag.includes(activeVenue));
        const bHas = b.tags.some(tag => activeVenue.includes(tag) || tag.includes(activeVenue));
        return bHas - aHas;
      });
    }
    return matched;
  }, [activeCategory, activeVenue, vendors]);

  const discoverVendors = useMemo(() => {
    if (discoverFilter === 'all') return vendors;
    return vendors.filter(v => v.category === discoverFilter);
  }, [discoverFilter, vendors]);

  useEffect(() => {
    let interval;
    if (isFullscreen && photos.length > 0) {
      interval = setInterval(() => {
        setCurrentSlideIndex((prev) => (prev + 1) % photos.length);
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [isFullscreen, photos.length]);

  const handleCreateEvent = async (e) => {
    e.preventDefault();
    if (!user || !newEventName) return;
    
    const newEvent = { name: newEventName, date: '2027-01-01', tier: 'free', budget: 350000, createdAt: Date.now() };
    const docRef = await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'events'), newEvent);
    
    const sampleTasks = [
      { eventId: docRef.id, title: '證婚場地', category: 'ceremony_venue', isCompleted: true, actualCost: 6800, venue: '伯大尼小教堂', dueDate: '2026-05-15', taskType: 'vendor' },
      { eventId: docRef.id, title: '場地佈置', category: 'deco', isCompleted: false, venue: '伯大尼小教堂', estimatedCost: 8000, dueDate: '2026-10-01', taskType: 'vendor' },
      { eventId: docRef.id, title: '出門及晚宴場地', category: 'banquet_venue', isCompleted: true, actualCost: 180000, venue: 'Ritz Carlton', dueDate: '2026-05-15', taskType: 'vendor' },
      { eventId: docRef.id, title: '婚禮攝影及錄影', category: 'photography', isCompleted: false, estimatedCost: 18000, dueDate: '2026-07-30', taskType: 'vendor' },
    ];
    for (const task of sampleTasks) {
      await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'tasks'), task);
    }

    setNewEventName('');
    showToast('🎉 婚禮專案建立成功！');
    setCurrentEvent({ id: docRef.id, ...newEvent });
    setCurrentView('couple-checklist');
  };

  const handleAddTask = async (e) => {
    e.preventDefault();
    if (!user || !currentEvent) return;
    const title = newTaskForm.categoryKey === 'other' ? newTaskForm.customTitle : TASK_CATEGORIES[newTaskForm.categoryKey];
    const newTask = {
      eventId: currentEvent.id, title, category: newTaskForm.categoryKey, isCompleted: false, venue: newTaskForm.venue,
      dueDate: newTaskForm.dueDate, estimatedCost: Number(newTaskForm.estimatedCost) || 0, actualCost: Number(newTaskForm.estimatedCost) || 0, taskType: 'vendor'
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
      actualCost: !task.isCompleted ? task.estimatedCost : 0 
    });
  };

  const handleAddGuest = async (e) => {
    e.preventDefault();
    if (!user || !currentEvent || !newGuestForm.name) return;
    
    // 防白畫面修復：使用安全嘅隨機字串取代 crypto.randomUUID()
    const guestId = Math.random().toString(36).substring(2, 8).toUpperCase(); 
    
    const newGuest = {
      eventId: currentEvent.id, guestId: guestId, ...newGuestForm, hasAttended: false, hasGifted: false, giftAmount: 0
    };
    await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'guests'), newGuest);
    setNewGuestForm({ name: '', group: '男家親戚', headCount: 1, tableNumber: '未分配' });
    showToast('✅ 嘉賓已加入名單，已生成專屬 QR Code！');
  };

  const handleGiveRedPacket = async (amount) => {
    if (!user || !activeGuestPortal) return;
    const targetUid = isGuestMode ? qOwner : user.uid;
    const guestRef = doc(db, 'artifacts', appId, 'users', targetUid, 'guests', activeGuestPortal.id);
    await updateDoc(guestRef, { hasGifted: true, giftAmount: amount });
    setShowPaymentModal(false);
    showToast(`🧧 成功發送 $${amount} 電子人情，感謝！`);
  };

  const handleSimulateReceptionScan = async (guest) => {
    if (!user) return;
    const guestRef = doc(db, 'artifacts', appId, 'users', user.uid, 'guests', guest.id);
    await updateDoc(guestRef, { hasAttended: true });
    setScanResult(guest);
    setTimeout(() => setScanResult(null), 3000);
  };

  const simulateScanQrCode = () => {
    const unAttendedGuests = eventGuests.filter(g => !g.hasAttended);
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

  const handleRealUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !user || !currentEvent || !activeGuestPortal) return;
    if (isStorageFull) return setShowUpgradeModal(true);

    setIsUploading(true);
    setUploadProgress(0);
    
    try {
      const targetUid = isGuestMode ? qOwner : user.uid;
      const fileExt = file.name.split('.').pop();
      const fileName = `photos/${currentEvent.id}/${Date.now()}_${activeGuestPortal.guestId}.${fileExt}`;
      const storageRef = ref(storage, fileName);
      const uploadTask = uploadBytesResumable(storageRef, file);
      
      uploadTask.on('state_changed', 
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadProgress(Math.round(progress));
        },
        (error) => {
          console.error("Upload error:", error);
          showToast('❌ 上載失敗，請重試！');
          setIsUploading(false);
        },
        async () => {
          const downloadURL = await getDownloadURL(uploadTask.ref);
          const newPhoto = {
            eventId: currentEvent.id,
            url: downloadURL,
            uploaderId: activeGuestPortal.guestId,
            uploaderName: activeGuestPortal.name,
            createdAt: Date.now()
          };
          await addDoc(collection(db, 'artifacts', appId, 'users', targetUid, 'photos'), newPhoto);
          setIsUploading(false);
          setUploadProgress(0);
          showToast('📸 相片已成功上載至大螢幕！');
        }
      );
    } catch (err) {
      console.error(err);
      setIsUploading(false);
    }
  };

  const handleJobSubmit = (e) => {
    e.preventDefault();
    if (!newJobForm.budget) return;
    const newJob = { id: `job-${Date.now()}`, coupleName: currentEvent?.name || '新人', weddingDate: currentEvent?.date || '', serviceNeeded: newJobForm.serviceNeeded, venues: newJobForm.venueInput ? newJobForm.venueInput.split(',').map(v => v.trim()) : [], budget: newJobForm.budget, details: newJobForm.details, status: 'open', proposalsCount: 0, postedAt: '剛剛' };
    setJobRequests([newJob, ...jobRequests]);
    setNewJobForm({ serviceNeeded: '場地佈置', venueInput: '', budget: '', details: '' });
    showToast('✅ 求救 Post 已成功發佈！');
  };

  const submitProposal = (jobId) => {
    setJobRequests(jobRequests.map(j => j.id === jobId ? {...j, proposalsCount: j.proposalsCount + 1} : j));
    setProposalsData(prev => ({
      ...prev, [jobId]: [{ id: Date.now().toString(), vendorName: 'Visionary Capture', rating: 4.9, price: '待定', message: '商戶已發送初步報價，請聯絡商戶了解詳情。', date: '剛剛' }, ...(prev[jobId] || [])]
    }));
    showToast('✅ 報價已發送畀新人！');
  };

  const handleInvite = (e) => {
    e.preventDefault();
    if (!inviteForm.name) return;
    const newMember = { id: `u${Date.now()}`, name: `${inviteForm.name} (邀請中)`, role: 'pending' };
    setTeamMembers([...teamMembers, newMember]);
    setShowInviteModal(false);
    setInviteForm({name: '', email: ''});
    showToast(`✅ 邀請電郵已發送至 ${inviteForm.email || '該成員'}`);
  };

  // ==========================================
  // Render Components
  // ==========================================

  // --- Login Screen (For Owners/Planners) ---
  if (authChecked && !user && !isGuestMode) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 md:p-12 rounded-[2rem] shadow-2xl max-w-md w-full text-center border border-slate-100 relative overflow-hidden animate-in fade-in zoom-in duration-500">
           <div className="absolute top-0 inset-x-0 h-2 bg-gradient-to-r from-rose-400 to-pink-500"></div>
           <Heart className="w-16 h-16 text-rose-500 fill-rose-500 mx-auto mb-6" />
           <h1 className="text-3xl font-black text-slate-800 tracking-wider mb-2">囍程</h1>
           <h2 className="text-xl font-bold text-slate-600 mb-8">Save The Day</h2>
           <p className="text-slate-500 mb-8 text-sm leading-relaxed">全港首個具備實時 QR Code 入席、相片收集箱及預算管理的一站式婚禮 SaaS 平台。</p>
           
           <button onClick={handleGoogleLogin} className="w-full bg-white border-2 border-slate-200 text-slate-700 font-bold py-3.5 rounded-xl hover:bg-slate-50 hover:border-slate-300 transition-all flex items-center justify-center gap-3 shadow-sm">
             <img src="https://www.svgrepo.com/show/475656/google-color.svg" className="w-5 h-5" alt="Google" />
             使用 Google 帳號登入
           </button>
           <p className="text-xs text-slate-400 mt-6">新人及婚禮統籌專用</p>
        </div>
      </div>
    );
  }

  if (!authChecked) return <div className="min-h-screen flex items-center justify-center text-slate-500">系統連接中...</div>;


  const renderRoleSimulator = () => (
    <div className="bg-slate-900 text-white text-sm py-2 px-4 flex flex-wrap justify-center items-center gap-4 z-50">
      <span className="font-bold flex items-center gap-1"><Users className="w-4 h-4 text-slate-400" /> 開發者模式視角切換：</span>
      <button onClick={() => { setUserRole('owner'); activeGuestPortal ? setCurrentView('couple-guests') : null; setActiveGuestPortal(null); }} className={`px-3 py-1 rounded-full ${userRole === 'owner' ? 'bg-rose-500 font-bold' : 'bg-slate-800 hover:bg-slate-700'}`}>👩🏻‍❤️‍👨🏻 主理新人</button>
      <button onClick={() => { setUserRole('reception'); setActiveGuestPortal(null); setCurrentView('reception-scanner'); }} className={`px-3 py-1 rounded-full ${userRole === 'reception' ? 'bg-indigo-500 font-bold' : 'bg-slate-800 hover:bg-slate-700'}`}>👯‍♀️ 兄弟姊妹(接待)</button>
      <button onClick={() => { setUserRole('vendor'); setActiveGuestPortal(null); setCurrentView('vendor-dashboard'); }} className={`px-3 py-1 rounded-full ${userRole === 'vendor' ? 'bg-emerald-500 font-bold' : 'bg-slate-800 hover:bg-slate-700'}`}>💼 商戶 (Vendor)</button>
      {activeGuestPortal && (
        <button className="px-3 py-1 rounded-full bg-pink-500 font-bold text-white shadow-md border-2 border-white/20 animate-pulse">
          📱 賓客專屬網頁 ({activeGuestPortal.name})
        </button>
      )}
    </div>
  );

  const renderEventsDashboard = () => (
    <div className="max-w-4xl mx-auto mt-12 p-4 animate-in fade-in zoom-in duration-300">
      <div className="text-center mb-12">
        <Heart className="w-16 h-16 text-rose-500 mx-auto mb-4 fill-rose-100" />
        <h1 className="text-4xl font-black text-slate-800 mb-2">囍程 總大堂</h1>
        <p className="text-slate-500">建立或選擇你想管理的婚禮專案</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {events.map(ev => (
          <div key={ev.id} onClick={() => { setCurrentEvent(ev); setCurrentView('couple-checklist'); }} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-lg hover:border-rose-300 transition-all cursor-pointer group relative overflow-hidden">
            {ev.tier === 'premium' && <div className="absolute top-0 right-0 bg-amber-400 text-white text-[10px] font-bold px-3 py-1 rounded-bl-xl flex items-center gap-1"><Crown className="w-3 h-3"/> PREMIUM</div>}
            <h3 className="text-xl font-bold text-slate-800 mb-1 group-hover:text-rose-600 transition-colors">{ev.name}</h3>
            <p className="text-sm text-slate-500 flex items-center gap-1 mb-4"><Calendar className="w-4 h-4"/> 預定日期: {ev.date}</p>
            <div className="flex justify-between items-center border-t border-slate-100 pt-4 mt-4">
              <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded">專案 ID: {ev.id.substring(0,6)}</span>
              <ArrowRight className="w-5 h-5 text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity translate-x-[-10px] group-hover:translate-x-0" />
            </div>
          </div>
        ))}

        <div className="bg-rose-50 p-6 rounded-2xl border-2 border-dashed border-rose-200 hover:border-rose-400 transition-all flex flex-col items-center justify-center text-center min-h-[200px]">
          <form onSubmit={handleCreateEvent} className="w-full flex flex-col items-center">
            <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mb-3 shadow-sm"><Plus className="w-6 h-6 text-rose-500" /></div>
            <h3 className="text-lg font-bold text-slate-800 mb-2">建立新婚禮</h3>
            <input type="text" required placeholder="例如: Chantal & Fiance" className="w-full max-w-[200px] p-2 text-center border border-rose-200 rounded-lg outline-none focus:ring-2 focus:ring-rose-400 mb-3 bg-white" value={newEventName} onChange={e => setNewEventName(e.target.value)} />
            <button type="submit" className="bg-rose-500 text-white text-xs font-bold px-4 py-2 rounded-full hover:bg-rose-600">立即建立</button>
          </form>
        </div>
      </div>
    </div>
  );

  const renderCoupleChecklist = () => {
    const progressPercentage = Math.round((eventTasks.filter(t => t.isCompleted).length / (eventTasks.length || 1)) * 100);

    return (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mt-8 animate-in slide-in-from-bottom-4 duration-500">
        <section className="lg:col-span-6 flex flex-col gap-4">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-slate-800">我的任務清單</h2>
              <div className="text-sm font-bold text-rose-600 bg-rose-50 px-3 py-1 rounded-full">進度 {progressPercentage}%</div>
            </div>
            
            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar mb-4">
              {eventTasks.map(task => (
                <div key={task.id} onClick={() => { if(!task.isCompleted) { setActiveCategory(task.category); setActiveVenue(task.venue); } }} className={`flex items-start p-3.5 rounded-xl cursor-pointer border transition-all ${task.isCompleted ? 'bg-slate-50 border-transparent opacity-75' : activeCategory === task.category ? 'bg-rose-50 border-rose-200 shadow-sm ring-1 ring-rose-100' : 'bg-white border-slate-200 hover:border-rose-200'}`}>
                  <button onClick={(e) => toggleTask(task, e)} className="mt-0.5 mr-3 flex-shrink-0"><CheckCircle2 className={`w-6 h-6 ${task.isCompleted ? 'text-green-500' : 'text-slate-300'}`} /></button>
                  <div className="flex-grow">
                    <div className="flex items-center flex-wrap gap-2 mb-1">
                        <span className={`font-bold ${task.isCompleted ? 'line-through text-slate-500' : 'text-slate-800'}`}>{task.title}</span>
                        {task.venue && <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded flex items-center gap-1"><MapPin className="w-3 h-3" /> {task.venue}</span>}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-slate-500">
                        <div className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {task.dueDate}</div>
                        <div className="flex items-center gap-1"><DollarSign className="w-3.5 h-3.5" /> {task.isCompleted ? `實際: $${task.actualCost}` : `預算: $${task.estimatedCost}`}</div>
                    </div>
                  </div>
                  {userRole === 'owner' && <button onClick={(e) => { e.stopPropagation(); deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'tasks', task.id)); setActiveCategory(null); }} className="ml-2 p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"><Trash2 className="w-4 h-4" /></button>}
                  {!task.isCompleted && <ArrowRight className={`ml-2 mt-2 w-4 h-4 flex-shrink-0 ${activeCategory === task.category ? 'text-rose-500' : 'text-slate-300'}`} />}
                </div>
              ))}
              {eventTasks.length === 0 && <div className="text-center py-8 text-slate-400">目前沒有籌備任務，立即新增！</div>}
            </div>

            <form onSubmit={handleAddTask} className="bg-slate-50 p-4 rounded-xl border border-slate-200 grid grid-cols-2 gap-2 mt-4">
              <select className="col-span-2 p-2.5 border border-slate-300 rounded-lg text-sm outline-none bg-white" value={newTaskForm.categoryKey} onChange={(e) => setNewTaskForm({...newTaskForm, categoryKey: e.target.value})}>
                <optgroup label="場地及佈置"><option value="ceremony_venue">證婚場地</option><option value="banquet_venue">出門及晚宴場地</option><option value="deco">場地佈置</option></optgroup>
                <optgroup label="團隊及統籌"><option value="lawyer">證婚律師</option><option value="photography">攝影及錄影</option><option value="mua">新娘化妝師</option></optgroup>
                <option value="other">✏️ 自訂項目 (其他)...</option>
              </select>
              {newTaskForm.categoryKey === 'other' && <input type="text" placeholder="自訂項目名稱..." required className="col-span-2 p-2.5 border border-slate-300 rounded-lg text-sm outline-none" value={newTaskForm.customTitle} onChange={e => setNewTaskForm({...newTaskForm, customTitle: e.target.value})} />}
              <input type="text" placeholder="📍 指定場地 (選填)" className="col-span-2 p-2.5 border border-slate-300 rounded-lg text-sm outline-none" value={newTaskForm.venue} onChange={e => setNewTaskForm({...newTaskForm, venue: e.target.value})} />
              <input type="date" required className="p-2.5 border border-slate-300 rounded-lg text-sm outline-none text-slate-600" value={newTaskForm.dueDate} onChange={e => setNewTaskForm({...newTaskForm, dueDate: e.target.value})} />
              <input type="number" placeholder="大約預算 $" className="p-2.5 border border-slate-300 rounded-lg text-sm outline-none" value={newTaskForm.estimatedCost} onChange={e => setNewTaskForm({...newTaskForm, estimatedCost: e.target.value})} />
              <button type="submit" className="col-span-2 bg-slate-900 text-white font-bold py-3 rounded-lg mt-1 hover:bg-slate-800 shadow-sm flex items-center justify-center gap-2"><Plus className="w-4 h-4"/> 新增任務</button>
            </form>
          </div>
        </section>

        <section className="lg:col-span-6">
          <div className="sticky top-28">
            {!activeCategory ? (
              <div className="bg-white rounded-2xl p-10 shadow-sm border border-slate-200 text-center flex flex-col items-center justify-center min-h-[400px] bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-50/50 via-white to-white">
                <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center mb-6 shadow-inner"><Search className="w-10 h-10 text-indigo-500" /></div>
                <h3 className="text-xl font-bold text-slate-800 mb-3">尋找完美商戶靈感？</h3>
                <p className="text-slate-500 mb-6 text-sm leading-relaxed max-w-sm">點擊左側未完成任務，AI 會為你配對合適商戶；或直接進入「商戶指南」瀏覽作品集！</p>
                <button onClick={() => setCurrentView('discover-vendors')} className="bg-slate-900 text-white font-bold px-8 py-3.5 rounded-xl hover:bg-slate-800 transition-colors shadow-md w-full max-w-sm">
                  🔍 立即探索商戶指南
                </button>
              </div>
            ) : (
              <div className="bg-transparent animate-in slide-in-from-right-4 duration-300">
                <div className="mb-5 flex items-end justify-between">
                  <div>
                    <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">智能配對推薦</h2>
                    <p className="text-rose-600 font-medium text-sm mt-1">正在尋找：{TASK_CATEGORIES[activeCategory] || '商戶'} {activeVenue && <span className="text-slate-500"> @ {activeVenue}</span>}</p>
                  </div>
                </div>
                <div className="space-y-4 max-h-[750px] overflow-y-auto pr-2 custom-scrollbar">
                  {filteredVendors.length > 0 ? (
                    filteredVendors.map(vendor => {
                      const isPerfectMatch = activeVenue && vendor.tags.some(tag => activeVenue.includes(tag) || tag.includes(activeVenue));
                      return (
                        <div key={vendor.id} className={`bg-white rounded-2xl p-6 shadow-sm border transition-all relative ${isPerfectMatch ? 'border-rose-300 ring-1 ring-rose-100' : 'border-slate-100'}`}>
                          {isPerfectMatch && <div className="absolute top-0 right-6 -translate-y-1/2 bg-gradient-to-r from-rose-500 to-pink-500 text-white text-[10px] font-bold px-3 py-1 rounded-full flex items-center gap-1"><MapPin className="w-3 h-3"/> 場地經驗匹配</div>}
                          <div className="flex gap-2 mb-3 flex-wrap">{vendor.tags.map(tag => <span key={tag} className="text-xs font-bold px-2.5 py-1 rounded-md bg-slate-100 text-slate-600">{tag}</span>)}</div>
                          <h3 className="text-lg font-bold text-slate-800">{vendor.name}</h3>
                          <div className="flex items-center gap-3 text-sm mb-4 mt-1">
                              <span className="font-bold text-slate-700 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">{vendor.price}</span>
                              <span className="flex items-center gap-1 text-slate-500"><Star className="w-4 h-4 fill-amber-400 text-amber-400" /> {vendor.rating}</span>
                          </div>
                          <div className="flex gap-2 mt-4">
                             <button onClick={() => setViewingVendorProfile(vendor)} className="flex-1 bg-slate-900 text-white py-2 rounded-xl text-sm font-bold hover:bg-slate-800">查看作品集</button>
                             <button onClick={() => { setCurrentView('couple-jobboard'); setActiveCategory(null); }} className="flex-1 bg-rose-50 text-rose-700 border border-rose-200 py-2 rounded-xl text-sm font-bold hover:bg-rose-100">索取報價</button>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200 text-center">
                      <p className="text-slate-500 mb-4 font-medium">資料庫暫時未有此場地的推薦商戶。</p>
                      <button onClick={() => { setCurrentView('couple-jobboard'); setActiveCategory(null); }} className="bg-rose-100 text-rose-700 font-bold px-6 py-2.5 rounded-xl hover:bg-rose-200">不如去「求救板」出 Post 等 Vendor 搵你？</button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    );
  };

  const renderCoupleBudget = () => {
    const totalRemaining = totalBudget - totalSpent;
    const budgetPercentage = Math.round((totalSpent / totalBudget) * 100);

    return (
      <div className="max-w-5xl mx-auto mt-8 animate-in slide-in-from-bottom-4 duration-500">
        <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200 mb-8">
          <h2 className="text-2xl font-bold text-slate-800 mb-6 flex items-center gap-2"><Wallet className="w-7 h-7 text-rose-500" /> 預算管理與明細</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-slate-50 rounded-xl p-5 border border-slate-200 shadow-sm"><p className="text-sm text-slate-500 mb-1 font-bold">總預算目標 (HKD)</p><p className="text-3xl font-black text-slate-800">${totalBudget.toLocaleString()}</p></div>
            <div className="bg-rose-50 rounded-xl p-5 border border-rose-200 shadow-sm relative overflow-hidden"><p className="text-sm text-rose-700 mb-1 font-bold relative z-10">已確認開支</p><p className="text-3xl font-black text-rose-700 relative z-10">${totalSpent.toLocaleString()}</p></div>
            <div className={`rounded-xl p-5 border shadow-sm ${totalRemaining < 0 ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}><p className={`text-sm mb-1 font-bold ${totalRemaining < 0 ? 'text-red-600' : 'text-emerald-700'}`}>剩餘可分配</p><p className={`text-3xl font-black ${totalRemaining < 0 ? 'text-red-700' : 'text-emerald-600'}`}>${totalRemaining.toLocaleString()}</p></div>
          </div>

          <div className="mb-10 bg-slate-50 p-5 rounded-xl border border-slate-100">
             <div className="flex justify-between text-sm mb-2"><span className="font-bold text-slate-700 flex items-center gap-2"><PieChart className="w-4 h-4"/>預算消耗進度</span><span className="font-black text-slate-800">{budgetPercentage}%</span></div>
             <div className="w-full bg-slate-200 rounded-full h-4 overflow-hidden shadow-inner">
                <div className={`h-full transition-all duration-1000 ease-out relative ${budgetPercentage > 100 ? 'bg-red-500' : 'bg-gradient-to-r from-rose-400 to-rose-500'}`} style={{ width: `${Math.min(budgetPercentage, 100)}%` }}></div>
             </div>
          </div>

          <div className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
              <div className="hidden sm:grid grid-cols-12 gap-4 p-4 bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
                <div className="col-span-6">項目</div><div className="col-span-2 text-center">狀態</div><div className="col-span-4 text-right">金額 (HKD)</div>
              </div>
              <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto custom-scrollbar">
                {eventTasks.map(task => (
                  <div key={task.id} className="grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-4 p-4 bg-white hover:bg-slate-50 items-center">
                      <div className="sm:col-span-6 flex items-center gap-3">
                          {task.isCompleted ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : <Circle className="w-5 h-5 text-amber-400" />}
                          <div className="font-bold text-slate-800">{task.title}</div>
                      </div>
                      <div className="sm:col-span-2 sm:text-center pl-8 sm:pl-0">
                          {task.isCompleted ? <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-1 rounded">已確認 (已付款)</span> : <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-1 rounded">籌備中 (預算)</span>}
                      </div>
                      <div className="sm:col-span-4 sm:text-right pl-8 sm:pl-0 font-mono">
                          {task.isCompleted ? <span className="font-bold text-slate-800">${task.actualCost}</span> : <span className="text-slate-400">${task.estimatedCost}</span>}
                      </div>
                  </div>
                ))}
              </div>
          </div>
        </div>
      </div>
    );
  };

  const renderDiscoverDirectory = () => (
    <div className="max-w-7xl mx-auto mt-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="text-center mb-10"><h2 className="text-3xl font-black text-slate-800 mb-4">探索優質婚禮商戶</h2></div>
      <div className="flex flex-wrap justify-center gap-2 mb-8">
        <button onClick={() => setDiscoverFilter('all')} className={`px-5 py-2 rounded-full font-bold text-sm transition-all ${discoverFilter === 'all' ? 'bg-slate-900 text-white shadow-md' : 'bg-white text-slate-600 border border-slate-200'}`}>全部商戶</button>
        <button onClick={() => setDiscoverFilter('photography')} className={`px-5 py-2 rounded-full font-bold text-sm transition-all ${discoverFilter === 'photography' ? 'bg-slate-900 text-white shadow-md' : 'bg-white text-slate-600 border border-slate-200'}`}>📸 攝影</button>
        <button onClick={() => setDiscoverFilter('deco')} className={`px-5 py-2 rounded-full font-bold text-sm transition-all ${discoverFilter === 'deco' ? 'bg-slate-900 text-white shadow-md' : 'bg-white text-slate-600 border border-slate-200'}`}>🌸 佈置</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {discoverVendors.map(vendor => (
          <div key={vendor.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-lg cursor-pointer group" onClick={() => setViewingVendorProfile(vendor)}>
            <div className="h-48 w-full overflow-hidden bg-slate-100 relative">
              {vendor.portfolio && vendor.portfolio[0] && <img src={vendor.portfolio[0]} alt={vendor.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />}
            </div>
            <div className="p-5">
              <h3 className="text-lg font-bold text-slate-800 mb-2 truncate">{vendor.name}</h3>
              <div className="flex justify-between items-center border-t border-slate-100 pt-4"><span className="font-black text-rose-600">{vendor.price}</span><span className="text-sm font-bold text-slate-900 bg-slate-100 px-4 py-2 rounded-lg">查看作品集</span></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderGuestList = () => (
    <div className="max-w-6xl mx-auto mt-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2"><Users className="w-7 h-7 text-indigo-500" /> 嘉賓名單與座位表</h2>
          <p className="text-slate-500 text-sm mt-1">每個嘉賓都有專屬 ID，生成獨立 QR Code 網址。</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
            <div className="relative w-full max-w-xs">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input type="text" placeholder="搜尋姓名..." className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-indigo-500" value={guestSearchQuery} onChange={e => setGuestSearchQuery(e.target.value)} />
            </div>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
              <tr><th className="p-4">姓名 (專屬 ID)</th><th className="p-4">群組</th><th className="p-4">座位</th><th className="p-4 text-center">狀態 / 人情</th><th className="p-4 text-right">操作</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {eventGuests.filter(g => g.name.includes(guestSearchQuery)).map(guest => (
                <tr key={guest.id} className="hover:bg-slate-50/50">
                  <td className="p-4">
                    <div className="font-bold text-slate-800">{guest.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono">ID: {guest.guestId}</div>
                  </td>
                  <td className="p-4"><span className="bg-slate-100 text-slate-600 text-xs px-2 py-1 rounded-md">{guest.group}</span></td>
                  <td className="p-4 font-bold text-slate-700">{guest.tableNumber}</td>
                  <td className="p-4 text-center">
                    <div className="flex flex-col items-center gap-1">
                      {guest.hasAttended ? <span className="text-green-600 font-bold text-[10px] bg-green-50 px-2 py-0.5 rounded border border-green-200">已報到</span> : <span className="text-slate-400 text-[10px]">未到</span>}
                      {guest.hasGifted && <span className="text-rose-600 font-bold text-[10px] bg-rose-50 px-2 py-0.5 rounded border border-rose-200">🧧 ${guest.giftAmount}</span>}
                    </div>
                  </td>
                  <td className="p-4 text-right">
                    {userRole === 'owner' ? (
                      <div className="flex justify-end gap-2">
                        <button onClick={() => { setActiveGuestPortal(guest); setUserRole('guest_portal'); setCurrentView('guest-portal'); }} className="p-2 text-rose-500 bg-rose-50 hover:bg-rose-100 rounded-lg" title="預覽賓客手機版面"><Smartphone className="w-4 h-4" /></button>
                        <button onClick={() => setViewingQrCode(guest)} className="p-2 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg" title="打開 QR Code 連結"><QrCode className="w-4 h-4" /></button>
                      </div>
                    ) : (
                      <button onClick={() => handleSimulateReceptionScan(guest)} disabled={guest.hasAttended} className={`text-xs font-bold px-3 py-1.5 rounded-lg border flex items-center justify-end gap-1 ml-auto ${guest.hasAttended ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed' : 'bg-indigo-600 text-white border-indigo-700 hover:bg-indigo-700'}`}>
                        <ScanLine className="w-3 h-3"/> 掃描報到
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {eventGuests.length === 0 && <div className="text-center py-10 text-slate-400">尚未加入任何嘉賓</div>}
        </div>

        {userRole === 'owner' && (
          <div className="lg:col-span-4">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 sticky top-28">
              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2"><UserPlus className="w-5 h-5 text-indigo-500"/> 新增嘉賓</h3>
              <form onSubmit={handleAddGuest} className="space-y-4">
                <div><input type="text" required placeholder="姓名" className="w-full p-2.5 rounded-lg border border-slate-300 outline-none" value={newGuestForm.name} onChange={e => setNewGuestForm({...newGuestForm, name: e.target.value})} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <select className="w-full p-2.5 rounded-lg border border-slate-300 outline-none bg-white" value={newGuestForm.group} onChange={e => setNewGuestForm({...newGuestForm, group: e.target.value})}>
                    <option>男家親戚</option><option>女家朋友</option><option>VIP</option>
                  </select>
                  <input type="number" min="1" required placeholder="人數" className="w-full p-2.5 rounded-lg border border-slate-300 outline-none" value={newGuestForm.headCount} onChange={e => setNewGuestForm({...newGuestForm, headCount: parseInt(e.target.value) || 1})} />
                </div>
                <div><input type="text" placeholder="分配座位 (例如: Table 1)" className="w-full p-2.5 rounded-lg border border-slate-300 outline-none" value={newGuestForm.tableNumber} onChange={e => setNewGuestForm({...newGuestForm, tableNumber: e.target.value})} /></div>
                <button type="submit" className="w-full bg-slate-900 text-white font-bold py-3 rounded-xl hover:bg-slate-800">新增</button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderPersonalGuestPortal = () => {
    if (!activeGuestPortal) return <div className="text-center mt-20 text-slate-500">正在載入您的專屬電子喜帖...</div>;
    const guest = activeGuestPortal;
    
    return (
      <div className="max-w-md mx-auto mt-4 pb-12 animate-in fade-in zoom-in duration-300">
        <div className="bg-white rounded-[2rem] shadow-xl overflow-hidden border border-slate-200">
          <div className="bg-slate-900 text-center text-white py-10 px-6 relative">
             <div className="absolute top-0 left-0 w-full h-full bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] opacity-30"></div>
             <Heart className="w-8 h-8 mx-auto mb-2 text-rose-500 fill-rose-500 relative z-10" />
             <h2 className="text-xl font-black tracking-widest mb-1 relative z-10">{currentEvent?.name || '婚禮晚宴'}</h2>
             <p className="text-white/60 text-xs font-mono relative z-10">Save The Day 囍程</p>
          </div>

          <div className="p-6 -mt-6 relative z-20">
            <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-6 text-center mb-6">
               <h3 className="text-sm text-slate-500 mb-1">親愛的嘉賓</h3>
               <h2 className="text-2xl font-black text-slate-800 mb-4">{guest.name}</h2>
               <div className="inline-block bg-indigo-50 border border-indigo-100 rounded-xl px-5 py-3">
                 <p className="text-xs text-indigo-500 font-bold mb-1">您的專屬座位</p>
                 <p className="text-3xl font-black text-indigo-700">{guest.tableNumber}</p>
               </div>
            </div>

            <div className="space-y-4">
               {/* 真正嘅相片上載 UI */}
               <div className="p-5 rounded-2xl border-2 border-slate-200 bg-slate-50">
                 <h4 className="font-bold text-slate-800 flex items-center gap-2 mb-2"><Camera className="w-5 h-5 text-slate-600"/> 現場相片分享</h4>
                 <p className="text-xs text-slate-500 mb-3">分享您剛才拍攝的美照，相片會即時投射至大螢幕！</p>
                 
                 <input type="file" id="real-photo-upload" accept="image/*" className="hidden" onChange={handleRealUpload} disabled={isUploading || isStorageFull} />
                 
                 <label htmlFor="real-photo-upload" className={`w-full py-3 rounded-xl shadow-sm flex items-center justify-center gap-2 font-bold transition-colors ${isUploading ? 'bg-slate-300 text-slate-600 cursor-not-allowed' : isStorageFull ? 'bg-red-100 text-red-600 cursor-not-allowed' : 'bg-slate-900 text-white hover:bg-slate-800 cursor-pointer'}`}>
                   {isUploading ? <><span className="animate-pulse">上載中 {uploadProgress}%...</span></> : 
                    isStorageFull ? <><AlertCircle className="w-4 h-4"/> 空間已滿</> :
                    <><Upload className="w-4 h-4"/> 從手機選擇相片</>}
                 </label>
               </div>

               <div className={`p-5 rounded-2xl border-2 transition-all ${guest.hasGifted ? 'bg-green-50 border-green-200' : 'bg-rose-50 border-rose-200'}`}>
                 <div className="flex justify-between items-center mb-2">
                   <h4 className="font-bold text-slate-800 flex items-center gap-2"><CreditCard className="w-5 h-5 text-rose-500"/> 電子人情 (Red Packet)</h4>
                 </div>
                 {guest.hasGifted ? (
                   <p className="text-sm text-green-700 font-medium">感謝您的祝福！已紀錄禮金：${guest.giftAmount}</p>
                 ) : (
                   <button onClick={() => setShowPaymentModal(true)} className="w-full bg-rose-600 text-white font-bold py-2.5 rounded-xl hover:bg-rose-700 shadow-sm flex items-center justify-center gap-2">
                     <QrCode className="w-4 h-4"/> 使用 PayMe / FPS
                   </button>
                 )}
               </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderPhotoDrop = () => (
    <div className="max-w-6xl mx-auto mt-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2"><Camera className="w-7 h-7 text-rose-500" /> 互動相片牆 (Photo Drop)</h2>
          <p className="text-slate-500 text-sm mt-1">統一收集賓客相片。升級 Premium 解鎖無限儲存空間。</p>
        </div>
        <button onClick={() => setIsFullscreen(true)} className="bg-rose-600 text-white font-bold px-6 py-2 rounded-xl hover:bg-rose-700 shadow-md flex items-center gap-2"><Monitor className="w-4 h-4"/> 播放 Live Slideshow</button>
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 mb-8 flex flex-col md:flex-row items-center gap-6">
         <div className={`p-4 rounded-full ${isPremium ? 'bg-amber-100' : 'bg-slate-100'}`}>
           {isPremium ? <Crown className="w-8 h-8 text-amber-500" /> : <PieChart className="w-8 h-8 text-slate-500" />}
         </div>
         <div className="flex-grow w-full">
            <div className="flex justify-between items-end mb-2">
              <div>
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                  雲端儲存空間 {isPremium && <span className="bg-amber-400 text-white text-[10px] px-2 py-0.5 rounded-full">PRO</span>}
                </h3>
              </div>
              <div className="text-right">
                <span className={`text-lg font-black ${isStorageFull ? 'text-red-500' : 'text-slate-800'}`}>{storageUsedMB.toFixed(1)} MB</span>
                {!isPremium && <span className="text-sm text-slate-500 font-medium"> / {FREE_TIER_LIMIT_MB} MB</span>}
              </div>
            </div>
            {!isPremium && (
              <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                <div className={`h-full transition-all duration-500 ${isStorageFull ? 'bg-red-500' : 'bg-slate-800'}`} style={{ width: `${Math.min((storageUsedMB / FREE_TIER_LIMIT_MB) * 100, 100)}%` }}></div>
              </div>
            )}
         </div>
         {!isPremium && (
           <button onClick={() => setShowUpgradeModal(true)} className="flex-shrink-0 bg-amber-400 text-white font-bold px-5 py-2.5 rounded-xl hover:bg-amber-500 shadow-sm flex items-center gap-2">
             升級 Premium
           </button>
         )}
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
        <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span> 已收集 {eventPhotos.length} 張相片</h3>
        {eventPhotos.length === 0 ? (
          <div className="text-center py-10 text-slate-400">暫時未有賓客上載相片</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {eventPhotos.map(p => (
              <div key={p.id} className="aspect-square rounded-xl overflow-hidden relative group cursor-pointer shadow-sm">
                <img src={p.url} alt="upload" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
                  <span className="text-white text-xs font-bold truncate">{p.uploaderName}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderCoupleJobBoard = () => (
    <div className="max-w-4xl mx-auto mt-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="bg-white rounded-2xl p-8 shadow-sm border border-rose-100 mb-8 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-rose-50/30 via-white to-white">
        <div className="flex items-start sm:items-center gap-4 mb-6">
          <div className="bg-rose-100 p-3 rounded-2xl flex-shrink-0"><AlertCircle className="w-8 h-8 text-rose-500" /></div>
          <div>
            <h2 className="text-2xl font-bold text-slate-800">出 Post 求救</h2>
            <p className="text-slate-500 text-sm mt-1">配對唔到心水？將你嘅要求、Budget、指定場地列出嚟，等全港 Vendor 主動搵你報價！</p>
          </div>
        </div>
        <form onSubmit={handleJobSubmit} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">需要咩服務？</label>
              <select className="w-full p-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-rose-300 outline-none bg-white" value={newJobForm.serviceNeeded} onChange={e => setNewJobForm({...newJobForm, serviceNeeded: e.target.value})}>
                 {Object.values(TASK_CATEGORIES).map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">大約預算 Budget</label>
              <input type="text" required placeholder="例如: $15,000 - $20,000" className="w-full p-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-rose-300 outline-none" value={newJobForm.budget} onChange={e => setNewJobForm({...newJobForm, budget: e.target.value})} />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-bold text-slate-700 mb-1">詳細要求</label>
              <textarea rows="4" required placeholder="講多少少你嘅期望、風格、特別要求..." className="w-full p-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-rose-300 outline-none resize-none" value={newJobForm.details} onChange={e => setNewJobForm({...newJobForm, details: e.target.value})}></textarea>
            </div>
          </div>
          <button type="submit" className="w-full bg-rose-600 text-white font-bold py-3.5 rounded-xl hover:bg-rose-700 transition-colors flex justify-center items-center gap-2 shadow-sm"><Send className="w-5 h-5" /> 立即發佈到「商戶大堂」</button>
        </form>
      </div>
      
      <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">我發佈過嘅求救記錄</h3>
      <div className="space-y-4">
         {jobRequests.map(job => (
             <div key={job.id} className="bg-white rounded-xl p-5 border border-slate-200 flex justify-between items-center hover:border-rose-200 transition-colors">
                 <div>
                    <h4 className="font-bold text-slate-800 text-lg flex items-center gap-2">{job.serviceNeeded}</h4>
                    <p className="text-sm text-slate-500 mt-1">預算: <span className="font-bold text-slate-700">{job.budget}</span></p>
                 </div>
                 <div className="text-right">
                    <div className="text-rose-600 font-bold mb-1">{job.proposalsCount} 個商戶已報價</div>
                    <button onClick={() => setViewingProposals(job.id)} className="text-sm font-bold bg-rose-50 text-rose-700 border border-rose-200 px-4 py-1.5 rounded-lg hover:bg-rose-100">查看報價單</button>
                 </div>
             </div>
         ))}
      </div>
    </div>
  );

  const renderVendorDashboard = () => (
    <div className="max-w-6xl mx-auto mt-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="bg-slate-900 rounded-2xl p-8 text-white mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-3"><Briefcase className="w-7 h-7 text-emerald-400" /> 商戶接單大堂 (Vendor Board)</h2>
          <p className="text-slate-400 mt-2 text-sm">瀏覽全港新人發佈的急切要求，主動發送報價單發掘潛在客源。</p>
        </div>
        <div className="bg-slate-800/80 backdrop-blur px-5 py-3 rounded-xl border border-slate-700">
           <div className="text-xs text-slate-400 mb-0.5">當前登入商戶：</div>
           <div className="font-bold text-emerald-400 text-lg">Visionary Capture</div>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {jobRequests.map((job) => {
          return (
            <div key={job.id} className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 hover:border-emerald-300 transition-all flex flex-col h-full">
              <div className="mb-4 mt-2">
                <h3 className="text-xl font-bold text-slate-800 mb-1">{job.serviceNeeded}</h3>
                <p className="text-sm text-slate-500 font-medium">客戶: {job.coupleName} • 發佈於 {job.postedAt}</p>
              </div>
              <div className="space-y-3 mb-6 flex-grow bg-slate-50 p-4 rounded-xl border border-slate-100">
                <div className="flex items-center justify-between text-sm"><span className="text-slate-500 flex items-center gap-1.5"><Calendar className="w-4 h-4" /> 婚期</span><strong className="text-slate-800">{job.weddingDate}</strong></div>
                <div className="flex items-center justify-between text-sm"><span className="text-slate-500 flex items-center gap-1.5"><DollarSign className="w-4 h-4" /> 預算</span><strong className="text-rose-600">{job.budget}</strong></div>
                <div className="text-sm text-slate-700 mt-3 pt-3 border-t border-slate-200 leading-relaxed"><span className="text-slate-400 block mb-1 text-xs">詳細要求：</span>"{job.details}"</div>
              </div>
              <button onClick={() => submitProposal(job.id)} className="w-full bg-emerald-600 text-white font-bold py-3 rounded-xl hover:bg-emerald-700 transition-colors flex justify-center items-center gap-2 shadow-sm"><MessageSquare className="w-5 h-5" /> 立即發送報價單</button>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderVendorProfileEdit = () => (
    <div className="max-w-4xl mx-auto mt-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="bg-emerald-900 p-8 text-white">
          <h2 className="text-2xl font-bold flex items-center gap-3"><Briefcase className="w-7 h-7 text-emerald-400" /> 商戶專頁管理 (Profile Builder)</h2>
          <p className="text-emerald-100 mt-2 text-sm">完善你的專頁資料及上載最新作品。</p>
        </div>
        <div className="p-8 space-y-8">
          <div>
            <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2"><Info className="w-5 h-5 text-emerald-600"/> 基本資料</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div><label className="block text-sm font-bold text-slate-700 mb-1">商戶名稱</label><input type="text" className="w-full p-3 rounded-xl border border-slate-300 bg-slate-50" value={vendors[0].name} readOnly /></div>
              <div><label className="block text-sm font-bold text-slate-700 mb-1">參考起步價</label><input type="text" className="w-full p-3 rounded-xl border border-slate-300 bg-slate-50" value={vendors[0].price} readOnly /></div>
              <div className="md:col-span-2"><label className="block text-sm font-bold text-slate-700 mb-1">商戶簡介</label><textarea rows="3" className="w-full p-3 rounded-xl border border-slate-300 bg-slate-50 resize-none" value={vendors[0].description} readOnly></textarea></div>
            </div>
          </div>
          <button className="w-full bg-emerald-600 text-white font-bold py-3.5 rounded-xl hover:bg-emerald-700 transition-colors shadow-sm">儲存專頁設定</button>
        </div>
      </div>
    </div>
  );

  const renderReceptionScanner = () => (
    <div className="max-w-md mx-auto mt-10 animate-in fade-in duration-300">
      <div className="bg-slate-900 rounded-3xl p-6 text-center text-white shadow-2xl relative overflow-hidden">
        <div className="relative z-10">
          <ScanLine className="w-12 h-12 text-indigo-400 mx-auto mb-4" />
          <h2 className="text-2xl font-black mb-2">接待處掃描系統</h2>
          <div className="aspect-square bg-black rounded-2xl border-2 border-indigo-500/50 relative overflow-hidden mb-8 mt-6">
            <div className="absolute top-0 left-0 w-full h-1 bg-indigo-500 shadow-[0_0_15px_#6366f1] animate-[scan_2s_ease-in-out_infinite]"></div>
            <div className="w-full h-full flex items-center justify-center text-slate-500"><span className="text-sm">請對準QR Code...</span></div>
          </div>
          <button onClick={simulateScanQrCode} className="w-full bg-indigo-500 text-white font-black py-4 rounded-xl hover:bg-indigo-600 tracking-wider">[模擬] 掃描</button>
        </div>
      </div>
    </div>
  );

  const renderProposalsModal = () => {
    if (!viewingProposals) return null;
    return (
      <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
        <div className="bg-white rounded-2xl p-6 max-w-2xl w-full shadow-xl max-h-[85vh] flex flex-col relative">
          <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-4">
            <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2"><MessageSquare className="w-5 h-5 text-rose-500" />商戶報價單</h3>
            <button onClick={() => setViewingProposals(null)} className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"><X className="w-6 h-6" /></button>
          </div>
          <div className="overflow-y-auto custom-scrollbar pr-2 flex-grow">
            {proposalsData[viewingProposals] && proposalsData[viewingProposals].length > 0 ? (
              proposalsData[viewingProposals].map(p => (
                <div key={p.id} className="mb-4 p-5 border border-slate-200 rounded-xl bg-slate-50">
                  <div className="flex justify-between items-start mb-2"><div className="font-bold text-slate-800 text-lg">{p.vendorName}</div><div className="font-bold text-rose-600 text-lg">{p.price}</div></div>
                  <div className="flex items-center gap-1 text-sm text-slate-500 mb-3"><Star className="w-4 h-4 text-amber-400 fill-amber-400" /> <span className="font-medium">{p.rating}</span> • {p.date}</div>
                  <p className="text-sm text-slate-700 leading-relaxed bg-white p-3 rounded-lg border border-slate-100">"{p.message}"</p>
                </div>
              ))
            ) : (
              <div className="text-center text-slate-500 py-10">暫時未有商戶發送報價，請耐心等候。</div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderInviteModal = () => {
    if (!showInviteModal) return null;
    return (
      <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
         <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2"><Mail className="w-5 h-5 text-indigo-500"/> 邀請兄弟姊妹加入</h3>
            <form onSubmit={handleInvite} className="space-y-4">
               <div><input type="text" required placeholder="稱呼 (例如: 伴郎 Kevin)" className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:border-indigo-500" value={inviteForm.name} onChange={e => setInviteForm({...inviteForm, name: e.target.value})} /></div>
               <div><input type="email" required placeholder="Email 電郵地址" className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:border-indigo-500" value={inviteForm.email} onChange={e => setInviteForm({...inviteForm, email: e.target.value})} /></div>
               <div className="flex gap-2 mt-6">
                  <button type="button" onClick={() => setShowInviteModal(false)} className="flex-1 py-2 text-slate-600 bg-slate-100 rounded-lg font-bold hover:bg-slate-200">取消</button>
                  <button type="submit" className="flex-1 py-2 text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg font-bold">發送邀請</button>
               </div>
            </form>
         </div>
      </div>
    );
  };

  const renderVendorModal = () => {
    if (!viewingVendorProfile) return null;
    const vendor = viewingVendorProfile;
    return (
      <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
        <div className="bg-white rounded-3xl max-w-4xl w-full shadow-2xl max-h-[90vh] flex flex-col overflow-hidden relative">
          <button onClick={() => setViewingVendorProfile(null)} className="absolute top-4 right-4 z-10 bg-black/40 text-white p-2 rounded-full hover:bg-black/60 transition-colors"><X className="w-5 h-5" /></button>
          <div className="overflow-y-auto custom-scrollbar flex-grow">
            <div className="h-64 md:h-80 w-full bg-slate-200 relative">
              {vendor.portfolio && vendor.portfolio[0] && <img src={vendor.portfolio[0]} alt="cover" className="w-full h-full object-cover" />}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"></div>
              <div className="absolute bottom-0 left-0 p-8 w-full">
                 <div className="flex flex-wrap gap-2 mb-3">{vendor.tags.map(tag => <span key={tag} className="bg-white/20 backdrop-blur-md text-white text-xs font-bold px-3 py-1 rounded-full border border-white/30">{tag}</span>)}</div>
                 <h2 className="text-3xl md:text-4xl font-black text-white drop-shadow-md">{vendor.name}</h2>
              </div>
            </div>
            <div className="p-8">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8 bg-slate-50 p-6 rounded-2xl border border-slate-100">
                 <div className="flex-1"><p className="text-slate-600 leading-relaxed text-sm md:text-base">{vendor.description}</p></div>
                 <div className="text-left md:text-right flex-shrink-0">
                   <div className="text-sm text-slate-500 font-bold mb-1">參考起步價</div>
                   <div className="text-3xl font-black text-rose-600 mb-2">{vendor.price}</div>
                   <div className="flex items-center gap-1.5 md:justify-end text-slate-600 font-bold"><Star className="w-5 h-5 fill-amber-400 text-amber-400" /> {vendor.rating} / 5.0</div>
                 </div>
              </div>
              <h3 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2"><ImageIcon className="w-6 h-6 text-rose-500"/> 作品集展示 (Portfolio)</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {vendor.portfolio && vendor.portfolio.map((img, index) => (
                  <div key={index} className="aspect-square rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow cursor-pointer">
                    <img src={img} alt={`portfolio-${index}`} className="w-full h-full object-cover hover:scale-110 transition-transform duration-500" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderQrCodeModal = () => {
    if (!viewingQrCode) return null;
    
    const hostUrl = typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.host}${window.location.pathname}` : '';
    const shareUrl = `${hostUrl}?o=${user?.uid}&e=${currentEvent?.id}&g=${viewingQrCode?.guestId}`;
    const qrCodeImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(shareUrl)}&color=312e81`;
    
    return (
      <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
        <div className="bg-white rounded-[2rem] p-8 max-w-sm w-full text-center relative shadow-2xl">
          <button onClick={() => setViewingQrCode(null)} className="absolute top-4 right-4 bg-slate-100 rounded-full p-1"><X className="w-5 h-5" /></button>
          <h3 className="text-rose-600 font-black tracking-widest text-sm mb-1">ELECTRONIC INVITATION</h3>
          <h2 className="text-2xl font-bold text-slate-800">{currentEvent?.name}</h2>
          <div className="bg-indigo-50 p-6 rounded-3xl border-2 border-indigo-100 my-6 inline-block"><img src={qrCodeImgUrl} className="w-48 h-48 mx-auto rounded-xl" alt="qr" /></div>
          <p className="text-slate-500 mb-3">親愛的 <strong>{viewingQrCode?.name}</strong>，憑此 QR Code 入場。</p>
          <p className="text-[10px] text-slate-400 break-all mb-6 bg-slate-50 p-2 rounded">{shareUrl}</p>
          <button onClick={() => { navigator.clipboard.writeText(shareUrl); showToast('✅ 網址已複製！'); }} className="w-full bg-indigo-500 text-white font-bold py-3 rounded-xl hover:bg-indigo-600 shadow-sm flex items-center justify-center gap-2">複製專屬連結 (WhatsApp 發送)</button>
        </div>
      </div>
    );
  };

  const renderUpgradeModal = () => {
    if (!showUpgradeModal) return null;
    return (
      <div className="fixed inset-0 bg-slate-900/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
        <div className="bg-white rounded-[2rem] p-8 max-w-md w-full shadow-2xl relative text-center">
          <button onClick={() => setShowUpgradeModal(false)} className="absolute top-4 right-4 bg-slate-100 rounded-full p-1"><X className="w-5 h-5" /></button>
          <Crown className="w-16 h-16 text-amber-400 mx-auto mb-4" />
          <h2 className="text-2xl font-black text-slate-800 mb-2">升級至 Premium</h2>
          <p className="text-slate-500 text-sm mb-6">解鎖無限相片上載、高清影片支援及永久保存。</p>
          <button onClick={upgradeToPremium} className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-xl hover:bg-slate-800 shadow-lg">立即付款 $499 解鎖</button>
        </div>
      </div>
    );
  };

  const renderPaymentModal = () => {
    if (!showPaymentModal) return null;
    return (
      <div className="fixed inset-0 bg-slate-900/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
        <div className="bg-white rounded-[2rem] p-8 max-w-sm w-full shadow-2xl relative text-center">
          <button onClick={() => setShowPaymentModal(false)} className="absolute top-4 right-4 bg-slate-100 rounded-full p-1"><X className="w-5 h-5" /></button>
          <div className="bg-rose-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"><CreditCard className="w-8 h-8 text-rose-500"/></div>
          <h2 className="text-2xl font-black text-slate-800 mb-1">電子人情</h2>
          <p className="text-slate-500 text-sm mb-6">請使用 FPS 或 PayMe 掃描下方 QR Code 轉帳。</p>
          <div className="grid grid-cols-3 gap-2 mb-4">
             <button onClick={() => handleGiveRedPacket(800)} className="bg-slate-50 border border-slate-200 py-2 rounded-lg font-bold text-slate-700 hover:bg-rose-50 hover:border-rose-300">$800</button>
             <button onClick={() => handleGiveRedPacket(1000)} className="bg-slate-50 border border-slate-200 py-2 rounded-lg font-bold text-slate-700 hover:bg-rose-50 hover:border-rose-300">$1000</button>
             <button onClick={() => handleGiveRedPacket(1500)} className="bg-slate-50 border border-slate-200 py-2 rounded-lg font-bold text-slate-700 hover:bg-rose-50 hover:border-rose-300">$1500</button>
          </div>
        </div>
      </div>
    );
  };

  const renderScanResultModal = () => {
    if (!scanResult) return null;
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl">
           <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-white -mt-16"><CheckCircle2 className="w-10 h-10 text-green-500" /></div>
           <h3 className="text-2xl font-black text-slate-800 mb-6">報到成功！</h3>
           <div className="bg-slate-50 rounded-xl p-5 border border-slate-100 text-left space-y-3">
              <div className="flex justify-between items-center"><span className="text-slate-500 font-bold">嘉賓姓名</span><span className="text-xl font-black">{scanResult.name}</span></div>
              <div className="flex justify-between items-center"><span className="text-slate-500 font-bold">安排座位</span><span className="text-2xl font-black text-indigo-600 bg-indigo-50 px-3 py-1 rounded-lg border border-indigo-100">{scanResult.tableNumber}</span></div>
           </div>
        </div>
      </div>
    );
  };

  const renderFullscreenSlideshow = () => {
    if (!isFullscreen || photos.length === 0) return null;
    const currentPhoto = photos[currentSlideIndex];
    return (
      <div className="fixed inset-0 bg-black z-50 flex items-center justify-center">
        <button onClick={() => setIsFullscreen(false)} className="absolute top-6 right-6 text-white/50 hover:text-white bg-black/20 p-3 rounded-full z-20"><X className="w-8 h-8" /></button>
        <div className="absolute bottom-8 right-8 z-20 bg-black/60 backdrop-blur px-5 py-3 rounded-2xl text-right"><p className="text-white/70 text-sm mb-1">Photo by</p><p className="text-white font-black text-2xl">{currentPhoto.uploaderName}</p></div>
        <div className="relative w-full h-full flex items-center justify-center p-12">
          <div className="absolute inset-0 opacity-30"><img key={`bg-${currentSlideIndex}`} src={currentPhoto.url} className="w-full h-full object-cover blur-2xl" alt="blur-bg" /></div>
          <img key={`main-${currentSlideIndex}`} src={currentPhoto.url} alt="slideshow" className="max-w-full max-h-full object-contain relative z-10 shadow-2xl rounded-lg animate-in fade-in zoom-in-95 duration-700" />
        </div>
      </div>
    );
  };


  // ==========================================
  // Global Layout Structure
  // ==========================================
  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-10">
      {toast && <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-[100] bg-slate-900 text-white px-6 py-3 rounded-full shadow-2xl font-bold animate-in fade-in slide-in-from-top-4">{toast}</div>}

      {/* 開發者模式：模擬角色切換按鈕 */}
      {renderRoleSimulator()}

      {/* Guest Mode (Only shows Guest Portal) */}
      {isGuestMode ? (
        renderPersonalGuestPortal()
      ) : (
        <>
          {currentEvent && (
            <header className="bg-white shadow-sm sticky top-0 z-40 border-b border-slate-200">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between items-center py-4">
                   <h1 className="text-xl font-black text-slate-800 flex items-center gap-2 cursor-pointer" onClick={() => setCurrentView('events-dashboard')}>
                     <Heart className="w-6 h-6 fill-rose-500 text-rose-500" /> 囍程
                     <span className="text-xs font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded ml-2">主控台</span>
                   </h1>
                   <div className="flex items-center gap-4">
                     <div className="text-sm font-bold text-slate-800 bg-rose-50 px-3 py-1 rounded-lg border border-rose-100">{currentEvent.name}</div>
                     <button onClick={handleLogout} className="text-slate-400 hover:text-slate-600"><LogOut className="w-5 h-5"/></button>
                   </div>
                </div>
                {/* CORRECTED TOP TAB ORDER WITH ALL TABS */}
                <div className="flex space-x-1 overflow-x-auto custom-scrollbar">
                  {userRole === 'owner' && (
                    <>
                      <button onClick={() => setCurrentView('couple-checklist')} className={`px-4 py-3 text-sm font-bold border-b-[3px] whitespace-nowrap ${currentView === 'couple-checklist' ? 'border-rose-500 text-rose-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>📋 籌備清單</button>
                      <button onClick={() => setCurrentView('couple-budget')} className={`px-4 py-3 text-sm font-bold border-b-[3px] whitespace-nowrap ${currentView === 'couple-budget' ? 'border-rose-500 text-rose-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>💰 預算管理</button>
                      <button onClick={() => setCurrentView('discover-vendors')} className={`px-4 py-3 text-sm font-bold border-b-[3px] whitespace-nowrap ${currentView === 'discover-vendors' ? 'border-rose-500 text-rose-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>🔍 商戶指南</button>
                      <div className="w-px h-5 bg-slate-300 my-auto mx-2 hidden sm:block"></div>
                      <button onClick={() => setCurrentView('couple-jobboard')} className={`px-4 py-3 text-sm font-bold border-b-[3px] whitespace-nowrap flex items-center gap-1 ${currentView === 'couple-jobboard' ? 'border-rose-500 text-rose-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>🆘 出Post求救 <span className="bg-rose-100 text-rose-600 text-[10px] px-1.5 py-0.5 rounded-full">搵Vendor</span></button>
                      <button onClick={() => setCurrentView('couple-guests')} className={`px-4 py-3 text-sm font-bold border-b-[3px] whitespace-nowrap ${currentView === 'couple-guests' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>🎟️ 嘉賓與座位</button>
                      <button onClick={() => setCurrentView('photo-drop')} className={`px-4 py-3 text-sm font-bold border-b-[3px] whitespace-nowrap flex items-center gap-1 ${currentView === 'photo-drop' ? 'border-rose-500 text-rose-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}><Camera className="w-4 h-4"/> 互動相片牆 {isPremium && <Crown className="w-3 h-3 text-amber-500"/>}</button>
                    </>
                  )}
                  {userRole === 'reception' && (
                    <>
                      <button onClick={() => setCurrentView('reception-scanner')} className={`px-4 py-3 text-sm font-bold border-b-[3px] whitespace-nowrap ${currentView === 'reception-scanner' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-slate-500'}`}>📷 掃描 QR Code</button>
                      <button onClick={() => setCurrentView('couple-guests')} className={`px-4 py-3 text-sm font-bold border-b-[3px] whitespace-nowrap ${currentView === 'couple-guests' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-slate-500'}`}>📋 查閱名單</button>
                    </>
                  )}
                  {userRole === 'vendor' && (
                    <>
                      <button onClick={() => setCurrentView('vendor-dashboard')} className={`px-4 py-3 text-sm font-bold border-b-[3px] whitespace-nowrap ${currentView === 'vendor-dashboard' ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-slate-500'}`}>💼 接單大堂</button>
                      <button onClick={() => setCurrentView('vendor-profile')} className={`px-4 py-3 text-sm font-bold border-b-[3px] whitespace-nowrap ${currentView === 'vendor-profile' ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-slate-500'}`}>👤 管理專頁</button>
                    </>
                  )}
                </div>
              </div>
            </header>
          )}

          <main className="max-w-7xl mx-auto px-4">
            {!currentEvent && currentView === 'events-dashboard' && renderEventsDashboard()}
            
            {/* Owner Views */}
            {userRole === 'owner' && currentEvent && currentView === 'couple-checklist' && renderCoupleChecklist()}
            {userRole === 'owner' && currentEvent && currentView === 'couple-budget' && renderCoupleBudget()}
            {userRole === 'owner' && currentEvent && currentView === 'discover-vendors' && renderDiscoverDirectory()}
            {userRole === 'owner' && currentEvent && currentView === 'couple-guests' && renderGuestList()}
            {userRole === 'owner' && currentEvent && currentView === 'photo-drop' && renderPhotoDrop()}
            {userRole === 'owner' && currentEvent && currentView === 'couple-jobboard' && renderCoupleJobBoard()}
            
            {/* Reception Views */}
            {userRole === 'reception' && currentEvent && currentView === 'couple-guests' && renderGuestList()}
            {userRole === 'reception' && currentEvent && currentView === 'reception-scanner' && renderReceptionScanner()}
            
            {/* Vendor Views */}
            {userRole === 'vendor' && currentView === 'vendor-dashboard' && renderVendorDashboard()}
            {userRole === 'vendor' && currentView === 'vendor-profile' && renderVendorProfileEdit()}
            
            {/* Guest Portal View */}
            {userRole === 'guest_portal' && currentEvent && currentView === 'guest-portal' && renderPersonalGuestPortal()}
          </main>
        </>
      )}

      {renderUpgradeModal()}
      {renderPaymentModal()}
      {renderQrCodeModal()}
      {renderVendorModal()}
      {renderFullscreenSlideshow()}
      {renderProposalsModal()}
      {renderScanResultModal()}
      {renderInviteModal()}

      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
      `}} />
    </div>
  );
}