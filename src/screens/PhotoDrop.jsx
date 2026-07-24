import { useState, useMemo, useEffect } from 'react';
import {
  Camera,
  Crown,
  PieChart,
  Monitor,
  MessageCircle,
  Heart,
  X,
  Trash2,
  Filter,
  Image as ImageIcon,
} from 'lucide-react';
import { FREE_TIER_LIMIT_MB } from '../lib/config';

/**
 * PhotoDrop — 互動相片牆
 *
 * 2026-07-23 — Added 4 features that were missing:
 *   1. Caption per photo (owner + guest via link + helper can edit)
 *   2. ❤️ Reactions (toggle, count, recent avatars)
 *   3. Filter by uploader (chips at the top of the gallery)
 *   4. Delete (owner moderation) — rules already allow it
 *
 * Firestore rules permit update/delete by the owner, so we don't
 * need a Cloud Function. The onSnapshot in App.jsx picks up the
 * changes automatically.
 *
 * Photo doc shape (matches uploadToNas + firestore.rules match /photos):
 *   { id, eventId, url, thumbnailUrl, uploaderId, uploaderName,
 *     createdAt, caption?, reactions?: { [uid]: true } }
 */

export function PhotoDrop({
  photos,
  storageUsedMB,
  isPremium,
  currentUserUid,
  onPlaySlideshow,
  onUpgrade,
  onUpdatePhoto,   // (photoId, { caption?, reactions? }) => Promise<void>
  onDeletePhoto,   // (photoId) => Promise<void>
  onShowToast,     // (msg) => void
}) {
  // Filter state
  const [uploaderFilter, setUploaderFilter] = useState('all');

  // Expanded photo modal state
  const [expandedPhoto, setExpandedPhoto] = useState(null);
  const [editingCaption, setEditingCaption] = useState('');
  const [isSavingCaption, setIsSavingCaption] = useState(false);

  // Get unique uploader list (for filter chips)
  const uploaders = useMemo(() => {
    const map = new Map();
    photos.forEach((p) => {
      if (p.uploaderId && p.uploaderName) {
        map.set(p.uploaderId, p.uploaderName);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [photos]);

  const visiblePhotos = useMemo(() => {
    if (uploaderFilter === 'all') return photos;
    return photos.filter((p) => p.uploaderId === uploaderFilter);
  }, [photos, uploaderFilter]);

  const openPhoto = (photo) => {
    setExpandedPhoto(photo);
    setEditingCaption(photo.caption || '');
  };
  const closePhoto = () => {
    setExpandedPhoto(null);
    setEditingCaption('');
  };

  const handleSaveCaption = async () => {
    if (!expandedPhoto) return;
    setIsSavingCaption(true);
    try {
      await onUpdatePhoto(expandedPhoto.id, { caption: editingCaption.trim() });
      // Optimistically reflect in the modal so the user sees the save immediately
      setExpandedPhoto({ ...expandedPhoto, caption: editingCaption.trim() });
      onShowToast?.('✅ 留言已儲存');
    } catch (err) {
      onShowToast?.(`❌ 儲存失敗：${err.message || '未知錯誤'}`);
    } finally {
      setIsSavingCaption(false);
    }
  };

  const handleToggleReaction = async (photo) => {
    if (!currentUserUid) {
      onShowToast?.('請先登入才能點 ❤️');
      return;
    }
    const current = photo.reactions || {};
    const hasReacted = !!current[currentUserUid];
    const next = { ...current };
    if (hasReacted) {
      delete next[currentUserUid];
    } else {
      next[currentUserUid] = true;
    }
    try {
      await onUpdatePhoto(photo.id, { reactions: next });
      // Optimistic update on the photo card so the heart fills instantly
      if (expandedPhoto?.id === photo.id) {
        setExpandedPhoto({ ...expandedPhoto, reactions: next });
      } else {
        // No modal open — nothing to update locally, Firestore listener will repaint
      }
    } catch (err) {
      onShowToast?.(`❌ 點讚失敗：${err.message || '未知錯誤'}`);
    }
  };

  const handleDelete = async () => {
    if (!expandedPhoto) return;
    if (!window.confirm('確定刪除呢張相片？此操作無法復原。')) return;
    try {
      await onDeletePhoto(expandedPhoto.id);
      onShowToast?.('🗑️ 相片已刪除');
      closePhoto();
    } catch (err) {
      onShowToast?.(`❌ 刪除失敗：${err.message || '未知錯誤'}`);
    }
  };

  return (
    <div className="max-w-6xl mx-auto mt-8 animate-in slide-in-from-bottom-4 duration-500">
      {/* Header + Slideshow CTA */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Camera className="w-7 h-7 text-rose-500" /> 互動相片牆 (Photo Drop)
          </h2>
          <p className="text-slate-500 text-sm mt-1">
            統一收集賓客相片。升級 Premium 解鎖無限儲存空間。
          </p>
        </div>
        <button
          onClick={onPlaySlideshow}
          disabled={photos.length === 0}
          className="bg-rose-600 text-white font-bold px-6 py-2 rounded-xl hover:bg-rose-700 shadow-md flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Monitor className="w-4 h-4" /> 播放 Live Slideshow
        </button>
      </div>

      {/* Storage meter */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 mb-8 flex flex-col md:flex-row items-center gap-6">
        <div className={`p-4 rounded-full ${isPremium ? 'bg-amber-100' : 'bg-slate-100'}`}>
          {isPremium ? (
            <Crown className="w-8 h-8 text-amber-500" />
          ) : (
            <PieChart className="w-8 h-8 text-slate-500" />
          )}
        </div>
        <div className="flex-grow w-full">
          <div className="flex justify-between items-end mb-2">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              雲端儲存空間{' '}
              {isPremium && (
                <span className="bg-amber-400 text-white text-[10px] px-2 py-0.5 rounded-full">
                  PRO
                </span>
              )}
            </h3>
            <div className="text-right">
              <span
                className={`text-lg font-black ${
                  storageUsedMB >= FREE_TIER_LIMIT_MB ? 'text-red-500' : 'text-slate-800'
                }`}
              >
                {storageUsedMB.toFixed(1)} MB
              </span>
              {!isPremium && (
                <span className="text-sm text-slate-500 font-medium">
                  {' '}/ {FREE_TIER_LIMIT_MB} MB
                </span>
              )}
            </div>
          </div>
          {!isPremium && (
            <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  storageUsedMB >= FREE_TIER_LIMIT_MB ? 'bg-red-500' : 'bg-slate-800'
                }`}
                style={{
                  width: `${Math.min((storageUsedMB / FREE_TIER_LIMIT_MB) * 100, 100)}%`,
                }}
              />
            </div>
          )}
        </div>
        {!isPremium && (
          <button
            onClick={onUpgrade}
            className="flex-shrink-0 bg-amber-400 text-white font-bold px-5 py-2.5 rounded-xl hover:bg-amber-500 shadow-sm flex items-center gap-2"
          >
            升級 Premium
          </button>
        )}
      </div>

      {/* Gallery */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
        {/* Gallery header + filter chips */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            已收集 {visiblePhotos.length}
            {uploaderFilter !== 'all' && photos.length !== visiblePhotos.length
              ? ` / ${photos.length}`
              : ''}{' '}
            張相片
          </h3>

          {uploaders.length > 1 && (
            <div className="flex items-center gap-2 flex-wrap">
              <Filter className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <Chip
                label="全部"
                count={photos.length}
                active={uploaderFilter === 'all'}
                onClick={() => setUploaderFilter('all')}
              />
              {uploaders.map((u) => (
                <Chip
                  key={u.id}
                  label={u.name}
                  count={photos.filter((p) => p.uploaderId === u.id).length}
                  active={uploaderFilter === u.id}
                  onClick={() => setUploaderFilter(u.id)}
                />
              ))}
            </div>
          )}
        </div>

        {visiblePhotos.length === 0 ? (
          <div className="text-center py-10 text-slate-400">
            {uploaderFilter === 'all'
              ? '暫時未有賓客上載相片'
              : `${uploaders.find((u) => u.id === uploaderFilter)?.name || ''} 暫時未上載相片`}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {visiblePhotos.map((p) => {
              const displayUrl = p.thumbnailUrl || p.url;
              const reactionCount = p.reactions ? Object.keys(p.reactions).length : 0;
              const userHasReacted = currentUserUid && p.reactions?.[currentUserUid];
              return (
                <PhotoCard
                  key={p.id}
                  photo={p}
                  displayUrl={displayUrl}
                  reactionCount={reactionCount}
                  userHasReacted={userHasReacted}
                  currentUserUid={currentUserUid}
                  onOpen={() => openPhoto(p)}
                  onToggleReaction={() => handleToggleReaction(p)}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Full-screen expanded photo modal */}
      {expandedPhoto && (
        <ExpandedPhotoModal
          photo={expandedPhoto}
          editingCaption={editingCaption}
          isSavingCaption={isSavingCaption}
          currentUserUid={currentUserUid}
          isOwner={currentUserUid && expandedPhoto.uploaderId === currentUserUid}
          onClose={closePhoto}
          onCaptionChange={setEditingCaption}
          onSaveCaption={handleSaveCaption}
          onToggleReaction={() => handleToggleReaction(expandedPhoto)}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}

// ---- Sub-components ---------------------------------------------------

function Chip({ label, count, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs font-bold px-3 py-1.5 rounded-full transition-colors whitespace-nowrap ${
        active
          ? 'bg-rose-500 text-white shadow-sm'
          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
      }`}
    >
      {label}{' '}
      <span className={active ? 'opacity-90' : 'opacity-60'}>
        {count}
      </span>
    </button>
  );
}

function PhotoCard({
  photo,
  displayUrl,
  reactionCount,
  userHasReacted,
  currentUserUid,
  onOpen,
  onToggleReaction,
}) {
  return (
    <div
      className="aspect-square rounded-xl overflow-hidden relative group cursor-pointer shadow-sm bg-slate-100"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen()}
    >
      <img
        src={displayUrl}
        data-full-url={photo.url}
        alt={photo.caption || photo.uploaderName || 'upload'}
        loading="lazy"
        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
      />

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-3 pointer-events-none">
        <div className="flex justify-end">
          {photo.caption && (
            <span className="bg-white/90 text-slate-800 text-[10px] px-2 py-1 rounded-full max-w-full truncate">
              💬 {photo.caption}
            </span>
          )}
        </div>
        <div className="flex justify-between items-end">
          <span className="text-white text-xs font-bold truncate">{photo.uploaderName}</span>
          {reactionCount > 0 && (
            <span className="bg-rose-500/90 text-white text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1">
              <Heart className="w-3 h-3 fill-current" /> {reactionCount}
            </span>
          )}
        </div>
      </div>

      {/* Persistent heart badge when there are reactions and no hover */}
      {reactionCount > 0 && (
        <div className="absolute top-2 right-2 bg-rose-500 text-white text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 shadow-md group-hover:opacity-0 transition-opacity">
          <Heart className="w-3 h-3 fill-current" /> {reactionCount}
        </div>
      )}

      {/* Quick-reaction button on tap (mobile-friendly) */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleReaction();
        }}
        className={`absolute bottom-2 right-2 w-9 h-9 rounded-full flex items-center justify-center shadow-lg transition-all ${
          userHasReacted
            ? 'bg-rose-500 text-white scale-110'
            : 'bg-white/90 text-slate-700 opacity-0 group-hover:opacity-100 hover:bg-rose-50'
        }`}
        aria-label={userHasReacted ? '取消讚好' : '讚好'}
        title={userHasReacted ? '取消讚好' : '讚好'}
        disabled={!currentUserUid}
      >
        <Heart className={`w-4 h-4 ${userHasReacted ? 'fill-current' : ''}`} />
      </button>
    </div>
  );
}

function ExpandedPhotoModal({
  photo,
  editingCaption,
  isSavingCaption,
  currentUserUid,
  isOwner,
  onClose,
  onCaptionChange,
  onSaveCaption,
  onToggleReaction,
  onDelete,
}) {
  const reactionCount = photo.reactions ? Object.keys(photo.reactions).length : 0;
  const userHasReacted = currentUserUid && photo.reactions?.[currentUserUid];

  // 2026-07-24 — Esc key handler. The original X button was small
  // (p-1.5 + w-5 = ~32px) and buried inside the sidebar header on
  // mobile (modal is flex-col, so X is at top-right of the SIDEBAR,
  // not the screen — easy to miss). Users reported clicking X did
  // nothing. The root cause was likely the toast overlay (z-200,
  // pointer-events-none was added but iOS Safari has historical
  // quirks with it) sitting on top of the modal X. Defense in depth:
  // 1) Floating X button pinned to top-right of the SCREEN, with
  //    z above the modal so it's always reachable. 2) Esc key
  //    closes the modal. 3) Click-outside already worked but kept.
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      {/* Floating close button — pinned to top-right of the screen,
          above the modal box. Easier to find on mobile than the
          small sidebar X. z-60 (above modal z-50, below toast z-200). */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="fixed top-4 right-4 z-[60] bg-black/60 hover:bg-black/80 text-white p-3 rounded-full backdrop-blur-sm shadow-lg transition-colors"
        aria-label="關閉相片"
      >
        <X className="w-6 h-6" />
      </button>
      <div
        className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col md:flex-row shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Photo */}
        <div className="flex-1 bg-slate-900 flex items-center justify-center min-h-[300px] md:min-h-0">
          <img
            src={photo.url}
            alt={photo.caption || photo.uploaderName || 'upload'}
            className="max-h-[60vh] md:max-h-[90vh] w-full object-contain"
          />
        </div>

        {/* Sidebar */}
        <div className="w-full md:w-80 flex flex-col border-t md:border-t-0 md:border-l border-slate-200 max-h-[40vh] md:max-h-[90vh]">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-slate-200">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-rose-400 to-pink-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                {(photo.uploaderName || '?').charAt(0)}
              </div>
              <div className="min-w-0">
                <div className="font-bold text-slate-800 text-sm truncate">
                  {photo.uploaderName}
                </div>
                <div className="text-[10px] text-slate-400">
                  {photo.createdAt
                    ? new Date(photo.createdAt).toLocaleString('zh-HK', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })
                    : ''}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
              aria-label="關閉"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Caption editor */}
          <div className="p-4 border-b border-slate-200 flex-shrink-0">
            <label className="block text-xs font-bold text-slate-600 mb-2 flex items-center gap-1">
              <MessageCircle className="w-3.5 h-3.5" /> 留言 / Caption
            </label>
            <textarea
              value={editingCaption}
              onChange={(e) => onCaptionChange(e.target.value)}
              placeholder={isOwner ? '新增一啲描述…' : '賓客可以加留言…'}
              maxLength={500}
              rows={3}
              className="w-full text-sm border border-slate-200 rounded-lg p-2 focus:outline-none focus:border-rose-400 resize-none"
            />
            <div className="flex justify-between items-center mt-2">
              <span className="text-[10px] text-slate-400">
                {editingCaption.length}/500
              </span>
              <button
                type="button"
                onClick={onSaveCaption}
                disabled={isSavingCaption || editingCaption === (photo.caption || '')}
                className="text-xs font-bold px-3 py-1.5 rounded-lg bg-rose-500 text-white hover:bg-rose-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSavingCaption ? '儲存中…' : '儲存'}
              </button>
            </div>
          </div>

          {/* Reactions summary */}
          <div className="p-4 border-b border-slate-200 flex-shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-600 flex items-center gap-1">
                <Heart className="w-3.5 h-3.5" /> 讚好
              </span>
              <span className="text-lg font-black text-rose-500">{reactionCount}</span>
            </div>
            <button
              type="button"
              onClick={onToggleReaction}
              disabled={!currentUserUid}
              className={`w-full mt-3 py-2 rounded-lg font-bold flex items-center justify-center gap-2 transition-colors ${
                userHasReacted
                  ? 'bg-rose-50 text-rose-600 border border-rose-200'
                  : 'bg-slate-100 text-slate-700 hover:bg-rose-50 hover:text-rose-600'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <Heart className={`w-4 h-4 ${userHasReacted ? 'fill-current' : ''}`} />
              {userHasReacted ? '已讚好（再按取消）' : '讚好呢張相'}
            </button>
          </div>

          {/* Spacer pushes delete to bottom */}
          <div className="flex-grow" />

          {/* Owner-only delete */}
          {isOwner && (
            <div className="p-4 border-t border-slate-200 flex-shrink-0">
              <button
                type="button"
                onClick={onDelete}
                className="w-full text-sm font-bold text-red-600 hover:bg-red-50 py-2 rounded-lg flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4" /> 刪除呢張相
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
