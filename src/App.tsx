import React, { useState, useEffect, useMemo } from 'react';
import { 
  CheckCircle2, Circle, MapPin, Heart, ArrowRight, 
  Briefcase, Send, Calendar, DollarSign, AlertCircle, 
  Trash2, Plus, Clock, ArrowUpDown, Search, UserPlus, 
  Users, MessageSquare, Mail, Wallet, Star, PieChart, X,
  Image as ImageIcon, Upload, LayoutGrid, Info, QrCode, 
  ScanLine, UserCheck, Camera, Monitor, Smartphone
} from 'lucide-react';

// --- 分類與 Mock Data ---
const TASK_CATEGORIES = {
  ceremony_venue: '證婚場地', banquet_venue: '出門及晚宴場地', deco: '場地佈置',
  lawyer: '證婚律師', photography: '婚禮攝影及錄影', mua: '新娘化妝師 (MUA)',
  bridesmaid_mua: '姊妹化妝', mc: '婚禮司儀 (MC)', chaperone: '大妗姐', planner: '婚禮統籌',
  rings: '結婚戒指', wedding_dress: '婚紗及晚裝', groom_suit: '男裝禮服',
  bridal_party_attire: '姊妹裙及兄弟衫', parents_attire: '四大長老服飾',
  rituals: '過大禮物資', photobooth: 'Photo booth', gifts: '回禮禮物',
  transport: '花車及旅遊巴', invitation: '喜帖', honeymoon: '蜜月旅行', other: '自訂項目'
};

const INITIAL_TASKS = [
  { id: 1, title: '證婚律師', category: 'lawyer', isCompleted: true, actualCost: 3500, dueDate: '2026-06-01', taskType: 'vendor' },
  { id: 2, title: '證婚場地', category: 'ceremony_venue', isCompleted: true, actualCost: 6800, venue: '伯大尼小教堂', dueDate: '2026-05-15', taskType: 'vendor' },
  { id: 3, title: '場地佈置', category: 'deco', isCompleted: false, venue: '伯大尼小教堂', estimatedCost: 8000, dueDate: '2026-10-01', taskType: 'vendor' },
  { id: 4, title: '出門及晚宴場地', category: 'banquet_venue', isCompleted: true, actualCost: 180000, venue: 'Ritz Carlton', dueDate: '2026-05-15', taskType: 'vendor' },
  { id: 5, title: '場地佈置', category: 'deco', isCompleted: false, venue: 'Ritz Carlton', estimatedCost: 25000, dueDate: '2026-09-01', taskType: 'vendor' },
  { id: 6, title: '結婚戒指', category: 'rings', isCompleted: true, actualCost: 25000, dueDate: '2026-08-01', taskType: 'vendor' },
  { id: 7, title: '新娘化妝師 (MUA)', category: 'mua', isCompleted: true, actualCost: 9800, dueDate: '2026-07-15', taskType: 'vendor' },
  { id: 8, title: '婚禮攝影及錄影', category: 'photography', isCompleted: false, estimatedCost: 18000, dueDate: '2026-07-30', taskType: 'vendor' },
  { id: 9, title: '婚禮司儀 (MC)', category: 'mc', isCompleted: true, actualCost: 5000, dueDate: '2026-08-15', taskType: 'vendor' },
  { id: 10, title: '婚紗及晚裝', category: 'wedding_dress', isCompleted: false, estimatedCost: 12000, dueDate: '2026-09-15', taskType: 'vendor' },
  { id: 11, title: '過大禮物資', category: 'rituals', isCompleted: true, actualCost: 6800, dueDate: '2026-11-01', taskType: 'vendor' },
  { id: 12, title: '大妗姐', category: 'chaperone', isCompleted: true, actualCost: 3000, dueDate: '2026-11-01', taskType: 'vendor' },
  { id: 13, title: 'Photo booth', category: 'photobooth', isCompleted: false, estimatedCost: 4500, dueDate: '2026-10-15', taskType: 'vendor' },
  { id: 14, title: '姊妹化妝', category: 'bridesmaid_mua', isCompleted: false, estimatedCost: 6000, dueDate: '2026-10-15', taskType: 'vendor' },
  { id: 15, title: '姊妹裙及兄弟衫', category: 'bridal_party_attire', isCompleted: false, estimatedCost: 4000, dueDate: '2026-10-30', taskType: 'vendor' },
  { id: 16, title: '四大長老服飾', category: 'parents_attire', isCompleted: false, estimatedCost: 8000, dueDate: '2026-10-30', taskType: 'vendor' },
  { id: 17, title: '回禮禮物', category: 'gifts', isCompleted: true, actualCost: 3500, dueDate: '2026-12-01', taskType: 'vendor' },
];

const INITIAL_VENDORS = [
  { id: 101, name: 'Visionary Capture', category: 'photography', rating: 4.9, price: '$18,000+', tags: ['伯大尼', 'Ritz Carlton', '紀實唯美'], description: '超過10年頂級酒店及教堂拍攝經驗。', portfolio: ['https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=400&q=80', 'https://images.unsplash.com/photo-1606800052052-a08af7148866?auto=format&fit=crop&w=400&q=80', 'https://images.unsplash.com/photo-1511285560929-80b456fea0bc?auto=format&fit=crop&w=400&q=80'] },
  { id: 102, name: 'Light & Shadow Studio', category: 'photography', rating: 4.7, price: '$15,000+', tags: ['伯大尼'], description: '自然唯美風格，專注海外及本地特色教堂拍攝。', portfolio: ['https://images.unsplash.com/photo-1537368910025-700350fe46c7?auto=format&fit=crop&w=400&q=80'] },
  { id: 103, name: 'FairyTale Floral', category: 'deco', rating: 4.8, price: '$25,000+', tags: ['Ritz Carlton', '奢華花藝'], description: '專為五星級酒店設計的頂尖佈置團隊。', portfolio: ['https://images.unsplash.com/photo-1469334031218-e382a71b716b?auto=format&fit=crop&w=400&q=80'] },
  { id: 104, name: 'Bethanie Charm Deco', category: 'deco', rating: 4.6, price: '$8,000+', tags: ['伯大尼', '小清新'], description: '專為伯大尼教堂設計的佈置套餐。', portfolio: ['https://images.unsplash.com/photo-1519225421980-715cb0215aed?auto=format&fit=crop&w=400&q=80'] }
];

const INITIAL_JOB_REQUESTS = [
  { id: 'job-1', coupleName: 'Chantal & Fiance', weddingDate: '2027年1月', serviceNeeded: '場地佈置', venues: ['Ritz Carlton'], budget: '$20,000 - $30,000', details: '需要做過Ritz Carlton嘅佈置，有特高樓底設計經驗優先。', status: 'open', proposalsCount: 2, postedAt: '2小時前' },
  { id: 'job-2', coupleName: 'Mandy & Kevin', weddingDate: '2026年11月', serviceNeeded: '婚禮攝影及錄影', venues: ['伯大尼小教堂'], budget: '$8,000 - $12,000', details: '需要半日伯大尼教堂行禮拍攝。必須要有伯大尼拍攝經驗。', status: 'open', proposalsCount: 5, postedAt: '1日前' }
];

const MOCK_PROPOSALS = {
  'job-1': [
    { id: 'p1', vendorName: 'FairyTale Floral', rating: 4.8, price: '$22,000', message: '我哋對 Ritz Carlton 嘅特高樓底非常有經驗，白綠色系小清新加香檳金絕對做到你要嘅效果，仲可以送一次免費 3D 模擬圖。', date: '1小時前' },
    { id: 'p2', vendorName: 'Elegance Wedding', rating: 4.6, price: '$28,500', message: '我哋上個月先喺 Ritz 做完類似風格，可以安排睇真實 Reference 相片。', date: '30分鐘前' }
  ],
  'job-2': [
    { id: 'p3', vendorName: 'Visionary Capture', rating: 4.9, price: '$9,800', message: '伯大尼半日拍攝係我哋熱門 Package，熟悉避開教堂限制嘅拍攝機位。', date: '2小時前' }
  ]
};

