import { ScanLine } from 'lucide-react';

export function ReceptionScanner({ onSimulateScan }) {
  return (
    <div className="max-w-md mx-auto mt-10 animate-in fade-in duration-300">
      <div className="bg-slate-900 rounded-3xl p-6 text-center text-white shadow-2xl relative overflow-hidden">
        <div className="relative z-10">
          <ScanLine className="w-12 h-12 text-indigo-400 mx-auto mb-4" />
          <h2 className="text-2xl font-black mb-2">接待處掃描系統</h2>
          <div className="aspect-square bg-black rounded-2xl border-2 border-indigo-500/50 relative overflow-hidden mb-8 mt-6">
            <div className="absolute top-0 left-0 w-full h-1 bg-indigo-500 shadow-[0_0_15px_#6366f1] animate-[scan_2s_ease-in-out_infinite]"></div>
            <div className="w-full h-full flex items-center justify-center text-slate-500">
              <span className="text-sm">請對準QR Code...</span>
            </div>
          </div>
          <button
            onClick={onSimulateScan}
            className="w-full bg-indigo-500 text-white font-black py-4 rounded-xl hover:bg-indigo-600 tracking-wider"
          >
            [模擬] 掃描
          </button>
        </div>
      </div>
    </div>
  );
}
