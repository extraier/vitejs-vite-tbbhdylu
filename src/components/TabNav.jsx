import { Camera, Crown } from 'lucide-react';

export function TabNav({ userRole, currentView, isPremium, onNavigate }) {
  return (
    <div className="flex space-x-1 overflow-x-auto custom-scrollbar">
      {userRole === 'owner' && (
        <>
          <NavTab current={currentView} view="couple-checklist" onClick={onNavigate} color="rose">
            📋 籌備清單
          </NavTab>
          <NavTab current={currentView} view="couple-budget" onClick={onNavigate} color="rose">
            💰 預算管理
          </NavTab>
          <NavTab current={currentView} view="discover-vendors" onClick={onNavigate} color="rose">
            🔍 商戶指南
          </NavTab>
          <div className="w-px h-5 bg-slate-300 my-auto mx-2 hidden sm:block"></div>
          <NavTab current={currentView} view="couple-jobboard" onClick={onNavigate} color="rose">
            🆘 出Post求救{' '}
            <span className="bg-rose-100 text-rose-600 text-[10px] px-1.5 py-0.5 rounded-full">搵Vendor</span>
          </NavTab>
          <NavTab current={currentView} view="couple-guests" onClick={onNavigate} color="indigo">
            🎟️ 嘉賓與座位
          </NavTab>
          <NavTab current={currentView} view="photo-drop" onClick={onNavigate} color="rose">
            <Camera className="w-4 h-4" /> 互動相片牆{' '}
            {isPremium && <Crown className="w-3 h-3 text-amber-500" />}
          </NavTab>
        </>
      )}
      {userRole === 'reception' && (
        <>
          <NavTab current={currentView} view="reception-scanner" onClick={onNavigate} color="indigo">
            📷 掃描 QR Code
          </NavTab>
          <NavTab current={currentView} view="couple-guests" onClick={onNavigate} color="indigo">
            📋 查閱名單
          </NavTab>
        </>
      )}
      {userRole === 'vendor' && (
        <>
          <NavTab current={currentView} view="vendor-dashboard" onClick={onNavigate} color="emerald">
            💼 接單大堂
          </NavTab>
          <NavTab current={currentView} view="vendor-profile" onClick={onNavigate} color="emerald">
            👤 管理專頁
          </NavTab>
        </>
      )}
    </div>
  );
}

function NavTab({ current, view, onClick, color, children }) {
  const active = current === view;
  const palette = {
    rose: { border: 'border-rose-500', text: 'text-rose-600' },
    indigo: { border: 'border-indigo-500', text: 'text-indigo-600' },
    emerald: { border: 'border-emerald-500', text: 'text-emerald-600' },
  }[color];
  return (
    <button
      onClick={() => onClick(view)}
      className={`px-4 py-3 text-sm font-bold border-b-[3px] whitespace-nowrap flex items-center gap-1 ${
        active
          ? `${palette.border} ${palette.text}`
          : 'border-transparent text-slate-500 hover:text-slate-800'
      }`}
    >
      {children}
    </button>
  );
}
