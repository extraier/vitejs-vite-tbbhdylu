import { Heart } from 'lucide-react';

export function LoginScreen({ onLogin }) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white p-8 md:p-12 rounded-[2rem] shadow-2xl max-w-md w-full text-center border border-slate-100 relative overflow-hidden animate-in fade-in zoom-in duration-500">
        <div className="absolute top-0 inset-x-0 h-2 bg-gradient-to-r from-rose-400 to-pink-500"></div>
        <Heart className="w-16 h-16 text-rose-500 fill-rose-500 mx-auto mb-6" />
        <h1 className="text-3xl font-black text-slate-800 tracking-wider mb-2">囍程</h1>
        <h2 className="text-xl font-bold text-slate-600 mb-8">Save The Day</h2>
        <p className="text-slate-500 mb-8 text-sm leading-relaxed">
          全港首個具備實時 QR Code 入席、相片收集箱及預算管理的一站式婚禮 SaaS 平台。
        </p>
        <button
          onClick={onLogin}
          className="w-full bg-white border-2 border-slate-200 text-slate-700 font-bold py-3.5 rounded-xl hover:bg-slate-50 hover:border-slate-300 transition-all flex items-center justify-center gap-3 shadow-sm"
        >
          <img
            src="https://www.svgrepo.com/show/475656/google-color.svg"
            className="w-5 h-5"
            alt="Google"
          />
          使用 Google 帳號登入
        </button>
        <p className="text-xs text-slate-400 mt-6">新人及婚禮統籌專用</p>
      </div>
    </div>
  );
}