const INITIAL_GUESTS = [
  { id: 'g1', name: '陳大文 一家', group: '男家親戚', headCount: 4, tableNumber: 'Table 1', hasAttended: false, phone: '91234567' },
  { id: 'g2', name: '李小玲', group: '女家朋友', headCount: 1, tableNumber: 'Table 12', hasAttended: true, phone: '61234567' },
  { id: 'g3', name: '王司長', group: 'VIP / 工作伙伴', headCount: 2, tableNumber: 'Table 2', hasAttended: false, phone: '98765432' },
  { id: 'g4', name: '張偉明', group: '男家朋友', headCount: 1, tableNumber: '未分配', hasAttended: false, phone: '68765432' },
];

const INITIAL_PHOTOS = [
  { id: 1, url: 'https://images.unsplash.com/photo-1511285560929-80b456fea0bc?auto=format&fit=crop&w=600&q=80', uploader: '伴娘 Mandy', time: '10分鐘前' },
  { id: 2, url: 'https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=600&q=80', uploader: '表哥 Kenneth', time: '5分鐘前' },
  { id: 3, url: 'https://images.unsplash.com/photo-1469334031218-e382a71b716b?auto=format&fit=crop&w=600&q=80', uploader: '大學同學 Alice', time: '剛才' }
];

