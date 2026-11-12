import { legalNoticeTitle } from '../lib/legalNotice';
import { readUiLang, writeUiLang } from '../lib/uiLang';
import { useState } from 'react';

const NOTICE = {
  zh: 'Save the Day 尚未在應用程式內刊登這頁的正式文本。此網址預留給該文件，本身不是私隱政策或服務條款。',
  en: 'Save the Day has not published the official text for this page in the app. This address is reserved for that document. It is not itself a privacy policy or a set of terms.',
};

export function LegalNotice({ page }) {
  const title = legalNoticeTitle(page) || { zh: '說明', en: 'Notice' };
  const [lang, setLang] = useState(readUiLang);
  const choose = (next) => {
    writeUiLang(next);
    setLang(next);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 px-4 py-10">
      <main className="max-w-xl mx-auto bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
        <div className="flex justify-end mb-4">
          <div className="inline-flex bg-slate-100 rounded-full p-1 text-xs font-bold">
            <button type="button" aria-pressed={lang === 'zh'} onClick={() => choose('zh')} className={`px-3 py-1 rounded-full ${lang === 'zh' ? 'bg-white' : ''}`}>中</button>
            <button type="button" aria-pressed={lang === 'en'} onClick={() => choose('en')} className={`px-3 py-1 rounded-full ${lang === 'en' ? 'bg-white' : ''}`}>EN</button>
          </div>
        </div>
        <p className="text-xs font-bold tracking-widest text-slate-400 uppercase">Save the Day</p>
        <h1 className="text-2xl font-black mt-1 mb-4">{lang === 'zh' ? title.zh : title.en}</h1>
        <p className="text-sm leading-relaxed text-slate-700">{NOTICE[lang]}</p>
        <p className="text-sm leading-relaxed text-slate-500 mt-3">{lang === 'zh' ? NOTICE.en : NOTICE.zh}</p>
        <a href="/" className="inline-block mt-6 text-sm font-bold text-rose-600">
          {lang === 'zh' ? '返回首頁' : 'Back to home'}
        </a>
      </main>
    </div>
  );
}
