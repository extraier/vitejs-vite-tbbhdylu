import { Briefcase, Info } from 'lucide-react';

export function VendorProfileEdit({ vendor }) {
  return (
    <div className="max-w-4xl mx-auto mt-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="bg-emerald-900 p-8 text-white">
          <h2 className="text-2xl font-bold flex items-center gap-3">
            <Briefcase className="w-7 h-7 text-emerald-400" /> 商戶專頁管理 (Profile Builder)
          </h2>
          <p className="text-emerald-100 mt-2 text-sm">完善你的專頁資料及上載最新作品。</p>
        </div>
        <div className="p-8 space-y-8">
          <div>
            <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
              <Info className="w-5 h-5 text-emerald-600" /> 基本資料
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">商戶名稱</label>
                <input
                  type="text"
                  className="w-full p-3 rounded-xl border border-slate-300 bg-slate-50"
                  value={vendor.name}
                  readOnly
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">參考起步價</label>
                <input
                  type="text"
                  className="w-full p-3 rounded-xl border border-slate-300 bg-slate-50"
                  value={vendor.price}
                  readOnly
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-bold text-slate-700 mb-1">商戶簡介</label>
                <textarea
                  rows="3"
                  className="w-full p-3 rounded-xl border border-slate-300 bg-slate-50 resize-none"
                  value={vendor.description}
                  readOnly
                ></textarea>
              </div>
            </div>
          </div>
          <button className="w-full bg-emerald-600 text-white font-bold py-3.5 rounded-xl hover:bg-emerald-700 transition-colors shadow-sm">
            儲存專頁設定
          </button>
        </div>
      </div>
    </div>
  );
}
