import { CheckCircle2 } from 'lucide-react';

export function ScanResultModal({ guest, onClose }) {
  if (!guest) return null;
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-white -mt-16">
          <CheckCircle2 className="w-10 h-10 text-green-500" />
        </div>
        <h3 className="text-2xl font-black text-slate-800 mb-6">報到成功！</h3>
        <div className="bg-slate-50 rounded-xl p-5 border border-slate-100 text-left space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-slate-500 font-bold">嘉賓姓名</span>
            <span className="text-xl font-black">{guest.name}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-500 font-bold">安排座位</span>
            <span className="text-2xl font-black text-indigo-600 bg-indigo-50 px-3 py-1 rounded-lg border border-indigo-100">
              {guest.tableNumber}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
