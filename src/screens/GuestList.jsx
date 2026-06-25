import { useState } from 'react';
import {
  Users,
  Search,
  UserPlus,
  Smartphone,
  QrCode,
  ScanLine,
} from 'lucide-react';

export function GuestList({
  guests,
  userRole,
  searchQuery,
  onSearchChange,
  newGuestForm,
  onNewGuestFormChange,
  onAddGuest,
  onPreviewAsGuest,
  onShowQr,
  onCheckIn,
}) {
  const filtered = guests.filter((g) => g.name.includes(searchQuery));

  return (
    <div className="max-w-6xl mx-auto mt-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Users className="w-7 h-7 text-indigo-500" /> 嘉賓名單與座位表
          </h2>
          <p className="text-slate-500 text-sm mt-1">每個嘉賓都有專屬 ID，生成獨立 QR Code 網址。</p>
        </div>
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
              {filtered.map((guest) => (
                <GuestRow
                  key={guest.id}
                  guest={guest}
                  userRole={userRole}
                  onPreviewAsGuest={onPreviewAsGuest}
                  onShowQr={onShowQr}
                  onCheckIn={onCheckIn}
                />
              ))}
            </tbody>
          </table>
          {guests.length === 0 && (
            <div className="text-center py-10 text-slate-400">尚未加入任何嘉賓</div>
          )}
        </div>

        {userRole === 'owner' && (
          <div className="lg:col-span-4">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 sticky top-28">
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
                    <option>女家朋友</option>
                    <option>VIP</option>
                  </select>
                  <input
                    type="number"
                    min="1"
                    required
                    placeholder="人數"
                    className="w-full p-2.5 rounded-lg border border-slate-300 outline-none"
                    value={newGuestForm.headCount}
                    onChange={(e) =>
                      onNewGuestFormChange({
                        ...newGuestForm,
                        headCount: parseInt(e.target.value) || 1,
                      })
                    }
                  />
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GuestRow({ guest, userRole, onPreviewAsGuest, onShowQr, onCheckIn }) {
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
          {guest.hasGifted && (
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
