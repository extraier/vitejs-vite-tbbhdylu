// JoinAsVendorCTA.jsx — small card that lives on the public landing page
// and on the LoginScreen. Two states:
//
//   - Not signed in  → "Sign in first, then click here"
//   - Signed in, not vendor yet → opens the wizard at /vendor-onboarding
//   - Signed in, already vendor → routes to vendor dashboard (rare path;
//     mostly handled elsewhere, but we guard against double-application).
//
// Why a CTA component instead of inline JSX in App.jsx: keeps the wizard
// entry point self-contained so we can drop it on multiple surfaces
// (landing, login, footer) without copy-paste.

import { Briefcase, ArrowRight } from 'lucide-react';

export function JoinAsVendorCTA({ user, onJoin }) {
  const handleClick = () => {
    if (onJoin) onJoin();
  };

  return (
    <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-6 text-white">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
          <Briefcase className="w-6 h-6 text-emerald-400" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-bold mb-1">我是商戶 / For Vendors</h3>
          <p className="text-sm text-slate-300 mb-3">
            加入囍程商戶指南，接觸全港新人。5 分鐘填表，立即收到查詢。
          </p>
          <button
            type="button"
            onClick={handleClick}
            className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-bold transition-colors"
          >
            加入商戶 / Join as Vendor
            <ArrowRight className="w-4 h-4" />
          </button>
          {!user && (
            <div className="text-xs text-slate-400 mt-2">
              點擊後會先帶你去登入
            </div>
          )}
        </div>
      </div>
    </div>
  );
}