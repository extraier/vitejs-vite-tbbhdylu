import { AlertCircle, Send } from 'lucide-react';
import { TASK_CATEGORIES } from '../lib/config';

export function CoupleJobBoard({
  jobRequests,
  newJobForm,
  onNewJobFormChange,
  onSubmitJob,
  onShowProposals,
}) {
  return (
    <div className="max-w-4xl mx-auto mt-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="bg-white rounded-2xl p-8 shadow-sm border border-rose-100 mb-8 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-rose-50/30 via-white to-white">
        <div className="flex items-start sm:items-center gap-4 mb-6">
          <div className="bg-rose-100 p-3 rounded-2xl flex-shrink-0">
            <AlertCircle className="w-8 h-8 text-rose-500" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-800">出 Post 求救</h2>
            <p className="text-slate-500 text-sm mt-1">
              配對唔到心水？將你嘅要求、Budget、指定場地列出嚟，等全港 Vendor 主動搵你報價！
            </p>
          </div>
        </div>
        <form onSubmit={onSubmitJob} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">需要咩服務？</label>
              <select
                className="w-full p-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-rose-300 outline-none bg-white"
                value={newJobForm.serviceNeeded}
                onChange={(e) => onNewJobFormChange({ ...newJobForm, serviceNeeded: e.target.value })}
              >
                {Object.values(TASK_CATEGORIES).map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">
                大約預算 Budget
              </label>
              <input
                type="text"
                required
                placeholder="例如: $15,000 - $20,000"
                className="w-full p-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-rose-300 outline-none"
                value={newJobForm.budget}
                onChange={(e) => onNewJobFormChange({ ...newJobForm, budget: e.target.value })}
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-bold text-slate-700 mb-1">詳細要求</label>
              <textarea
                rows="4"
                required
                placeholder="講多少少你嘅期望、風格、特別要求..."
                className="w-full p-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-rose-300 outline-none resize-none"
                value={newJobForm.details}
                onChange={(e) => onNewJobFormChange({ ...newJobForm, details: e.target.value })}
              ></textarea>
            </div>
          </div>
          <button
            type="submit"
            className="w-full bg-rose-600 text-white font-bold py-3.5 rounded-xl hover:bg-rose-700 transition-colors flex justify-center items-center gap-2 shadow-sm"
          >
            <Send className="w-5 h-5" /> 立即發佈到「商戶大堂」
          </button>
        </form>
      </div>

      <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
        我發佈過嘅求救記錄
      </h3>
      <div className="space-y-4">
        {jobRequests.map((job) => (
          <div
            key={job.id}
            className="bg-white rounded-xl p-5 border border-slate-200 flex justify-between items-center hover:border-rose-200 transition-colors"
          >
            <div>
              <h4 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                {job.serviceNeeded}
              </h4>
              <p className="text-sm text-slate-500 mt-1">
                預算: <span className="font-bold text-slate-700">{job.budget}</span>
              </p>
            </div>
            <div className="text-right">
              <div className="text-rose-600 font-bold mb-1">{job.proposalsCount} 個商戶已報價</div>
              <button
                onClick={() => onShowProposals(job.id)}
                className="text-sm font-bold bg-rose-50 text-rose-700 border border-rose-200 px-4 py-1.5 rounded-lg hover:bg-rose-100"
              >
                查看報價單
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
