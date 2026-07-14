// Step4Portfolio.jsx — image upload via cdn.savetheday.io
//
// Reuses the existing portfolioUpload helper. Files are uploaded to the
// NAS CDN first; the returned public URLs populate form.portfolio[]. On
// submit, applyAsVendor receives the URL array — no server-side image
// processing needed.

import { useState, useRef } from 'react';
import { ImagePlus, X, Upload, AlertCircle } from 'lucide-react';
import {
  uploadPortfolioImages,
  portfolioUploadConfigured,
} from '../../lib/portfolioUpload';

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILES = 24;

export function Step4Portfolio({ form, update, user, errors }) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [tagInput, setTagInput] = useState('');
  const fileInputRef = useRef(null);

  const handleFiles = async (fileList) => {
    setUploadError(null);
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    // Client-side validation — keep it consistent with portfolioUpload's
    // internal guards so the user gets a clean error here too.
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

    const remaining = MAX_FILES - form.portfolio.length;
    if (files.length > remaining) {
      setUploadError(`最多 ${MAX_FILES} 張，仲可以加多 ${remaining} 張`);
      return;
    }

    if (!portfolioUploadConfigured()) {
      setUploadError('上傳功能未設定（VITE_NAS_UPLOAD_URL/SECRET 缺失）');
      return;
    }
    if (!user?.uid) {
      setUploadError('需要先登入');
      return;
    }

    setUploading(true);
    try {
      const urls = await uploadPortfolioImages(user.uid, files);
      update({ portfolio: [...form.portfolio, ...urls] });
    } catch (e) {
      setUploadError(e?.message || '上傳失敗');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeImage = (idx) => {
    const next = form.portfolio.filter((_, i) => i !== idx);
    update({ portfolio: next });
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (!t) return;
    if (form.tags.includes(t)) {
      setTagInput('');
      return;
    }
    if (form.tags.length >= 10) {
      setUploadError('最多 10 個標籤');
      return;
    }
    update({ tags: [...form.tags, t] });
    setTagInput('');
  };

  const removeTag = (idx) => {
    update({ tags: form.tags.filter((_, i) => i !== idx) });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          作品集圖片 <span className="text-rose-600">*</span>
        </label>
        <div className="text-xs text-slate-500 mb-2">
          至少 1 張，建議 6-12 張。最多 {MAX_FILES} 張。JPG/PNG/WebP，每張 ≤ 8 MB。
        </div>

        {/* Existing images grid */}
        {form.portfolio.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mb-3">
            {form.portfolio.map((url, idx) => (
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

        {/* Upload trigger */}
        {form.portfolio.length < MAX_FILES && (
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
                  <Upload className="w-8 h-8 text-slate-400 animate-pulse" />
                  <div className="text-sm text-slate-600">上傳中…</div>
                </>
              ) : (
                <>
                  <ImagePlus className="w-8 h-8 text-slate-400" />
                  <div className="text-sm text-slate-700 font-medium">
                    點擊選擇圖片
                  </div>
                  <div className="text-xs text-slate-500">
                    可一次揀多張，自動順序上傳
                  </div>
                </>
              )}
            </button>
          </>
        )}

        {uploadError && (
          <div className="mt-2 bg-rose-50 border border-rose-200 rounded-lg p-2 flex gap-2 text-sm text-rose-700">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>{uploadError}</div>
          </div>
        )}
        {errors.portfolio && (
          <div className="mt-2 text-xs text-rose-600">{errors.portfolio}</div>
        )}
      </div>

      {/* Tags */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          標籤（最多 10 個）
        </label>
        <div className="text-xs text-slate-500 mb-2">
          熱門場地、風格、賣點。例：伯大尼、Ritz Carlton、紀實唯美
        </div>
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTag();
              }
            }}
            placeholder="輸入標籤後按 Enter 或 ＋"
            className="flex-1 px-3 py-2 rounded-lg border border-slate-300 outline-none text-sm"
            maxLength={30}
          />
          <button
            type="button"
            onClick={addTag}
            className="px-3 py-2 rounded-lg bg-slate-700 text-white text-sm font-bold hover:bg-slate-800"
          >
            ＋
          </button>
        </div>
        {form.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {form.tags.map((t, idx) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-sm"
              >
                {t}
                <button
                  type="button"
                  onClick={() => removeTag(idx)}
                  className="hover:text-rose-600"
                  title="刪除"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}