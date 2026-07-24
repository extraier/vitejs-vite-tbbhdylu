import { X } from 'lucide-react';

export function FullscreenSlideshow({ photos, currentIndex, onClose }) {
  if (!photos || photos.length === 0) return null;
  const photo = photos[currentIndex];
  return (
    <div className="fixed inset-0 bg-black z-50 flex items-center justify-center">
      <button
        onClick={onClose}
        // 2026-07-24 — bumped z from 20 to 60 so this X is reachable
        // when the upload-success toast (z-200) is on screen. Even
        // though the toast has pointer-events:none, iOS Safari has
        // historical quirks with it; explicit z-stacking is the
        // belt-and-braces fix. Made the button bigger (p-3 / w-8 h-8)
        // for easier tapping on mobile.
        className="fixed top-6 right-6 text-white/70 hover:text-white bg-black/30 hover:bg-black/60 p-3 rounded-full z-[60] transition-colors"
        aria-label="關閉 slideshow"
      >
        <X className="w-8 h-8" />
      </button>
      <div className="absolute bottom-8 right-8 z-20 bg-black/60 backdrop-blur px-5 py-3 rounded-2xl text-right">
        <p className="text-white/70 text-sm mb-1">Photo by</p>
        <p className="text-white font-black text-2xl">{photo.uploaderName}</p>
      </div>
      <div className="relative w-full h-full flex items-center justify-center p-12">
        <div className="absolute inset-0 opacity-30">
          <img
            key={`bg-${currentIndex}`}
            src={photo.url}
            className="w-full h-full object-cover blur-2xl"
            alt="blur-bg"
          />
        </div>
        <img
          key={`main-${currentIndex}`}
          src={photo.url}
          alt="slideshow"
          className="max-w-full max-h-full object-contain relative z-10 shadow-2xl rounded-lg animate-in fade-in zoom-in-95 duration-700"
        />
      </div>
    </div>
  );
}
