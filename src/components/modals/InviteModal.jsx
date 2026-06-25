import { useState } from 'react';
import { Mail, X } from 'lucide-react';

export function InviteModal({ isOpen, onClose, onInvite }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name) return;
    onInvite({ name, email });
    setName('');
    setEmail('');
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
        <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
          <Mail className="w-5 h-5 text-indigo-500" />
          邀請兄弟姊妹加入
        </h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            required
            placeholder="稱呼 (例如: 伴郎 Kevin)"
            className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:border-indigo-500"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            type="email"
            required
            placeholder="Email 電郵地址"
            className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:border-indigo-500"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <div className="flex gap-2 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 text-slate-600 bg-slate-100 rounded-lg font-bold hover:bg-slate-200"
            >
              取消
            </button>
            <button
              type="submit"
              className="flex-1 py-2 text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg font-bold"
            >
              發送邀請
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
