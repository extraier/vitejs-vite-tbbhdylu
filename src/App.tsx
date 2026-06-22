import React, { useState, useEffect, useMemo } from 'react';
import { 
  CheckCircle2, Circle, MapPin, Heart, ArrowRight, 
  Briefcase, Send, Calendar, DollarSign, AlertCircle, 
  Trash2, Plus, Clock, ArrowUpDown, Search, UserPlus, 
  Users, MessageSquare, Mail, Wallet, Star, PieChart, X,
  Image as ImageIcon, Upload, LayoutGrid, Info, QrCode, 
  ScanLine, UserCheck, Camera, Monitor, Smartphone, Crown, CreditCard
} from 'lucide-react';

// --- Firebase Imports ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, addDoc, updateDoc, doc, deleteDoc } from 'firebase/firestore';

// --- Firebase Initialization (Follows Strict Rules) ---
const customFirebaseConfig = {
  apiKey: "AIzaSyA-HGRqFqNRp3t4xKjXgnjSZoqUoWZmEXs",
  authDomain: "savetheday-2377a.firebaseapp.com",
  projectId: "savetheday-2377a",
  storageBucket: "savetheday-2377a.firebasestorage.app",
  messagingSenderId: "1076306848030",
  appId: "1:1076306848030:web:067794edd31cb2cdb3410f",
  measurementId: "G-LH4S4CEBK1"
};

const firebaseConfig = typeof __firebase_config !== 'undefined' && Object.keys(JSON.parse(__firebase_config)).length > 0 ? JSON.parse(__firebase_config) : customFirebaseConfig;
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'savetheday-production';

// --- Constants ---
const TASK_CATEGORIES = {
  ceremony_venue: '證婚場地', banquet_venue: '出門及晚宴場地', deco: '場地佈置',
  lawyer: '證婚律師', photography: '婚禮攝影及錄影', mua: '新娘化妝師 (MUA)',
  other: '自訂項目'
};

const FREE_TIER_LIMIT_MB = 100;