export default function App() {
  // --- Global States ---
  const [userRole, setUserRole] = useState('owner'); // 'owner', 'reception', 'vendor', 'guest'
  const [currentView, setCurrentView] = useState('couple-checklist'); 
  
  // --- Data States ---
  const [tasks, setTasks] = useState(INITIAL_TASKS);
  const [vendors] = useState(INITIAL_VENDORS);
  const [teamMembers, setTeamMembers] = useState([{ id: 'u1', name: '伴娘 Mandy', role: 'bridesmaid' }]);
  const [jobRequests, setJobRequests] = useState(INITIAL_JOB_REQUESTS);
  const [proposalsData, setProposalsData] = useState(MOCK_PROPOSALS);
  const [guests, setGuests] = useState(INITIAL_GUESTS);
  const [photos, setPhotos] = useState(INITIAL_PHOTOS);
  
  // --- UI & Form States ---
  const [searchQuery, setSearchQuery] = useState('');
  const [guestSearchQuery, setGuestSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('status');
  const [activeCategory, setActiveCategory] = useState(null);
  const [activeVenue, setActiveVenue] = useState(null);
  const [discoverFilter, setDiscoverFilter] = useState('all');
  const [editingDateId, setEditingDateId] = useState(null);
  
  const [newTaskForm, setNewTaskForm] = useState({ categoryKey: 'other', customTitle: '', venue: '', dueDate: '2026-12-31', estimatedCost: '', taskType: 'vendor', assignee: '' });
  const [newJobForm, setNewJobForm] = useState({ serviceNeeded: '場地佈置', venueInput: '', budget: '', details: '' });
  const [showJobSuccess, setShowJobSuccess] = useState(false);
  
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteForm, setInviteForm] = useState({ name: '', email: '' });

  // --- Modals ---
  const [viewingVendorProfile, setViewingVendorProfile] = useState(null);
  const [viewingQrCode, setViewingQrCode] = useState(null);
  const [scanResult, setScanResult] = useState(null);
  const [viewingProposals, setViewingProposals] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);

  const [totalBudget] = useState(350000);
  const [vendorProfileForm, setVendorProfileForm] = useState(INITIAL_VENDORS[0]);

  // --- Effects ---
  useEffect(() => {
    let interval;
    if (isFullscreen && photos.length > 0) {
      interval = setInterval(() => {
        setCurrentSlideIndex((prev) => (prev + 1) % photos.length);
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [isFullscreen, photos.length]);

  // --- Handlers ---
  const handleSimulateUpload = () => {
    setIsUploading(true);
    setTimeout(() => {
      setPhotos([{ id: Date.now(), url: 'https://images.unsplash.com/photo-1537368910025-700350fe46c7?auto=format&fit=crop&w=600&q=80', uploader: '你 (嘉賓)', time: '剛才' }, ...photos]);
      setIsUploading(false);
      alert('上載成功！相片會即時喺大螢幕播出！');
    }, 1500);
  };

  const handleAddTask = (e) => {
    e.preventDefault();
    if (newTaskForm.categoryKey === 'other' && !newTaskForm.customTitle) return;
    const title = newTaskForm.categoryKey === 'other' ? newTaskForm.customTitle : TASK_CATEGORIES[newTaskForm.categoryKey];
    const newTask = {
      id: Date.now(), title, category: newTaskForm.categoryKey, isCompleted: false, venue: newTaskForm.venue,
      dueDate: newTaskForm.dueDate || '2026-12-31', estimatedCost: Number(newTaskForm.estimatedCost) || 0,
      taskType: newTaskForm.taskType, assignee: newTaskForm.assignee
    };
    setTasks([...tasks, newTask]);
    setNewTaskForm({ categoryKey: 'other', customTitle: '', venue: '', dueDate: '2026-12-31', estimatedCost: '', taskType: 'vendor', assignee: '' });
  };

  const toggleTask = (taskId, e) => {
    e.stopPropagation();
    if (userRole === 'vendor') return;
    setTasks(tasks.map(t => t.id === taskId ? { ...t, isCompleted: !t.isCompleted } : t));
  };

  const selectTask = (task) => {
    if (!task.isCompleted && task.taskType === 'vendor') {
      setActiveCategory(task.category);
      setActiveVenue(task.venue || null);
    }
  };

  const updateDueDate = (taskId, newDate) => {
    setTasks(tasks.map(t => t.id === taskId ? { ...t, dueDate: newDate } : t));
    setEditingDateId(null);
  };

  const deleteTask = (taskId, e) => {
    e.stopPropagation();
    if (window.confirm('確定要刪除呢個任務？')) {
      setTasks(tasks.filter(t => t.id !== taskId));
      if (activeCategory === tasks.find(t => t.id === taskId)?.category) setActiveCategory(null);
    }
  };

  const simulateScanQrCode = () => {
    const unAttendedGuests = guests.filter(g => !g.hasAttended);
    if (unAttendedGuests.length === 0) return alert('所有嘉賓已成功報到！');
    const randomGuest = unAttendedGuests[Math.floor(Math.random() * unAttendedGuests.length)];
    setScanResult(randomGuest);
    setTimeout(() => {
      setGuests(guests.map(g => g.id === randomGuest.id ? { ...g, hasAttended: true } : g));
      setScanResult(null);
    }, 3000);
  };

  const handleJobSubmit = (e) => {
    e.preventDefault();
    if (!newJobForm.budget) return;
    const newJob = {
      id: `job-${Date.now()}`, coupleName: '主理新人', weddingDate: '2027年1月',
      serviceNeeded: newJobForm.serviceNeeded, venues: newJobForm.venueInput ? newJobForm.venueInput.split(',').map(v => v.trim()) : [],
      budget: newJobForm.budget, details: newJobForm.details, status: 'open', proposalsCount: 0, postedAt: '剛剛'
    };
    setJobRequests([newJob, ...jobRequests]);
    setNewJobForm({ serviceNeeded: '場地佈置', venueInput: '', budget: '', details: '' });
    setShowJobSuccess(true);
    setTimeout(() => setShowJobSuccess(false), 3000);
  };

  const submitProposal = (jobId) => {
    alert('✅ 報價已發送畀新人！');
    setJobRequests(jobRequests.map(j => j.id === jobId ? {...j, proposalsCount: j.proposalsCount + 1} : j));
    setProposalsData(prev => ({
      ...prev, [jobId]: [{ id: Date.now().toString(), vendorName: 'Visionary Capture', rating: 4.9, price: '待定', message: '商戶已發送初步報價，請聯絡商戶了解詳情。', date: '剛剛' }, ...(prev[jobId] || [])]
    }));
  };

  const handleInvite = (e) => {
    e.preventDefault();
    if (!inviteForm.name) return;
    const newMember = { id: `u${Date.now()}`, name: `${inviteForm.name} (邀請中)`, role: 'pending' };
    setTeamMembers([...teamMembers, newMember]);
    setShowInviteModal(false);
    setInviteForm({name: '', email: ''});
    alert(`✅ 邀請電郵已發送至 ${inviteForm.email || '該成員'}`);
  };

  // --- Memoized Data ---
  const displayTasks = useMemo(() => {
    let filtered = tasks;
    if (searchQuery) filtered = tasks.filter(t => t.title.toLowerCase().includes(searchQuery.toLowerCase()) || (t.venue && t.venue.toLowerCase().includes(searchQuery.toLowerCase())));
    return [...filtered].sort((a, b) => {
      if (sortBy === 'status') {
        if (a.isCompleted === b.isCompleted) return new Date(a.dueDate) - new Date(b.dueDate);
        return a.isCompleted ? 1 : -1;
      }
      if (sortBy === 'dueDate') return new Date(a.dueDate) - new Date(b.dueDate);
      if (sortBy === 'name') return a.title.localeCompare(b.title);
      return 0;
    });
  }, [tasks, searchQuery, sortBy]);

  const completedTasks = tasks.filter(t => t.isCompleted).length;
  const progressPercentage = Math.round((completedTasks / tasks.length) * 100) || 0;
  const totalSpent = tasks.reduce((sum, task) => sum + (task.isCompleted ? (task.actualCost || 0) : 0), 0);
  const remainingBudget = totalBudget - totalSpent;
  const budgetPercentage = Math.round((totalSpent / totalBudget) * 100);

  const displayGuests = useMemo(() => {
    if (!guestSearchQuery) return guests;
    return guests.filter(g => g.name.toLowerCase().includes(guestSearchQuery.toLowerCase()) || g.tableNumber.toLowerCase().includes(guestSearchQuery.toLowerCase()));
  }, [guests, guestSearchQuery]);

  const filteredVendors = useMemo(() => {
    if (!activeCategory) return [];
    let matched = vendors.filter(v => v.category === activeCategory);
    if (activeVenue) {
      matched.sort((a, b) => {
        const aHasVenue = a.tags.some(tag => activeVenue.includes(tag) || tag.includes(activeVenue));
        const bHasVenue = b.tags.some(tag => activeVenue.includes(tag) || tag.includes(activeVenue));
        return bHasVenue - aHasVenue;
      });
    }
    return matched;
  }, [activeCategory, activeVenue, vendors]);

  const discoverVendors = useMemo(() => {
    if (discoverFilter === 'all') return vendors;
    return vendors.filter(v => v.category === discoverFilter);
  }, [discoverFilter, vendors]);

  // ==========================================
  // Render Blocks
  // ==========================================
  const renderRoleSimulator = () => (
    <div className="bg-slate-900 text-white text-sm py-2 px-4 flex flex-wrap justify-center items-center gap-4 z-50">
      <span className="font-bold flex items-center gap-1"><Users className="w-4 h-4 text-slate-400" /> 系統視角：</span>
      <button onClick={() => { setUserRole('owner'); setCurrentView('couple-checklist'); setIsFullscreen(false); }} className={`px-3 py-1 rounded-full ${userRole === 'owner' ? 'bg-rose-500 font-bold' : 'bg-slate-800 hover:bg-slate-700'}`}>👩🏻‍❤️‍👨🏻 主理新人</button>
      <button onClick={() => { setUserRole('reception'); setCurrentView('reception-scanner'); setIsFullscreen(false); }} className={`px-3 py-1 rounded-full ${userRole === 'reception' ? 'bg-indigo-500 font-bold' : 'bg-slate-800 hover:bg-slate-700'}`}>👯‍♀️ 兄弟姊妹(接待)</button>
      <button onClick={() => { setUserRole('vendor'); setCurrentView('vendor-dashboard'); setIsFullscreen(false); }} className={`px-3 py-1 rounded-full ${userRole === 'vendor' ? 'bg-emerald-500 font-bold' : 'bg-slate-800 hover:bg-slate-700'}`}>💼 商戶 (Vendor)</button>
      <button onClick={() => { setUserRole('guest'); setCurrentView('guest-upload'); setIsFullscreen(false); }} className={`px-3 py-1 rounded-full ${userRole === 'guest' ? 'bg-pink-500 font-bold' : 'bg-slate-800 hover:bg-slate-700'}`}>📱 賓客手機</button>
    </div>
  );

  const renderCoupleChecklist = () => (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mt-8">
      <section className="lg:col-span-6 flex flex-col gap-4">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
            <div>
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">我的任務清單</h2>
              <div className="text-sm text-slate-500 mt-1 flex items-center gap-2">
                已完成 {completedTasks}/{tasks.length} 
                <div className="w-24 bg-slate-100 rounded-full h-2 inline-block ml-2">
                  <div className="bg-rose-500 h-2 rounded-full transition-all" style={{ width: `${progressPercentage}%` }}></div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-grow sm:flex-grow-0">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input type="text" placeholder="搜尋..." className="w-full sm:w-32 pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-rose-300" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
              </div>
              <div className="relative">
                <select className="appearance-none bg-slate-50 border border-slate-200 text-slate-700 py-2 pl-3 pr-8 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-rose-300 font-medium cursor-pointer" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                  <option value="status">未完成優先</option>
                  <option value="dueDate">緊急優先</option>
                  <option value="name">按名稱 (A-Z)</option>
                </select>
                <ArrowUpDown className="w-4 h-4 absolute right-2.5 top-2.5 text-slate-400 pointer-events-none" />
              </div>
            </div>
          </div>

          <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar mb-4">
            {displayTasks.map((task) => {
              const isUrgent = !task.isCompleted && new Date(task.dueDate) < new Date('2026-08-01');
              return (
                <div key={task.id} onClick={() => selectTask(task)} className={`flex items-start p-3.5 rounded-xl transition-all cursor-pointer border group ${task.isCompleted ? 'bg-slate-50/50 border-transparent opacity-75' : activeCategory === task.category && activeVenue === task.venue ? 'bg-rose-50 border-rose-200 shadow-sm ring-1 ring-rose-200' : 'bg-white border-slate-200 hover:border-rose-200 hover:shadow-sm'}`}>
                  <button onClick={(e) => toggleTask(task.id, e)} className="mt-0.5 mr-3 flex-shrink-0" disabled={userRole === 'vendor'}>
                    {task.isCompleted ? <CheckCircle2 className="w-6 h-6 text-green-500" /> : <Circle className="w-6 h-6 text-slate-300 hover:text-rose-400" />}
                  </button>
                  <div className="flex-grow min-w-0">
                     <div className="flex items-center flex-wrap gap-2 mb-1">
                        <span className={`font-bold truncate ${task.isCompleted ? 'line-through text-slate-500' : 'text-slate-800'}`}>{task.title}</span>
                        {task.venue && <span className={`text-[10px] px-2 py-0.5 rounded-md flex items-center gap-1 ${task.isCompleted ? 'bg-slate-100 text-slate-500' : 'bg-slate-100 text-slate-600'}`}><MapPin className="w-3 h-3" /> {task.venue}</span>}
                        {task.taskType === 'friend' && <span className="text-[10px] px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 flex items-center gap-1 border border-indigo-100"><Users className="w-3 h-3" /> {task.assignee || '需指派'}</span>}
                     </div>
                     <div className="flex items-center gap-4 text-xs">
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                           <Clock className={`w-3.5 h-3.5 ${isUrgent ? 'text-amber-500' : 'text-slate-400'}`} />
                           {editingDateId === task.id && userRole === 'owner' ? (
                              <input type="date" className="border border-slate-300 rounded px-1 py-0.5 bg-white text-slate-700 outline-none" value={task.dueDate} onChange={(e) => updateDueDate(task.id, e.target.value)} autoFocus onBlur={() => setEditingDateId(null)} />
                           ) : (
                              <span className={`cursor-pointer hover:underline ${isUrgent ? 'text-amber-600 font-bold' : 'text-slate-500'}`} onClick={() => userRole === 'owner' && setEditingDateId(task.id)}>{task.dueDate}</span>
                           )}
                        </div>
                        {task.taskType === 'vendor' && (
                          <div className="flex items-center gap-1 text-slate-500">
                             <DollarSign className="w-3.5 h-3.5" />
                             {userRole === 'collaborator' ? '***' : task.isCompleted ? `實際: $${task.actualCost?.toLocaleString() || 0}` : `預算: $${task.estimatedCost?.toLocaleString() || 0}`}
                          </div>
                        )}
                     </div>
                  </div>
                  {userRole === 'owner' && <button onClick={(e) => deleteTask(task.id, e)} className="ml-2 p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"><Trash2 className="w-4 h-4" /></button>}
                  {!task.isCompleted && task.taskType === 'vendor' && <ArrowRight className={`ml-2 mt-1 w-4 h-4 flex-shrink-0 ${activeCategory === task.category ? 'text-rose-500' : 'text-slate-300'}`} />}
                </div>
              );
            })}
            {displayTasks.length === 0 && <div className="text-center py-8 text-slate-400">找不到相符的任務</div>}
          </div>
          
          {userRole === 'owner' && (
            <div className="mt-6 pt-5 border-t border-slate-100">
              <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-1"><Plus className="w-4 h-4"/> 新增籌備事項</h3>
              <div className="flex gap-2 mb-3">
                 <button type="button" onClick={() => setNewTaskForm({...newTaskForm, taskType: 'vendor', assignee: ''})} className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition-colors ${newTaskForm.taskType === 'vendor' ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-white border-slate-200 text-slate-500'}`}>💼 需要搵商戶</button>
                 <button type="button" onClick={() => setNewTaskForm({...newTaskForm, taskType: 'friend'})} className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition-colors ${newTaskForm.taskType === 'friend' ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-200 text-slate-500'}`}>👯‍♀️ 搵兄弟姊妹幫手</button>
              </div>
              <form onSubmit={handleAddTask} className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                  <div className="sm:col-span-2">
                    <select className="w-full p-2.5 text-sm border border-slate-300 rounded-lg outline-none focus:border-rose-400 bg-white" value={newTaskForm.categoryKey} onChange={(e) => setNewTaskForm({...newTaskForm, categoryKey: e.target.value})}>
                      <optgroup label="場地及佈置"><option value="ceremony_venue">證婚場地</option><option value="banquet_venue">出門及晚宴場地</option><option value="deco">場地佈置</option></optgroup>
                      <optgroup label="團隊及統籌"><option value="lawyer">證婚律師</option><option value="photography">婚禮攝影及錄影</option><option value="mua">新娘化妝師 (MUA)</option><option value="mc">婚禮司儀 (MC)</option><option value="chaperone">大妗姐</option></optgroup>
                      <optgroup label="服飾及造型"><option value="wedding_dress">婚紗及晚裝</option><option value="bridal_party_attire">姊妹裙及兄弟衫</option><option value="parents_attire">四大長老服飾</option><option value="rings">結婚戒指</option></optgroup>
                      <optgroup label="其他"><option value="rituals">過大禮物資</option><option value="photobooth">Photo booth</option><option value="gifts">回禮禮物</option><option value="transport">花車及旅遊巴</option><option value="invitation">喜帖</option><option value="honeymoon">蜜月旅行</option><option value="other">✏️ 自訂項目 (其他)...</option></optgroup>
                    </select>
                  </div>
                  {newTaskForm.categoryKey === 'other' && (
                    <div className="sm:col-span-2"><input type="text" placeholder="輸入自訂項目名稱..." required className="w-full p-2.5 text-sm border border-slate-300 rounded-lg outline-none focus:border-rose-400 bg-white" value={newTaskForm.customTitle} onChange={(e) => setNewTaskForm({...newTaskForm, customTitle: e.target.value})} /></div>
                  )}
                  <div className="sm:col-span-2">
                     {newTaskForm.taskType === 'vendor' ? (
                       <div className="relative"><MapPin className="w-4 h-4 absolute left-3 top-3 text-slate-400" /><input type="text" placeholder="📍 指定場地 (選填, 例如: 伯大尼)" className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 rounded-lg outline-none focus:border-rose-400 bg-white" value={newTaskForm.venue} onChange={(e) => setNewTaskForm({...newTaskForm, venue: e.target.value})} /></div>
                     ) : (
                       <div className="flex gap-2">
                         <select className="flex-grow p-2.5 text-sm border border-indigo-300 rounded-lg outline-none focus:border-indigo-500 bg-white text-indigo-900" value={newTaskForm.assignee} onChange={(e) => setNewTaskForm({...newTaskForm, assignee: e.target.value})}>
                           <option value="">選擇指派給...</option>
                           {teamMembers.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                         </select>
                         <button type="button" onClick={() => setShowInviteModal(true)} className="px-3 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 border border-indigo-200"><UserPlus className="w-4 h-4" /></button>
                       </div>
                     )}
                  </div>
                  <input type="date" required className="p-2.5 text-sm border border-slate-300 rounded-lg outline-none focus:border-rose-400 bg-white text-slate-600" value={newTaskForm.dueDate} onChange={(e) => setNewTaskForm({...newTaskForm, dueDate: e.target.value})} />
                  {newTaskForm.taskType === 'vendor' && <input type="number" placeholder="大約預算 $" className="p-2.5 text-sm border border-slate-300 rounded-lg outline-none focus:border-rose-400 bg-white" value={newTaskForm.estimatedCost} onChange={(e) => setNewTaskForm({...newTaskForm, estimatedCost: e.target.value})} />}
                </div>
                <button type="submit" className={`w-full py-2.5 rounded-lg text-sm font-bold text-white transition-colors ${newTaskForm.taskType === 'vendor' ? 'bg-slate-900 hover:bg-slate-800' : 'bg-indigo-600 hover:bg-indigo-700'}`}>新增項目</button>
              </form>
            </div>
          )}
        </div>
      </section>

      {/* 右邊：智能配對推薦 或 引導探索 */}
      <section className="lg:col-span-6">
        <div className="sticky top-28">
          {!activeCategory ? (
            <div className="bg-white rounded-2xl p-10 shadow-sm border border-slate-200 text-center flex flex-col items-center justify-center min-h-[400px] bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-50/50 via-white to-white">
              <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center mb-6 shadow-inner"><Search className="w-10 h-10 text-indigo-500" /></div>
              <h3 className="text-xl font-bold text-slate-800 mb-3">尋找完美商戶靈感？</h3>
              <p className="text-slate-500 mb-6 text-sm leading-relaxed max-w-sm">你可以點擊左側未完成的任務，系統會利用 AI 自動為你篩選合適商戶；或者直接進入「商戶指南」瀏覽真實作品集！</p>
              <button onClick={() => setCurrentView('discover-vendors')} className="bg-slate-900 text-white font-bold px-8 py-3.5 rounded-xl hover:bg-slate-800 transition-colors shadow-md w-full max-w-sm flex items-center justify-center gap-2">
                <Search className="w-5 h-5"/> 立即探索商戶指南
              </button>
            </div>
          ) : (
            <div className="bg-transparent">
              <div className="mb-5 flex items-end justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">智能配對推薦</h2>
                  <p className="text-rose-600 font-medium text-sm mt-1">正在尋找：{TASK_CATEGORIES[activeCategory] || '商戶'} {activeVenue && <span className="text-slate-500"> @ {activeVenue}</span>}</p>
                </div>
                <span className="text-xs font-bold text-slate-500 bg-white px-3 py-1.5 rounded-full border border-slate-200 shadow-sm">{filteredVendors.length} 個結果</span>
              </div>
              <div className="space-y-4 max-h-[750px] overflow-y-auto pr-2 custom-scrollbar">
                {filteredVendors.length > 0 ? (
                  filteredVendors.map(vendor => {
                    const isPerfectMatch = activeVenue && vendor.tags.some(tag => activeVenue.includes(tag) || tag.includes(activeVenue));
                    return (
                      <div key={vendor.id} className={`bg-white rounded-2xl p-6 shadow-sm border transition-all relative ${isPerfectMatch ? 'border-rose-300 ring-1 ring-rose-100' : 'border-slate-100 hover:border-slate-300'}`}>
                        {isPerfectMatch && <div className="absolute top-0 right-6 -translate-y-1/2 bg-gradient-to-r from-rose-500 to-pink-500 text-white text-[10px] font-bold px-3 py-1 rounded-full shadow-sm flex items-center gap-1"><MapPin className="w-3 h-3" /> 場地經驗匹配</div>}
                        <div className="flex gap-2 mb-3 flex-wrap">
                          {vendor.tags.map(tag => <span key={tag} className={`text-xs font-bold px-2.5 py-1 rounded-md ${activeVenue && (activeVenue.includes(tag) || tag.includes(activeVenue)) ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>{tag}</span>)}
                        </div>
                        <div className="flex justify-between items-start mb-1">
                          <h3 className="text-lg font-bold text-slate-800">{vendor.name}</h3>
                        </div>
                        <div className="flex items-center gap-3 text-sm mb-4">
                            <span className="font-bold text-slate-700 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">{vendor.price}</span>
                            <span className="flex items-center gap-1 text-slate-500 font-medium"><Star className="w-4 h-4 fill-amber-400 text-amber-400" /> {vendor.rating}</span>
                        </div>
                        <div className="flex gap-2 mt-4">
                           <button onClick={() => setViewingVendorProfile(vendor)} className="flex-1 bg-slate-900 text-white py-2 rounded-xl text-sm font-bold hover:bg-slate-800 transition-colors">查看作品集</button>
                           <button onClick={() => { setCurrentView('couple-jobboard'); setActiveCategory(null); }} className="flex-1 bg-rose-50 text-rose-700 border border-rose-200 py-2 rounded-xl text-sm font-bold hover:bg-rose-100 transition-colors">索取報價</button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200 text-center flex flex-col items-center">
                    <p className="text-slate-500 mb-4 font-medium">資料庫暫時未有此場地的推薦商戶。</p>
                    <button onClick={() => { setCurrentView('couple-jobboard'); setActiveCategory(null); }} className="bg-rose-100 text-rose-700 font-bold px-6 py-2.5 rounded-xl hover:bg-rose-200 transition-colors">不如去「求救板」出 Post 等 Vendor 搵你？</button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );

  const renderCoupleBudget = () => (
    <div className="max-w-5xl mx-auto mt-8">
      <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200 mb-8">
        <h2 className="text-2xl font-bold text-slate-800 mb-6 flex items-center gap-2"><Wallet className="w-7 h-7 text-rose-500" /> 預算管理與明細 (Budget Tracker)</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
           <div className="bg-slate-50 rounded-xl p-5 border border-slate-200 shadow-sm"><p className="text-sm text-slate-500 mb-1 font-bold">總預算目標 (HKD)</p><p className="text-3xl font-black text-slate-800">${totalBudget.toLocaleString()}</p></div>
           <div className="bg-rose-50 rounded-xl p-5 border border-rose-200 shadow-sm relative overflow-hidden"><div className="absolute right-0 top-0 w-16 h-16 bg-rose-100 rounded-bl-full -mr-4 -mt-4"></div><p className="text-sm text-rose-700 mb-1 font-bold relative z-10">已確認開支 (已付款)</p><p className="text-3xl font-black text-rose-700 relative z-10">${totalSpent.toLocaleString()}</p></div>
           <div className={`rounded-xl p-5 border shadow-sm ${remainingBudget < 0 ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}><p className={`text-sm mb-1 font-bold ${remainingBudget < 0 ? 'text-red-600' : 'text-emerald-700'}`}>剩餘可分配預算</p><p className={`text-3xl font-black ${remainingBudget < 0 ? 'text-red-700' : 'text-emerald-600'}`}>${remainingBudget.toLocaleString()}</p></div>
        </div>
        
        <div className="mb-10 bg-slate-50 p-5 rounded-xl border border-slate-100">
           <div className="flex justify-between text-sm mb-2"><span className="font-bold text-slate-700 flex items-center gap-2"><PieChart className="w-4 h-4"/>預算消耗進度</span><span className="font-black text-slate-800">{budgetPercentage}%</span></div>
           <div className="w-full bg-slate-200 rounded-full h-4 overflow-hidden shadow-inner">
              <div className={`h-full transition-all duration-1000 ease-out relative ${budgetPercentage > 100 ? 'bg-red-500' : 'bg-gradient-to-r from-rose-400 to-rose-500'}`} style={{ width: `${Math.min(budgetPercentage, 100)}%` }}></div>
           </div>
        </div>

        <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">所有項目開支明細</h3>
        <div className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
            <div className="hidden sm:grid grid-cols-12 gap-4 p-4 bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
               <div className="col-span-6">項目名稱及場地</div><div className="col-span-2 text-center">狀態</div><div className="col-span-4 text-right">金額 (HKD)</div>
            </div>
            <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto custom-scrollbar">
              {tasks.map(task => (
                 <div key={task.id} className="grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-4 p-4 bg-white hover:bg-slate-50 transition-colors items-center">
                     <div className="sm:col-span-6 flex items-start sm:items-center gap-3">
                         {task.isCompleted ? <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5 sm:mt-0" /> : <Circle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5 sm:mt-0" />}
                         <div>
                           <div className="font-bold text-slate-800 flex flex-wrap items-center gap-2">{task.title}{task.taskType === 'friend' && <span className="bg-indigo-100 text-indigo-700 text-[10px] px-2 py-0.5 rounded-full border border-indigo-200">非商戶</span>}</div>
                           {task.venue && <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1"><MapPin className="w-3 h-3"/>{task.venue}</div>}
                         </div>
                     </div>
                     <div className="sm:col-span-2 text-left sm:text-center mt-2 sm:mt-0 pl-8 sm:pl-0">
                         {task.isCompleted ? <span className="bg-green-100 text-green-700 text-xs font-bold px-2.5 py-1 rounded">已確認 (已付款)</span> : <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2.5 py-1 rounded">籌備中 (預算)</span>}
                     </div>
                     <div className="sm:col-span-4 text-left sm:text-right mt-1 sm:mt-0 pl-8 sm:pl-0 font-mono">
                         {task.isCompleted ? <><span className="text-slate-400 text-xs sm:hidden mr-2">實際：</span><span className="font-bold text-slate-800 text-lg">${task.actualCost?.toLocaleString() || 0}</span></> : <><span className="text-slate-400 text-xs sm:hidden mr-2">預計：</span><span className="text-slate-400 font-medium">${task.estimatedCost?.toLocaleString() || 0}</span></>}
                     </div>
                 </div>
              ))}
            </div>
        </div>
      </div>
    </div>
  );

  const renderDiscoverDirectory = () => (
    <div className="max-w-7xl mx-auto mt-8">
      <div className="text-center mb-10"><h2 className="text-3xl font-black text-slate-800 mb-4">探索優質婚禮商戶</h2></div>
      <div className="flex flex-wrap justify-center gap-2 mb-8">
        <button onClick={() => setDiscoverFilter('all')} className={`px-5 py-2 rounded-full font-bold text-sm transition-all ${discoverFilter === 'all' ? 'bg-slate-900 text-white shadow-md' : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-400'}`}>全部商戶</button>
        <button onClick={() => setDiscoverFilter('photography')} className={`px-5 py-2 rounded-full font-bold text-sm transition-all ${discoverFilter === 'photography' ? 'bg-slate-900 text-white shadow-md' : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-400'}`}>📸 攝影及錄影</button>
        <button onClick={() => setDiscoverFilter('deco')} className={`px-5 py-2 rounded-full font-bold text-sm transition-all ${discoverFilter === 'deco' ? 'bg-slate-900 text-white shadow-md' : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-400'}`}>🌸 場地佈置</button>
        <button onClick={() => setDiscoverFilter('mua')} className={`px-5 py-2 rounded-full font-bold text-sm transition-all ${discoverFilter === 'mua' ? 'bg-slate-900 text-white shadow-md' : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-400'}`}>💄 化妝及造型</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {discoverVendors.map(vendor => (
          <div key={vendor.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-lg transition-all cursor-pointer group" onClick={() => setViewingVendorProfile(vendor)}>
            <div className="h-48 w-full overflow-hidden bg-slate-100 relative">
              {vendor.portfolio && vendor.portfolio[0] && <img src={vendor.portfolio[0]} alt={vendor.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />}
              <div className="absolute top-3 right-3 bg-white/90 backdrop-blur text-slate-800 text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1 shadow-sm"><Star className="w-3 h-3 text-amber-500 fill-amber-500" /> {vendor.rating}</div>
            </div>
            <div className="p-5">
              <h3 className="text-lg font-bold text-slate-800 mb-2 truncate">{vendor.name}</h3>
              <div className="flex flex-wrap gap-1.5 mb-4">{vendor.tags.slice(0, 3).map(tag => <span key={tag} className="bg-slate-100 text-slate-600 text-[10px] font-bold px-2 py-1 rounded-md">{tag}</span>)}</div>
              <p className="text-sm text-slate-500 line-clamp-2 mb-5">{vendor.description}</p>
              <div className="flex justify-between items-center border-t border-slate-100 pt-4"><span className="font-black text-rose-600">{vendor.price}</span><span className="text-sm font-bold text-slate-900 bg-slate-100 px-4 py-2 rounded-lg group-hover:bg-slate-900 group-hover:text-white transition-colors">查看作品集</span></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderGuestList = () => (
    <div className="max-w-6xl mx-auto mt-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div><h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2"><Users className="w-7 h-7 text-indigo-500" /> 嘉賓名單與座位表</h2></div>
        <div className="flex items-center gap-4 bg-white p-3 rounded-xl border border-slate-200">
           <div className="text-center px-4 border-r border-slate-100"><div className="text-xs text-slate-500 font-bold">總人數</div><div className="text-xl font-black text-slate-800">{guests.reduce((sum, g) => sum + g.headCount, 0)}</div></div>
           <div className="text-center px-4"><div className="text-xs text-slate-500 font-bold">已報到</div><div className="text-xl font-black text-green-600">{guests.filter(g => g.hasAttended).reduce((sum, g) => sum + g.headCount, 0)}</div></div>
        </div>
      </div>
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
            <div className="relative w-full max-w-xs">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input type="text" placeholder="搜尋姓名或枱號..." className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-indigo-500" value={guestSearchQuery} onChange={(e) => setGuestSearchQuery(e.target.value)} />
            </div>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
            <tr><th className="p-4">姓名</th><th className="p-4">群組</th><th className="p-4">座位</th><th className="p-4 text-center">報到狀態</th><th className="p-4 text-center">電子喜帖</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {displayGuests.map(guest => (
              <tr key={guest.id} className="hover:bg-slate-50/50">
                <td className="p-4 font-bold text-slate-800">{guest.name}</td>
                <td className="p-4"><span className="bg-slate-100 text-slate-600 text-xs px-2 py-1 rounded-md">{guest.group}</span></td>
                <td className="p-4 font-bold text-slate-700">{guest.tableNumber}</td>
                <td className="p-4 text-center">{guest.hasAttended ? <span className="text-green-600 font-bold text-xs bg-green-50 px-2 py-1 rounded">已報到</span> : <span className="text-slate-400 text-xs">未到</span>}</td>
                <td className="p-4 text-center"><button onClick={() => setViewingQrCode(guest)} className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg"><QrCode className="w-5 h-5" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderPhotoDrop = () => (
    <div className="max-w-6xl mx-auto mt-8">
      <div className="flex justify-between items-center mb-8">
        <div><h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2"><Camera className="w-7 h-7 text-rose-500" /> 互動相片牆 (Photo Drop)</h2></div>
        <button onClick={() => setIsFullscreen(true)} className="bg-rose-600 text-white font-bold px-6 py-2 rounded-xl hover:bg-rose-700 shadow-md flex items-center gap-2"><Monitor className="w-4 h-4"/> 播放 Slideshow</button>
      </div>
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
        <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span> 已收集 {photos.length} 張相片</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {photos.map(p => (
            <div key={p.id} className="aspect-square rounded-xl overflow-hidden relative group cursor-pointer shadow-sm">
              <img src={p.url} alt="upload" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3"><span className="text-white text-xs font-bold truncate">{p.uploader}</span></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderGuestUploadView = () => (
    <div className="max-w-md mx-auto mt-10">
      <div className="bg-white rounded-[3rem] shadow-2xl overflow-hidden border-[8px] border-slate-900 relative min-h-[700px] flex flex-col">
        <div className="absolute top-0 inset-x-0 h-6 bg-slate-900 rounded-b-3xl w-40 mx-auto z-20"></div>
        <div className="bg-gradient-to-br from-rose-500 to-pink-600 p-8 pt-12 text-center text-white pb-10">
          <Heart className="w-10 h-10 mx-auto mb-3 fill-white/20 text-white/80" />
          <h2 className="text-2xl font-black tracking-widest mb-1">Chantal & Fiance</h2>
        </div>
        <div className="flex-grow bg-slate-50 p-6 -mt-6 rounded-t-3xl relative z-10 flex flex-col">
          <div className="flex-grow flex flex-col items-center justify-center border-2 border-dashed border-rose-300 rounded-2xl bg-rose-50/50 mb-6 cursor-pointer" onClick={handleSimulateUpload}>
            {isUploading ? (
              <div className="animate-pulse flex flex-col items-center text-rose-500"><Upload className="w-12 h-12 mb-3 animate-bounce" /><span className="font-bold">上傳中...</span></div>
            ) : (
              <div className="flex flex-col items-center text-rose-400"><div className="bg-white p-4 rounded-full shadow-sm mb-4"><Camera className="w-10 h-10 text-rose-500" /></div><h3 className="font-bold text-slate-700 text-lg">點擊上載相片</h3></div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const renderReceptionScanner = () => (
    <div className="max-w-md mx-auto mt-10">
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

  const renderFullscreenSlideshow = () => {
    if (!isFullscreen || photos.length === 0) return null;
    const currentPhoto = photos[currentSlideIndex];
    return (
      <div className="fixed inset-0 bg-black z-50 flex items-center justify-center">
        <button onClick={() => setIsFullscreen(false)} className="absolute top-6 right-6 text-white/50 hover:text-white bg-black/20 p-3 rounded-full z-20"><X className="w-8 h-8" /></button>
        <div className="absolute bottom-8 right-8 z-20 bg-black/60 backdrop-blur px-5 py-3 rounded-2xl text-right"><p className="text-white/70 text-sm mb-1">Photo by</p><p className="text-white font-black text-2xl">{currentPhoto.uploader}</p></div>
        <div className="relative w-full h-full flex items-center justify-center p-12">
          <div className="absolute inset-0 opacity-30"><img key={`bg-${currentSlideIndex}`} src={currentPhoto.url} className="w-full h-full object-cover blur-2xl" alt="blur-bg" /></div>
          <img key={`main-${currentSlideIndex}`} src={currentPhoto.url} alt="slideshow" className="max-w-full max-h-full object-contain relative z-10 shadow-2xl rounded-lg animate-in fade-in zoom-in-95 duration-700" />
        </div>
      </div>
    );
  };

  const renderCoupleJobBoard = () => (
    <div className="max-w-4xl mx-auto mt-8">
      <div className="bg-white rounded-2xl p-8 shadow-sm border border-rose-100 mb-8 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-rose-50/30 via-white to-white">
        <div className="flex items-start sm:items-center gap-4 mb-6">
          <div className="bg-rose-100 p-3 rounded-2xl flex-shrink-0"><AlertCircle className="w-8 h-8 text-rose-500" /></div>
          <div>
            <h2 className="text-2xl font-bold text-slate-800">出 Post 求救</h2>
            <p className="text-slate-500 text-sm mt-1">配對唔到心水？將你嘅要求、Budget、指定場地列出嚟，等全港 Vendor 主動搵你報價！</p>
          </div>
        </div>
        {showJobSuccess && <div className="bg-green-50 text-green-700 p-4 rounded-xl mb-6 flex items-center gap-2 border border-green-200 font-bold"><CheckCircle2 className="w-5 h-5" /> 求救 Post 已成功發佈！商戶會盡快聯絡你。</div>}
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
         {jobRequests.filter(j => j.coupleName === '主理新人' || j.coupleName === 'Chantal & Fiance').map(job => (
             <div key={job.id} className="bg-white rounded-xl p-5 border border-slate-200 flex justify-between items-center hover:border-rose-200 transition-colors">
                 <div>
                    <h4 className="font-bold text-slate-800 text-lg flex items-center gap-2">{job.serviceNeeded}</h4>
                    <p className="text-sm text-slate-500 mt-1">預算: <span className="font-bold text-slate-700">{job.budget}</span> • 發佈於 {job.postedAt}</p>
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
    <div className="max-w-6xl mx-auto mt-8">
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
          const isMatch = job.venues.some(v => v.includes('伯大尼') || v.includes('Ritz'));
          const isCategoryMatch = job.serviceNeeded.includes('攝影');
          return (
            <div key={job.id} className={`bg-white rounded-2xl p-6 shadow-sm border transition-all flex flex-col h-full relative overflow-hidden group ${isMatch || isCategoryMatch ? 'border-emerald-300 hover:shadow-md ring-1 ring-emerald-50' : 'border-slate-200 hover:border-slate-300'}`}>
              {(isMatch || isCategoryMatch) && <div className="absolute top-0 right-0 bg-emerald-500 text-white text-[10px] font-bold px-3 py-1 rounded-bl-lg">與你的專長匹配</div>}
              <div className="mb-4 mt-2">
                <h3 className="text-xl font-bold text-slate-800 mb-1">{job.serviceNeeded}</h3>
                <p className="text-sm text-slate-500 font-medium">客戶: {job.coupleName} • 發佈於 {job.postedAt}</p>
              </div>
              <div className="space-y-3 mb-6 flex-grow bg-slate-50 p-4 rounded-xl border border-slate-100">
                <div className="flex items-center justify-between text-sm"><span className="text-slate-500 flex items-center gap-1.5"><Calendar className="w-4 h-4" /> 婚期</span><strong className="text-slate-800">{job.weddingDate}</strong></div>
                <div className="flex items-center justify-between text-sm"><span className="text-slate-500 flex items-center gap-1.5"><DollarSign className="w-4 h-4" /> 預算</span><strong className="text-rose-600">{job.budget}</strong></div>
                {job.venues && job.venues.length > 0 && (
                  <div className="flex items-start justify-between text-sm border-t border-slate-200 pt-3 mt-3">
                    <span className="text-slate-500 flex items-center gap-1.5"><MapPin className="w-4 h-4" /> 指定場地</span>
                    <div className="flex flex-wrap gap-1 justify-end">{job.venues.map(v => <span key={v} className="bg-white border border-slate-200 text-slate-700 px-2 py-0.5 rounded font-bold text-xs shadow-sm">{v}</span>)}</div>
                  </div>
                )}
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
    <div className="max-w-4xl mx-auto mt-8">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="bg-emerald-900 p-8 text-white">
          <h2 className="text-2xl font-bold flex items-center gap-3"><Briefcase className="w-7 h-7 text-emerald-400" /> 商戶專頁管理 (Profile Builder)</h2>
          <p className="text-emerald-100 mt-2 text-sm">完善你的專頁資料及上載最新作品，吸引更多新人聯絡你。</p>
        </div>
        <div className="p-8 space-y-8">
          <div>
            <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2"><Info className="w-5 h-5 text-emerald-600"/> 基本資料</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div><label className="block text-sm font-bold text-slate-700 mb-1">商戶名稱</label><input type="text" className="w-full p-3 rounded-xl border border-slate-300 bg-slate-50" value={vendorProfileForm.name} readOnly /></div>
              <div><label className="block text-sm font-bold text-slate-700 mb-1">參考起步價 (Starting Price)</label><input type="text" className="w-full p-3 rounded-xl border border-slate-300 focus:border-emerald-500 outline-none" value={vendorProfileForm.price} onChange={e => setVendorProfileForm({...vendorProfileForm, price: e.target.value})} /></div>
              <div className="md:col-span-2"><label className="block text-sm font-bold text-slate-700 mb-1">商戶簡介</label><textarea rows="3" className="w-full p-3 rounded-xl border border-slate-300 focus:border-emerald-500 outline-none resize-none" value={vendorProfileForm.description} onChange={e => setVendorProfileForm({...vendorProfileForm, description: e.target.value})}></textarea></div>
            </div>
          </div>
          <div className="border-t border-slate-100 pt-8">
            <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2"><LayoutGrid className="w-5 h-5 text-emerald-600"/> 作品集管理 (Portfolio)</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              {vendorProfileForm.portfolio.map((img, index) => (
                <div key={index} className="relative aspect-square rounded-xl overflow-hidden group">
                  <img src={img} alt="portfolio" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"><button className="bg-red-500 text-white p-2 rounded-full hover:bg-red-600"><Trash2 className="w-4 h-4"/></button></div>
                </div>
              ))}
              <button className="aspect-square rounded-xl border-2 border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-500 hover:border-emerald-500 hover:text-emerald-600 hover:bg-emerald-50 transition-colors">
                <Upload className="w-8 h-8 mb-2" /><span className="text-sm font-bold">上載新相片</span>
              </button>
            </div>
          </div>
          <button className="w-full bg-emerald-600 text-white font-bold py-3.5 rounded-xl hover:bg-emerald-700 transition-colors shadow-sm">儲存專頁設定</button>
        </div>
      </div>
    </div>
  );

  // --- Modal Renders ---
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
          {userRole === 'owner' && (
            <div className="p-5 border-t border-slate-100 bg-white flex gap-3">
              <button className="flex-1 bg-slate-900 text-white font-bold py-3.5 rounded-xl hover:bg-slate-800 transition-colors">聯絡商戶 / 索取報價單</button>
              <button className="flex-1 bg-rose-50 text-rose-600 font-bold py-3.5 rounded-xl border border-rose-200 hover:bg-rose-100 transition-colors flex items-center justify-center gap-2"><Heart className="w-5 h-5"/> 加入書籤</button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderQrCodeModal = () => {
    if (!viewingQrCode) return null;
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(viewingQrCode.id)}&color=312e81`;
    return (
      <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
        <div className="bg-white rounded-[2rem] p-8 max-w-sm w-full text-center relative shadow-2xl">
          <button onClick={() => setViewingQrCode(null)} className="absolute top-4 right-4 bg-slate-100 rounded-full p-1"><X className="w-5 h-5" /></button>
          <h3 className="text-rose-600 font-black tracking-widest text-sm mb-1">ELECTRONIC INVITATION</h3>
          <h2 className="text-2xl font-bold text-slate-800">Chantal & Fiance</h2>
          <div className="bg-indigo-50 p-6 rounded-3xl border-2 border-indigo-100 my-6 inline-block"><img src={qrCodeUrl} className="w-48 h-48 mx-auto rounded-xl" alt="qr" /></div>
          <p className="text-slate-500 mb-6">親愛的 <strong>{viewingQrCode.name}</strong>，憑此 QR Code 入場。</p>
          <button className="w-full bg-green-500 text-white font-bold py-3.5 rounded-xl hover:bg-green-600 transition-colors shadow-sm flex items-center justify-center gap-2">透過 WhatsApp 發送</button>
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

  const renderProposalsModal = () => {
    if (!viewingProposals) return null;
    return (
      <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
        <div className="bg-white rounded-2xl p-6 max-w-2xl w-full shadow-xl max-h-[85vh] flex flex-col relative">
          <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-4">
            <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2"><MessageSquare className="w-5 h-5 text-rose-500" />商戶報價單</h3>
            <button onClick={() => setViewingProposals(null)} className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"><X className="w-6 h-6" /></button>
          </div>
          <div className="overflow-y-auto custom-scrollbar pr-2 flex-grow">
            {proposalsData[viewingProposals] && proposalsData[viewingProposals].length > 0 ? (
              proposalsData[viewingProposals].map(p => (
                <div key={p.id} className="mb-4 p-5 border border-slate-200 rounded-xl bg-slate-50 hover:border-rose-200 transition-colors">
                  <div className="flex justify-between items-start mb-2"><div className="font-bold text-slate-800 text-lg">{p.vendorName}</div><div className="font-bold text-rose-600 text-lg">{p.price}</div></div>
                  <div className="flex items-center gap-1 text-sm text-slate-500 mb-3"><Star className="w-4 h-4 text-amber-400 fill-amber-400" /> <span className="font-medium">{p.rating}</span> • {p.date}</div>
                  <p className="text-sm text-slate-700 leading-relaxed bg-white p-3 rounded-lg border border-slate-100">"{p.message}"</p>
                  <div className="mt-4 flex gap-3">
                    <button className="flex-1 bg-slate-900 text-white py-2.5 rounded-lg text-sm font-bold hover:bg-slate-800 transition-colors">聯絡商戶</button>
                    <button className="flex-1 bg-white border border-slate-300 text-slate-700 py-2.5 rounded-lg text-sm font-bold hover:bg-slate-50 transition-colors">婉拒</button>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center text-slate-500 py-10 flex flex-col items-center">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-3"><MessageSquare className="w-8 h-8 text-slate-300" /></div>
                暫時未有商戶發送報價，請耐心等候。
              </div>
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
               <div><label className="block text-xs font-bold text-slate-500 mb-1">稱呼 (例如: 伴郎 Kevin)</label><input type="text" required className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:border-indigo-500" value={inviteForm.name} onChange={e => setInviteForm({...inviteForm, name: e.target.value})} /></div>
               <div><label className="block text-xs font-bold text-slate-500 mb-1">Email 電郵地址</label><input type="email" required className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:border-indigo-500" value={inviteForm.email} onChange={e => setInviteForm({...inviteForm, email: e.target.value})} /></div>
               <div className="flex gap-2 mt-6">
                  <button type="button" onClick={() => setShowInviteModal(false)} className="flex-1 py-2 text-slate-600 bg-slate-100 rounded-lg font-bold">取消</button>
                  <button type="submit" className="flex-1 py-2 text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg font-bold">發送邀請</button>
               </div>
            </form>
         </div>
      </div>
    );
  };

  // ==========================================
  // Main Layout
  // ==========================================
  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-10">
      {renderRoleSimulator()}
      
      {!isFullscreen && userRole !== 'guest' && (
        <header className="bg-white shadow-sm sticky top-0 z-40 border-b border-slate-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-4">
               <h1 className="text-xl font-black text-slate-800 flex items-center gap-2 tracking-tight"><Heart className="w-6 h-6 fill-rose-500 text-rose-500" /> WeddingMatch <span className="text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 ml-2 hidden sm:inline-block">2027年1月 💒 伯大尼 x Ritz Carlton</span></h1>
            </div>
            <div className="flex space-x-1 overflow-x-auto custom-scrollbar">
              {userRole === 'owner' && (
                <>
                  <button onClick={() => setCurrentView('couple-checklist')} className={`px-4 py-3 text-sm font-bold border-b-[3px] whitespace-nowrap transition-colors ${currentView === 'couple-checklist' ? 'border-rose-500 text-rose-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>📋 我的籌備</button>
                  <button onClick={() => setCurrentView('couple-budget')} className={`px-4 py-3 text-sm font-bold border-b-[3px] whitespace-nowrap transition-colors ${currentView === 'couple-budget' ? 'border-rose-500 text-rose-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>💰 預算管理</button>
                  <button onClick={() => setCurrentView('discover-vendors')} className={`px-4 py-3 text-sm font-bold border-b-[3px] whitespace-nowrap transition-colors ${currentView === 'discover-vendors' ? 'border-rose-500 text-rose-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>🔍 商戶指南</button>
                  <div className="w-px h-5 bg-slate-300 my-auto mx-2 hidden sm:block"></div>
                  <button onClick={() => setCurrentView('couple-jobboard')} className={`px-4 py-3 text-sm font-bold border-b-[3px] whitespace-nowrap transition-colors flex items-center gap-1 ${currentView === 'couple-jobboard' ? 'border-rose-500 text-rose-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>🆘 出Post求救 <span className="bg-rose-100 text-rose-600 text-[10px] px-1.5 py-0.5 rounded-full">搵Vendor</span></button>
                  <button onClick={() => setCurrentView('couple-guests')} className={`px-4 py-3 text-sm font-bold border-b-[3px] whitespace-nowrap transition-colors ${currentView === 'couple-guests' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>🎟️ 嘉賓與座位</button>
                  <button onClick={() => setCurrentView('photo-drop')} className={`px-4 py-3 text-sm font-bold border-b-[3px] whitespace-nowrap transition-colors flex items-center gap-1 ${currentView === 'photo-drop' ? 'border-rose-500 text-rose-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}><Camera className="w-4 h-4"/> 互動相片牆</button>
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

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {userRole === 'owner' && currentView === 'couple-checklist' && renderCoupleChecklist()}
        {userRole === 'owner' && currentView === 'discover-vendors' && renderDiscoverDirectory()}
        {userRole === 'owner' && currentView === 'couple-guests' && renderGuestList()}
        {userRole === 'owner' && currentView === 'photo-drop' && renderPhotoDrop()}
        {userRole === 'owner' && currentView === 'couple-budget' && renderCoupleBudget()}
        {userRole === 'owner' && currentView === 'couple-jobboard' && renderCoupleJobBoard()}
        
        {userRole === 'reception' && currentView === 'couple-guests' && renderGuestList()}
        {userRole === 'reception' && currentView === 'reception-scanner' && renderReceptionScanner()}
        
        {userRole === 'vendor' && currentView === 'vendor-dashboard' && renderVendorDashboard()}
        {userRole === 'vendor' && currentView === 'vendor-profile' && renderVendorProfileEdit()}
        
        {userRole === 'guest' && renderGuestUploadView()}
      </main>

      {renderFullscreenSlideshow()}
      {renderVendorModal()}
      {renderQrCodeModal()}
      {renderScanResultModal()}
      {renderProposalsModal()}
      {renderInviteModal()}

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes scan { 0% { top: 0; } 50% { top: 100%; } 100% { top: 0; } }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
      `}} />
    </div>
  );
}