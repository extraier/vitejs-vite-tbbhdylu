import { useState, useRef, useEffect } from 'react';
import {
  QrCode,
  Plus,
  Trash2,
  Upload,
  X,
  Save,
  Copy,
  Check,
  ExternalLink,
  AlertCircle,
  CreditCard,
  ImageIcon,
} from 'lucide-react';
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';
import {
  collection,
  query,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db, storage, appId } from '../lib/firebase';

// 2026-07-24 — 電子人情 (e-Red-Packet) manager.
//
// Owners upload their payment-app QR codes here (PayMe, FPS, AlipayHK,
// WeChat Pay HK, etc.). Each QR lives in Firebase Storage and the
// metadata in Firestore. The PersonalGuestPortal's PaymentModal reads
// these records to display the actual QR code to the guest.
//
// Why multiple QRs instead of one: HK couples commonly use 2-3 payment
// apps (PayMe for most guests, FPS for older relatives, AlipayHK for
// mainland guests). Letting them upload one per app gives every guest
// a familiar scan target instead of forcing a single provider.
//
// Storage layout:
//   /artifacts/{appId}/users/{ownerUid}/redPackets/{qrId}
//     - provider   "payme" | "fps" | "alipayhk" | "wechat" | "other"
//     - label      e.g. "PayMe - Jenny"
//     - qrUrl      Firebase Storage download URL for the QR image
//     - qrPath     Storage path (so we can delete the file on remove)
//     - suggested  optional number, e.g. 800
//     - note       optional text, e.g. "新人名字: 阿明"
//     - sortOrder  numeric, used to render in stable order
//     - createdAt  server timestamp
//
// Image constraints:
//   - Max 2 MB
//   - PNG / JPG / WEBP only
//   - Stored at storage path "red-packets/{ownerUid}/{qrId}/{filename}"

const PROVIDERS = {
  payme: { label: 'PayMe', color: 'emerald', emoji: '💳' },
  fps: { label: 'FPS (轉數快)', color: 'blue', emoji: '🏦' },
  alipayhk: { label: 'AlipayHK', color: 'sky', emoji: '💙' },
  wechat: { label: 'WeChat Pay', color: 'green', emoji: '💚' },
  octopus: { label: '八達通', color: 'purple', emoji: '🐙' },
  other: { label: '其他', color: 'slate', emoji: '💰' },
};

