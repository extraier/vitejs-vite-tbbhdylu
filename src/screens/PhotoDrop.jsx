import { Camera, Crown, PieChart, Monitor } from 'lucide-react';
import { FREE_TIER_LIMIT_MB } from '../lib/config';

export function PhotoDrop({ photos, storageUsedMB, isPremium, onPlaySlideshow, onUpgrade }) {
  return (
    <div className="max-w-6xl mx-auto mt-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Camera className="w-7 h-7 text-rose-500" /> 互動相片牆 (Photo Drop)
          </h2>
          <p className="text-slate-500 text-sm mt-1">統一收集賓客相片。升級 Premium 解鎖無限儲存空間。</p>
        </div>
        <button
          onClick={onPlaySlideshow}
          className="bg-rose-600 text-white font-bold px-6 py-2 rounded-xl hover:bg-rose-700 shadow-md flex items-center gap-2"
        >
          <Monitor className="w-4 h-4" /> 播放 Live Slideshow
        </button>
      </div>

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
            <div>
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                雲端儲存空間{' '}
                {isPremium && (
                  <span className="bg-amber-400 text-white text-[10px] px-2 py-0.5 rounded-full">
                    PRO
                  </span>
                )}
              </h3>
            </div>
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
                  {' '}
                  / {FREE_TIER_LIMIT_MB} MB
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
              ></div>
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

      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
        <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span> 已收集 {photos.length}{' '}
          張相片
        </h3>
        {photos.length === 0 ? (
          <div className="text-center py-10 text-slate-400">暫時未有賓客上載相片</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {photos.map((p) => {
              // Use thumbnailUrl when available (256px, ~500 bytes) for the
              // gallery grid; full url only loads when user opens full-screen.
              // Fall back to url for legacy photos uploaded before thumbnail
              // support shipped (Hermes 2026-06-25).
              const displayUrl = p.thumbnailUrl || p.url;
              return (
                <div
                  key={p.id}
                  className="aspect-square rounded-xl overflow-hidden relative group cursor-pointer shadow-sm"
                >
                  <img
                    src={displayUrl}
                    data-full-url={p.url}
                    alt="upload"
                    loading="lazy"
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
                    <span className="text-white text-xs font-bold truncate">{p.uploaderName}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
