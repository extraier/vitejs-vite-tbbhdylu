import { Wallet, PieChart, CheckCircle2, Circle } from 'lucide-react';

export function CoupleBudget({ tasks, totalBudget, totalSpent }) {
  const totalRemaining = totalBudget - totalSpent;
  const budgetPercentage = Math.round((totalSpent / totalBudget) * 100);

  return (
    <div className="max-w-5xl mx-auto mt-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200 mb-8">
        <h2 className="text-2xl font-bold text-slate-800 mb-6 flex items-center gap-2">
          <Wallet className="w-7 h-7 text-rose-500" /> 預算管理與明細
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <SummaryCard label="總預算目標 (HKD)" value={`$${totalBudget.toLocaleString()}`} tone="slate" />
          <SummaryCard label="已確認開支" value={`$${totalSpent.toLocaleString()}`} tone="rose" />
          <SummaryCard
            label="剩餘可分配"
            value={`$${totalRemaining.toLocaleString()}`}
            tone={totalRemaining < 0 ? 'red' : 'emerald'}
          />
        </div>

        <div className="mb-10 bg-slate-50 p-5 rounded-xl border border-slate-100">
          <div className="flex justify-between text-sm mb-2">
            <span className="font-bold text-slate-700 flex items-center gap-2">
              <PieChart className="w-4 h-4" />預算消耗進度
            </span>
            <span className="font-black text-slate-800">{budgetPercentage}%</span>
          </div>
          <div className="w-full bg-slate-200 rounded-full h-4 overflow-hidden shadow-inner">
            <div
              className={`h-full transition-all duration-1000 ease-out relative ${
                budgetPercentage > 100 ? 'bg-red-500' : 'bg-gradient-to-r from-rose-400 to-rose-500'
              }`}
              style={{ width: `${Math.min(budgetPercentage, 100)}%` }}
            ></div>
          </div>
        </div>

        <div className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
          <div className="hidden sm:grid grid-cols-12 gap-4 p-4 bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
            <div className="col-span-6">項目</div>
            <div className="col-span-2 text-center">狀態</div>
            <div className="col-span-4 text-right">金額 (HKD)</div>
          </div>
          <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto custom-scrollbar">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-4 p-4 bg-white hover:bg-slate-50 items-center"
              >
                <div className="sm:col-span-6 flex items-center gap-3">
                  {task.isCompleted ? (
                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                  ) : (
                    <Circle className="w-5 h-5 text-amber-400" />
                  )}
                  <div className="font-bold text-slate-800">{task.title}</div>
                </div>
                <div className="sm:col-span-2 sm:text-center pl-8 sm:pl-0">
                  {task.isCompleted ? (
                    <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-1 rounded">
                      已確認 (已付款)
                    </span>
                  ) : (
                    <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-1 rounded">
                      籌備中 (預算)
                    </span>
                  )}
                </div>
                <div className="sm:col-span-4 sm:text-right pl-8 sm:pl-0 font-mono">
                  {task.isCompleted ? (
                    <span className="font-bold text-slate-800">${task.actualCost}</span>
                  ) : (
                    <span className="text-slate-400">${task.estimatedCost}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, tone }) {
  const palette = {
    slate: 'bg-slate-50 border-slate-200 text-slate-800',
    rose: 'bg-rose-50 border-rose-200 text-rose-700',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    red: 'bg-red-50 border-red-200 text-red-700',
  }[tone];
  return (
    <div className={`rounded-xl p-5 border shadow-sm ${palette}`}>
      <p className={`text-sm mb-1 font-bold`}>{label}</p>
      <p className="text-3xl font-black">{value}</p>
    </div>
  );
}
