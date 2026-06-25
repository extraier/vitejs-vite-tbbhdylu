import { MessageSquare, Star, X } from 'lucide-react';

export function ProposalsModal({ jobId, proposals, onClose }) {
  if (!jobId) return null;
  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl p-6 max-w-2xl w-full shadow-xl max-h-[85vh] flex flex-col relative">
        <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-4">
          <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-rose-500" />
            商戶報價單
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
        <div className="overflow-y-auto custom-scrollbar pr-2 flex-grow">
          {proposals?.length > 0 ? (
            proposals.map((p) => (
              <div key={p.id} className="mb-4 p-5 border border-slate-200 rounded-xl bg-slate-50">
                <div className="flex justify-between items-start mb-2">
                  <div className="font-bold text-slate-800 text-lg">{p.vendorName}</div>
                  <div className="font-bold text-rose-600 text-lg">{p.price}</div>
                </div>
                <div className="flex items-center gap-1 text-sm text-slate-500 mb-3">
                  <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                  <span className="font-medium">{p.rating}</span> • {p.date}
                </div>
                <p className="text-sm text-slate-700 leading-relaxed bg-white p-3 rounded-lg border border-slate-100">
                  "{p.message}"
                </p>
              </div>
            ))
          ) : (
            <div className="text-center text-slate-500 py-10">
              暫時未有商戶發送報價，請耐心等候。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
