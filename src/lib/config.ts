// App-wide constants. Kept in plain TS so screens can import what they need
// without pulling the entire App.jsx in.

// TASK_CATEGORIES — flat key → Chinese label map. Used by the
// COUPLE-SIDE task picker (CoupleChecklist, CoupleJobBoard,
// CoupleBudget) so couples can plan tasks that line up 1:1 with
// the categories vendors can register under (see VENDOR_CATEGORIES
// below for the hierarchical source of truth).
//
// 2026-07-15 — expanded from 6 hand-picked categories to all 13
// top-level vendor categories + sub-services, so couples searching
// for any vendor type (e.g. 婚禮蛋糕, 過大禮物資, 蜜月旅遊) can
// find it in the dropdown. Keys are namespaced as `${topKey}.${subKey}`
// for sub-services (e.g. 'venue.banquet_hall') so they coexist with
// the legacy flat keys ('ceremony_venue', 'deco', etc.) and don't
// break existing task docs in Firestore.
//
// getTaskCategoryLabel() resolves a namespaced key back to its
// Chinese label, with safe fallback to the flat map for legacy keys.
export const TASK_CATEGORIES: Record<string, string> = {
  // ---- Legacy flat keys (kept for backward-compat with existing
  //      task docs in Firestore) ----
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

  // ---- New keys namespaced as top.sub, derived from VENDOR_CATEGORIES.
  //      Picker uses these directly. Existing tasks without a subcategory
  //      still match their legacy key. ----
  ...Object.fromEntries(
    Object.entries(VENDOR_CATEGORIES).flatMap(([topKey, top]) => [
      [topKey, top.label],
      ...Object.entries(top.subs).map(([subKey, subLabel]) => [
        `${topKey}.${subKey}`,
        subLabel,
      ]),
    ]),
  ),
};

// Lookup helper for the task picker. Resolves:
//   'venue'                          → '婚宴場地'
//   'venue.banquet_hall'             → '酒店宴會廳'
//   'ceremony_venue' (legacy)        → '證婚場地' (via fallback)
//   'something.weird' (unknown)      → 'something.weird' (raw)
export function getTaskCategoryLabel(key: string): string {
  if (!key) return '';
  if (TASK_CATEGORIES[key]) return TASK_CATEGORIES[key];
  // Sub-service key with no exact match — try splitting on '.' to
  // fall back to just the top label (defensive: in case a task was
  // saved with a sub-only key).
  if (key.includes('.')) {
    const [top] = key.split('.');
    return TASK_CATEGORIES[top] || key;
  }
  return key;
}

// VENDOR_CATEGORIES — hierarchical (top-level category → sub-services).
// Used by:
//   - src/components/onboarding/Step2Business.jsx  (initial wizard picker)
//   - src/screens/VendorProfileEdit.jsx           (post-onboarding edits)
//   - src/screens/VendorDashboard.jsx             (pill display)
//
// Shape: { [topKey]: { label, icon, subs: { [subKey]: subLabel } } }
//
// Each vendor doc stores:
//   category    = topKey  (e.g. 'venue', 'photo_video')
//   subcategory = subKey  (e.g. 'banquet_hall', 'photographer')
//
// Backward-compat: existing vendor docs without subcategory still work;
// the dashboard pill falls back to TASK_CATEGORIES[category] (the
// original flat label) when subcategory is missing.
export const VENDOR_CATEGORIES: Record<string, {
  label: string;
  icon: string; // emoji
  subs: Record<string, string>;
}> = {
  venue: {
    label: '婚宴場地',
    icon: '🏛️',
    subs: {
      banquet_hall: '酒店宴會廳',
      unique_venue: '特色場地 (工廈/戶外)',
      chapel_registry: '教堂 / 登記處',
      cruise_wedding: '遊艇 / 海上婚禮',
    },
  },
  officiant: {
    label: '統籌服務',
    icon: '👰',
    subs: {
      planner: '婚禮統籌師',
    },
  },
  ceremony_staff: {
    label: '人員服務',
    icon: '🎤',
    subs: {
      mc: '婚禮司儀 (MC)',
      chaperone: '大妗姐',
      celebrant: '證婚監禮人',
    },
  },
  photo_video: {
    label: '攝影攝錄',
    icon: '🎥',
    subs: {
      photographer: '婚禮攝影師',
      videographer: '婚禮攝錄師',
      pre_wedding: 'Pre-wedding 攝影',
      photobooth: '即影即有攝影 (Booth)',
    },
  },
  styling: {
    label: '造型服務',
    icon: '💄',
    subs: {
      bride_mua: '新娘化妝師',
      groom_styling: '新郎造型',
      wedding_dress_buy: '裙褂婚紗晚裝禮服 (購買)',
      wedding_dress_rent: '裙褂婚紗晚裝禮服 (租借)',
      western_tailor: '西裝訂製/租借',
    },
  },
  floral_deco: {
    label: '佈置花藝',
    icon: '🌸',
    subs: {
      wedding_floral: '婚禮花藝佈置',
      venue_deco: '場地佈置設計',
      bridal_bouquet: '新娘花球',
    },
  },
  catering: {
    label: '餐飲',
    icon: '🍽️',
    subs: {
      wedding_wine: '婚宴酒席 (per table)',
      wedding_cake: '婚禮蛋糕',
      catering_service: '到會服務 (Catering)',
      drinks_beverage: '酒水/飲品',
    },
  },
  music: {
    label: '音樂娛樂',
    icon: '🎵',
    subs: {
      live_band: '婚禮樂隊/樂手',
      dj: 'DJ 服務',
      sound_light: '音響燈光設備',
    },
  },
  print_design: {
    label: '印刷設計',
    icon: '📄',
    subs: {
      invitation_card: '喜帖設計及印刷',
      table_card: '桌卡/場地指示牌',
      wedding_favours: '婚禮小禮物 (Favour)',
    },
  },
  ceremony_goods: {
    label: '傳統禮儀',
    icon: '🧧',
    subs: {
      betrothal_gifts: '過大禮物資',
      bed_setting: '安床儀式',
      hairpin_ritual: '上頭儀式物資',
    },
  },
  transport: {
    label: '交通',
    icon: '🚗',
    subs: {
      bridal_car: '婚禮花車',
      guest_bus: '賓客接駁巴士',
    },
  },
  honeymoon: {
    label: '蜜月旅行',
    icon: '✈️',
    subs: {
      honeymoon_ticket: '蜜月旅遊套票',
      hotel: '酒店住宿',
    },
  },
  miscellaneous: {
    label: '雜項',
    icon: '💰',
    subs: {
      cash_buffer: '預備金 (Buffer 10%)',
    },
  },
};

// Lookup helpers — use these everywhere instead of indexing the raw
// object. They handle missing keys (returns Chinese label or raw key)
// and missing subcategory (returns just the parent label).
export function getVendorCategoryLabel(category: string, subcategory?: string): string {
  const top = VENDOR_CATEGORIES[category];
  if (!top) {
    // Fallback to flat TASK_CATEGORIES for legacy docs.
    return TASK_CATEGORIES[category] || category || '';
  }
  if (subcategory && top.subs[subcategory]) {
    return `${top.label} · ${top.subs[subcategory]}`;
  }
  return top.label;
}

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
