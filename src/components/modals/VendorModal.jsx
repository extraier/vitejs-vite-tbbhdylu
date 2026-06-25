import { X, Star, ImageIcon } from 'lucide-react';

export function VendorModal({ vendor, onClose }) {
  if (!vendor) return null;
  return (
    <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-3xl max-w-4xl w-full shadow-2xl max-h-[90vh] flex flex-col overflow-hidden relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 bg-black/40 text-white p-2 rounded-full hover:bg-black/60 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="overflow-y-auto custom-scrollbar flex-grow">
          <div className="h-64 md:h-80 w-full bg-slate-200 relative">
            {vendor.portfolio?.[0] && (
              <img
                src={vendor.portfolio[0]}
                alt="cover"
                className="w-full h-full object-cover"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"></div>
            <div className="absolute bottom-0 left-0 p-8 w-full">
              <div className="flex flex-wrap gap-2 mb-3">
                {vendor.tags.map((tag) => (
                  <span
                    key={tag}
                    className="bg-white/20 backdrop-blur-md text-white text-xs font-bold px-3 py-1 rounded-full border border-white/30"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <h2 className="text-3xl md:text-4xl font-black text-white drop-shadow-md">
                {vendor.name}
              </h2>
            </div>
          </div>
          <div className="p-8">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8 bg-slate-50 p-6 rounded-2xl border border-slate-100">
              <div className="flex-1">
                <p className="text-slate-600 leading-relaxed text-sm md:text-base">
                  {vendor.description}
                </p>
              </div>
              <div className="text-left md:text-right flex-shrink-0">
                <div className="text-sm text-slate-500 font-bold mb-1">參考起步價</div>
                <div className="text-3xl font-black text-rose-600 mb-2">{vendor.price}</div>
                <div className="flex items-center gap-1.5 md:justify-end text-slate-600 font-bold">
                  <Star className="w-5 h-5 fill-amber-400 text-amber-400" /> {vendor.rating} / 5.0
                </div>
              </div>
            </div>
            <h3 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
              <ImageIcon className="w-6 h-6 text-rose-500" /> 作品集展示 (Portfolio)
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {vendor.portfolio?.map((img, index) => (
                <div
                  key={index}
                  className="aspect-square rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                >
                  <img
                    src={img}
                    alt={`portfolio-${index}`}
                    className="w-full h-full object-cover hover:scale-110 transition-transform duration-500"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
