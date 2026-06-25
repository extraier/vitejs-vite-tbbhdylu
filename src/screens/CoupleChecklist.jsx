import { useMemo } from 'react';
import {
  CheckCircle2,
  Circle,
  MapPin,
  Clock,
  DollarSign,
  Trash2,
  Plus,
  ArrowRight,
  Search,
  Star,
} from 'lucide-react';
import { TASK_CATEGORIES } from '../lib/config';

export function CoupleChecklist({
  tasks,
  vendors,
  activeCategory,
  activeVenue,
  onSelectCategory,
  onToggleTask,
  onDeleteTask,
  newTaskForm,
  onNewTaskFormChange,
  onAddTask,
  onClearActiveCategory,
  onGoDiscover,
  onGoJobBoard,
}) {
  const progressPercentage = Math.round(
    (tasks.filter((t) => t.isCompleted).length / (tasks.length || 1)) * 100,
  );

  const filteredVendors = useMemo(() => {
    if (!activeCategory) return [];
    let matched = vendors.filter((v) => v.category === activeCategory);
    if (activeVenue) {
      matched.sort((a, b) => {
        const aHas = a.tags.some((tag) => activeVenue.includes(tag) || tag.includes(activeVenue));
        const bHas = b.tags.some((tag) => activeVenue.includes(tag) || tag.includes(activeVenue));
        return bHas - aHas;
      });
    }
    return matched;
  }, [activeCategory, activeVenue, vendors]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mt-8 animate-in slide-in-from-bottom-4 duration-500">
      <section className="lg:col-span-6 flex flex-col gap-4">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-slate-800">我的任務清單</h2>
            <div className="text-sm font-bold text-rose-600 bg-rose-50 px-3 py-1 rounded-full">
              進度 {progressPercentage}%
            </div>
          </div>

          <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar mb-4">
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                isActive={activeCategory === task.category}
                onSelect={() => {
                  if (!task.isCompleted) {
                    onSelectCategory(task.category, task.venue);
                  }
                }}
                onToggle={(e) => onToggleTask(task, e)}
                onDelete={(e) => onDeleteTask(task, e)}
                onClearActive={onClearActiveCategory}
              />
            ))}
            {tasks.length === 0 && (
              <div className="text-center py-8 text-slate-400">目前沒有籌備任務，立即新增！</div>
            )}
          </div>

          <form
            onSubmit={onAddTask}
            className="bg-slate-50 p-4 rounded-xl border border-slate-200 grid grid-cols-2 gap-2 mt-4"
          >
            <select
              className="col-span-2 p-2.5 border border-slate-300 rounded-lg text-sm outline-none bg-white"
              value={newTaskForm.categoryKey}
              onChange={(e) => onNewTaskFormChange({ ...newTaskForm, categoryKey: e.target.value })}
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
              </optgroup>
              <option value="other">✏️ 自訂項目 (其他)...</option>
            </select>
            {newTaskForm.categoryKey === 'other' && (
              <input
                type="text"
                placeholder="自訂項目名稱..."
                required
                className="col-span-2 p-2.5 border border-slate-300 rounded-lg text-sm outline-none"
                value={newTaskForm.customTitle}
                onChange={(e) => onNewTaskFormChange({ ...newTaskForm, customTitle: e.target.value })}
              />
            )}
            <input
              type="text"
              placeholder="📍 指定場地 (選填)"
              className="col-span-2 p-2.5 border border-slate-300 rounded-lg text-sm outline-none"
              value={newTaskForm.venue}
              onChange={(e) => onNewTaskFormChange({ ...newTaskForm, venue: e.target.value })}
            />
            <input
              type="date"
              required
              className="p-2.5 border border-slate-300 rounded-lg text-sm outline-none text-slate-600"
              value={newTaskForm.dueDate}
              onChange={(e) => onNewTaskFormChange({ ...newTaskForm, dueDate: e.target.value })}
            />
            <input
              type="number"
              placeholder="大約預算 $"
              className="p-2.5 border border-slate-300 rounded-lg text-sm outline-none"
              value={newTaskForm.estimatedCost}
              onChange={(e) => onNewTaskFormChange({ ...newTaskForm, estimatedCost: e.target.value })}
            />
            <button
              type="submit"
              className="col-span-2 bg-slate-900 text-white font-bold py-3 rounded-lg mt-1 hover:bg-slate-800 shadow-sm flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" /> 新增任務
            </button>
          </form>
        </div>
      </section>

      <section className="lg:col-span-6">
        <div className="sticky top-28">
          {!activeCategory ? (
            <EmptyMatch onGoDiscover={onGoDiscover} />
          ) : (
            <VendorMatch
              activeCategory={activeCategory}
              activeVenue={activeVenue}
              vendors={filteredVendors}
              onViewProfile={() => {}}
              onGoJobBoard={onGoJobBoard}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function TaskRow({ task, isActive, onSelect, onToggle, onDelete, onClearActive }) {
  return (
    <div
      onClick={onSelect}
      className={`flex items-start p-3.5 rounded-xl cursor-pointer border transition-all ${
        task.isCompleted
          ? 'bg-slate-50 border-transparent opacity-75'
          : isActive
            ? 'bg-rose-50 border-rose-200 shadow-sm ring-1 ring-rose-100'
            : 'bg-white border-slate-200 hover:border-rose-200'
      }`}
    >
      <button onClick={onToggle} className="mt-0.5 mr-3 flex-shrink-0">
        <CheckCircle2
          className={`w-6 h-6 ${task.isCompleted ? 'text-green-500' : 'text-slate-300'}`}
        />
      </button>
      <div className="flex-grow">
        <div className="flex items-center flex-wrap gap-2 mb-1">
          <span
            className={`font-bold ${task.isCompleted ? 'line-through text-slate-500' : 'text-slate-800'}`}
          >
            {task.title}
          </span>
          {task.venue && (
            <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded flex items-center gap-1">
              <MapPin className="w-3 h-3" /> {task.venue}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> {task.dueDate}
          </div>
          <div className="flex items-center gap-1">
            <DollarSign className="w-3.5 h-3.5" />{' '}
            {task.isCompleted ? `實際: $${task.actualCost}` : `預算: $${task.estimatedCost}`}
          </div>
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(e);
        }}
        className="ml-2 p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
      >
        <Trash2 className="w-4 h-4" />
      </button>
      {!task.isCompleted && (
        <ArrowRight
          className={`ml-2 mt-2 w-4 h-4 flex-shrink-0 ${
            isActive ? 'text-rose-500' : 'text-slate-300'
          }`}
        />
      )}
    </div>
  );
}

function EmptyMatch({ onGoDiscover }) {
  return (
    <div className="bg-white rounded-2xl p-10 shadow-sm border border-slate-200 text-center flex flex-col items-center justify-center min-h-[400px] bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-50/50 via-white to-white">
      <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center mb-6 shadow-inner">
        <Search className="w-10 h-10 text-indigo-500" />
      </div>
      <h3 className="text-xl font-bold text-slate-800 mb-3">尋找完美商戶靈感？</h3>
      <p className="text-slate-500 mb-6 text-sm leading-relaxed max-w-sm">
        點擊左側未完成任務，AI 會為你配對合適商戶；或直接進入「商戶指南」瀏覽作品集！
      </p>
      <button
        onClick={onGoDiscover}
        className="bg-slate-900 text-white font-bold px-8 py-3.5 rounded-xl hover:bg-slate-800 transition-colors shadow-md w-full max-w-sm"
      >
        🔍 立即探索商戶指南
      </button>
    </div>
  );
}

function VendorMatch({ activeCategory, activeVenue, vendors, onViewProfile, onGoJobBoard }) {
  return (
    <div className="bg-transparent animate-in slide-in-from-right-4 duration-300">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">智能配對推薦</h2>
          <p className="text-rose-600 font-medium text-sm mt-1">
            正在尋找：{TASK_CATEGORIES[activeCategory] || '商戶'}{' '}
            {activeVenue && <span className="text-slate-500"> @ {activeVenue}</span>}
          </p>
        </div>
      </div>
      <div className="space-y-4 max-h-[750px] overflow-y-auto pr-2 custom-scrollbar">
        {vendors.length > 0 ? (
          vendors.map((vendor) => (
            <VendorCard
              key={vendor.id}
              vendor={vendor}
              activeVenue={activeVenue}
              onViewProfile={onViewProfile}
              onGoJobBoard={onGoJobBoard}
            />
          ))
        ) : (
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200 text-center">
            <p className="text-slate-500 mb-4 font-medium">資料庫暫時未有此場地的推薦商戶。</p>
            <button
              onClick={onGoJobBoard}
              className="bg-rose-100 text-rose-700 font-bold px-6 py-2.5 rounded-xl hover:bg-rose-200"
            >
              不如去「求救板」出 Post 等 Vendor 搵你？
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function VendorCard({ vendor, activeVenue, onViewProfile, onGoJobBoard }) {
  const isPerfectMatch =
    activeVenue && vendor.tags.some((tag) => activeVenue.includes(tag) || tag.includes(activeVenue));
  return (
    <div
      className={`bg-white rounded-2xl p-6 shadow-sm border transition-all relative ${
        isPerfectMatch ? 'border-rose-300 ring-1 ring-rose-100' : 'border-slate-100'
      }`}
    >
      {isPerfectMatch && (
        <div className="absolute top-0 right-6 -translate-y-1/2 bg-gradient-to-r from-rose-500 to-pink-500 text-white text-[10px] font-bold px-3 py-1 rounded-full flex items-center gap-1">
          <MapPin className="w-3 h-3" /> 場地經驗匹配
        </div>
      )}
      <div className="flex gap-2 mb-3 flex-wrap">
        {vendor.tags.map((tag) => (
          <span
            key={tag}
            className="text-xs font-bold px-2.5 py-1 rounded-md bg-slate-100 text-slate-600"
          >
            {tag}
          </span>
        ))}
      </div>
      <h3 className="text-lg font-bold text-slate-800">{vendor.name}</h3>
      <div className="flex items-center gap-3 text-sm mb-4 mt-1">
        <span className="font-bold text-slate-700 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
          {vendor.price}
        </span>
        <span className="flex items-center gap-1 text-slate-500">
          <Star className="w-4 h-4 fill-amber-400 text-amber-400" /> {vendor.rating}
        </span>
      </div>
      <div className="flex gap-2 mt-4">
        <button
          onClick={() => onViewProfile(vendor)}
          className="flex-1 bg-slate-900 text-white py-2 rounded-xl text-sm font-bold hover:bg-slate-800"
        >
          查看作品集
        </button>
        <button
          onClick={onGoJobBoard}
          className="flex-1 bg-rose-50 text-rose-700 border border-rose-200 py-2 rounded-xl text-sm font-bold hover:bg-rose-100"
        >
          索取報價
        </button>
      </div>
    </div>
  );
}
