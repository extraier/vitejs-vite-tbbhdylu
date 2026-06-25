import { Briefcase, Calendar, DollarSign, MessageSquare } from 'lucide-react';

export function VendorDashboard({ jobRequests, onSubmitProposal }) {
  return (
    <div className="max-w-6xl mx-auto mt-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="bg-slate-900 rounded-2xl p-8 text-white mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-3">
            <Briefcase className="w-7 h-7 text-emerald-400" /> 商戶接單大堂 (Vendor Board)
          </h2>
          <p className="text-slate-400 mt-2 text-sm">
            瀏覽全港新人發佈的急切要求，主動發送報價單發掘潛在客源。
          </p>
        </div>
        <div className="bg-slate-800/80 backdrop-blur px-5 py-3 rounded-xl border border-slate-700">
          <div className="text-xs text-slate-400 mb-0.5">當前登入商戶：</div>
          <div className="font-bold text-emerald-400 text-lg">Visionary Capture</div>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {jobRequests.map((job) => (
          <div
            key={job.id}
            className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 hover:border-emerald-300 transition-all flex flex-col h-full"
          >
            <div className="mb-4 mt-2">
              <h3 className="text-xl font-bold text-slate-800 mb-1">{job.serviceNeeded}</h3>
              <p className="text-sm text-slate-500 font-medium">
                客戶: {job.coupleName} • 發佈於 {job.postedAt}
              </p>
            </div>
            <div className="space-y-3 mb-6 flex-grow bg-slate-50 p-4 rounded-xl border border-slate-100">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500 flex items-center gap-1.5">
                  <Calendar className="w-4 h-4" /> 婚期
                </span>
                <strong className="text-slate-800">{job.weddingDate}</strong>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500 flex items-center gap-1.5">
                  <DollarSign className="w-4 h-4" /> 預算
                </span>
                <strong className="text-rose-600">{job.budget}</strong>
              </div>
              <div className="text-sm text-slate-700 mt-3 pt-3 border-t border-slate-200 leading-relaxed">
                <span className="text-slate-400 block mb-1 text-xs">詳細要求：</span>"{job.details}"
              </div>
            </div>
            <button
              onClick={() => onSubmitProposal(job.id)}
              className="w-full bg-emerald-600 text-white font-bold py-3 rounded-xl hover:bg-emerald-700 transition-colors flex justify-center items-center gap-2 shadow-sm"
            >
              <MessageSquare className="w-5 h-5" /> 立即發送報價單
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
