// App-wide constants. Kept in plain TS so screens can import what they need
// without pulling the entire App.jsx in.

export const TASK_CATEGORIES: Record<string, string> = {
  ceremony_venue: '證婚場地',
  banquet_venue: '出門及晚宴場地',
  deco: '場地佈置',
  lawyer: '證婚律師',
  photography: '婚禮攝影及錄影',
  mua: '新娘化妝師 (MUA)',
  bridesmaid_mua: '姊妹化妝',
  mc: '婚禮司儀 (MC)',
  chaperone: '大妗姐',
  planner: '婚禮統籌',
  rings: '結婚戒指',
  wedding_dress: '婚紗及晚裝',
  groom_suit: '男裝禮服',
  bridal_party_attire: '姊妹裙及兄弟衫',
  parents_attire: '四大長老服飾',
  rituals: '過大禮物資',
  photobooth: 'Photo booth',
  gifts: '回禮禮物',
  transport: '花車及旅遊巴',
  invitation: '喜帖',
  honeymoon: '蜜月旅行',
  other: '自訂項目',
};

export const FREE_TIER_LIMIT_MB = 100;

export type Vendor = {
  id: number;
  name: string;
  category: string;
  rating: number;
  price: string;
  tags: string[];
  description: string;
  portfolio: string[];
};

// Default vendors for the Discover and Smart Match tabs.
export const DEFAULT_VENDORS: Vendor[] = [
  {
    id: 101,
    name: 'Visionary Capture',
    category: 'photography',
    rating: 4.9,
    price: '$18,000+',
    tags: ['伯大尼', 'Ritz Carlton', '紀實唯美'],
    description: '超過10年頂級酒店及教堂拍攝經驗，擅長捕捉自然流露的情感與光影。',
    portfolio: [
      'https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=400&q=80',
      'https://images.unsplash.com/photo-1606800052052-a08af7148866?auto=format&fit=crop&w=400&q=80',
    ],
  },
  {
    id: 102,
    name: 'Light & Shadow Studio',
    category: 'photography',
    rating: 4.7,
    price: '$15,000+',
    tags: ['伯大尼'],
    description: '自然唯美風格，專注海外及本地特色教堂拍攝。',
    portfolio: ['https://images.unsplash.com/photo-1537368910025-700350fe46c7?auto=format&fit=crop&w=400&q=80'],
  },
  {
    id: 103,
    name: 'FairyTale Floral',
    category: 'deco',
    rating: 4.8,
    price: '$25,000+',
    tags: ['Ritz Carlton', '奢華花藝'],
    description: '專為五星級酒店設計的頂尖佈置團隊，提供全方位 3D 模擬圖。',
    portfolio: ['https://images.unsplash.com/photo-1469334031218-e382a71b716b?auto=format&fit=crop&w=400&q=80'],
  },
  {
    id: 104,
    name: 'Bethanie Charm Deco',
    category: 'deco',
    rating: 4.6,
    price: '$8,000+',
    tags: ['伯大尼', '小清新'],
    description: '專為伯大尼教堂設計的佈置套餐。',
    portfolio: ['https://images.unsplash.com/photo-1519225421980-715cb0215aed?auto=format&fit=crop&w=400&q=80'],
  },
];

export type JobRequest = {
  id: string;
  coupleName: string;
  weddingDate: string;
  serviceNeeded: string;
  venues: string[];
  budget: string;
  details: string;
  status: 'open' | 'closed';
  proposalsCount: number;
  postedAt: string;
};

export const INITIAL_JOB_REQUESTS: JobRequest[] = [
  {
    id: 'job-1',
    coupleName: 'Chantal & Fiance',
    weddingDate: '2027年1月',
    serviceNeeded: '場地佈置',
    venues: ['Ritz Carlton'],
    budget: '$20,000 - $30,000',
    details: '需要做過Ritz Carlton嘅佈置，有特高樓底設計經驗優先。',
    status: 'open',
    proposalsCount: 2,
    postedAt: '2小時前',
  },
  {
    id: 'job-2',
    coupleName: 'Mandy & Kevin',
    weddingDate: '2026年11月',
    serviceNeeded: '婚禮攝影及錄影',
    venues: ['伯大尼小教堂'],
    budget: '$8,000 - $12,000',
    details: '需要半日伯大尼教堂行禮拍攝。必須要有伯大尼拍攝經驗。',
    status: 'open',
    proposalsCount: 0,
    postedAt: '1日前',
  },
];

export type Proposal = {
  id: string;
  vendorName: string;
  rating: number;
  price: string;
  message: string;
  date: string;
};

export const MOCK_PROPOSALS: Record<string, Proposal[]> = {
  'job-1': [
    {
      id: 'p1',
      vendorName: 'FairyTale Floral',
      rating: 4.8,
      price: '$22,000',
      message: '我哋對 Ritz Carlton 嘅特高樓底非常有經驗，白綠色系小清新加香檳金絕對做到你要嘅效果。',
      date: '1小時前',
    },
    {
      id: 'p2',
      vendorName: 'Elegance Wedding',
      rating: 4.6,
      price: '$28,500',
      message: '可以安排睇真實 Reference 相片。',
      date: '30分鐘前',
    },
  ],
};
