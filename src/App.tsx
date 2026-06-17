import React, { useState, useMemo } from 'react';
import { 
  CheckCircle2, Circle, MapPin, Heart, ArrowRight, 
  Briefcase, Send, Calendar, DollarSign, AlertCircle, 
  Trash2, Plus, Clock, ArrowUpDown, Search, UserPlus, Users, Edit3, MessageSquare, Tag, Mail, Wallet, Star, PieChart, X
} from 'lucide-react';

// --- 標準化廣東話分類 (Standardized Categories in Cantonese) ---
const TASK_CATEGORIES = {
  // 場地及佈置
  ceremony_venue: '證婚場地',
  banquet_venue: '出門及晚宴場地',
  deco: '場地佈置',
  // 團隊及統籌
  lawyer: '證婚律師',
  photography: '婚禮攝影及錄影 (例如: 2P1V)',
  mua: '新娘化妝師 (MUA)',
  bridesmaid_mua: '姊妹化妝',
  mc: '婚禮司儀 (MC)',
  chaperone: '大妗姐',
  planner: '婚禮統籌 (Wedding Planner)',
  // 服飾及造型
  rings: '結婚戒指',
  wedding_dress: '婚紗及晚裝',
  groom_suit: '男裝禮服',
  bridal_party_attire: '姊妹裙及兄弟衫',
  parents_attire: '四大長老服飾',
  // 物資及其他
  rituals: '過大禮物資',
  photobooth: 'Photo booth',
  gifts: '回禮禮物',
  transport: '花車及旅遊巴',
  invitation: '喜帖及婚禮網頁',
  honeymoon: '蜜月旅行',
  other: '自訂項目 (其他)'
};

