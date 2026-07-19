/**
 * HelperDashboard — 兄弟姊妹 / 助手 control panel.
 *
 * Landed at currentView === 'helper-dashboard' for users who are
 * active helpers on at least one wedding. Renders a tabbed
 * surface whose tabs follow the couple-granted perms:
 *
 *   - 任務        (canViewChecklist) → assigned tasks + activity timeline
 *                                       + status picker
 *   - 賓客名單    (canViewGuestList) → read-only guest list
 *   - 接待處掃描  (canScan)          → ReceptionScanner mounted inline
 *   - 預算總覽    (canViewBudget)    → CoupleBudget read-only
 *   - 上傳相片    (canUploadPhotos)  → PhotoDrop mounted inline
 *
 * 2026-07-19 — first version, paired with the
 * `<TaskActivityTimeline>` work in the same day (threaded comments
 * + status-update audit trail on every task).
 */

import { useMemo, useState } from 'react';
import {
  QrCode,
  Users,
  Wallet,
  Image as ImageIcon,
  Loader2,
  ListChecks,
  ChevronDown,
  AlertTriangle,
  CheckCircle2,
  Hourglass,
  PlayCircle,
} from 'lucide-react';
import { collection, doc, query, updateDoc, where } from 'firebase/firestore';
import { db, appId } from '../lib/firebase';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { useToast } from '../hooks/useToast';
import { TaskActivityTimeline } from '../components/TaskActivityTimeline';
import { ReceptionScanner } from './ReceptionScanner';
import { PhotoDrop } from './PhotoDrop';
import { recordTaskStatusUpdate } from '../lib/taskUpdates';

const TASK_STATUSES = [
  { id: 'todo', label: '待辦', color: 'slate', Icon: Hourglass },
  { id: 'in_progress', label: '進行中', color: 'emerald', Icon: PlayCircle },
  { id: 'blocked', label: '受阻', color: 'amber', Icon: AlertTriangle },
  { id: 'done', label: '已完成', color: 'emerald', Icon: CheckCircle2 },
];

