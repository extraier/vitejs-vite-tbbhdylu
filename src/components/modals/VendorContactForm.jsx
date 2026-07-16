// VendorContactForm — add/edit a vendor the couple knows from outside
// the platform (Instagram, word of mouth, etc.).
//
// 2026-07-15 — new component. Lets 主理新人 save a vendor contact
// as a personal address book entry. Once the vendor formally signs
// up to savetheday.io (auto-linked by email match), the chat
// button on this contact opens a real conversation.

import { useState, useEffect } from 'react';
import { X, UserPlus, Instagram, Phone, Mail, Save } from 'lucide-react';
import { VENDOR_CATEGORIES } from '../../lib/config';

export function VendorContactForm({ initial, onSave, onClose }) {
  const [form, setForm] = useState({
    vendorName: '',
    vendorEmail: '',
    vendorPhone: '',
    vendorInstagram: '',
    category: '',
    notes: '',
    ...(initial || {}),
  });

  useEffect(() => {
    if (initial) {
      setForm((f) => ({ ...f, ...initial }));
    }
  }, [initial]);

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.vendorName.trim()) return;
    onSave({
      vendorName: form.vendorName.trim(),
      vendorEmail: form.vendorEmail.trim(),
      vendorPhone: form.vendorPhone.trim(),
      vendorInstagram: form.vendorInstagram.trim().replace(/^@/, ''),
      category: form.category,
      notes: form.notes.trim(),
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-3xl max-w-md w-full shadow-2xl animate-in slide-in-from-bottom-4 duration-200 max-h-[90vh] overflow-y-auto"
      >
        <div className="p-5 border-b border-slate-200 flex justify-between items-center">
          <h3 className="font-black text-slate-800 flex items-center gap-2 text-lg">
            <UserPlus className="w-5 h-5 text-rose-500" />
            {initial ? '編輯商戶' : '新增商戶'}
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <Field
            label="商戶名稱 *"
            placeholder="例：小明 @ HK Wedding Photography"
            value={form.vendorName}
            onChange={(v) => setForm({ ...form, vendorName: v })}
            required
          />

          <div>
            <label className="text-sm font-bold text-slate-700 mb-1 block">
              服務類別
            </label>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="w-full p-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:border-rose-400 bg-white"
            >
              <option value="">未分類</option>
              {Object.entries(VENDOR_CATEGORIES).map(([topKey, top]) => (
                <optgroup key={topKey} label={`${top.icon} ${top.label}`}>
                  <option value={topKey}>{top.label}</option>
                  {Object.entries(top.subs).map(([subKey, subLabel]) => (
                    <option key={subKey} value={`${topKey}.${subKey}`}>
                      ↳ {subLabel}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <Field
            icon={<Mail className="w-4 h-4" />}
            label="電郵 (建議填寫，方便日後連結帳號)"
            type="email"
            placeholder="vendor@example.com"
            value={form.vendorEmail}
            onChange={(v) => setForm({ ...form, vendorEmail: v })}
          />

          <Field
            icon={<Phone className="w-4 h-4" />}
            label="電話 (WhatsApp)"
            type="tel"
            placeholder="9123 4567"
            value={form.vendorPhone}
            onChange={(v) => setForm({ ...form, vendorPhone: v })}
          />

          <Field
            icon={<Instagram className="w-4 h-4" />}
            label="Instagram 帳號 (不用加 @)"
            placeholder="happyweddings"
            value={form.vendorInstagram}
            onChange={(v) =>
              setForm({ ...form, vendorInstagram: v.replace(/^@/, '') })
            }
          />

          <div>
            <label className="text-sm font-bold text-slate-700 mb-1 block">
              備註
            </label>
            <textarea
              value={form.notes}
              onChange={(e) =>
                setForm({ ...form, notes: e.target.value })
              }
              rows={2}
              placeholder="例：上次合作過，好好傾。可問下報價。"
              className="w-full p-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:border-rose-400 resize-none"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-slate-100 text-slate-700 py-2.5 rounded-xl font-bold hover:bg-slate-200"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!form.vendorName.trim()}
              className="flex-1 bg-rose-500 text-white py-2.5 rounded-xl font-bold hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Save className="w-4 h-4" />
              {initial ? '儲存' : '新增商戶'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, icon, type = 'text', placeholder, required }) {
  return (
    <div>
      <label className="text-sm font-bold text-slate-700 mb-1 flex items-center gap-1">
        {icon}
        {label}
      </label>
      <input
        type={type}
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full p-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:border-rose-400"
      />
    </div>
  );
}
