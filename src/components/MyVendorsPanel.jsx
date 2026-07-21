// MyVendorsPanel — "💎 我嘅商戶" section inside CoupleChecklist.
// Lists the couple's saved vendor contacts (vendors they know from
// outside the platform — Instagram, word of mouth, etc.). Each
// contact has quick-action icons for IG / WhatsApp / email / chat.
//
// 2026-07-15 — new component. Sits ABOVE the task list in
// CoupleChecklist. Tapping 💬 on a non-onboarded contact opens
// <VendorInviteModal> (share a signup link via WhatsApp/IG/email);
// tapping 💬 on an onboarded contact (linkedVendorUid set) opens
// the real chat via the existing chat.js helpers.
//
// 2026-07-21 — Two-path "新增商戶" flow:
//   1. AddVendorPicker: pick from existing catalog (677 onboarded)
//      OR fall back to creating a custom off-platform vendor.
//   2. When picking from catalog, we use the vendor's existing data
//      (name, category, location, etc.) and set linkedVendorUid so
//      chat opens immediately.

import { useState } from 'react';
import {
  UserPlus,
  Instagram,
  Phone,
  Mail,
  MessageSquare,
  Edit3,
  Trash2,
  ExternalLink,
  Link2,
} from 'lucide-react';
import { VENDOR_CATEGORIES, getTaskCategoryLabel } from '../lib/config';
import { VendorContactForm } from './modals/VendorContactForm';
import { VendorInviteModal } from './modals/VendorInviteModal';
import { AddVendorPicker } from './modals/AddVendorPicker';

export function MyVendorsPanel({
  contacts = [],
  loading,
  onAddContact,
  onUpdateContact,
  onDeleteContact,
  onLinkContact, // (contact) => void; manual uid-based link fallback
  onChatContact, // (contact) => void; called for contacts with linkedVendorUid
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [invitingContact, setInvitingContact] = useState(null);

  function handleSave(data) {
    if (editing) {
      onUpdateContact?.({ ...editing, ...data });
    } else {
      onAddContact?.(data);
    }
    setFormOpen(false);
    setEditing(null);
  }

  function handleChat(contact) {
    if (contact.linkedVendorUid) {
      onChatContact?.(contact);
    } else {
      setInvitingContact(contact);
    }
  }

  // 2026-07-21 — when user picks an existing vendor from the catalog,
  // map vendor fields → MyVendors contact shape. linkedVendorUid set
  // → chat opens immediately (no invite modal needed).
  function handlePickExisting(vendor) {
    const contact = {
      vendorName: vendor.name,
      vendorEmail: '',         // not exposed publicly
      vendorPhone: '',         // not exposed publicly
      vendorInstagram: '',     // could pull from vendor doc later
      category: vendor.category || '',
      notes: vendor.serviceAreaCity
        ? `從目錄加入 · ${vendor.serviceAreaCity}`
        : '從目錄加入',
      linkedVendorUid: vendor.id,
      // Save a snapshot so the card still works if the vendor doc moves
      vendorSnapshot: {
        name: vendor.name,
        categoryLabel: vendor.categoryLabel,
        serviceAreaCity: vendor.serviceAreaCity,
        serviceAreaDistrict: vendor.serviceAreaDistrict,
        portfolio: (vendor.portfolio || []).slice(0, 4),
        rating: vendor.rating || 0,
      },
      isFromCatalog: true,
    };
    onAddContact?.(contact);
    setPickerOpen(false);
  }

  function handleAddCustom() {
    setPickerOpen(false);
    setEditing(null);
    setFormOpen(true);
  }

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-black text-slate-700 flex items-center gap-2">
          💎 我嘅商戶
          <span className="text-xs font-bold text-slate-400">
            ({contacts.length})
          </span>
        </h3>
        <button
          onClick={() => {
            setEditing(null);
            setPickerOpen(true);
          }}
          className="text-sm bg-rose-50 hover:bg-rose-100 text-rose-600 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 border border-rose-200"
        >
          <UserPlus className="w-4 h-4" />
          新增商戶
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-slate-400 py-4 text-center">載入中...</div>
      ) : contacts.length === 0 ? (
        <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-xl p-5 text-center">
          <div className="text-3xl mb-2">📒</div>
          <p className="text-sm text-slate-600 font-bold mb-1">
            你嘅商戶地址簿係空嘅
          </p>
          <p className="text-xs text-slate-500 leading-relaxed">
            喺 Instagram、WhatsApp 或者朋友介紹嘅商戶，
            <br />
            加入呢度就方便日後聯絡同收發訊息。
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {contacts.map((contact) => (
            <ContactCard
              key={contact.id}
              contact={contact}
              onChat={() => handleChat(contact)}
              onLink={() => onLinkContact?.(contact)}
              onEdit={() => {
                setEditing(contact);
                setFormOpen(true);
              }}
              onDelete={() => {
                if (window.confirm(`確定要刪除「${contact.vendorName}」？`)) {
                  onDeleteContact?.(contact.id);
                }
              }}
            />
          ))}
        </div>
      )}

      {pickerOpen && (
        <AddVendorPicker
          onPickExisting={handlePickExisting}
          onAddCustom={handleAddCustom}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {formOpen && (
        <VendorContactForm
          initial={editing}
          onSave={handleSave}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
        />
      )}

      {invitingContact && (
        <VendorInviteModal
          contact={invitingContact}
          onClose={() => setInvitingContact(null)}
        />
      )}
    </div>
  );
}