const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export function RedPacketManager({ ownerUid, onClose, showToast }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState(null);

  // Live-subscribe to this couple's red-packet QRs
  useEffect(() => {
    if (!ownerUid) return;
    const colRef = collection(
      db,
      'artifacts',
      appId,
      'users',
      ownerUid,
      'redPackets',
    );
    const q = query(colRef);
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        setItems(list);
        setLoading(false);
      },
      (err) => {
        console.error('redPackets subscription failed:', err);
        setError('無法載入電子人情設定。請重新整理頁面再試。');
        setLoading(false);
      },
    );
    return () => unsub();
  }, [ownerUid]);

  async function handleAdd(file, provider, label, suggested, note) {
    if (!ownerUid) {
      setError('未登入，無法儲存');
      return;
    }
    if (!file) {
      setError('請選擇 QR Code 圖片');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(`圖片不能超過 2 MB（你上傳的是 ${(file.size / 1024 / 1024).toFixed(1)} MB）`);
      return;
    }
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('只支援 PNG / JPG / WEBP 格式');
      return;
    }

    setError(null);
    const newId = `rp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
    const path = `red-packets/${ownerUid}/${newId}/${safeName}`;

    try {
      // Upload image first; only write Firestore doc if upload succeeds.
      const sRef = storageRef(storage, path);
      await uploadBytes(sRef, file, { contentType: file.type });
      const url = await getDownloadURL(sRef);

      const docRef = doc(
        db,
        'artifacts',
        appId,
        'users',
        ownerUid,
        'redPackets',
        newId,
      );
      await setDoc(docRef, {
        provider,
        label: label?.trim() || PROVIDERS[provider]?.label || '電子人情',
        qrUrl: url,
        qrPath: path,
        suggested: suggested || null,
        note: note?.trim() || '',
        sortOrder: (items?.length || 0) + 1,
        createdAt: serverTimestamp(),
      });

      showToast?.('✅ 電子人情 QR Code 已上載');
    } catch (e) {
      console.error('red-packet upload failed:', e);
      setError('上載失敗：' + (e.message || '請稍後再試'));
    }
  }

  async function handleEdit(id, patch) {
    if (!ownerUid || !id) return;
    setError(null);
    try {
      const docRef = doc(
        db,
        'artifacts',
        appId,
        'users',
        ownerUid,
        'redPackets',
        id,
      );
      await setDoc(docRef, patch, { merge: true });
      showToast?.('✅ 已更新');
      setEditingId(null);
    } catch (e) {
      console.error('red-packet edit failed:', e);
      setError('更新失敗：' + (e.message || '請稍後再試'));
    }
  }

  async function handleDelete(item) {
    if (!item) return;
    if (!window.confirm(`確定刪除「${item.label}」？`)) return;
    setError(null);
    try {
      // Best-effort delete the image; if it fails, still drop the doc
      // (orphaned files are cheap to clean up later).
      if (item.qrPath) {
        try {
          await deleteObject(storageRef(storage, item.qrPath));
        } catch (e) {
          console.warn('qrPath delete failed (continuing):', e);
        }
      }
      await deleteDoc(
        doc(db, 'artifacts', appId, 'users', ownerUid, 'redPackets', item.id),
      );
      showToast?.('🗑 已刪除');
    } catch (e) {
      console.error('red-packet delete failed:', e);
      setError('刪除失敗：' + (e.message || '請稍後再試'));
    }
  }

  return (
    <div className="max-w-3xl mx-auto mt-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="bg-rose-100 p-3 rounded-2xl">
              <QrCode className="w-7 h-7 text-rose-500" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-800">🧧 電子人情</h2>
              <p className="text-sm text-slate-500 mt-1">
                上載你的 PayMe / FPS / AlipayHK QR Code，賓客可於電子喜帖直接掃碼。
              </p>
            </div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-700 rounded-lg"
              aria-label="關閉"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2 text-sm text-red-700">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Existing QRs */}
        {loading ? (
          <div className="text-center py-8 text-slate-400">載入中…</div>
        ) : items.length === 0 ? (
          <div className="text-center py-10 text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200 mb-4">
            尚未上載任何 QR Code。下面新增第一個吧！
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            {items.map((item) =>
              editingId === item.id ? (
                <EditRedPacketCard
                  key={item.id}
                  item={item}
                  onSave={(patch) => handleEdit(item.id, patch)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <RedPacketCard
                  key={item.id}
                  item={item}
                  onEdit={() => setEditingId(item.id)}
                  onDelete={() => handleDelete(item)}
                />
              ),
            )}
          </div>
        )}

        {/* Add new */}
        <NewRedPacketForm onSubmit={handleAdd} />
      </div>
    </div>
  );
}

function RedPacketCard({ item, onEdit, onDelete }) {
  const meta = PROVIDERS[item.provider] || PROVIDERS.other;
  return (
    <div className="border border-slate-200 rounded-xl p-3 bg-white flex gap-3">
      <div className="flex-shrink-0 w-24 h-24 bg-slate-100 rounded-lg overflow-hidden flex items-center justify-center">
        {item.qrUrl ? (
          <img
            src={item.qrUrl}
            alt={item.label}
            className="w-full h-full object-contain"
          />
        ) : (
          <ImageIcon className="w-8 h-8 text-slate-300" />
        )}
      </div>
      <div className="flex-grow min-w-0">
        <div className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
          <span>{meta.emoji}</span>
          <span className="truncate">{item.label}</span>
        </div>
        <div className="text-xs text-slate-500 mt-0.5">{meta.label}</div>
        {item.suggested ? (
          <div className="text-sm text-rose-600 font-bold mt-1">
            建議：HK$ {item.suggested}
          </div>
        ) : null}
        {item.note ? (
          <div className="text-xs text-slate-500 mt-1 italic truncate">
            {item.note}
          </div>
        ) : null}
        <div className="flex gap-1 mt-2">
          <button
            onClick={onEdit}
            className="px-2 py-1 text-xs text-slate-600 bg-slate-50 hover:bg-rose-50 hover:text-rose-600 border border-slate-200 rounded font-bold"
          >
            <span className="text-xs">✏️</span> 編輯
          </button>
          <button
            onClick={onDelete}
            className="px-2 py-1 text-xs text-slate-400 hover:text-red-600 hover:bg-red-50 border border-slate-200 rounded"
            title="刪除"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function EditRedPacketCard({ item, onSave, onCancel }) {
  const [provider, setProvider] = useState(item.provider || 'payme');
  const [label, setLabel] = useState(item.label || '');
  const [suggested, setSuggested] = useState(item.suggested || '');
  const [note, setNote] = useState(item.note || '');
  return (
    <div className="border-2 border-rose-300 rounded-xl p-3 bg-rose-50/30 space-y-2">
      <select
        value={provider}
        onChange={(e) => setProvider(e.target.value)}
        className="w-full p-2 text-sm rounded-lg border border-slate-300 bg-white"
      >
        {Object.entries(PROVIDERS).map(([k, v]) => (
          <option key={k} value={k}>
            {v.emoji} {v.label}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="顯示名稱 (例: PayMe - Jenny)"
        className="w-full p-2 text-sm rounded-lg border border-slate-300"
      />
      <input
        type="number"
        value={suggested}
        onChange={(e) => setSuggested(e.target.value)}
        placeholder="建議金額 (可選)"
        min="0"
        className="w-full p-2 text-sm rounded-lg border border-slate-300"
      />
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="備註 (例: 留言請填新人名字)"
        className="w-full p-2 text-sm rounded-lg border border-slate-300"
      />
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 border border-slate-300 rounded"
        >
          取消
        </button>
        <button
          onClick={() =>
            onSave({
              provider,
              label: label.trim() || PROVIDERS[provider]?.label || '電子人情',
              suggested: suggested ? Number(suggested) : null,
              note: note.trim(),
            })
          }
          className="px-2 py-1 text-xs text-white bg-rose-600 hover:bg-rose-700 rounded font-bold"
        >
          儲存
        </button>
      </div>
    </div>
  );
}

function NewRedPacketForm({ onSubmit }) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState('payme');
  const [label, setLabel] = useState('');
  const [suggested, setSuggested] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef(null);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full p-3 rounded-xl border-2 border-dashed border-slate-300 text-slate-500 hover:border-rose-300 hover:text-rose-600 font-bold flex items-center justify-center gap-2"
      >
        <Plus className="w-4 h-4" /> 新增 QR Code
      </button>
    );
  }

  async function handleSubmit() {
    if (!file) return;
    setSubmitting(true);
    try {
      await onSubmit(file, provider, label, suggested, note);
      // reset
      setLabel('');
      setSuggested('');
      setNote('');
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-xl border-2 border-rose-300 p-4 bg-rose-50/30 space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-bold text-slate-800 text-sm">新增 QR Code</div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={submitting}
          className="text-slate-400 hover:text-slate-600 p-1"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-12 gap-3">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="col-span-6 p-2 rounded-lg border border-slate-300 text-sm bg-white"
        >
          {Object.entries(PROVIDERS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.emoji} {v.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="顯示名稱 (例: PayMe - Jenny)"
          className="col-span-6 p-2 rounded-lg border border-slate-300 text-sm"
        />
        <input
          type="number"
          value={suggested}
          onChange={(e) => setSuggested(e.target.value)}
          placeholder="建議金額 (可選)"
          min="0"
          className="col-span-6 p-2 rounded-lg border border-slate-300 text-sm"
        />
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="備註 (例: 留言請填新人名字)"
          className="col-span-6 p-2 rounded-lg border border-slate-300 text-sm"
        />
        <div className="col-span-12">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="block w-full text-sm text-slate-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-bold file:bg-rose-50 file:text-rose-700 hover:file:bg-rose-100"
          />
          {file && (
            <div className="mt-2 text-xs text-slate-500">
              已選: {file.name} ({(file.size / 1024).toFixed(0)} KB)
            </div>
          )}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button
          onClick={() => setOpen(false)}
          disabled={submitting}
          className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100"
        >
          取消
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting || !file}
          className="px-3 py-1.5 text-sm rounded-lg bg-rose-600 text-white font-bold hover:bg-rose-700 disabled:opacity-50 flex items-center gap-1"
        >
          <Upload className="w-4 h-4" />
          {submitting ? '上載中…' : '上載'}
        </button>
      </div>
    </div>
  );
}

// 2026-07-24 — guest-side preview. Used by the PaymentModal in
// PersonalGuestPortal to render the actual QR codes. Pure
// presentation; no state, no side effects. Takes a list of redPackets
// from Firestore (via the parent) and renders them as a vertical
// stack of cards the guest can scan.
//
// Why a separate component (vs inlining in PaymentModal): the
// PaymentModal is shared with the live guest portal. This card is
// the one piece that depends on the owner's uploaded data, so we
// keep it as a small render-only component that the modal can mount
// when data is present.
export function RedPacketGuestView({ redPackets, suggestedAmount, onCopyQrLink }) {
  if (!redPackets || redPackets.length === 0) {
    return (
      <div className="text-center text-sm text-slate-500 py-4">
        暫未提供電子人情 QR Code。
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {suggestedAmount ? (
        <div className="text-center text-sm font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg py-2">
          建議人情：HK$ {suggestedAmount}
        </div>
      ) : null}
      {redPackets.map((rp) => {
        const meta = PROVIDERS[rp.provider] || PROVIDERS.other;
        return (
          <div
            key={rp.id}
            className="border border-slate-200 rounded-xl p-3 bg-white"
          >
            <div className="flex justify-between items-center mb-2">
              <div className="text-sm font-bold text-slate-700">
                {meta.emoji} {rp.label}
              </div>
              <span className="text-[10px] text-slate-400 uppercase tracking-wide">
                {meta.label}
              </span>
            </div>
            <div className="bg-slate-50 rounded-lg p-2 flex justify-center">
              <img
                src={rp.qrUrl}
                alt={`${rp.label} QR Code`}
                className="w-44 h-44 object-contain"
              />
            </div>
            {rp.note ? (
              <div className="text-xs text-slate-500 mt-2 text-center italic">
                {rp.note}
              </div>
            ) : null}
            {onCopyQrLink ? (
              <button
                onClick={() => onCopyQrLink(rp)}
                className="mt-2 w-full text-xs text-slate-500 hover:text-rose-600 flex items-center justify-center gap-1"
              >
                <Copy className="w-3 h-3" /> 複製 QR Code 連結
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
