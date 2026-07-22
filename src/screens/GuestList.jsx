import { useState } from 'react';
import {
  Users,
  Search,
  UserPlus,
  Smartphone,
  QrCode,
  ScanLine,
  Mail,
  Pencil,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

export function GuestList({
  guests,
  userRole,
  helperPerms,
  searchQuery,
  onSearchChange,
  newGuestForm,
  onNewGuestFormChange,
  onAddGuest,
  familyForm,
  onFamilyFormChange,
  onAddFamily,
  onPreviewAsGuest,
  onShowQr,
  onCheckIn,
  onOpenInvitationEditor,
  onEditGuest,
}) {
  const [addMode, setAddMode] = useState('single'); // 'single' | 'family'
  const [expandedHouseholds, setExpandedHouseholds] = useState(new Set());
  // Helpers can see gift presence but not amounts unless canViewGiftAmount.
  // We don't strip here (server returns full data anyway) — instead GuestRow
  // checks helperPerms.canViewGiftAmount before rendering the amount.
  const filtered = guests.filter((g) => g.name.includes(searchQuery));

  // Hide child rows whose parent is already shown (collapse into household view).
  const childIdsHidden = new Set(
    guests
      .filter((g) => g.householdId && g.householdId !== g.guestId && !g.isHouseholdParent)
      .filter((g) => {
        // Hide only if parent exists in current guest list
        return guests.some((p) => p.guestId === g.householdId && p.isHouseholdParent);
      })
      .map((g) => g.id),
  );
  const visibleGuests = guests.filter((g) => !childIdsHidden.has(g.id));

  const toggleHousehold = (householdId) => {
    setExpandedHouseholds((prev) => {
      const next = new Set(prev);
      if (next.has(householdId)) next.delete(householdId);
      else next.add(householdId);
      return next;
    });
  };

  return (
    <div className="max-w-6xl mx-auto mt-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Users className="w-7 h-7 text-indigo-500" /> 嘉賓名單與座位表
          </h2>
          <p className="text-slate-500 text-sm mt-1">每個嘉賓都有專屬 ID，生成獨立 QR Code 網址。</p>
        </div>
        {onOpenInvitationEditor && userRole === 'owner' && (
          <button
            onClick={onOpenInvitationEditor}
            className="px-4 py-2 bg-rose-50 text-rose-700 rounded-xl font-bold hover:bg-rose-100 border border-rose-200 flex items-center gap-2"
          >
            <Mail className="w-4 h-4" /> 電子喜帖
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
            <div className="relative w-full max-w-xs">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="搜尋姓名..."
                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-indigo-500"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
              />
            </div>
          </div>
          {/* Mobile: card stack — one guest per card, all actions visible inline.
              Desktop: keep the original table layout for power users who want
              density. Both render the same data; only the markup differs. */}
          <div className="md:hidden divide-y divide-slate-100">
            {visibleGuests
              .filter((g) => g.name.includes(searchQuery))
              .map((guest) => (
                <GuestCard
                  key={guest.id}
                  guest={guest}
                  allGuests={guests}
                  userRole={userRole}
                  helperPerms={helperPerms}
                  onPreviewAsGuest={onPreviewAsGuest}
                  onShowQr={onShowQr}
                  onCheckIn={onCheckIn}
                  onEditGuest={onEditGuest}
                  isExpanded={expandedHouseholds.has(guest.householdId || guest.guestId)}
                  onToggleExpand={() => toggleHousehold(guest.householdId || guest.guestId)}
                />
              ))}
            {guests.length === 0 && (
              <div className="text-center py-10 text-slate-400">尚未加入任何嘉賓</div>
            )}
          </div>

          {/* Desktop: full table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-4">姓名 (專屬 ID)</th>
                  <th className="p-4">群組</th>
                  <th className="p-4">座位</th>
                  <th className="p-4 text-center">狀態 / 人情</th>
                  <th className="p-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleGuests
                  .filter((g) => g.name.includes(searchQuery))
                  .map((guest) => (
                    <GuestTableFragment
                      key={guest.id}
                      guest={guest}
                      allGuests={guests}
                      userRole={userRole}
                      helperPerms={helperPerms}
                      onPreviewAsGuest={onPreviewAsGuest}
                      onShowQr={onShowQr}
                      onCheckIn={onCheckIn}
                      onEditGuest={onEditGuest}
                      isExpanded={expandedHouseholds.has(guest.householdId || guest.guestId)}
                      onToggleExpand={() => toggleHousehold(guest.householdId || guest.guestId)}
                    />
                  ))}
              </tbody>
            </table>
            {guests.length === 0 && (
              <div className="text-center py-10 text-slate-400">尚未加入任何嘉賓</div>
            )}
          </div>
        </div>

        {userRole === 'owner' && (
          <div className="lg:col-span-4">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 sticky top-28">
              {/* Mode toggle */}
              <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-4">
                <button
                  type="button"
                  onClick={() => setAddMode('single')}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors ${
                    addMode === 'single' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  👤 單人
                </button>
                <button
                  type="button"
                  onClick={() => setAddMode('family')}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors ${
                    addMode === 'family' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  👨‍👩‍👧 家庭
                </button>
              </div>

              {addMode === 'single' ? (
                <>
                  <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <UserPlus className="w-5 h-5 text-indigo-500" /> 新增嘉賓
                  </h3>
                  <form onSubmit={onAddGuest} className="space-y-4">
                    <input
                      type="text"
                      required
                      placeholder="姓名"
                      className="w-full p-2.5 rounded-lg border border-slate-300 outline-none"
                      value={newGuestForm.name}
                      onChange={(e) => onNewGuestFormChange({ ...newGuestForm, name: e.target.value })}
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <select
                        className="w-full p-2.5 rounded-lg border border-slate-300 outline-none bg-white"
                        value={newGuestForm.group}
                        onChange={(e) => onNewGuestFormChange({ ...newGuestForm, group: e.target.value })}
                      >
                        <option>男家親戚</option>
                        <option>女家親戚</option>
                        <option>男家朋友</option>
                        <option>女家朋友</option>
                        <option>同事</option>
                        <option>VIP</option>
                        <option>其他</option>
                      </select>
                      <select
                        className="w-full p-2.5 rounded-lg border border-slate-300 outline-none bg-white"
                        value={newGuestForm.headCount}
                        onChange={(e) =>
                          onNewGuestFormChange({
                            ...newGuestForm,
                            headCount: parseInt(e.target.value, 10) || 1,
                          })
                        }
                      >
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                          <option key={n} value={n}>
                            {n} 位
                          </option>
                        ))}
                      </select>
                    </div>
                    <input
                      type="text"
                      placeholder="分配座位 (例如: Table 1)"
                      className="w-full p-2.5 rounded-lg border border-slate-300 outline-none"
                      value={newGuestForm.tableNumber}
                      onChange={(e) =>
                        onNewGuestFormChange({ ...newGuestForm, tableNumber: e.target.value })
                      }
                    />
                    <button
                      type="submit"
                      className="w-full bg-slate-900 text-white font-bold py-3 rounded-xl hover:bg-slate-800"
                    >
                      新增
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-bold text-slate-800 mb-1 flex items-center gap-2">
                    👨‍👩‍👧 新增家庭
                  </h3>
                  <p className="text-xs text-slate-500 mb-4">一次過加晒成家人，一張喜帖，個別 QR Code。</p>
                  <form onSubmit={onAddFamily} className="space-y-4">
                    <input
                      type="text"
                      required
                      placeholder="家庭名稱 (例：陳家)"
                      className="w-full p-2.5 rounded-lg border border-slate-300 outline-none"
                      value={familyForm.name}
                      onChange={(e) => onFamilyFormChange({ ...familyForm, name: e.target.value })}
                    />
                    <input
                      type="email"
                      placeholder="聯絡人 Email (用嚟寄喜帖)"
                      className="w-full p-2.5 rounded-lg border border-slate-300 outline-none"
                      value={familyForm.email}
                      onChange={(e) => onFamilyFormChange({ ...familyForm, email: e.target.value })}
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <select
                        className="w-full p-2.5 rounded-lg border border-slate-300 outline-none bg-white"
                        value={familyForm.group}
                        onChange={(e) => onFamilyFormChange({ ...familyForm, group: e.target.value })}
                      >
                        <option>男家親戚</option>
                        <option>女家親戚</option>
                        <option>男家朋友</option>
                        <option>女家朋友</option>
                        <option>同事</option>
                        <option>VIP</option>
                        <option>其他</option>
                      </select>
                      <input
                        type="text"
                        placeholder="座位 (選填)"
                        className="w-full p-2.5 rounded-lg border border-slate-300 outline-none"
                        value={familyForm.tableNumber}
                        onChange={(e) => onFamilyFormChange({ ...familyForm, tableNumber: e.target.value })}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-2">
                        家庭成員（每人獨立 QR Code）
                      </label>
                      <div className="space-y-2">
                        {familyForm.members.map((m, i) => (
                          <div key={i} className="flex gap-2">
                            <input
                              type="text"
                              placeholder={`成員 ${i + 1} 姓名`}
                              className="flex-1 p-2 rounded-lg border border-slate-300 outline-none text-sm"
                              value={m}
                              onChange={(e) => {
                                const next = [...familyForm.members];
                                next[i] = e.target.value;
                                onFamilyFormChange({ ...familyForm, members: next });
                              }}
                            />
                            {familyForm.members.length > 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  const next = familyForm.members.filter((_, j) => j !== i);
                                  onFamilyFormChange({ ...familyForm, members: next });
                                }}
                                className="px-2 text-slate-400 hover:text-red-500"
                                title="移除成員"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() =>
                            onFamilyFormChange({
                              ...familyForm,
                              members: [...familyForm.members, ''],
                            })
                          }
                          className="w-full py-2 border-2 border-dashed border-slate-300 rounded-lg text-slate-500 text-xs font-bold hover:border-indigo-400 hover:text-indigo-600"
                        >
                          ➕ 加多一位成員
                        </button>
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="w-full bg-rose-600 text-white font-bold py-3 rounded-xl hover:bg-rose-700"
                    >
                      新增家庭
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GuestRow({ guest, userRole, helperPerms, onPreviewAsGuest, onShowQr, onCheckIn, onEditGuest }) {
  // canViewGiftAmount gates the actual dollar amount, but helpers always see
  // whether the gift was given (the hasGifted flag). This matches the owner's
  // intent: helpers should know "did this guest pay?" without seeing how much.
  const canSeeGiftAmount = !helperPerms || helperPerms.canViewGiftAmount;
  const showGift = guest.hasGifted && (canSeeGiftAmount || !helperPerms);
  return (
    <tr className="hover:bg-slate-50/50">
      <td className="p-4">
        <div className="font-bold text-slate-800">{guest.name}</div>
        <div className="text-[10px] text-slate-400 font-mono">ID: {guest.guestId}</div>
      </td>
      <td className="p-4">
        <span className="bg-slate-100 text-slate-600 text-xs px-2 py-1 rounded-md">
          {guest.group}
        </span>
      </td>
      <td className="p-4 font-bold text-slate-700">{guest.tableNumber}</td>
      <td className="p-4 text-center">
        <div className="flex flex-col items-center gap-1">
          {guest.hasAttended ? (
            <span className="text-green-600 font-bold text-[10px] bg-green-50 px-2 py-0.5 rounded border border-green-200">
              已報到
            </span>
          ) : (
            <span className="text-slate-400 text-[10px]">未到</span>
          )}
          {/* Helper without canViewGiftAmount: see "已付款" pill, no amount. */}
          {guest.hasGifted && helperPerms && !canSeeGiftAmount && (
            <span className="text-rose-600 font-bold text-[10px] bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
              🧧 已付款
            </span>
          )}
          {showGift && (
            <span className="text-rose-600 font-bold text-[10px] bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
              🧧 ${guest.giftAmount}
            </span>
          )}
        </div>
      </td>
      <td className="p-4 text-right">
        {userRole === 'owner' ? (
          <div className="flex justify-end gap-2">
            <button
              onClick={() => onEditGuest?.(guest)}
              className="p-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg"
              title="編輯嘉賓資料"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              onClick={() => onPreviewAsGuest(guest)}
              className="p-2 text-rose-500 bg-rose-50 hover:bg-rose-100 rounded-lg"
              title="預覽賓客手機版面"
            >
              <Smartphone className="w-4 h-4" />
            </button>
            <button
              onClick={() => onShowQr(guest)}
              className="p-2 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg"
              title="打開 QR Code 連結"
            >
              <QrCode className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => onCheckIn(guest)}
            disabled={guest.hasAttended}
            className={`text-xs font-bold px-3 py-1.5 rounded-lg border flex items-center justify-end gap-1 ml-auto ${
              guest.hasAttended
                ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                : 'bg-indigo-600 text-white border-indigo-700 hover:bg-indigo-700'
            }`}
          >
            <ScanLine className="w-3 h-3" /> 掃描報到
          </button>
        )}
      </td>
    </tr>
  );
}

/**
 * GuestTableFragment — renders one or more <tr> depending on whether the guest
 * is a household parent.
 *
 * - Single-person guest (no householdId OR no parent in list):
 *   renders one GuestRow.
 * - Household parent (isHouseholdParent === true): renders the parent row with
 *   a chevron expand button + member count, plus child rows when expanded.
 */
function GuestTableFragment({
  guest,
  allGuests,
  userRole,
  helperPerms,
  onPreviewAsGuest,
  onShowQr,
  onCheckIn,
  onEditGuest,
  isExpanded,
  onToggleExpand,
}) {
  const isParent = Boolean(guest.isHouseholdParent);
  const members = isParent
    ? allGuests.filter((g) => g.householdId === guest.guestId && g.id !== guest.id)
    : [];
  const totalPeople = members.length + 1;

  if (!isParent) {
    return (
      <GuestRow
        guest={guest}
        userRole={userRole}
        helperPerms={helperPerms}
        onPreviewAsGuest={onPreviewAsGuest}
        onShowQr={onShowQr}
        onCheckIn={onCheckIn}
        onEditGuest={onEditGuest}
      />
    );
  }

  return (
    <>
      <tr className="bg-rose-50/30 hover:bg-rose-50/60">
        <td className="p-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleExpand}
              className="text-slate-400 hover:text-slate-700 p-0.5"
              aria-label={isExpanded ? '收埋成員' : '展開成員'}
            >
              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
            <div>
              <div className="font-bold text-slate-800 flex items-center gap-1.5">
                <span>👨‍👩‍👧</span> {guest.name}
                <span className="text-xs bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded font-bold">
                  {totalPeople}人
                </span>
              </div>
              <div className="text-[10px] text-slate-400 font-mono">ID: {guest.guestId}</div>
            </div>
          </div>
        </td>
        <td className="p-4">
          <span className="bg-slate-100 text-slate-600 text-xs px-2 py-1 rounded-md">
            {guest.group}
          </span>
        </td>
        <td className="p-4 font-bold text-slate-700">{guest.tableNumber || '未分配'}</td>
        <td className="p-4 text-center">
          <HouseholdStatus guest={guest} members={members} helperPerms={helperPerms} />
        </td>
        <td className="p-4 text-right">
          <div className="flex justify-end gap-2">
            <button
              onClick={() => onEditGuest?.(guest)}
              className="p-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg"
              title="編輯家庭資料"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              onClick={() => onShowQr(guest)}
              className="p-2 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg"
              title="打開家庭 QR Code"
            >
              <QrCode className="w-4 h-4" />
            </button>
          </div>
        </td>
      </tr>

      {isExpanded && members.map((m) => (
        <tr key={m.id} className="bg-slate-50/50 hover:bg-slate-50">
          <td className="p-4 pl-12">
            <div>
              <div className="text-slate-700 text-sm flex items-center gap-1">
                <span className="text-slate-300">↳</span> {m.name}
              </div>
              <div className="text-[10px] text-slate-400 font-mono">ID: {m.guestId}</div>
            </div>
          </td>
          <td className="p-4 text-xs text-slate-400">家庭成員</td>
          <td className="p-4 text-xs text-slate-500">{m.tableNumber || '—'}</td>
          <td className="p-4 text-center">
            <span className={`text-[10px] ${m.hasAttended ? 'text-green-600 font-bold' : 'text-slate-400'}`}>
              {m.hasAttended ? '已報到' : '未到'}
            </span>
          </td>
          <td className="p-4 text-right">
            <div className="flex justify-end gap-1">
              <button
                onClick={() => onEditGuest?.(m)}
                className="p-1.5 text-slate-500 bg-white hover:bg-slate-100 rounded border border-slate-200"
                title="編輯成員"
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                onClick={() => onShowQr(m)}
                className="p-1.5 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded border border-indigo-200"
                title="成員 QR Code"
              >
                <QrCode className="w-3 h-3" />
              </button>
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}

/**
 * Household-level status: show attendance progress + family gift */
function HouseholdStatus({ guest, members, helperPerms }) {
  const canSeeGiftAmount = !helperPerms || helperPerms.canViewGiftAmount;
  const totalAttendees = members.length + 1;
  const attendedCount =
    (guest.hasAttended ? 1 : 0) +
    members.filter((m) => m.hasAttended).length;
  const allAttended = attendedCount === totalAttendees;
  const showGift = guest.hasGifted && canSeeGiftAmount;

  return (
    <div className="flex flex-col items-center gap-1">
      <span className={`text-[10px] px-2 py-0.5 rounded border font-bold ${
        allAttended
          ? 'bg-green-50 text-green-600 border-green-200'
          : attendedCount > 0
            ? 'bg-amber-50 text-amber-700 border-amber-200'
            : 'bg-slate-50 text-slate-400 border-slate-200'
      }`}>
        {attendedCount}/{totalAttendees} 已到
      </span>
      {showGift && (
        <span className="text-rose-600 font-bold text-[10px] bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
          🧧 ${guest.giftAmount}
        </span>
      )}
    </div>
  );
}

/**
 * GuestCard — mobile-friendly layout for the GuestList.
 *
 * 2026-07-23 — The original table layout forces 5 columns side-by-side, which
 * overflows on mobile and pushes the QR code button (the rightmost column)
 * off-screen. This card layout shows one guest per card with all metadata
 * inline and all action buttons visible without horizontal scrolling.
 *
 * Mirrors GuestTableFragment semantics:
 *   - Household parent: chevron + member count + (expanded) child list
 *   - Single guest: single card with action buttons
 *
 * Desktop (md+) hides this and shows the original table instead.
 */
function GuestCard({
  guest,
  allGuests,
  userRole,
  helperPerms,
  onPreviewAsGuest,
  onShowQr,
  onCheckIn,
  onEditGuest,
  isExpanded,
  onToggleExpand,
}) {
  const isParent = Boolean(guest.isHouseholdParent);
  const members = isParent
    ? allGuests.filter((g) => g.householdId === guest.guestId && g.id !== guest.id)
    : [];
  const totalPeople = members.length + 1;

  if (isParent) {
    return (
      <div className="p-4 hover:bg-rose-50/30">
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={onToggleExpand}
            className="mt-0.5 text-slate-400 hover:text-slate-700 p-0.5 flex-shrink-0"
            aria-label={isExpanded ? '收埋成員' : '展開成員'}
          >
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-bold text-slate-800 flex items-center gap-1.5 flex-wrap">
                  <span>👨‍👩‍👧</span>
                  <span>{guest.name}</span>
                  <span className="text-xs bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded font-bold">
                    {totalPeople}人
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 font-mono mt-0.5">ID: {guest.guestId}</div>
              </div>
              {/* Action buttons — visible without scrolling */}
              <div className="flex gap-1.5 flex-shrink-0">
                <button
                  onClick={() => onEditGuest?.(guest)}
                  className="p-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg"
                  title="編輯家庭資料"
                  aria-label="編輯家庭"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onShowQr(guest)}
                  className="p-2 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg"
                  title="打開家庭 QR Code"
                  aria-label="QR Code"
                >
                  <QrCode className="w-4 h-4" />
                </button>
              </div>
            </div>
            {/* Metadata row — group · table · status */}
            <div className="mt-2 flex items-center gap-2 text-xs flex-wrap">
              <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md">
                {guest.group}
              </span>
              <span className="text-slate-300">·</span>
              <span className="font-bold text-slate-700">{guest.tableNumber || '未分配'}</span>
              <span className="text-slate-300">·</span>
              <HouseholdStatus guest={guest} members={members} helperPerms={helperPerms} />
            </div>
          </div>
        </div>
        {isExpanded && (
          <div className="mt-3 ml-6 space-y-2">
            {members.map((m) => (
              <SingleGuestInline key={m.id} guest={m} helperPerms={helperPerms} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 hover:bg-slate-50/50">
      <SingleGuestInline
        guest={guest}
        helperPerms={helperPerms}
        userRole={userRole}
        onPreviewAsGuest={onPreviewAsGuest}
        onShowQr={onShowQr}
        onCheckIn={onCheckIn}
        onEditGuest={onEditGuest}
      />
    </div>
  );
}

/**
 * SingleGuestInline — one row inside a card (used for both the single-guest
 * card and the expanded household members).
 */
function SingleGuestInline({
  guest,
  helperPerms,
  userRole,
  onPreviewAsGuest,
  onShowQr,
  onCheckIn,
  onEditGuest,
  compact,
}) {
  const canSeeGiftAmount = !helperPerms || helperPerms.canViewGiftAmount;
  const showGift = guest.hasGifted && (canSeeGiftAmount || !helperPerms);

  return (
    <div className="flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <div className={compact ? 'text-slate-700 text-sm' : 'font-bold text-slate-800'}>
          {guest.name}
        </div>
        <div className="text-[10px] text-slate-400 font-mono mt-0.5">ID: {guest.guestId}</div>
        {!compact && (
          <div className="mt-2 flex items-center gap-2 text-xs flex-wrap">
            <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md">
              {guest.group}
            </span>
            <span className="text-slate-300">·</span>
            <span className="font-bold text-slate-700">{guest.tableNumber || '未分配'}</span>
            <span className="text-slate-300">·</span>
            {guest.hasAttended ? (
              <span className="text-green-600 font-bold text-[10px] bg-green-50 px-2 py-0.5 rounded border border-green-200">
                已報到
              </span>
            ) : (
              <span className="text-slate-400 text-[10px]">未到</span>
            )}
            {guest.hasGifted && helperPerms && !canSeeGiftAmount && (
              <span className="text-rose-600 font-bold text-[10px] bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                🧧 已付款
              </span>
            )}
            {showGift && (
              <span className="text-rose-600 font-bold text-[10px] bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                🧧 ${guest.giftAmount}
              </span>
            )}
          </div>
        )}
      </div>
      {/* Action buttons — visible without scrolling */}
      {userRole === 'owner' && (
        <div className="flex gap-1.5 flex-shrink-0">
          <button
            onClick={() => onEditGuest?.(guest)}
            className="p-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg"
            title="編輯嘉賓資料"
            aria-label="編輯"
          >
            <Pencil className={compact ? 'w-3 h-3' : 'w-4 h-4'} />
          </button>
          {!compact && (
            <button
              onClick={() => onPreviewAsGuest(guest)}
              className="p-2 text-rose-500 bg-rose-50 hover:bg-rose-100 rounded-lg"
              title="預覽賓客手機版面"
              aria-label="預覽"
            >
              <Smartphone className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => onShowQr(guest)}
            className="p-2 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg"
            title="打開 QR Code 連結"
            aria-label="QR Code"
          >
            <QrCode className={compact ? 'w-3 h-3' : 'w-4 h-4'} />
          </button>
        </div>
      )}
      {userRole !== 'owner' && (
        <button
          onClick={() => onCheckIn(guest)}
          disabled={guest.hasAttended}
          className={`text-xs font-bold px-3 py-1.5 rounded-lg border flex items-center gap-1 flex-shrink-0 ${
            guest.hasAttended
              ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
              : 'bg-indigo-600 text-white border-indigo-700 hover:bg-indigo-700'
          }`}
        >
          <ScanLine className={compact ? 'w-3 h-3' : 'w-3 h-3'} />
          {guest.hasAttended ? '已到' : '掃描報到'}
        </button>
      )}
    </div>
  );
}