function ContactCard({ contact, onChat, onLink, onEdit, onDelete }) {
  const linked = Boolean(contact.linkedVendorUid);
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 hover:shadow-sm transition-shadow relative group">
      {/* Linked vendor badge */}
      {linked ? (
        <span
          className="absolute top-2 right-2 text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-full font-bold"
          title="此商戶已加入平台"
        >
          ✓ 已連結
        </span>
      ) : (
        <span
          className="absolute top-2 right-2 text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full font-bold"
          title="此商戶尚未加入平台，需要發送邀請"
        >
          未加入
        </span>
      )}

      <div className="flex items-start gap-3 mb-2">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center text-slate-700 font-black text-lg flex-shrink-0">
          {contact.vendorName?.charAt(0)?.toUpperCase() || '?'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <div className="font-bold text-slate-800 truncate">
              {contact.vendorName}
            </div>
            {contact.isFromCatalog && (
              <span
                className="text-[9px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded font-bold flex-shrink-0"
                title="從 Save The Day 商戶目錄加入"
              >
                📂 從目錄
              </span>
            )}
          </div>
          {contact.category && (
            <div className="text-[10px] text-slate-500 mt-0.5 truncate">
              {categoryLabel(contact.category)}
            </div>
          )}
          {contact.vendorSnapshot?.serviceAreaCity && (
            <div className="text-[10px] text-slate-500 mt-0.5 truncate">
              📍 {contact.vendorSnapshot.serviceAreaCity}
              {contact.vendorSnapshot.serviceAreaDistrict && ` · ${contact.vendorSnapshot.serviceAreaDistrict}`}
            </div>
          )}
          {contact.notes && (
            <div className="text-xs text-slate-500 italic mt-1 line-clamp-2">
              "{contact.notes}"
            </div>
          )}
        </div>
      </div>

      {/* Quick action row */}
      <div className="flex items-center gap-1 mt-2 pt-2 border-t border-slate-100">
        {contact.vendorPhone && (
          <a
            href={`tel:${contact.vendorPhone}`}
            className="p-2 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
            title={`致電 ${contact.vendorPhone}`}
          >
            <Phone className="w-4 h-4" />
          </a>
        )}
        {contact.vendorEmail && (
          <a
            href={`mailto:${contact.vendorEmail}?subject=${encodeURIComponent(
              '婚禮查詢',
            )}`}
            className="p-2 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
            title={`電郵 ${contact.vendorEmail}`}
          >
            <Mail className="w-4 h-4" />
          </a>
        )}
        {contact.vendorInstagram && (
          <a
            href={`https://instagram.com/${contact.vendorInstagram}`}
            target="_blank"
            rel="noreferrer"
            className="p-2 text-slate-500 hover:text-pink-600 hover:bg-pink-50 rounded-lg transition-colors"
            title={`IG @${contact.vendorInstagram}`}
          >
            <Instagram className="w-4 h-4" />
          </a>
        )}
        <button
          onClick={onChat}
          className={`p-2 rounded-lg transition-colors ${
            linked
              ? 'text-rose-500 hover:bg-rose-50'
              : 'text-amber-500 hover:bg-amber-50'
          }`}
          title={linked ? '開啟對話' : '邀請加入平台'}
        >
          <MessageSquare className="w-4 h-4" />
        </button>
        <div className="flex-1" />
        <button
          onClick={onLink}
          className={`p-1.5 rounded-lg transition-colors ${
            linked
              ? 'text-emerald-500 hover:bg-emerald-50'
              : 'text-amber-500 hover:bg-amber-50 opacity-0 group-hover:opacity-100'
          }`}
          title={
            linked
              ? '已連結此商戶 (重新連結可覆蓋 uid)'
              : '連結到已註冊商戶 (輸入 uid)'
          }
        >
          <Link2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onEdit}
          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
          title="編輯"
        >
          <Edit3 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
          title="刪除"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// Resolves a contact.category string to a label (handles legacy
// flat keys + new namespaced top.sub keys). Falls back to the raw
// string. Same lookup as getTaskCategoryLabel — re-implemented here
// to avoid cross-tree circular imports via the modals.
function categoryLabel(key) {
  if (!key) return '';
  if (key.includes('.')) {
    const [top, sub] = key.split('.');
    const t = VENDOR_CATEGORIES[top];
    if (t?.subs?.[sub]) return `${t.label} · ${t.subs[sub]}`;
    if (t) return t.label;
    return key;
  }
  return VENDOR_CATEGORIES[key]?.label || key;
}
