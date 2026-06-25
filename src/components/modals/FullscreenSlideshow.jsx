import { X } from 'lucide-react';

export function FullscreenSlideshow({ photos, currentIndex, onClose }) {
  if (!photos || photos.length === 0) return null;
  const photo = photos[currentIndex];
  return (
    <div className="fixed inset-0 bg-black z-50 flex items-center justify-center">
      <button
        onClick={onClose}
        className="absolute top-6 right-6 text-white/50 hover:text-white bg-black/20 p-3 rounded-full z-20"
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
