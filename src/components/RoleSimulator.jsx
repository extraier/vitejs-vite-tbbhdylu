import { Users } from 'lucide-react';

export function RoleSimulator({ userRole, activeGuestPortal, onSwitch }) {
  return (
    <div className="bg-slate-900 text-white text-sm py-2 px-4 flex flex-wrap justify-center items-center gap-4 z-50">
      <span className="font-bold flex items-center gap-1">
        <Users className="w-4 h-4 text-slate-400" /> 開發者模式視角切換：
      </span>
      <button
        onClick={() => onSwitch('owner')}
        className={`px-3 py-1 rounded-full ${
          userRole === 'owner' ? 'bg-rose-500 font-bold' : 'bg-slate-800 hover:bg-slate-700'
        }`}
      >
        👩🏻‍❤️‍👨🏻 主理新人
      </button>
      <button
        onClick={() => onSwitch('reception')}
        className={`px-3 py-1 rounded-full ${
          userRole === 'reception' ? 'bg-indigo-500 font-bold' : 'bg-slate-800 hover:bg-slate-700'
        }`}
      >
        👯‍♀️ 兄弟姊妹(接待)
      </button>
      <button
        onClick={() => onSwitch('vendor')}
        className={`px-3 py-1 rounded-full ${
          userRole === 'vendor' ? 'bg-emerald-500 font-bold' : 'bg-slate-800 hover:bg-slate-700'
        }`}
      >
        💼 商戶 (Vendor)
      </button>
      {activeGuestPortal && (
        <button className="px-3 py-1 rounded-full bg-pink-500 font-bold text-white shadow-md border-2 border-white/20 animate-pulse">
          📱 賓客專屬網頁 ({activeGuestPortal.name})
        </button>
      )}
    </div>
  );
}
