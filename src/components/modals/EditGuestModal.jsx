import { useState, useEffect } from 'react';
import { X, Save, Trash2 } from 'lucide-react';

export function EditGuestModal({ isOpen, guest, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(null);

  // Hydrate form whenever a different guest is opened
  useEffect(() => {
    if (!guest) {
      setForm(null);
      return;
    }
    setForm({
      name: guest.name || '',
      email: guest.email || '',
      group: guest.group || '男家親戚',
      tableNumber: guest.tableNumber || '',
      headCount: guest.headCount || 1,
    });
  }, [guest?.id]);

  if (!isOpen || !guest || !form) return null;

  const handleSave = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    // 2026-07-18 — Coerce empty tableNumber → '未分配' so the data
    // layer stays consistent with the new "leave blank" UX.
    const tableNumber = form.tableNumber.trim() || '未分配';
    onSave({
      ...form,
      headCount: parseInt(form.headCount, 10) || 1,
      tableNumber,
    });
  };

  const handleDelete = () => {
    if (!confirm(`確定刪除「${guest.name}」？\n\n佢嘅 QR Code 同 RSVP 都會一齊冇咗。`)) return;
    onDelete(guest);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            ✏️ 編輯嘉賓
          </h3>
          <button onClick={onClose} className="bg-slate-100 rounded-full p-1 hover:bg-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 mb-4 text-[11px] font-mono text-slate-500">
          ID: {guest.guestId}
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">姓名</label>
            <input
              type="text"
              required
              className="w-full p-2.5 rounded-lg border border-slate-300 outline-none focus:border-indigo-500"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Email（用嚟寄電子喜帖）</label>
            <input
              type="email"
              placeholder="選填"
              className="w-full p-2.5 rounded-lg border border-slate-300 outline-none focus:border-indigo-500"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">群組</label>
              <select
                className="w-full p-2.5 rounded-lg border border-slate-300 outline-none bg-white"
                value={form.group}
                onChange={(e) => setForm({ ...form, group: e.target.value })}
              >
                <option>男家親戚</option>
                <option>女家親戚</option>
                <option>男家朋友</option>
                <option>女家朋友</option>
                <option>同事</option>
                <option>VIP</option>
                <option>其他</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">人數</label>
              <select
                className="w-full p-2.5 rounded-lg border border-slate-300 outline-none bg-white"
                value={form.headCount}
                onChange={(e) => setForm({ ...form, headCount: parseInt(e.target.value, 10) || 1 })}
              >
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <option key={n} value={n}>
                    {n} 位
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">座位</label>
            <input
              type="text"
              placeholder="例：Table 1"
              className="w-full p-2.5 rounded-lg border border-slate-300 outline-none"
              value={form.tableNumber}
              onChange={(e) => setForm({ ...form, tableNumber: e.target.value })}
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={handleDelete}
              className="px-4 py-2.5 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg font-bold flex items-center gap-1.5 border border-red-200"
            >
              <Trash2 className="w-4 h-4" /> 刪除
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-slate-600 bg-slate-100 rounded-lg font-bold hover:bg-slate-200"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-4 py-2.5 text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg font-bold flex items-center gap-1.5"
            >
              <Save className="w-4 h-4" /> 儲存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}