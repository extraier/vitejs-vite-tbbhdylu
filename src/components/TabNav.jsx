import { Camera, Crown } from 'lucide-react';
import { tabsForRole } from '../lib/tabs';

export function TabNav({ userRole, currentView, isPremium, helperPerms, onNavigate }) {
  const tabs = tabsForRole(userRole, helperPerms);
  return (
    <div className="flex space-x-1 overflow-x-auto custom-scrollbar">
      {tabs.map(([view, label]) => {
        // Owner uses rose palette, reception/helper uses indigo, vendor uses emerald
        const color = userRole === 'owner' ? 'rose' : userRole === 'vendor' ? 'emerald' : 'indigo';
        const isPhotoTab = view === 'photo-drop';
        const icon = isPhotoTab ? <Camera className="w-4 h-4" /> : null;
        // Strip the leading emoji (first char if non-ASCII) so we can render
        // the icon separately for photo-drop. Other tabs just show the label.
        const displayLabel = icon ? label.replace(/^.{2}/, '').trim() : label;
        return (
          <NavTab key={view} current={currentView} view={view} onClick={onNavigate} color={color}>
            <span className="flex items-center gap-1">
              {icon}
              {displayLabel}
              {view === 'photo-drop' && isPremium && userRole === 'owner' && (
                <Crown className="w-3 h-3 text-amber-500" />
              )}
            </span>
          </NavTab>
        );
      })}
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
