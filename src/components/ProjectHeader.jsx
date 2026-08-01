import { Heart, Pencil } from 'lucide-react';

export function ProjectHeader({ event, onRename, onBrandClick }) {
  return (
    <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
      <button
        type="button"
        className="flex items-center gap-2 cursor-pointer min-w-0"
        onClick={onBrandClick}
        aria-label="Save The Day 主頁"
      >
        <Heart className="w-6 h-6 fill-rose-500 text-rose-500 flex-shrink-0" />
        <span className="hidden sm:inline text-xl font-black text-slate-800 whitespace-nowrap">
          Save The Day
        </span>
      </button>
      <span className="hidden md:inline text-xs font-medium text-slate-500 border-l border-slate-200 pl-2 whitespace-nowrap">
        婚禮一站式管理
      </span>
      <span className="hidden sm:inline-flex text-xs font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded ml-2">
        主控台
      </span>
      {event && (
        <div className="flex items-center gap-1.5 min-w-0 ml-1">
          <div
            className="text-sm font-bold text-slate-800 bg-rose-50 px-2 sm:px-3 py-1 rounded-lg border border-rose-100 truncate max-w-[100px] sm:max-w-[180px] min-w-0"
            title={event.name}
          >
            {event.name}
          </div>
          {onRename && (
            <button
              type="button"
              onClick={onRename}
              aria-label="重新命名婚禮專案"
              title="重新命名婚禮專案"
              className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors flex-shrink-0"
            >
              <Pencil className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
