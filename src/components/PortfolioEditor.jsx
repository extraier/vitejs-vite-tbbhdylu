// PortfolioEditor.jsx — reusable image upload grid for any vendor flow.
//
// 2026-07-15 — extracted from Step4Portfolio.jsx so the same upload UX
// works in the post-onboarding "manage my portfolio" view. Both code
// paths now share the same validation, the same upload helper, and the
// same drag/drop / click-to-pick / URL-paste affordances.
//
// Used by:
//   - components/onboarding/Step4Portfolio.jsx  (initial wizard)
//   - screens/VendorProfileEdit.jsx             (post-onboarding edits)
//
// Props:
//   value        string[]    current portfolio URLs
//   onChange     (urls) => void  called when the list mutates
//   user         FirebaseUser   required for upload (writes under uid/)
//   max          number          cap (default 24)

import { useRef, useState } from 'react';
import {
  ImagePlus,
  X,
  Upload,
  AlertCircle,
  Link as LinkIcon,
  Loader2,
} from 'lucide-react';
import {
  uploadPortfolioImages,
  portfolioUploadConfigured,
} from '../lib/portfolioUpload';

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
const DEFAULT_MAX = 24;

export function PortfolioEditor({ value = [], onChange, user, max = DEFAULT_MAX }) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const fileInputRef = useRef(null);

  const handleFiles = async (fileList) => {
    setUploadError(null);
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    for (const f of files) {
      if (!ACCEPTED.includes(f.type)) {
        setUploadError(`不支援嘅格式：${f.type || '未知'}（只接受 JPG/PNG/WebP）`);
        return;
      }
      if (f.size > 8 * 1024 * 1024) {
        setUploadError(`檔案太大：${(f.size / 1024 / 1024).toFixed(1)} MB（上限 8 MB）`);
        return;
      }
    }
    const remaining = max - value.length;
    if (files.length > remaining) {
      setUploadError(`最多 ${max} 張，仲可以加多 ${remaining} 張`);
      return;
    }
    if (!portfolioUploadConfigured()) {
      setUploadError('上傳功能未設定');
      return;
    }
    if (!user?.uid) {
      setUploadError('需要先登入');
      return;
    }

    setUploading(true);
    try {
      const urls = await uploadPortfolioImages(user.uid, files);
      onChange([...value, ...urls]);
    } catch (e) {
      setUploadError(e?.message || '上傳失敗');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeImage = (idx) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  const handleAddUrl = () => {
    setUploadError(null);
    const raw = urlInput.trim();
    if (!raw) return;
    const candidates = raw.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    const valid = [];
    for (const u of candidates) {
      try {
        const parsed = new URL(u);
        if (!/^https?:$/.test(parsed.protocol)) continue;
        valid.push(u);
      } catch {
        // skip invalid
      }
    }
    if (valid.length === 0) {
      setUploadError('請輸入有效嘅 HTTPS 圖片連結（支援多行或逗號分隔）');
      return;
    }
    const remaining = max - value.length;
    if (valid.length > remaining) {
      setUploadError(`最多 ${max} 張，仲可以加多 ${remaining} 張`);
      return;
    }
    onChange([...value, ...valid]);
    setUrlInput('');
    setShowUrlInput(false);
  };

  return (
    <div className="space-y-3">
      {/* Existing images grid */}
      {value.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {value.map((url, idx) => (
            <div
              key={url}
              className="relative aspect-square rounded-lg overflow-hidden border border-slate-200 group"
            >
              <img
                src={url}
                alt={`作品 ${idx + 1}`}
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() => removeImage(idx)}
                className="absolute top-1 right-1 bg-rose-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                title="刪除"
              >
                <X className="w-3 h-3" />
              </button>
              <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs px-2 py-1">
                #{idx + 1}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload trigger + URL fallback */}
      {value.length < max && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED.join(',')}
            multiple
            onChange={(e) => handleFiles(e.target.files)}
            className="hidden"
            disabled={uploading}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-full py-8 rounded-xl border-2 border-dashed border-slate-300 hover:border-emerald-400 hover:bg-emerald-50 transition-colors flex flex-col items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? (
              <>
                <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
                <div className="text-sm text-slate-600">上傳中…</div>
              </>
            ) : (
              <>
                <ImagePlus className="w-8 h-8 text-slate-400" />
                <div className="text-sm text-slate-700 font-medium">點擊選擇圖片</div>
                <div className="text-xs text-slate-500">
                  可一次揀多張，自動順序上傳
                </div>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => setShowUrlInput((v) => !v)}
            className="w-full text-sm text-slate-600 hover:text-emerald-700 flex items-center justify-center gap-1.5 py-2"
          >
            <LinkIcon className="w-3.5 h-3.5" />
            {showUrlInput ? '隱藏 URL 貼上' : '或貼上已有嘅圖片 URL'}
          </button>

          {showUrlInput && (
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 space-y-2">
              <textarea
                rows={3}
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://example.com/photo1.jpg&#10;https://example.com/photo2.jpg"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-300 outline-none"
              />
              <button
                type="button"
                onClick={handleAddUrl}
                className="px-4 py-1.5 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-700"
              >
                加入
              </button>
            </div>
          )}
        </>
      )}

      {uploadError && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-2.5 flex items-start gap-2 text-sm text-rose-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>{uploadError}</div>
        </div>
      )}

      <div className="text-xs text-slate-500">
        {value.length}/{max} 張 · 建議 6-12 張展示作品
      </div>
    </div>
  );
}