export default function App() {
  // --- Global App States ---
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState('owner'); // 'owner', 'reception', 'guest_portal'
  const [currentView, setCurrentView] = useState('events-dashboard'); 
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState(null);
  
  // --- Multi-tenant Data States ---
  const [events, setEvents] = useState([]);
  const [currentEvent, setCurrentEvent] = useState(null);
  
  // --- Event Specific Data States ---
  const [tasks, setTasks] = useState([]);
  const [guests, setGuests] = useState([]);
  const [photos, setPhotos] = useState([]);
  
  // --- UI States ---
  const [searchQuery, setSearchQuery] = useState('');
  const [guestSearchQuery, setGuestSearchQuery] = useState('');
  const [activeGuestPortal, setActiveGuestPortal] = useState(null); // 正在模擬掃描嘅獨立賓客
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);

  // --- Forms ---
  const [newEventName, setNewEventName] = useState('');
  const [newTaskForm, setNewTaskForm] = useState({ categoryKey: 'other', customTitle: '', venue: '', dueDate: '2026-12-31', estimatedCost: '', taskType: 'vendor' });
  const [newGuestForm, setNewGuestForm] = useState({ name: '', group: '男家親戚', headCount: 1, tableNumber: '未分配' });

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // --- Firebase Auth & Setup ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Auth error:", error);
      }
    };
    initAuth();
    
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // --- Data Fetching (Scoped to User & Current Event) ---
  useEffect(() => {
    if (!user) return;
    
    // Fetch Events
    const eventsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'events');
    const unsubEvents = onSnapshot(eventsRef, (snapshot) => {
      setEvents(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => console.error(error));

    // Fetch Tasks
    const tasksRef = collection(db, 'artifacts', appId, 'users', user.uid, 'tasks');
    const unsubTasks = onSnapshot(tasksRef, (snapshot) => {
      setTasks(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => console.error(error));

    // Fetch Guests
    const guestsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'guests');
    const unsubGuests = onSnapshot(guestsRef, (snapshot) => {
      setGuests(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => console.error(error));

    // Fetch Photos
    const photosRef = collection(db, 'artifacts', appId, 'users', user.uid, 'photos');
    const unsubPhotos = onSnapshot(photosRef, (snapshot) => {
      setPhotos(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => console.error(error));

    return () => { unsubEvents(); unsubTasks(); unsubGuests(); unsubPhotos(); };
  }, [user]);

  // --- Derived Data (Filtered by currentEvent in memory as per rules) ---
  const eventTasks = useMemo(() => tasks.filter(t => t.eventId === currentEvent?.id), [tasks, currentEvent]);
  const eventGuests = useMemo(() => guests.filter(g => g.eventId === currentEvent?.id), [guests, currentEvent]);
  const eventPhotos = useMemo(() => photos.filter(p => p.eventId === currentEvent?.id).sort((a,b) => b.createdAt - a.createdAt), [photos, currentEvent]);

  // Budget Calcs
  const totalBudget = currentEvent?.budget || 350000;
  const totalSpent = eventTasks.reduce((sum, task) => sum + (task.isCompleted ? (task.actualCost || 0) : 0), 0);
  
  // Storage Calcs (Simulated 1MB per photo)
  const storageUsedMB = eventPhotos.length * 1.5; 
  const isPremium = currentEvent?.tier === 'premium';
  const isStorageFull = !isPremium && storageUsedMB >= FREE_TIER_LIMIT_MB;

  // --- Handlers (Firebase Mutations) ---
  const handleCreateEvent = async (e) => {
    e.preventDefault();
    if (!user || !newEventName) return;
    const newEvent = { name: newEventName, date: '2027-01-01', tier: 'free', budget: 350000, createdAt: Date.now() };
    const docRef = await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'events'), newEvent);
    setNewEventName('');
    showToast('🎉 婚禮專案建立成功！');
    
    // Auto-select and jump to checklist
    const created = { id: docRef.id, ...newEvent };
    setCurrentEvent(created);
    setCurrentView('couple-checklist');
  };

  const handleAddTask = async (e) => {
    e.preventDefault();
    if (!user || !currentEvent) return;
    const title = newTaskForm.categoryKey === 'other' ? newTaskForm.customTitle : TASK_CATEGORIES[newTaskForm.categoryKey];
    const newTask = {
      eventId: currentEvent.id, title, category: newTaskForm.categoryKey, isCompleted: false, venue: newTaskForm.venue,
      dueDate: newTaskForm.dueDate, estimatedCost: Number(newTaskForm.estimatedCost) || 0, actualCost: Number(newTaskForm.estimatedCost) || 0
    };
    await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'tasks'), newTask);
    setNewTaskForm({ categoryKey: 'other', customTitle: '', venue: '', dueDate: '2026-12-31', estimatedCost: '', taskType: 'vendor' });
    showToast('✅ 任務已新增');
  };

  const toggleTask = async (task, e) => {
    e.stopPropagation();
    if (!user || userRole !== 'owner') return;
    const taskRef = doc(db, 'artifacts', appId, 'users', user.uid, 'tasks', task.id);
    await updateDoc(taskRef, { isCompleted: !task.isCompleted });
  };

  const handleAddGuest = async (e) => {
    e.preventDefault();
    if (!user || !currentEvent || !newGuestForm.name) return;
    
    // 自動生成 User ID (Guest ID)
    const guestId = crypto.randomUUID().substring(0, 8).toUpperCase(); 
    
    const newGuest = {
      eventId: currentEvent.id, guestId: guestId, ...newGuestForm, hasAttended: false, hasGifted: false, giftAmount: 0
    };
    await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'guests'), newGuest);
    setNewGuestForm({ name: '', group: '男家親戚', headCount: 1, tableNumber: '未分配' });
    showToast('✅ 嘉賓已加入名單');
  };

  const handleSimulateGuestUpload = async () => {
    if (!user || !currentEvent || !activeGuestPortal) return;
    if (isStorageFull) {
      setShowUpgradeModal(true);
      return;
    }
    
    const newPhoto = {
      eventId: currentEvent.id,
      url: `https://images.unsplash.com/photo-1511285560929-80b456fea0bc?auto=format&fit=crop&w=600&q=80&random=${Date.now()}`,
      uploaderId: activeGuestPortal.guestId,
      uploaderName: activeGuestPortal.name,
      createdAt: Date.now()
    };
    await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'photos'), newPhoto);
    showToast('📸 相片已上載至大螢幕！');
  };

  const handleSimulateReceptionScan = async (guest) => {
    if (!user) return;
    const guestRef = doc(db, 'artifacts', appId, 'users', user.uid, 'guests', guest.id);
    await updateDoc(guestRef, { hasAttended: true });
    showToast(`✅ ${guest.name} 報到成功！`);
  };

  const handleGiveRedPacket = async (amount) => {
    if (!user || !activeGuestPortal) return;
    const guestRef = doc(db, 'artifacts', appId, 'users', user.uid, 'guests', activeGuestPortal.id);
    await updateDoc(guestRef, { hasGifted: true, giftAmount: amount });
    setShowPaymentModal(false);
    showToast(`🧧 成功發送 $${amount} 電子人情，感謝！`);
    // Update local active guest state for immediate UI feedback
    setActiveGuestPortal({...activeGuestPortal, hasGifted: true, giftAmount: amount});
  };

  const upgradeToPremium = async () => {
    if (!user || !currentEvent) return;
    const eventRef = doc(db, 'artifacts', appId, 'users', user.uid, 'events', currentEvent.id);
    await updateDoc(eventRef, { tier: 'premium' });
    setShowUpgradeModal(false);
    showToast('👑 已成功升級至 Premium！無限容量已開啟。');
  };


  // ==========================================
  // Render Components
  // ==========================================

  if (isLoading) return <div className="min-h-screen flex items-center justify-center text-slate-500">載入中...</div>;

  const renderRoleSimulator = () => (
    <div className="bg-slate-900 text-white text-sm py-2 px-4 flex flex-wrap justify-center items-center gap-4 z-50">
      <span className="font-bold flex items-center gap-1"><Users className="w-4 h-4 text-slate-400" /> 系統視角：</span>
      <button onClick={() => { setUserRole('owner'); activeGuestPortal ? setCurrentView('couple-guests') : null; setActiveGuestPortal(null); }} className={`px-3 py-1 rounded-full ${userRole === 'owner' ? 'bg-rose-500 font-bold' : 'bg-slate-800 hover:bg-slate-700'}`}>👩🏻‍❤️‍👨🏻 主理新人</button>
      <button onClick={() => { setUserRole('reception'); setActiveGuestPortal(null); setCurrentView('couple-guests'); }} className={`px-3 py-1 rounded-full ${userRole === 'reception' ? 'bg-indigo-500 font-bold' : 'bg-slate-800 hover:bg-slate-700'}`}>👯‍♀️ 兄弟姊妹(接待)</button>
      {activeGuestPortal && (
        <button className="px-3 py-1 rounded-full bg-pink-500 font-bold text-white shadow-md border-2 border-white/20 animate-pulse">
          📱 賓客專屬網頁 ({activeGuestPortal.name})
        </button>
      )}
    </div>
  );

  // 1. Events Landing Page (Multi-tenant)
  const renderEventsDashboard = () => (
    <div className="max-w-4xl mx-auto mt-12 p-4">
      <div className="text-center mb-12">
        <Heart className="w-16 h-16 text-rose-500 mx-auto mb-4 fill-rose-100" />
        <h1 className="text-4xl font-black text-slate-800 mb-2">WeddingMatch 總大堂</h1>
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

        <div className="bg-rose-50 p-6 rounded-2xl border-2 border-dashed border-rose-200 hover:border-rose-400 transition-all flex flex-col items-center justify-center text-center cursor-pointer min-h-[200px]" onClick={() => document.getElementById('newEventInput').focus()}>
          <form onSubmit={handleCreateEvent} className="w-full flex flex-col items-center">
            <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mb-3 shadow-sm"><Plus className="w-6 h-6 text-rose-500" /></div>
            <h3 className="text-lg font-bold text-slate-800 mb-2">建立新婚禮</h3>
            <input id="newEventInput" type="text" required placeholder="例如: Chantal & Fiance" className="w-full max-w-[200px] p-2 text-center border border-rose-200 rounded-lg outline-none focus:ring-2 focus:ring-rose-400 mb-3 bg-white" value={newEventName} onChange={e => setNewEventName(e.target.value)} />
            <button type="submit" className="bg-rose-500 text-white text-xs font-bold px-4 py-2 rounded-full hover:bg-rose-600">立即建立</button>
          </form>
        </div>
      </div>
    </div>
  );

  // 2. Guest Management (With Personal Portal Link)
  const renderGuestList = () => (
    <div className="max-w-6xl mx-auto mt-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2"><Users className="w-7 h-7 text-indigo-500" /> 嘉賓名單與座位表</h2>
          <p className="text-slate-500 text-sm mt-1">每個嘉賓都有專屬 ID 網頁，可用作報到及電子人情。</p>
        </div>
        <div className="flex gap-4">
           <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 text-center"><div className="text-xs text-slate-500 font-bold">總人數</div><div className="text-xl font-black text-slate-800">{eventGuests.reduce((sum, g) => sum + g.headCount, 0)}</div></div>
           <div className="bg-green-50 px-4 py-2 rounded-xl border border-green-200 text-center"><div className="text-xs text-green-600 font-bold">已報到</div><div className="text-xl font-black text-green-700">{eventGuests.filter(g => g.hasAttended).reduce((sum, g) => sum + g.headCount, 0)}</div></div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50">
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
                      <button onClick={() => { setActiveGuestPortal(guest); setUserRole('guest_portal'); setCurrentView('guest-portal'); }} className="text-xs bg-indigo-50 text-indigo-700 font-bold px-3 py-1.5 rounded-lg border border-indigo-200 hover:bg-indigo-100 transition-colors flex items-center justify-end gap-1 ml-auto">
                        <Smartphone className="w-3 h-3"/> 模擬專屬網頁
                      </button>
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
                <div><label className="block text-sm font-bold text-slate-700 mb-1">姓名 (家庭代表)</label><input type="text" required className="w-full p-2.5 rounded-lg border border-slate-300 outline-none" value={newGuestForm.name} onChange={e => setNewGuestForm({...newGuestForm, name: e.target.value})} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">群組</label>
                    <select className="w-full p-2.5 rounded-lg border border-slate-300 outline-none bg-white" value={newGuestForm.group} onChange={e => setNewGuestForm({...newGuestForm, group: e.target.value})}>
                      <option>男家親戚</option><option>女家朋友</option><option>VIP</option>
                    </select>
                  </div>
                  <div><label className="block text-sm font-bold text-slate-700 mb-1">人數</label><input type="number" min="1" required className="w-full p-2.5 rounded-lg border border-slate-300 outline-none" value={newGuestForm.headCount} onChange={e => setNewGuestForm({...newGuestForm, headCount: parseInt(e.target.value) || 1})} /></div>
                </div>
                <div><label className="block text-sm font-bold text-slate-700 mb-1">分配座位 (選填)</label><input type="text" placeholder="例如: Table 1" className="w-full p-2.5 rounded-lg border border-slate-300 outline-none" value={newGuestForm.tableNumber} onChange={e => setNewGuestForm({...newGuestForm, tableNumber: e.target.value})} /></div>
                <button type="submit" className="w-full bg-slate-900 text-white font-bold py-3 rounded-xl hover:bg-slate-800">新增至名單</button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // 3. Personalized Guest Portal (SaaS Feature)
  const renderPersonalGuestPortal = () => {
    if (!activeGuestPortal) return null;
    const guest = activeGuestPortal;
    
    return (
      <div className="max-w-md mx-auto mt-4 pb-12">
        <div className="bg-white rounded-[2rem] shadow-xl overflow-hidden border border-slate-200">
          {/* Header */}
          <div className="bg-slate-900 text-center text-white py-10 px-6 relative">
             <div className="absolute top-0 left-0 w-full h-full bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] opacity-30"></div>
             <Heart className="w-8 h-8 mx-auto mb-2 text-rose-500 fill-rose-500 relative z-10" />
             <h2 className="text-xl font-black tracking-widest mb-1 relative z-10">{currentEvent.name}</h2>
             <p className="text-white/60 text-xs font-mono relative z-10">2027.01.01</p>
          </div>

          <div className="p-6 -mt-6 relative z-20">
            {/* Welcome Card */}
            <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-6 text-center mb-6">
               <h3 className="text-sm text-slate-500 mb-1">親愛的嘉賓</h3>
               <h2 className="text-2xl font-black text-slate-800 mb-4">{guest.name}</h2>
               <div className="inline-block bg-indigo-50 border border-indigo-100 rounded-xl px-5 py-3">
                 <p className="text-xs text-indigo-500 font-bold mb-1">您的專屬座位</p>
                 <p className="text-3xl font-black text-indigo-700">{guest.tableNumber}</p>
               </div>
            </div>

            {/* Actions */}
            <div className="space-y-4">
               {/* 電子人情 */}
               <div className={`p-5 rounded-2xl border-2 transition-all ${guest.hasGifted ? 'bg-green-50 border-green-200' : 'bg-rose-50 border-rose-200'}`}>
                 <div className="flex justify-between items-center mb-2">
                   <h4 className="font-bold text-slate-800 flex items-center gap-2"><CreditCard className="w-5 h-5 text-rose-500"/> 電子人情 (Red Packet)</h4>
                   {guest.hasGifted && <span className="bg-green-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">已發送</span>}
                 </div>
                 {guest.hasGifted ? (
                   <p className="text-sm text-green-700 font-medium">感謝您的祝福！已紀錄禮金：${guest.giftAmount}</p>
                 ) : (
                   <>
                     <p className="text-xs text-slate-500 mb-3">支持環保及無現金，直接轉帳給新人。</p>
                     <button onClick={() => setShowPaymentModal(true)} className="w-full bg-rose-600 text-white font-bold py-2.5 rounded-xl hover:bg-rose-700 shadow-sm flex items-center justify-center gap-2">
                       <QrCode className="w-4 h-4"/> 使用 PayMe / FPS
                     </button>
                   </>
                 )}
               </div>

               {/* 上載相片 */}
               <div className="p-5 rounded-2xl border-2 border-slate-200 bg-slate-50">
                 <h4 className="font-bold text-slate-800 flex items-center gap-2 mb-2"><Camera className="w-5 h-5 text-slate-600"/> 現場相片分享</h4>
                 <p className="text-xs text-slate-500 mb-3">分享您剛才拍攝的美照，相片會即時投射至大螢幕！</p>
                 <button onClick={handleSimulateGuestUpload} disabled={isUploading} className="w-full bg-slate-900 text-white font-bold py-3 rounded-xl hover:bg-slate-800 shadow-sm flex items-center justify-center gap-2">
                   {isUploading ? <span className="animate-pulse">上載中...</span> : <><Upload className="w-4 h-4"/> 選擇相片上載</>}
                 </button>
               </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // 4. Photo Drop & Storage Quota
  const renderPhotoDrop = () => (
    <div className="max-w-6xl mx-auto mt-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2"><Camera className="w-7 h-7 text-rose-500" /> 互動相片牆 (Photo Drop)</h2>
          <p className="text-slate-500 text-sm mt-1">統一收集賓客相片。升級 Premium 解鎖無限儲存空間。</p>
        </div>
        <button onClick={() => setIsFullscreen(true)} className="bg-rose-600 text-white font-bold px-6 py-2 rounded-xl hover:bg-rose-700 shadow-md flex items-center gap-2"><Monitor className="w-4 h-4"/> 播放 Live Slideshow</button>
      </div>

      {/* Storage Quota Meter */}
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
                <p className="text-xs text-slate-500">{isPremium ? '無限上載空間，盡情收集回憶。' : '免費版可儲存約 60 張相片。'}</p>
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
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3"><span className="text-white text-xs font-bold truncate">{p.uploaderName}</span></div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // 5. Checklist View (Minimal for length, fully functional)
  const renderChecklist = () => (
    <div className="max-w-4xl mx-auto mt-8">
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-slate-800">我的任務清單</h2>
          <span className="text-sm font-bold text-rose-600 bg-rose-50 px-3 py-1 rounded-full">進度 {progressPercentage}%</span>
        </div>
        <div className="space-y-3 mb-6">
          {eventTasks.map(task => (
            <div key={task.id} className={`flex items-center p-3.5 rounded-xl border ${task.isCompleted ? 'bg-slate-50 opacity-75' : 'bg-white hover:border-rose-200'}`}>
              <button onClick={(e) => toggleTask(task, e)} className="mr-3"><CheckCircle2 className={`w-6 h-6 ${task.isCompleted ? 'text-green-500' : 'text-slate-300'}`} /></button>
              <div className="flex-grow font-bold text-slate-800">{task.title}</div>
              <div className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded border border-slate-200">${task.estimatedCost}</div>
            </div>
          ))}
          {eventTasks.length === 0 && <div className="text-center py-6 text-slate-400">目前沒有籌備任務，立即新增！</div>}
        </div>
        
        {/* Simple Add Form */}
        <form onSubmit={handleAddTask} className="flex gap-2">
          <select className="p-2.5 text-sm border border-slate-300 rounded-lg outline-none bg-white" value={newTaskForm.categoryKey} onChange={(e) => setNewTaskForm({...newTaskForm, categoryKey: e.target.value})}>
            <option value="other">其他</option><option value="deco">場地佈置</option><option value="photography">攝影</option>
          </select>
          <input type="text" placeholder="任務名稱..." required className="flex-grow p-2.5 text-sm border border-slate-300 rounded-lg outline-none" value={newTaskForm.customTitle} onChange={(e) => setNewTaskForm({...newTaskForm, customTitle: e.target.value})} />
          <input type="number" placeholder="預算 $" className="w-24 p-2.5 text-sm border border-slate-300 rounded-lg outline-none" value={newTaskForm.estimatedCost} onChange={(e) => setNewTaskForm({...newTaskForm, estimatedCost: e.target.value})} />
          <button type="submit" className="bg-slate-900 text-white font-bold px-4 rounded-lg">新增</button>
        </form>
      </div>
    </div>
  );


  // --- Modals Render ---
  const renderUpgradeModal = () => {
    if (!showUpgradeModal) return null;
    return (
      <div className="fixed inset-0 bg-slate-900/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
        <div className="bg-white rounded-[2rem] p-8 max-w-md w-full shadow-2xl relative text-center">
          <button onClick={() => setShowUpgradeModal(false)} className="absolute top-4 right-4 bg-slate-100 rounded-full p-1"><X className="w-5 h-5" /></button>
          <Crown className="w-16 h-16 text-amber-400 mx-auto mb-4" />
          <h2 className="text-2xl font-black text-slate-800 mb-2">升級至 Premium</h2>
          <p className="text-slate-500 text-sm mb-6">免費版 100MB 儲存空間已滿。升級即可解鎖無限相片上載、高清影片支援及永久保存。</p>
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-6 text-left">
             <div className="font-black text-amber-600 text-2xl mb-1">$499 <span className="text-sm font-medium">/ 婚禮專案</span></div>
             <ul className="text-sm text-slate-700 space-y-2 mt-3">
               <li className="flex items-center gap-2">✅ 無限相片雲端空間</li>
               <li className="flex items-center gap-2">✅ 去除浮水印 Slideshow</li>
               <li className="flex items-center gap-2">✅ 原圖一鍵打包下載</li>
             </ul>
          </div>
          <button onClick={upgradeToPremium} className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-xl hover:bg-slate-800 shadow-lg">立即付款解鎖</button>
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
          <p className="text-slate-500 text-sm mb-6">請使用 FPS 或 PayMe 掃描下方 QR Code 轉帳給新人。</p>
          <div className="bg-slate-100 p-4 rounded-2xl mb-6 inline-block">
            {/* Fake Payment QR Code */}
            <img src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=payme://&color=000000`} className="w-32 h-32 opacity-80" alt="pay" />
          </div>
          <div className="grid grid-cols-3 gap-2 mb-4">
             <button onClick={() => handleGiveRedPacket(800)} className="bg-slate-50 border border-slate-200 py-2 rounded-lg font-bold text-slate-700 hover:bg-rose-50 hover:border-rose-300">$800</button>
             <button onClick={() => handleGiveRedPacket(1000)} className="bg-slate-50 border border-slate-200 py-2 rounded-lg font-bold text-slate-700 hover:bg-rose-50 hover:border-rose-300">$1000</button>
             <button onClick={() => handleGiveRedPacket(1500)} className="bg-slate-50 border border-slate-200 py-2 rounded-lg font-bold text-slate-700 hover:bg-rose-50 hover:border-rose-300">$1500</button>
          </div>
        </div>
      </div>
    );
  };


  // ==========================================
  // Global Layout Structure
  // ==========================================
  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-10">
      {/* 頂部系統提示 (Toast) */}
      {toast && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-[100] bg-slate-900 text-white px-6 py-3 rounded-full shadow-2xl font-bold animate-in fade-in slide-in-from-top-4">
          {toast}
        </div>
      )}

      {renderRoleSimulator()}
      
      {/* 只有在選定 Event 且不是全螢幕/賓客介面時才顯示 Navigation */}
      {currentEvent && !isFullscreen && userRole !== 'guest_portal' && (
        <header className="bg-white shadow-sm sticky top-0 z-40 border-b border-slate-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-4">
               <h1 className="text-xl font-black text-slate-800 flex items-center gap-2 cursor-pointer" onClick={() => setCurrentView('events-dashboard')}>
                 <Heart className="w-6 h-6 fill-rose-500 text-rose-500" /> WeddingMatch
                 <span className="text-xs font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded ml-2">主控台</span>
               </h1>
               <div className="text-sm font-bold text-slate-800 bg-rose-50 px-3 py-1 rounded-lg border border-rose-100">{currentEvent.name}</div>
            </div>
            <div className="flex space-x-1 overflow-x-auto custom-scrollbar">
              <button onClick={() => setCurrentView('couple-checklist')} className={`px-4 py-3 text-sm font-bold border-b-[3px] whitespace-nowrap ${currentView === 'couple-checklist' ? 'border-rose-500 text-rose-600' : 'border-transparent text-slate-500'}`}>📋 籌備清單</button>
              <button onClick={() => setCurrentView('couple-guests')} className={`px-4 py-3 text-sm font-bold border-b-[3px] whitespace-nowrap ${currentView === 'couple-guests' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-slate-500'}`}>🎟️ 嘉賓與座位</button>
              <button onClick={() => setCurrentView('photo-drop')} className={`px-4 py-3 text-sm font-bold border-b-[3px] whitespace-nowrap flex items-center gap-1 ${currentView === 'photo-drop' ? 'border-rose-500 text-rose-600' : 'border-transparent text-slate-500'}`}>
                <Camera className="w-4 h-4"/> 互動相片牆 {isPremium && <Crown className="w-3 h-3 text-amber-500"/>}
              </button>
            </div>
          </div>
        </header>
      )}

      <main className="max-w-7xl mx-auto">
        {/* Landing Page (No Event Selected) */}
        {!currentEvent && currentView === 'events-dashboard' && renderEventsDashboard()}
        
        {/* Event Dashboard Views */}
        {currentEvent && userRole === 'owner' && currentView === 'couple-checklist' && renderChecklist()}
        {currentEvent && userRole === 'owner' && currentView === 'couple-guests' && renderGuestList()}
        {currentEvent && userRole === 'owner' && currentView === 'photo-drop' && renderPhotoDrop()}
        
        {/* Guest Portal View (Simulated Mobile) */}
        {currentEvent && userRole === 'guest_portal' && renderPersonalGuestPortal()}
      </main>

      {renderUpgradeModal()}
      {renderPaymentModal()}

      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
      `}} />
    </div>
  );
}