export function HelperDashboard({
  helperAssignment, // { ownerUid, ownerName?, eventName?, perms, eventId? }
  currentUser, // { uid, displayName, email }
  onCheckIn, // ReceptionScanner callback
  onManualCheckIn,
  eventGuests = [],
  recentScans = [],
}) {
  const ownerUid = helperAssignment?.ownerUid;
  const perms = helperAssignment?.perms || {};

  // Build the list of tabs from perms. Tasks is the default when
  // canViewChecklist is granted since the whole point of this feature
  // is to make assigned tasks + threaded comments reachable.
  const availableTabs = useMemo(() => {
    const tabs = [];
    if (perms.canViewChecklist) tabs.push({ id: 'tasks', label: '任務', Icon: ListChecks });
    if (perms.canViewGuestList) tabs.push({ id: 'guests', label: '賓客', Icon: Users });
    if (perms.canScan) tabs.push({ id: 'scan', label: '接待處掃描', Icon: QrCode });
    if (perms.canViewBudget) tabs.push({ id: 'budget', label: '預算總覽', Icon: Wallet });
    if (perms.canUploadPhotos) tabs.push({ id: 'photos', label: '上傳相片', Icon: ImageIcon });
    if (perms.canViewPhotos) tabs.push({ id: 'photos', label: '睇相', Icon: ImageIcon });
    return tabs;
  }, [perms]);
  const [activeTab, setActiveTab] = useState(availableTabs[0]?.id || 'tasks');
  // If perms shift, fall back to whichever tab is still available.
  if (!availableTabs.some((t) => t.id === activeTab) && availableTabs[0]) {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    setActiveTab(availableTabs[0].id);
  }

  // Tasks tab subscription: `assignedHelperUid == auth.uid` so the
  // firestore rule gates it server-side.
  const tasksPath =
    ownerUid && currentUser?.uid
      ? query(
          collection(db, 'artifacts', appId, 'users', ownerUid, 'tasks'),
          where('assignedHelperUid', '==', currentUser.uid),
        )
      : null;
  const { data: tasks = [], loading: tasksLoading } = useFirestoreCollection(tasksPath, [
    ownerUid,
    currentUser?.uid,
  ]);

  // Budget summary — only loaded if canViewBudget.
  const { data: budgetTasks = [] } = useFirestoreCollection(
    ownerUid && perms.canViewBudget
      ? collection(db, 'artifacts', appId, 'users', ownerUid, 'tasks')
      : null,
    [ownerUid, perms.canViewBudget],
  );
  const totalBudget = useMemo(
    () => budgetTasks.reduce((sum, t) => sum + Number(t.estimatedCost || 0), 0),
    [budgetTasks],
  );
  const totalSpent = useMemo(
    () => budgetTasks.reduce((sum, t) => sum + Number(t.actualCost || 0), 0),
    [budgetTasks],
  );

  // Photos subscription (read for the canView case, write for upload).
  const { data: photos = [] } = useFirestoreCollection(
    ownerUid && (perms.canViewPhotos || perms.canUploadPhotos)
      ? query(
          collection(db, 'artifacts', appId, 'users', ownerUid, 'photos'),
          where('eventId', '==', helperAssignment?.eventId || '__no_event__'),
        )
      : null,
    [ownerUid, helperAssignment?.eventId, perms.canViewPhotos, perms.canUploadPhotos],
  );

  // Guests subscription (read-only display).
  const { data: helperGuests = [] } = useFirestoreCollection(
    ownerUid && perms.canViewGuestList && helperAssignment?.eventId
      ? query(
          collection(db, 'artifacts', appId, 'users', ownerUid, 'guests'),
          where('eventId', '==', helperAssignment.eventId),
        )
      : null,
    [ownerUid, perms.canViewGuestList, helperAssignment?.eventId],
  );

  const headerTitle = helperAssignment?.ownerName
    ? `${helperAssignment.ownerName} 嘅婚禮 — 助手控制台`
    : '助手控制台';

  return (
    <div className="max-w-5xl mx-auto py-6 px-4">
      <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 bg-gradient-to-br from-amber-50 via-white to-rose-50 border-b border-slate-200">
          <div className="flex items-center gap-3 mb-2">
            <Users className="w-6 h-6 text-amber-500 fill-amber-100" />
            <h2 className="text-2xl font-black text-slate-800">{headerTitle}</h2>
          </div>
          <p className="text-xs text-slate-500">
            以下畫面根據主人（{helperAssignment?.ownerName || '主理新人'}）畀你嘅權限顯示。
            留言同更新任務狀態會即時同步到新人嗰邊。
          </p>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {Object.entries(perms)
              .filter(([, v]) => v === true)
              .map(([k]) => (
                <span
                  key={k}
                  className="text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full"
                >
                  ✓ {permZhLabel(k)}
                </span>
              ))}
          </div>
        </div>

        {availableTabs.length > 1 && (
          <div className="flex items-center gap-1 px-3 pt-3 border-b border-slate-200 overflow-x-auto">
            {availableTabs.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-1 px-3 py-2 text-sm font-bold rounded-t-lg border-b-2 transition-colors ${
                  activeTab === id
                    ? 'text-amber-700 border-amber-500 bg-amber-50/50'
                    : 'text-slate-500 border-transparent hover:text-slate-700'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="p-4">
          {activeTab === 'tasks' && (
            <HelperTasksTab
              tasks={tasks}
              loading={tasksLoading}
              ownerUid={ownerUid}
              currentUser={currentUser}
            />
          )}
          {activeTab === 'guests' && (
            <HelperGuestsTab guests={helperGuests} />
          )}
          {activeTab === 'scan' && (
            <ReceptionScanner
              eventGuests={eventGuests}
              recentScans={recentScans}
              onCheckIn={onCheckIn}
              onManualCheckIn={onManualCheckIn}
            />
          )}
          {activeTab === 'budget' && (
            <HelperBudgetTab
              tasks={budgetTasks}
              totalBudget={totalBudget}
              totalSpent={totalSpent}
            />
          )}
          {activeTab === 'photos' && (
            <PhotoDrop
              photos={photos}
              storageUsedMB={0}
              isPremium={false}
              onPlaySlideshow={() => {}}
              onUpgrade={() => {}}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Per-tab helpers ─────────────────────────────────────────────────── */

function HelperTasksTab({ tasks, loading, ownerUid, currentUser }) {
  const { showToast } = useToast();
  if (loading) {
    return (
      <div className="text-center py-8 text-slate-500">
        <Loader2 className="w-6 h-6 mx-auto animate-spin mb-2" />
        載入你嘅任務…
      </div>
    );
  }
  if (!tasks || tasks.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500">
        <ListChecks className="w-12 h-12 mx-auto text-slate-300 mb-3" />
        <p className="font-bold text-slate-700 mb-1">主人暫時未有指派任務畀你</p>
        <p className="text-xs">
          主理新人會喺「兄弟姊妹管理」指派任務（例：接待、攝影、雜務）
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        合共有 <b>{tasks.length}</b> 個任務指派咗畀你。可以更新狀態或者留言同新人溝通。
      </p>
      {tasks.map((t) => (
        <HelperTaskCard
          key={t.id}
          task={t}
          ownerUid={ownerUid}
          currentUser={currentUser}
          showToast={showToast}
        />
      ))}
    </div>
  );
}

function HelperTaskCard({ task, ownerUid, currentUser, showToast }) {
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const current =
    TASK_STATUSES.find((s) => s.id === task.status) || TASK_STATUSES[0];
  const CurrentIcon = current.Icon;
  const palette = {
    slate: 'bg-slate-100 text-slate-700 border-slate-200',
    emerald: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    amber: 'bg-amber-100 text-amber-700 border-amber-200',
  }[current.color];

  const handleStatus = async (newStatusId) => {
    if (newStatusId === task.status) {
      setPicking(false);
      return;
    }
    setSaving(true);
    try {
      const ref = doc(db, 'artifacts', appId, 'users', ownerUid, 'tasks', task.id);
      await updateDoc(ref, {
        status: newStatusId,
        statusUpdatedAt: Date.now(),
        ...(newStatusId === 'done' ? { isCompleted: true } : {}),
        ...(task.status === 'done' && newStatusId !== 'done'
          ? { isCompleted: false }
          : {}),
      });
      recordTaskStatusUpdate({
        ownerUid,
        taskId: task.id,
        fromStatus: task.status || null,
        toStatus: newStatusId,
        byUid: currentUser.uid,
        byName: currentUser.displayName || currentUser.email || '助手',
        byRole: 'helper',
      });
      showToast?.(
        `✓ 已更新為「${
          TASK_STATUSES.find((s) => s.id === newStatusId)?.label
        }」`,
      );
      setPicking(false);
    } catch (err) {
      showToast?.(`✗ 更新失敗: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
      <div className="p-3 flex items-start gap-3">
        <CurrentIcon
          className={`w-5 h-5 mt-0.5 ${
            current.color === 'amber'
              ? 'text-amber-500'
              : current.color === 'emerald'
                ? 'text-emerald-500'
                : 'text-slate-400'
          }`}
        />
        <div className="flex-1 min-w-0">
          <div
            className={`font-bold ${
              task.status === 'done' ? 'line-through text-slate-500' : 'text-slate-800'
            }`}
          >
            {task.title || task.category || '未命名任務'}
          </div>
          {task.venue && (
            <div className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded inline-flex items-center gap-1 mt-1">
              📍 {task.venue}
            </div>
          )}
          {task.dueDate && (
            <div className="text-[10px] text-slate-500 mt-1">
              📅 {task.dueDate} {task.dueTime && `· ${task.dueTime}`}
            </div>
          )}
        </div>
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setPicking((p) => !p)}
            disabled={saving}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border ${palette} ${
              saving ? 'opacity-50' : ''
            }`}
            title="更新任務狀態"
          >
            {saving ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
            {current.label}
          </button>
          {picking && (
            <div className="absolute right-0 mt-1 z-20 bg-white rounded-lg shadow-xl border border-slate-200 py-1 min-w-[160px]">
              {TASK_STATUSES.map((s) => {
                const SIcon = s.Icon;
                const isCur = s.id === task.status;
                return (
                  <button
                    key={s.id}
                    onClick={() => handleStatus(s.id)}
                    disabled={saving}
                    className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-slate-50 ${
                      isCur ? 'bg-slate-50 font-bold' : ''
                    } ${saving ? 'opacity-50' : ''}`}
                  >
                    <SIcon className="w-3.5 h-3.5 text-slate-500" />
                    {s.label}
                    {isCur && <CheckCircle2 className="w-3 h-3 ml-auto text-emerald-500" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <div className="border-t border-slate-200 bg-slate-50 p-3">
        <TaskActivityTimeline
          task={task}
          currentUser={currentUser}
          currentRole="helper"
        />
      </div>
    </div>
  );
}

function HelperGuestsTab({ guests }) {
  if (!guests || guests.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500">
        <Users className="w-12 h-12 mx-auto text-slate-300 mb-3" />
        <p className="font-bold text-slate-700 mb-1">賓客名單未準備好</p>
      </div>
    );
  }
  const attended = guests.filter((g) => g.hasAttended).length;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
        <div>
          <p className="text-xs text-emerald-700 font-bold">已出席</p>
          <p className="text-2xl font-black text-emerald-700">
            {attended} <span className="text-sm text-slate-500">/ {guests.length}</span>
          </p>
        </div>
        <p className="text-[10px] text-slate-500 text-right">只顯示名單，不能編輯</p>
      </div>
      <ul className="space-y-1">
        {guests.map((g) => (
          <li
            key={g.id}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm"
          >
            <CheckCircle2
              className={`w-4 h-4 ${g.hasAttended ? 'text-emerald-500' : 'text-slate-300'}`}
            />
            <span className={`flex-1 ${g.hasAttended ? 'line-through text-slate-400' : ''}`}>
              {g.name}
            </span>
            {g.table && (
              <span className="text-[10px] text-slate-500 bg-slate-50 px-2 py-0.5 rounded">
                {g.table}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function HelperBudgetTab({ tasks, totalBudget, totalSpent }) {
  const pct = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;
  return (
    <div className="space-y-3">
      <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
        <p className="text-xs text-rose-700 font-bold">主人嘅預算</p>
        <p className="text-2xl font-black text-rose-700">
          ${totalSpent.toLocaleString()}{' '}
          <span className="text-sm text-slate-500">/ ${totalBudget.toLocaleString()}</span>
        </p>
        <div className="mt-2 w-full bg-rose-100 rounded-full h-2 overflow-hidden">
          <div
            className="bg-rose-500 h-2 transition-all"
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
        <p className="text-[10px] text-slate-500 mt-1">{pct}% 已花</p>
      </div>
      <ul className="space-y-1">
        {tasks.map((t) => (
          <li
            key={t.id}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm"
          >
            <span className="flex-1">{t.title || '未命名'}</span>
            <span className="text-xs text-slate-700 font-bold">
              ${Number(t.actualCost || t.estimatedCost || 0).toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function permZhLabel(k) {
  return (
    {
      canScan: '接待處掃描',
      canViewGuestList: '賓客名單',
      canViewBudget: '預算總覽',
      canViewChecklist: '任務／對話',
      canViewPhotos: '睇相',
      canUploadPhotos: '上傳相片',
      canEditGuests: '編輯賓客',
    }[k] || k
  );
}