// --- Mock Data: 真實用戶嘅 Checklist (已標準化及加入 Venue) ---
const INITIAL_TASKS = [
  { id: 1, title: '證婚律師', category: 'lawyer', isCompleted: true, actualCost: 3500, dueDate: '2026-06-01', taskType: 'vendor' },
  { id: 2, title: '證婚場地', category: 'ceremony_venue', isCompleted: true, actualCost: 6800, venue: '伯大尼小教堂', dueDate: '2026-05-15', taskType: 'vendor' },
  { id: 3, title: '場地佈置', category: 'deco', isCompleted: false, venue: '伯大尼小教堂', estimatedCost: 8000, dueDate: '2026-10-01', taskType: 'vendor' },
  { id: 4, title: '出門及晚宴場地', category: 'banquet_venue', isCompleted: true, actualCost: 180000, venue: 'Ritz Carlton', dueDate: '2026-05-15', taskType: 'vendor' },
  { id: 5, title: '場地佈置', category: 'deco', isCompleted: false, venue: 'Ritz Carlton', estimatedCost: 25000, dueDate: '2026-09-01', taskType: 'vendor' },
  { id: 6, title: '結婚戒指', category: 'rings', isCompleted: true, actualCost: 25000, dueDate: '2026-08-01', taskType: 'vendor' },
  { id: 7, title: '新娘化妝師 (MUA)', category: 'mua', isCompleted: true, actualCost: 9800, dueDate: '2026-07-15', taskType: 'vendor' },
  { id: 8, title: '婚禮攝影及錄影 (例如: 2P1V)', category: 'photography', isCompleted: false, estimatedCost: 18000, dueDate: '2026-07-30', taskType: 'vendor' },
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

const VENDORS = [
  { id: 101, name: 'Visionary Capture (2P1V)', category: 'photography', rating: 4.9, price: '$18,000+', tags: ['伯大尼', 'Ritz Carlton'] },
  { id: 102, name: 'Light & Shadow Studio', category: 'photography', rating: 4.7, price: '$15,000+', tags: ['伯大尼'] },
  { id: 103, name: 'FairyTale Floral', category: 'deco', rating: 4.8, price: '$25,000+', tags: ['Ritz Carlton', '奢華花藝'] },
  { id: 104, name: 'Bethanie Charm Deco', category: 'deco', rating: 4.6, price: '$8,000+', tags: ['伯大尼', '小清新'] }
];

// --- 團隊成員名單 ---
const INITIAL_TEAM = [
  { id: 'u1', name: '伴娘 Mandy', role: 'bridesmaid' },
  { id: 'u2', name: '兄弟團', role: 'groomsmen' }
];

// --- 求救板 (Job Board) 真實範例數據 ---
const INITIAL_JOB_REQUESTS = [
  {
    id: 'job-1',
    coupleName: 'Chantal & Fiance',
    weddingDate: '2027年1月',
    serviceNeeded: '場地佈置',
    venues: ['Ritz Carlton'],
    budget: '$20,000 - $30,000',
    details: '急尋！需要做過Ritz Carlton嘅佈置，想要白綠色系小清新加少少香檳金，有特高樓底設計經驗優先。',
    status: 'open',
    proposalsCount: 2,
    postedAt: '2小時前'
  },
  {
    id: 'job-2',
    coupleName: 'Mandy & Kevin',
    weddingDate: '2026年11月',
    serviceNeeded: '婚禮攝影及錄影 (例如: 2P1V)',
    venues: ['伯大尼小教堂'],
    budget: '$8,000 - $12,000',
    details: '淨係需要半日伯大尼教堂行禮拍攝，想要捕捉自然情感，唔要太重filter。必須要有伯大尼拍攝經驗，知道點避開教堂規矩。',
    status: 'open',
    proposalsCount: 5,
    postedAt: '1日前'
  }
];

// --- Mock Data: 商戶報價單數據 ---
const MOCK_PROPOSALS = {
  'job-1': [
    { id: 'p1', vendorName: 'FairyTale Floral', rating: 4.8, price: '$22,000', message: '我哋對 Ritz Carlton 嘅特高樓底非常有經驗，白綠色系小清新加香檳金絕對做到你要嘅效果，仲可以送一次免費 3D 模擬圖。', date: '1小時前' },
    { id: 'p2', vendorName: 'Elegance Wedding', rating: 4.6, price: '$28,500', message: '我哋上個月先喺 Ritz 做完類似風格，可以安排睇真實 Reference 相片。', date: '30分鐘前' }
  ],
  'job-2': [
    { id: 'p3', vendorName: 'Visionary Capture', rating: 4.9, price: '$9,800', message: '伯大尼半日拍攝係我哋熱門 Package，熟悉避開教堂限制嘅拍攝機位。', date: '2小時前' }
  ]
};

export default function App() {
  // Global State
  const [userRole, setUserRole] = useState('owner'); // 'owner', 'collaborator', 'vendor'
  const [currentView, setCurrentView] = useState('couple-checklist'); 
  
  // App State
  const [tasks, setTasks] = useState(INITIAL_TASKS);
  const [teamMembers, setTeamMembers] = useState(INITIAL_TEAM);
  const [activeCategory, setActiveCategory] = useState(null);
  const [activeVenue, setActiveVenue] = useState(null);
  const [jobRequests, setJobRequests] = useState(INITIAL_JOB_REQUESTS);
  const [proposalsData, setProposalsData] = useState(MOCK_PROPOSALS);
  
  // UI State
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('status'); // 'status', 'dueDate', 'name'
  const [editingDateId, setEditingDateId] = useState(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteForm, setInviteForm] = useState({ name: '', email: '' });
  const [viewingProposals, setViewingProposals] = useState(null);

  // 預算設定
  const [totalBudget] = useState(350000);

  // --- Checklist 邏輯 ---
  
  // 1. 處理搜尋及排序
  const displayTasks = useMemo(() => {
    let filtered = tasks;
    
    // 搜尋過濾
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = tasks.filter(t => 
        t.title.toLowerCase().includes(q) || 
        (t.venue && t.venue.toLowerCase().includes(q))
      );
    }

    // 排序邏輯
    return [...filtered].sort((a, b) => {
      if (sortBy === 'status') {
        if (a.isCompleted === b.isCompleted) {
          // 如果狀態一樣，按日期排
          return new Date(a.dueDate) - new Date(b.dueDate);
        }
        return a.isCompleted ? 1 : -1;
      }
      if (sortBy === 'dueDate') {
        return new Date(a.dueDate) - new Date(b.dueDate);
      }
      if (sortBy === 'name') {
        return a.title.localeCompare(b.title);
      }
      return 0;
    });
  }, [tasks, searchQuery, sortBy]);

  const completedTasks = tasks.filter(t => t.isCompleted).length;
  const progressPercentage = Math.round((completedTasks / tasks.length) * 100) || 0;

  // 預算計算 (只有 Owner 睇到真實數字)
  const totalSpent = tasks.reduce((sum, task) => sum + (task.isCompleted ? (task.actualCost || 0) : 0), 0);
  const remainingBudget = totalBudget - totalSpent;
  const budgetPercentage = Math.round((totalSpent / totalBudget) * 100);

  // --- 互動功能 ---
  
  const toggleTask = (taskId, e) => {
    e.stopPropagation();
    if (userRole === 'vendor') return; // Vendor 冇權改 Checklist
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
      if (activeCategory === tasks.find(t => t.id === taskId)?.category) {
        setActiveCategory(null);
      }
    }
  };

  // --- 新增任務表單 State ---
  const [newTaskForm, setNewTaskForm] = useState({
    categoryKey: 'other',
    customTitle: '',
    venue: '',
    dueDate: '',
    estimatedCost: '',
    taskType: 'vendor', // 'vendor' 或 'friend'
    assignee: ''
  });

  const handleAddTask = (e) => {
    e.preventDefault();
    if (newTaskForm.categoryKey === 'other' && !newTaskForm.customTitle) return;

    const title = newTaskForm.categoryKey === 'other' ? newTaskForm.customTitle : TASK_CATEGORIES[newTaskForm.categoryKey];
    
    const newTask = {
      id: Date.now(),
      title: title,
      category: newTaskForm.categoryKey,
      isCompleted: false,
      venue: newTaskForm.venue,
      dueDate: newTaskForm.dueDate || '2026-12-31',
      estimatedCost: Number(newTaskForm.estimatedCost) || 0,
      taskType: newTaskForm.taskType,
      assignee: newTaskForm.assignee
    };

    setTasks([...tasks, newTask]);
    // 重置表單
    setNewTaskForm({ categoryKey: 'other', customTitle: '', venue: '', dueDate: '', estimatedCost: '', taskType: 'vendor', assignee: '' });
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

  // --- 商戶配對邏輯 ---
  const filteredVendors = useMemo(() => {
    if (!activeCategory) return [];
    // 搵同 Category 嘅商戶
    let matched = VENDORS.filter(v => v.category === activeCategory);
    
    // 如果 Checklist 有寫 Venue，將有對應 Tag 嘅商戶排上啲
    if (activeVenue) {
      matched.sort((a, b) => {
        const aHasVenue = a.tags.some(tag => activeVenue.includes(tag) || tag.includes(activeVenue));
        const bHasVenue = b.tags.some(tag => activeVenue.includes(tag) || tag.includes(activeVenue));
        return bHasVenue - aHasVenue; // 有經驗嘅排前面
      });
    }
    return matched;
  }, [activeCategory, activeVenue]);


  // --- 求救板功能 (Job Board) ---
  const [newJobForm, setNewJobForm] = useState({ serviceNeeded: '場地佈置', venueInput: '', budget: '', details: '' });
  const [showJobSuccess, setShowJobSuccess] = useState(false);

  const handleJobSubmit = (e) => {
    e.preventDefault();
    if (!newJobForm.budget) return;
    const newJob = {
      id: `job-${Date.now()}`, coupleName: '主理新人', weddingDate: '2027年1月',
      serviceNeeded: newJobForm.serviceNeeded,
      venues: newJobForm.venueInput ? newJobForm.venueInput.split(',').map(v => v.trim()) : [],
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
      ...prev,
      [jobId]: [
        { id: Date.now().toString(), vendorName: 'Visionary Capture (2P1V)', rating: 4.9, price: '待定', message: '商戶已發送初步報價，請聯絡商戶了解詳情。', date: '剛剛' },
        ...(prev[jobId] || [])
      ]
    }));
  };

  // ==========================================
  // Render Components
  // ==========================================

  const renderRoleSimulator = () => (
    <div className="bg-slate-900 text-white text-sm py-2 px-4 flex justify-center items-center gap-4 z-50">
      <span className="font-bold flex items-center gap-1"><Users className="w-4 h-4 text-slate-400" /> 模擬身分切換：</span>
      <button 
        onClick={() => { setUserRole('owner'); setCurrentView('couple-checklist'); }}
        className={`px-3 py-1 rounded-full transition-colors ${userRole === 'owner' ? 'bg-rose-500 font-bold' : 'bg-slate-800 hover:bg-slate-700'}`}
      >👩🏻‍❤️‍👨🏻 主理新人</button>
      <button 
        onClick={() => { setUserRole('collaborator'); setCurrentView('couple-checklist'); }}
        className={`px-3 py-1 rounded-full transition-colors ${userRole === 'collaborator' ? 'bg-indigo-500 font-bold' : 'bg-slate-800 hover:bg-slate-700'}`}
      >👯‍♀️ 兄弟姊妹 (協作者)</button>
      <button 
        onClick={() => { setUserRole('vendor'); setCurrentView('vendor-dashboard'); }}
        className={`px-3 py-1 rounded-full transition-colors ${userRole === 'vendor' ? 'bg-emerald-500 font-bold' : 'bg-slate-800 hover:bg-slate-700'}`}
      >💼 商戶 (Vendor)</button>
    </div>
  );

  const renderCoupleChecklist = () => (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mt-8">
      {/* --- 左側：任務清單 --- */}
      <section className="lg:col-span-6 flex flex-col gap-4">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
          
          {/* Header & Controls */}
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
                <input 
                  type="text" placeholder="搜尋..." 
                  className="w-full sm:w-32 pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-rose-300"
                  value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="relative">
                <select 
                  className="appearance-none bg-slate-50 border border-slate-200 text-slate-700 py-2 pl-3 pr-8 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-rose-300 font-medium cursor-pointer"
                  value={sortBy} onChange={(e) => setSortBy(e.target.value)}
                >
                  <option value="status">按狀態 (未完成優先)</option>
                  <option value="dueDate">按到期日 (緊急優先)</option>
                  <option value="name">按名稱 (A-Z)</option>
                </select>
                <ArrowUpDown className="w-4 h-4 absolute right-2.5 top-2.5 text-slate-400 pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Task List */}
          <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 pb-4 custom-scrollbar">
            {displayTasks.map((task) => {
              const isUrgent = !task.isCompleted && new Date(task.dueDate) < new Date('2026-08-01');
              
              return (
                <div 
                  key={task.id} onClick={() => selectTask(task)}
                  className={`flex items-start p-3.5 rounded-xl transition-all cursor-pointer border group
                    ${task.isCompleted ? 'bg-slate-50/50 border-transparent opacity-75' : 
                      activeCategory === task.category && activeVenue === task.venue ? 'bg-rose-50 border-rose-200 shadow-sm ring-1 ring-rose-200' : 'bg-white border-slate-200 hover:border-rose-200 hover:shadow-sm'
                    }`}
                >
                  <button onClick={(e) => toggleTask(task.id, e)} className="mt-0.5 mr-3 flex-shrink-0" disabled={userRole === 'vendor'}>
                    {task.isCompleted ? <CheckCircle2 className="w-6 h-6 text-green-500" /> : <Circle className="w-6 h-6 text-slate-300 hover:text-rose-400" />}
                  </button>
                  
                  <div className="flex-grow min-w-0">
                     <div className="flex items-center flex-wrap gap-2 mb-1">
                        <span className={`font-bold truncate ${task.isCompleted ? 'line-through text-slate-500' : 'text-slate-800'}`}>
                          {task.title}
                        </span>
                        {/* 場地 Tag */}
                        {task.venue && (
                          <span className={`text-[10px] px-2 py-0.5 rounded-md flex items-center gap-1 ${task.isCompleted ? 'bg-slate-100 text-slate-500' : 'bg-slate-100 text-slate-600'}`}>
                            <MapPin className="w-3 h-3" /> {task.venue}
                          </span>
                        )}
                        {/* 負責人 Tag (如適用) */}
                        {task.taskType === 'friend' && (
                           <span className="text-[10px] px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 flex items-center gap-1 border border-indigo-100">
                             <Users className="w-3 h-3" /> {task.assignee || '需指派'}
                           </span>
                        )}
                     </div>
                     
                     <div className="flex items-center gap-4 text-xs">
                        {/* 日期編輯器 */}
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                           <Clock className={`w-3.5 h-3.5 ${isUrgent ? 'text-amber-500' : 'text-slate-400'}`} />
                           {editingDateId === task.id && userRole === 'owner' ? (
                              <input 
                                type="date" className="border border-slate-300 rounded px-1 py-0.5 bg-white text-slate-700 outline-none"
                                value={task.dueDate} onChange={(e) => updateDueDate(task.id, e.target.value)}
                                autoFocus onBlur={() => setEditingDateId(null)}
                              />
                           ) : (
                              <span 
                                className={`cursor-pointer hover:underline ${isUrgent ? 'text-amber-600 font-bold' : 'text-slate-500'}`}
                                onClick={() => userRole === 'owner' && setEditingDateId(task.id)}
                              >
                                {task.dueDate}
                              </span>
                           )}
                        </div>

                        {/* 金額顯示 (受權限控制) */}
                        {task.taskType === 'vendor' && (
                          <div className="flex items-center gap-1 text-slate-500">
                             <DollarSign className="w-3.5 h-3.5" />
                             {userRole === 'collaborator' ? '***' : 
                               task.isCompleted ? `實際: $${task.actualCost?.toLocaleString() || 0}` : `預算: $${task.estimatedCost?.toLocaleString() || 0}`
                             }
                          </div>
                        )}
                     </div>
                  </div>
                  
                  {/* Delete Button (Owner Only) */}
                  {userRole === 'owner' && (
                    <button onClick={(e) => deleteTask(task.id, e)} className="ml-2 p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  {!task.isCompleted && task.taskType === 'vendor' && <ArrowRight className={`ml-2 mt-1 w-4 h-4 flex-shrink-0 ${activeCategory === task.category ? 'text-rose-500' : 'text-slate-300'}`} />}
                </div>
              );
            })}
            {displayTasks.length === 0 && <div className="text-center py-8 text-slate-400">找不到相符的任務</div>}
          </div>

          {/* 新增任務表單 (Owner Only) */}
          {userRole === 'owner' && (
            <div className="mt-6 pt-5 border-t border-slate-100">
              <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-1"><Plus className="w-4 h-4"/> 新增籌備事項</h3>
              
              <div className="flex gap-2 mb-3">
                 <button 
                   onClick={() => setNewTaskForm({...newTaskForm, taskType: 'vendor', assignee: ''})}
                   className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition-colors ${newTaskForm.taskType === 'vendor' ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-white border-slate-200 text-slate-500'}`}
                 >💼 需要搵商戶</button>
                 <button 
                   onClick={() => setNewTaskForm({...newTaskForm, taskType: 'friend'})}
                   className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition-colors ${newTaskForm.taskType === 'friend' ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-200 text-slate-500'}`}
                 >👯‍♀️ 搵兄弟姊妹幫手</button>
              </div>

              <form onSubmit={handleAddTask} className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                  {/* 分類 / 標題 */}
                  <div className="sm:col-span-2">
                    <select 
                      className="w-full p-2.5 text-sm border border-slate-300 rounded-lg outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-400 bg-white"
                      value={newTaskForm.categoryKey} onChange={(e) => setNewTaskForm({...newTaskForm, categoryKey: e.target.value})}
                    >
                      <optgroup label="場地及佈置">
                        <option value="ceremony_venue">證婚場地</option>
                        <option value="banquet_venue">出門及晚宴場地</option>
                        <option value="deco">場地佈置</option>
                      </optgroup>
                      <optgroup label="團隊及統籌">
                        <option value="lawyer">證婚律師</option>
                        <option value="photography">攝影及錄影</option>
                        <option value="mua">新娘化妝師</option>
                        <option value="mc">司儀</option>
                      </optgroup>
                      <optgroup label="服飾及造型">
                        <option value="wedding_dress">婚紗及晚裝</option>
                        <option value="bridal_party_attire">姊妹裙及兄弟衫</option>
                      </optgroup>
                      <optgroup label="其他">
                        <option value="transport">花車及旅遊巴</option>
                        <option value="invitation">喜帖</option>
                        <option value="other">✏️ 自訂項目 (其他)...</option>
                      </optgroup>
                    </select>
                  </div>
                  
                  {newTaskForm.categoryKey === 'other' && (
                    <div className="sm:col-span-2">
                      <input 
                        type="text" placeholder="輸入自訂項目名稱..." required
                        className="w-full p-2.5 text-sm border border-slate-300 rounded-lg outline-none focus:border-rose-400 bg-white"
                        value={newTaskForm.customTitle} onChange={(e) => setNewTaskForm({...newTaskForm, customTitle: e.target.value})}
                      />
                    </div>
                  )}

                  {/* 場地 / 負責人 */}
                  <div className="sm:col-span-2">
                     {newTaskForm.taskType === 'vendor' ? (
                       <div className="relative">
                         <MapPin className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                         <input 
                           type="text" placeholder="📍 指定場地 (選填, 例如: 伯大尼)"
                           className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 rounded-lg outline-none focus:border-rose-400 bg-white"
                           value={newTaskForm.venue} onChange={(e) => setNewTaskForm({...newTaskForm, venue: e.target.value})}
                         />
                       </div>
                     ) : (
                       <div className="flex gap-2">
                         <select 
                           className="flex-grow p-2.5 text-sm border border-indigo-300 rounded-lg outline-none focus:border-indigo-500 bg-white text-indigo-900"
                           value={newTaskForm.assignee} onChange={(e) => setNewTaskForm({...newTaskForm, assignee: e.target.value})}
                         >
                           <option value="">選擇指派給...</option>
                           {teamMembers.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                         </select>
                         <button 
                           type="button" onClick={() => setShowInviteModal(true)}
                           className="px-3 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 transition-colors flex items-center justify-center border border-indigo-200" title="邀請新成員"
                         >
                           <UserPlus className="w-4 h-4" />
                         </button>
                       </div>
                     )}
                  </div>

                  <input 
                    type="date" required
                    className="p-2.5 text-sm border border-slate-300 rounded-lg outline-none focus:border-rose-400 bg-white text-slate-600"
                    value={newTaskForm.dueDate} onChange={(e) => setNewTaskForm({...newTaskForm, dueDate: e.target.value})}
                  />
                  {newTaskForm.taskType === 'vendor' && (
                    <input 
                      type="number" placeholder="大約預算 $" 
                      className="p-2.5 text-sm border border-slate-300 rounded-lg outline-none focus:border-rose-400 bg-white"
                      value={newTaskForm.estimatedCost} onChange={(e) => setNewTaskForm({...newTaskForm, estimatedCost: e.target.value})}
                    />
                  )}
                </div>
                <button type="submit" className={`w-full py-2.5 rounded-lg text-sm font-bold text-white transition-colors ${newTaskForm.taskType === 'vendor' ? 'bg-slate-900 hover:bg-slate-800' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
                  新增項目
                </button>
              </form>
            </div>
          )}
        </div>
      </section>

      {/* --- 右側：智能配對 --- */}
      <section className="lg:col-span-6">
        <div className="sticky top-28">
          {!activeCategory ? (
            <div className="bg-white rounded-2xl p-10 shadow-sm border border-slate-200 text-center flex flex-col items-center justify-center min-h-[400px] bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-rose-50/50 via-white to-white">
              <div className="w-20 h-20 bg-rose-100 rounded-full flex items-center justify-center mb-5 shadow-inner">
                 <Briefcase className="w-10 h-10 text-rose-400" />
              </div>
              <h3 className="text-xl font-bold text-slate-700 mb-2">點擊左側未完成任務</h3>
              <p className="text-slate-500 max-w-sm text-sm leading-relaxed">
                系統會根據你填寫的項目及「指定場地」，利用 AI 自動為你篩選具備相關經驗的香港優質商戶。
              </p>
            </div>
          ) : (
            <div className="bg-transparent">
              <div className="mb-5 flex items-end justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">智能配對推薦</h2>
                  <p className="text-rose-600 font-medium text-sm mt-1">
                    正在尋找：{TASK_CATEGORIES[activeCategory] || '商戶'} 
                    {activeVenue && <span className="text-slate-500"> @ {activeVenue}</span>}
                  </p>
                </div>
                <span className="text-xs font-bold text-slate-500 bg-white px-3 py-1.5 rounded-full border border-slate-200 shadow-sm">
                  {filteredVendors.length} 個結果
                </span>
              </div>

              <div className="space-y-4 max-h-[750px] overflow-y-auto pr-2 custom-scrollbar">
                {filteredVendors.length > 0 ? (
                  filteredVendors.map(vendor => {
                    // Highlight logic
                    const isPerfectMatch = activeVenue && vendor.tags.some(tag => activeVenue.includes(tag) || tag.includes(activeVenue));
                    
                    return (
                      <div key={vendor.id} className={`bg-white rounded-2xl p-6 shadow-sm border transition-all ${isPerfectMatch ? 'border-rose-300 ring-1 ring-rose-100' : 'border-slate-100 hover:border-slate-300'}`}>
                        {isPerfectMatch && (
                           <div className="absolute top-0 right-6 -translate-y-1/2 bg-gradient-to-r from-rose-500 to-pink-500 text-white text-[10px] font-bold px-3 py-1 rounded-full shadow-sm flex items-center gap-1">
                             <MapPin className="w-3 h-3" /> 場地經驗匹配
                           </div>
                        )}
                        <div className="flex gap-2 mb-3 flex-wrap">
                          {vendor.tags.map(tag => (
                            <span key={tag} className={`text-xs font-bold px-2.5 py-1 rounded-md ${activeVenue && (activeVenue.includes(tag) || tag.includes(activeVenue)) ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
                              {tag}
                            </span>
                          ))}
                        </div>
                        <div className="flex justify-between items-start mb-1">
                            <h3 className="text-lg font-bold text-slate-800">{vendor.name}</h3>
                        </div>
                        <div className="flex items-center gap-3 text-sm mb-4">
                            <span className="font-bold text-slate-700 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">{vendor.price}</span>
                            <span className="flex items-center gap-1 text-slate-500 font-medium">
                              <Star className="w-4 h-4 fill-amber-400 text-amber-400" /> {vendor.rating}
                            </span>
                        </div>
                        <div className="flex gap-2 mt-4">
                           <button className="flex-1 bg-slate-900 text-white py-2 rounded-xl text-sm font-bold hover:bg-slate-800 transition-colors">
                             查看作品集
                           </button>
                           <button className="flex-1 bg-rose-50 text-rose-700 border border-rose-200 py-2 rounded-xl text-sm font-bold hover:bg-rose-100 transition-colors">
                             索取報價
                           </button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200 text-center flex flex-col items-center">
                    <p className="text-slate-500 mb-4 font-medium">資料庫暫時未有此場地的推薦商戶。</p>
                    <button 
                      onClick={() => setCurrentView('couple-jobboard')}
                      className="bg-rose-100 text-rose-700 font-bold px-6 py-2.5 rounded-xl hover:bg-rose-200 transition-colors"
                    >
                      不如去「求救板」出 Post 等 Vendor 搵你？
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 團隊邀請 Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
           <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2"><Mail className="w-5 h-5 text-indigo-500"/> 邀請兄弟姊妹加入</h3>
              <form onSubmit={handleInvite} className="space-y-4">
                 <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">稱呼 (例如: 伴郎 Kevin)</label>
                    <input type="text" required className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:border-indigo-500" value={inviteForm.name} onChange={e => setInviteForm({...inviteForm, name: e.target.value})} />
                 </div>
                 <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">Email 電郵地址</label>
                    <input type="email" required className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:border-indigo-500" value={inviteForm.email} onChange={e => setInviteForm({...inviteForm, email: e.target.value})} />
                 </div>
                 <div className="flex gap-2 mt-6">
                    <button type="button" onClick={() => setShowInviteModal(false)} className="flex-1 py-2 text-slate-600 bg-slate-100 rounded-lg font-bold">取消</button>
                    <button type="submit" className="flex-1 py-2 text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg font-bold">發送邀請</button>
                 </div>
              </form>
           </div>
        </div>
      )}
    </div>
  );

  const renderCoupleJobBoard = () => (
    <div className="max-w-4xl mx-auto mt-8">
      <div className="bg-white rounded-2xl p-8 shadow-sm border border-rose-100 mb-8 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-rose-50/30 via-white to-white">
        <div className="flex items-start sm:items-center gap-4 mb-6">
          <div className="bg-rose-100 p-3 rounded-2xl flex-shrink-0">
             <AlertCircle className="w-8 h-8 text-rose-500" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-800">出 Post 求救</h2>
            <p className="text-slate-500 text-sm mt-1">配對唔到心水？將你嘅要求、Budget、指定場地列出嚟，等全港 Vendor 主動搵你報價！</p>
          </div>
        </div>

        {showJobSuccess && (
          <div className="bg-green-50 text-green-700 p-4 rounded-xl mb-6 flex items-center gap-2 border border-green-200 font-bold">
            <CheckCircle2 className="w-5 h-5" /> 求救 Post 已成功發佈！商戶會盡快聯絡你。
          </div>
        )}

        <form onSubmit={handleJobSubmit} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">需要咩服務？</label>
              <select className="w-full p-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-rose-300 focus:border-rose-300 outline-none transition-all bg-white"
                value={newJobForm.serviceNeeded} onChange={e => setNewJobForm({...newJobForm, serviceNeeded: e.target.value})}
              >
                 {Object.values(TASK_CATEGORIES).map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">大約預算 Budget</label>
              <input 
                type="text" required placeholder="例如: $15,000 - $20,000"
                className="w-full p-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-rose-300 focus:border-rose-300 outline-none transition-all"
                value={newJobForm.budget} onChange={e => setNewJobForm({...newJobForm, budget: e.target.value})}
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-bold text-slate-700 mb-1">指定場地經驗 (選填)</label>
              <input 
                type="text" placeholder="例如: 伯大尼, Ritz Carlton (以逗號分隔)"
                className="w-full p-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-rose-300 focus:border-rose-300 outline-none transition-all"
                value={newJobForm.venueInput} onChange={e => setNewJobForm({...newJobForm, venueInput: e.target.value})}
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-bold text-slate-700 mb-1">詳細要求</label>
              <textarea 
                rows="4" required placeholder="講多少少你嘅期望、風格、特別要求... (例如: 要有特高樓底設計經驗，鍾意白綠色系)"
                className="w-full p-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-rose-300 focus:border-rose-300 outline-none transition-all resize-none"
                value={newJobForm.details} onChange={e => setNewJobForm({...newJobForm, details: e.target.value})}
              ></textarea>
            </div>
          </div>
          <button type="submit" className="w-full bg-rose-600 text-white font-bold py-3.5 rounded-xl hover:bg-rose-700 transition-colors flex justify-center items-center gap-2 shadow-sm">
            <Send className="w-5 h-5" /> 立即發佈到「商戶大堂」
          </button>
        </form>
      </div>
      
      {/* 顯示自己出過嘅 Post */}
      <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">我發佈過嘅求救記錄</h3>
      <div className="space-y-4">
         {jobRequests.filter(j => j.coupleName === '主理新人' || j.coupleName === 'Chantal & Fiance').map(job => (
             <div key={job.id} className="bg-white rounded-xl p-5 border border-slate-200 flex justify-between items-center hover:border-rose-200 transition-colors">
                 <div>
                    <h4 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                      {job.serviceNeeded}
                      {job.venues.length > 0 && <span className="bg-slate-100 text-slate-600 text-[10px] px-2 py-0.5 rounded border border-slate-200">@ {job.venues.join(', ')}</span>}
                    </h4>
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
      <div className="bg-slate-900 rounded-2xl p-8 text-white mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-3">
            <Briefcase className="w-7 h-7 text-emerald-400" /> 商戶接單大堂 (Vendor Board)
          </h2>
          <p className="text-slate-400 mt-2 text-sm">瀏覽全港新人發佈的急切要求，主動發送報價單發掘潛在客源。</p>
        </div>
        <div className="bg-slate-800/80 backdrop-blur px-5 py-3 rounded-xl border border-slate-700">
           <div className="text-xs text-slate-400 mb-0.5">當前登入商戶：</div>
           <div className="font-bold text-emerald-400 text-lg">Visionary Capture (2P1V)</div>
           <div className="flex gap-2 mt-2">
             <span className="bg-slate-700 text-slate-300 text-[10px] px-2 py-0.5 rounded">伯大尼經驗</span>
             <span className="bg-slate-700 text-slate-300 text-[10px] px-2 py-0.5 rounded">Ritz Carlton經驗</span>
           </div>
        </div>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-bold text-slate-800">最新新人求救 ({jobRequests.length})</h3>
        <select className="bg-white border border-slate-200 text-slate-700 py-2 px-4 rounded-lg text-sm font-bold outline-none">
          <option>顯示所有類別</option>
          <option>只顯示「攝影及錄影」</option>
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {jobRequests.map((job) => {
          // Highlight match logic for vendor
          const isMatch = job.venues.some(v => v.includes('伯大尼') || v.includes('Ritz'));
          const isCategoryMatch = job.serviceNeeded.includes('攝影');

          return (
            <div key={job.id} className={`bg-white rounded-2xl p-6 shadow-sm border transition-all flex flex-col h-full relative overflow-hidden group ${isMatch || isCategoryMatch ? 'border-emerald-300 hover:shadow-md ring-1 ring-emerald-50' : 'border-slate-200 hover:border-slate-300'}`}>
              
              {(isMatch || isCategoryMatch) && (
                <div className="absolute top-0 right-0 bg-emerald-500 text-white text-[10px] font-bold px-3 py-1 rounded-bl-lg">
                  與你的專長匹配
                </div>
              )}

              <div className="mb-4 mt-2">
                <h3 className="text-xl font-bold text-slate-800 mb-1">{job.serviceNeeded}</h3>
                <p className="text-sm text-slate-500 font-medium">客戶: {job.coupleName} • 發佈於 {job.postedAt}</p>
              </div>

              <div className="space-y-3 mb-6 flex-grow bg-slate-50 p-4 rounded-xl border border-slate-100">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500 flex items-center gap-1.5"><Calendar className="w-4 h-4" /> 婚期</span>
                  <strong className="text-slate-800">{job.weddingDate}</strong>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500 flex items-center gap-1.5"><DollarSign className="w-4 h-4" /> 預算</span>
                  <strong className="text-rose-600">{job.budget}</strong>
                </div>
                {job.venues && job.venues.length > 0 && (
                  <div className="flex items-start justify-between text-sm border-t border-slate-200 pt-3 mt-3">
                    <span className="text-slate-500 flex items-center gap-1.5"><MapPin className="w-4 h-4" /> 指定場地</span>
                    <div className="flex flex-wrap gap-1 justify-end">
                      {job.venues.map(v => (
                         <span key={v} className="bg-white border border-slate-200 text-slate-700 px-2 py-0.5 rounded font-bold text-xs shadow-sm">{v}</span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="text-sm text-slate-700 mt-3 pt-3 border-t border-slate-200 leading-relaxed">
                  <span className="text-slate-400 block mb-1 text-xs">詳細要求：</span>
                  "{job.details}"
                </div>
              </div>

              <button onClick={() => submitProposal(job.id)} className="w-full bg-emerald-600 text-white font-bold py-3 rounded-xl hover:bg-emerald-700 transition-colors flex justify-center items-center gap-2 shadow-sm">
                <MessageSquare className="w-5 h-5" /> 立即發送報價單
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderCoupleBudget = () => (
    <div className="max-w-5xl mx-auto mt-8">
      <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200 mb-8">
        <h2 className="text-2xl font-bold text-slate-800 mb-6 flex items-center gap-2">
          <Wallet className="w-7 h-7 text-rose-500" />
          預算管理與明細 (Budget Tracker)
        </h2>
        
        {/* 預算大數據儀表板 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
           <div className="bg-slate-50 rounded-xl p-5 border border-slate-200 shadow-sm">
               <p className="text-sm text-slate-500 mb-1 font-bold">總預算目標 (HKD)</p>
               <p className="text-3xl font-black text-slate-800">${totalBudget.toLocaleString()}</p>
           </div>
           <div className="bg-rose-50 rounded-xl p-5 border border-rose-200 shadow-sm relative overflow-hidden">
               <div className="absolute right-0 top-0 w-16 h-16 bg-rose-100 rounded-bl-full -mr-4 -mt-4"></div>
               <p className="text-sm text-rose-700 mb-1 font-bold relative z-10">已確認開支 (已完成項目)</p>
               <p className="text-3xl font-black text-rose-700 relative z-10">${totalSpent.toLocaleString()}</p>
           </div>
           <div className={`rounded-xl p-5 border shadow-sm ${remainingBudget < 0 ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
               <p className={`text-sm mb-1 font-bold ${remainingBudget < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                 剩餘可分配預算
               </p>
               <p className={`text-3xl font-black ${remainingBudget < 0 ? 'text-red-700' : 'text-emerald-600'}`}>
                 ${remainingBudget.toLocaleString()}
               </p>
           </div>
        </div>

        {/* 進度條 */}
        <div className="mb-10 bg-slate-50 p-5 rounded-xl border border-slate-100">
           <div className="flex justify-between text-sm mb-2">
              <span className="font-bold text-slate-700 flex items-center gap-2"><PieChart className="w-4 h-4"/>預算消耗進度</span>
              <span className="font-black text-slate-800">{budgetPercentage}%</span>
           </div>
           <div className="w-full bg-slate-200 rounded-full h-4 overflow-hidden shadow-inner">
              <div 
                className={`h-full transition-all duration-1000 ease-out relative ${budgetPercentage > 100 ? 'bg-red-500' : 'bg-gradient-to-r from-rose-400 to-rose-500'}`} 
                style={{ width: `${Math.min(budgetPercentage, 100)}%` }}
              >
                <div className="absolute inset-0 bg-white/20 w-full h-full bg-[length:20px_20px] bg-[linear-gradient(45deg,transparent_25%,rgba(255,255,255,0.3)_25%,rgba(255,255,255,0.3)_50%,transparent_50%,transparent_75%,rgba(255,255,255,0.3)_75%,rgba(255,255,255,0.3)_100%)] opacity-50"></div>
              </div>
           </div>
           {budgetPercentage > 100 && <p className="text-xs text-red-500 font-bold mt-2">⚠️ 警告：目前開支已超出預算目標！</p>}
        </div>

        {/* 開支明細列表 */}
        <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">所有項目開支明細</h3>
        <div className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
            {/* Table Header (Desktop) */}
            <div className="hidden sm:grid grid-cols-12 gap-4 p-4 bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
               <div className="col-span-6">項目名稱及場地</div>
               <div className="col-span-2 text-center">狀態</div>
               <div className="col-span-4 text-right">金額 (HKD)</div>
            </div>

            <div className="divide-y divide-slate-100">
              {tasks.map(task => (
                 <div key={task.id} className="grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-4 p-4 bg-white hover:bg-slate-50 transition-colors items-center">
                     
                     <div className="sm:col-span-6 flex items-start sm:items-center gap-3">
                         {task.isCompleted ? <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5 sm:mt-0" /> : <Circle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5 sm:mt-0" />}
                         <div>
                           <div className="font-bold text-slate-800 flex flex-wrap items-center gap-2">
                             {task.title}
                             {task.taskType === 'friend' && <span className="bg-indigo-100 text-indigo-700 text-[10px] px-2 py-0.5 rounded-full border border-indigo-200">非商戶</span>}
                           </div>
                           {task.venue && <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1"><MapPin className="w-3 h-3"/>{task.venue}</div>}
                         </div>
                     </div>

                     <div className="sm:col-span-2 text-left sm:text-center mt-2 sm:mt-0 pl-8 sm:pl-0">
                         {task.isCompleted 
                           ? <span className="bg-green-100 text-green-700 text-xs font-bold px-2.5 py-1 rounded">已確認 (已付款)</span>
                           : <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2.5 py-1 rounded">籌備中 (預算)</span>
                         }
                     </div>

                     <div className="sm:col-span-4 text-left sm:text-right mt-1 sm:mt-0 pl-8 sm:pl-0 font-mono">
                         {task.isCompleted ? (
                             <>
                               <span className="text-slate-400 text-xs sm:hidden mr-2">實際：</span>
                               <span className="font-bold text-slate-800 text-lg">${task.actualCost?.toLocaleString() || 0}</span>
                             </>
                         ) : (
                             <>
                               <span className="text-slate-400 text-xs sm:hidden mr-2">預計：</span>
                               <span className="text-slate-400 font-medium">${task.estimatedCost?.toLocaleString() || 0}</span>
                             </>
                         )}
                     </div>
                 </div>
              ))}
            </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-10">
      {/* 頂部身分切換 Bar */}
      {renderRoleSimulator()}

      {/* 導航 (Tabs) - 根據身分動態顯示 */}
      <header className="bg-white shadow-sm sticky top-0 z-40 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
             <h1 className="text-xl font-black text-slate-800 flex items-center gap-2 tracking-tight">
                <Heart className="w-6 h-6 fill-rose-500 text-rose-500" />
                WeddingMatch <span className="text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 ml-2 hidden sm:inline-block">2027年1月 💒 伯大尼 x Ritz Carlton</span>
             </h1>
          </div>
          <div className="flex space-x-1 overflow-x-auto custom-scrollbar">
            
            {/* 新人 & 協作者 Tabs */}
            {(userRole === 'owner' || userRole === 'collaborator') && (
              <button 
                onClick={() => setCurrentView('couple-checklist')}
                className={`px-4 py-3 text-sm font-bold border-b-[3px] whitespace-nowrap transition-colors ${currentView === 'couple-checklist' ? 'border-rose-500 text-rose-600' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}
              >
                📋 {userRole === 'owner' ? '我的籌備' : '團隊籌備'}
              </button>
            )}

            {/* 只有 Owner 睇到嘅 Tabs */}
            {userRole === 'owner' && (
              <>
                <button 
                  onClick={() => setCurrentView('couple-budget')}
                  className={`px-4 py-3 text-sm font-bold border-b-[3px] whitespace-nowrap transition-colors ${currentView === 'couple-budget' ? 'border-rose-500 text-rose-600' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}
                >
                  💰 預算管理
                </button>
                <div className="w-px h-5 bg-slate-300 my-auto mx-2 hidden sm:block"></div>
                <button 
                  onClick={() => setCurrentView('couple-jobboard')}
                  className={`px-4 py-3 text-sm font-bold border-b-[3px] whitespace-nowrap transition-colors flex items-center gap-1 ${currentView === 'couple-jobboard' ? 'border-rose-500 text-rose-600' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}
                >
                  🆘 出Post求救 <span className="bg-rose-100 text-rose-600 text-[10px] px-1.5 py-0.5 rounded-full">搵Vendor</span>
                </button>
              </>
            )}

            {/* 商戶專用 Tab */}
            {userRole === 'vendor' && (
              <button 
                onClick={() => setCurrentView('vendor-dashboard')}
                className={`px-4 py-3 text-sm font-bold border-b-[3px] whitespace-nowrap transition-colors ${currentView === 'vendor-dashboard' ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}
              >
                💼 商戶接單大堂
              </button>
            )}
          </div>
        </div>
      </header>

      {/* 內容區 */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {(userRole === 'owner' || userRole === 'collaborator') && currentView === 'couple-checklist' && renderCoupleChecklist()}
        {userRole === 'owner' && currentView === 'couple-jobboard' && renderCoupleJobBoard()}
        {userRole === 'vendor' && currentView === 'vendor-dashboard' && renderVendorDashboard()}
        
        {userRole === 'owner' && currentView === 'couple-budget' && renderCoupleBudget()}
      </main>
      
      {/* 報價單彈出視窗 (Proposals Modal) */}
      {viewingProposals && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-2xl w-full shadow-xl max-h-[85vh] flex flex-col">
            <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-4">
              <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-rose-500" />
                商戶報價單
              </h3>
              <button onClick={() => setViewingProposals(null)} className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="overflow-y-auto custom-scrollbar pr-2 flex-grow">
              {proposalsData[viewingProposals] && proposalsData[viewingProposals].length > 0 ? (
                proposalsData[viewingProposals].map(p => (
                  <div key={p.id} className="mb-4 p-5 border border-slate-200 rounded-xl bg-slate-50 hover:border-rose-200 transition-colors">
                    <div className="flex justify-between items-start mb-2">
                      <div className="font-bold text-slate-800 text-lg">{p.vendorName}</div>
                      <div className="font-bold text-rose-600 text-lg">{p.price}</div>
                    </div>
                    <div className="flex items-center gap-1 text-sm text-slate-500 mb-3">
                      <Star className="w-4 h-4 text-amber-400 fill-amber-400" /> <span className="font-medium">{p.rating}</span> • {p.date}
                    </div>
                    <p className="text-sm text-slate-700 leading-relaxed bg-white p-3 rounded-lg border border-slate-100">
                      "{p.message}"
                    </p>
                    <div className="mt-4 flex gap-3">
                      <button className="flex-1 bg-slate-900 text-white py-2.5 rounded-lg text-sm font-bold hover:bg-slate-800 transition-colors">
                        聯絡商戶
                      </button>
                      <button className="flex-1 bg-white border border-slate-300 text-slate-700 py-2.5 rounded-lg text-sm font-bold hover:bg-slate-50 transition-colors">
                        婉拒
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center text-slate-500 py-10 flex flex-col items-center">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-3">
                    <MessageSquare className="w-8 h-8 text-slate-300" />
                  </div>
                  暫時未有商戶發送報價，請耐心等候。
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Scrollbar Style */}
      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #f1f5f9; 
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #cbd5e1; 
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #94a3b8; 
        }
      `}} />
    </div>
  );
}