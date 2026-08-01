// 2026-08-01 — Compact KPI tile for the MyProfile referral row.
export function ReferralKpi({ icon, label, value, tooltip }) {
  return (
    <div
      className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col items-start gap-1 shadow-sm"
      title={tooltip}
    >
      <div className="flex items-center gap-1.5 text-slate-500">
        <span className="text-rose-500">{icon}</span>
        <span className="text-[11px] font-bold uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-xl font-black text-slate-800 tabular-nums">{value}</div>
    </div>
  );
}