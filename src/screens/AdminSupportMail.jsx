// AdminSupportMail — read-only inbox for *@savetheday.io mail stored by
// the inboundEmail Cloud Function.
//
// Firestore (admin read; client create/update/delete denied):
//   inbound_threads/{threadId}   one doc per conversation
//   inbound_messages/{autoId}    one doc per email
//
// Reply-To on the auto-reply is support+<threadId>@savetheday.io, so a
// later customer reply is written onto the same thread. This screen
// only reads those docs. It does not send mail or change status.
//
// Attachments, when present, are objects in Cloud Storage at
// messages/{threadId}/... The storage rules default-deny that path,
// and the download token is object metadata, not a field on the
// message. Admins can see the file metadata here and cannot open the
// file from the app.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import {
  AlertCircle,
  ArrowLeft,
  Clock,
  Loader2,
  Lock,
  Mail,
  Paperclip,
  RefreshCw,
} from 'lucide-react';
import { db } from '../lib/firebase';

export const SUPPORT_MAIL_THREAD_LIMIT = 100;
export const SUPPORT_MAIL_MESSAGE_LIMIT = 200;

const STATUS_LABELS = {
  open: '未處理',
  closed: '已關閉',
};

export function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') {
    try {
      const date = value.toDate();
      return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
    } catch {
      return null;
    }
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'object') {
    const seconds = typeof value.seconds === 'number' ? value.seconds : value._seconds;
    if (typeof seconds === 'number' && Number.isFinite(seconds)) {
      const date = new Date(seconds * 1000);
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }
  return null;
}

export function formatWhen(value) {
  const date = toDate(value);
  if (!date) return '—';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${day} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${hours}:${minutes} UTC`;
}

export function nonEmpty(value) {
  if (value == null) return '';
  return String(value).trim();
}

export function subjectLabel(subject) {
  return nonEmpty(subject) || '（無主題）';
}

export function senderLabel(from) {
  return nonEmpty(from) || '（未知寄件人）';
}

export function snippetLabel(snippet) {
  return nonEmpty(snippet) || '（無內容）';
}

export function statusLabel(status) {
  const raw = nonEmpty(status);
  if (!raw) return '—';
  return STATUS_LABELS[raw] || raw;
}

export function messageCountLabel(count) {
  let numeric = null;
  if (typeof count === 'number' && Number.isFinite(count)) numeric = count;
  else if (typeof count === 'string' && count.trim() !== '' && Number.isFinite(Number(count))) {
    numeric = Number(count);
  }
  if (numeric == null) return '—';
  return `${numeric} 封`;
}

export function mailboxLabel(recipientBase) {
  const base = nonEmpty(recipientBase);
  if (!base) return '';
  if (base.includes('@')) return base;
  return `${base}@savetheday.io`;
}

export function htmlToText(html) {
  if (!html || typeof html !== 'string') return '';
  // The HTML parser decodes entities once and drops script/style nodes.
  // The result is plain text for React to escape; it is never reinserted as HTML.
  if (typeof DOMParser === 'undefined') return html.trim();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, noscript').forEach((node) => node.remove());
  doc.querySelectorAll('br').forEach((node) => {
    node.replaceWith(doc.createTextNode('\n'));
  });
  doc.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6, blockquote').forEach((node) => {
    node.appendChild(doc.createTextNode('\n'));
  });
  return (doc.body?.textContent || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function messageBody(message) {
  if (!message || typeof message !== 'object') return '';
  const plain = nonEmpty(message.strippedText) || nonEmpty(message.bodyPlain);
  if (plain) return plain;
  const html = nonEmpty(message.strippedHtml) || nonEmpty(message.bodyHtml);
  return html ? htmlToText(html) : '';
}

export function formatBytes(size) {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return '—';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function attachmentList(message) {
  const raw = message?.attachments;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => item && typeof item === 'object');
}

export function attachmentName(attachment) {
  const name = nonEmpty(attachment?.name);
  if (name) return name;
  const path = nonEmpty(attachment?.path);
  if (path) {
    const base = path.split('/').filter(Boolean).pop();
    if (base) return base;
  }
  return '（未命名附件）';
}

export function threadTime(thread) {
  return thread?.lastMessageAt || thread?.updatedAt || thread?.createdAt || null;
}

export function sortThreadsNewestFirst(threads) {
  return [...threads].sort((a, b) => {
    const aTime = toDate(threadTime(a))?.getTime() ?? 0;
    const bTime = toDate(threadTime(b))?.getTime() ?? 0;
    if (bTime !== aTime) return bTime - aTime;
    return String(a.id).localeCompare(String(b.id));
  });
}

export function sortMessagesChronological(messages) {
  return [...messages].sort((a, b) => {
    const aTime = toDate(a?.createdAt)?.getTime();
    const bTime = toDate(b?.createdAt)?.getTime();
    const aMissing = aTime == null;
    const bMissing = bTime == null;
    if (aMissing && bMissing) return String(a.id).localeCompare(String(b.id));
    if (aMissing) return 1;
    if (bMissing) return -1;
    if (aTime !== bTime) return aTime - bTime;
    return String(a.id).localeCompare(String(b.id));
  });
}

function docRows(snap) {
  const rows = [];
  snap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    rows.push({ ...data, id: docSnap.id });
  });
  return rows;
}

async function fetchThreads() {
  // Single-field orderBy uses the automatic index. Firestore omits
  // docs that have no lastMessageAt; inboundEmail always writes it.
  const threadsQuery = query(
    collection(db, 'inbound_threads'),
    orderBy('lastMessageAt', 'desc'),
    limit(SUPPORT_MAIL_THREAD_LIMIT),
  );
  const snap = await getDocs(threadsQuery);
  const rows = docRows(snap);
  return {
    threads: sortThreadsNewestFirst(rows),
    truncated: rows.length >= SUPPORT_MAIL_THREAD_LIMIT,
  };
}

async function fetchMessages(threadId) {
  // Equality on threadId only, then sort here, so this read does not
  // need a composite index.
  const messagesQuery = query(
    collection(db, 'inbound_messages'),
    where('threadId', '==', threadId),
    limit(SUPPORT_MAIL_MESSAGE_LIMIT),
  );
  const snap = await getDocs(messagesQuery);
  const rows = docRows(snap);
  return {
    messages: sortMessagesChronological(rows),
    truncated: rows.length >= SUPPORT_MAIL_MESSAGE_LIMIT,
  };
}

function statusClass(status) {
  if (status === 'open') return 'bg-amber-50 text-amber-800';
  if (status === 'closed') return 'bg-emerald-50 text-emerald-800';
  return 'bg-slate-100 text-slate-600';
}

function Field({ label, value }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="text-sm text-slate-800 break-words">{nonEmpty(value) || '—'}</div>
    </div>
  );
}

function AttachmentBlock({ message }) {
  const files = attachmentList(message);
  const declaredCount = typeof message?.attachmentCount === 'number' ? message.attachmentCount : null;
  if (files.length === 0 && !(declaredCount > 0)) return null;
  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-700">
        <Paperclip className="h-3.5 w-3.5" />
        附件
      </div>
      <p className="mb-2 text-xs text-slate-500">
        附件存咗喺 Cloud Storage（messages/…）。而家嘅 storage rules 拒絕讀取呢個路徑，下載 token 亦只喺檔案 metadata，所以呢度打唔開檔案，只顯示資料。
      </p>
      {files.length === 0 ? (
        <p className="text-xs text-slate-600">有 {declaredCount} 個附件，但訊息冇檔案資料。</p>
      ) : (
        <ul className="space-y-2">
          {files.map((file, index) => (
            <li key={`${nonEmpty(file.path) || attachmentName(file)}-${index}`} className="text-xs text-slate-700">
              <div className="font-semibold text-slate-900">{attachmentName(file)}</div>
              <div className="text-slate-500">
                {nonEmpty(file.mimeType) || '—'} · {formatBytes(file.size)}
              </div>
              {nonEmpty(file.path) && (
                <div className="mt-0.5 break-all font-mono text-[11px] text-slate-500">{file.path}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MessageCard({ message }) {
  const body = messageBody(message);
  const when = formatWhen(message?.createdAt);
  const messageId = nonEmpty(message?.messageId);
  return (
    <article className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm" data-testid={`support-message-${message.id}`}>
      <div className="mb-3 flex items-center justify-end gap-1.5 text-xs text-slate-500">
        <Clock className="h-3 w-3" />
        <time dateTime={toDate(message?.createdAt)?.toISOString()}>{when}</time>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="寄件人" value={nonEmpty(message?.from) ? message.from : '（未知寄件人）'} />
        <Field label="收件人" value={message?.to} />
        <Field label="主題" value={nonEmpty(message?.subject) ? message.subject : '（無主題）'} />
        <Field label="時間" value={when === '—' ? '' : when} />
      </div>
      {messageId && (
        <div className="mt-3">
          <Field label="Message-ID" value={messageId} />
        </div>
      )}
      <div className="mt-3">
        <div className="text-xs font-semibold text-slate-500">內文</div>
        {body ? (
          <pre className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 font-sans text-sm text-slate-800">{body}</pre>
        ) : (
          <p className="mt-1 text-sm italic text-slate-400">（無內文）</p>
        )}
      </div>
      <AttachmentBlock message={message} />
    </article>
  );
}

export function AdminSupportMail({ isAdmin }) {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [truncatedThreads, setTruncatedThreads] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState(null);
  const [truncatedMessages, setTruncatedMessages] = useState(false);
  const messageRequest = useRef(0);

  const loadThreads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchThreads();
      setThreads(result.threads);
      setTruncatedThreads(result.truncated);
    } catch (err) {
      setError(err?.message || '讀取對話失敗');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMessages = useCallback(async (threadId) => {
    const requestId = ++messageRequest.current;
    setMessagesLoading(true);
    setMessagesError(null);
    setMessages([]);
    try {
      const result = await fetchMessages(threadId);
      if (requestId !== messageRequest.current) return;
      setMessages(result.messages);
      setTruncatedMessages(result.truncated);
    } catch (err) {
      if (requestId !== messageRequest.current) return;
      setMessagesError(err?.message || '讀取郵件失敗');
    } finally {
      if (requestId === messageRequest.current) setMessagesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) loadThreads();
    else setLoading(false);
  }, [isAdmin, loadThreads]);

  const selected = threads.find((thread) => thread.id === selectedId) || null;

  async function refresh() {
    await loadThreads();
    if (selectedId) await loadMessages(selectedId);
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto mt-16 max-w-2xl text-center" data-testid="admin-support-mail-gate">
        <div className="rounded-2xl border border-slate-100 bg-white p-12 shadow-lg">
          <Lock className="mx-auto mb-4 h-16 w-16 text-slate-300" />
          <h2 className="mb-2 text-2xl font-bold text-slate-900">管理員專用</h2>
          <p className="text-slate-500">此頁面僅供管理員使用。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-8 max-w-5xl px-4 pb-16" data-testid="admin-support-mail">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="mb-2 flex items-center gap-2 text-3xl font-black text-slate-900">
            <Mail className="h-7 w-7 text-sky-600" /> 支援信箱
          </h1>
          <p className="text-slate-500">
            查閱寄到 support@savetheday.io 同其他 *@savetheday.io 嘅入信。只供閱讀，呢度唔可以回覆。
          </p>
        </div>
        <button
          type="button"
          onClick={() => { refresh(); }}
          disabled={loading || messagesLoading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading || messagesLoading ? 'animate-spin' : ''}`} />
          重新整理
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-rose-600" />
          <div>
            <div className="font-semibold text-rose-900">載入失敗</div>
            <div className="whitespace-pre-wrap text-sm text-rose-700">{error}</div>
          </div>
        </div>
      )}

      {selectedId ? (
        <ThreadView
          thread={selected}
          threadId={selectedId}
          messages={messages}
          loading={messagesLoading}
          error={messagesError}
          truncated={truncatedMessages}
          onBack={() => {
            messageRequest.current += 1;
            setSelectedId(null);
            setMessages([]);
            setMessagesError(null);
            setMessagesLoading(false);
            setTruncatedMessages(false);
          }}
        />
      ) : loading ? (
        <div className="rounded-2xl border border-slate-100 bg-white p-12 text-center">
          <Loader2 className="mx-auto mb-2 h-8 w-8 animate-spin text-slate-400" />
          <p className="text-sm text-slate-500">載入中…</p>
        </div>
      ) : threads.length === 0 ? (
        error ? null : (
          <div className="rounded-2xl border border-slate-100 bg-white p-12 text-center" data-testid="admin-support-mail-empty">
            <Mail className="mx-auto mb-3 h-12 w-12 text-sky-300" />
            <h2 className="mb-1 text-xl font-bold text-slate-900">未有支援郵件</h2>
            <p className="text-sm text-slate-500">
              當有人寄信去 support@savetheday.io，對話會列喺呢度。
            </p>
          </div>
        )
      ) : (
        <div className="space-y-3">
          <div className="px-1 text-xs text-slate-500">
            最近 {threads.length} 個對話，新嘅排前面
            {truncatedThreads ? `（只顯示最新 ${SUPPORT_MAIL_THREAD_LIMIT} 個）` : ''}
          </div>
          <ul className="space-y-3">
            {threads.map((thread) => {
              const mailbox = mailboxLabel(thread.recipientBase);
              return (
                <li key={thread.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(thread.id);
                      loadMessages(thread.id);
                    }}
                    data-testid={`support-thread-${thread.id}`}
                    className="w-full rounded-xl border border-slate-100 bg-white p-4 text-left shadow-sm hover:border-sky-200"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-bold text-slate-900">{subjectLabel(thread.subject)}</div>
                        <div className="truncate text-sm text-slate-600">{senderLabel(thread.lastFrom)}</div>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-1 text-xs text-slate-500">
                        <Clock className="h-3 w-3" />
                        {formatWhen(threadTime(thread))}
                      </div>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-slate-500">{snippetLabel(thread.lastSnippet)}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                      <span className={`rounded-full px-2 py-0.5 font-semibold ${statusClass(thread.status)}`}>
                        {statusLabel(thread.status)}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">
                        {messageCountLabel(thread.messageCount)}
                      </span>
                      {mailbox && (
                        <span className="rounded-full bg-sky-50 px-2 py-0.5 font-semibold text-sky-700">{mailbox}</span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function ThreadView({ thread, threadId, messages, loading, error, truncated, onBack }) {
  const mailbox = mailboxLabel(thread?.recipientBase);
  return (
    <div data-testid="admin-support-mail-thread">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 flex items-center gap-1 text-sm font-bold text-slate-600 hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" />
        返回對話
      </button>
      <div className="mb-4 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-black text-slate-900">{subjectLabel(thread?.subject)}</h2>
        <p className="mt-1 text-sm text-slate-600">{senderLabel(thread?.lastFrom)}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className={`rounded-full px-2 py-0.5 font-semibold ${statusClass(thread?.status)}`}>
            {statusLabel(thread?.status)}
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">
            {messageCountLabel(thread?.messageCount)}
          </span>
          {mailbox && (
            <span className="rounded-full bg-sky-50 px-2 py-0.5 font-semibold text-sky-700">{mailbox}</span>
          )}
        </div>
        <p className="mt-3 break-all font-mono text-xs text-slate-500">
          對話 {threadId}
          {' · '}
          客戶回覆會經 support+{threadId}@savetheday.io 歸入呢串
        </p>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-rose-600" />
          <div>
            <div className="font-semibold text-rose-900">載入失敗</div>
            <div className="text-sm text-rose-700">{error}</div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-slate-100 bg-white p-12 text-center">
          <Loader2 className="mx-auto mb-2 h-8 w-8 animate-spin text-slate-400" />
          <p className="text-sm text-slate-500">載入中…</p>
        </div>
      ) : messages.length === 0 ? (
        error ? null : (
          <div className="rounded-2xl border border-slate-100 bg-white p-12 text-center">
            <Mail className="mx-auto mb-3 h-12 w-12 text-slate-300" />
            <h3 className="mb-1 text-lg font-bold text-slate-900">呢個對話未有郵件</h3>
            <p className="text-sm text-slate-500">對話記錄存在，但未有可顯示嘅郵件內容。</p>
          </div>
        )
      ) : (
        <div className="space-y-3">
          {truncated && (
            <p className="px-1 text-xs text-slate-500">呢個對話超過 {SUPPORT_MAIL_MESSAGE_LIMIT} 封，只顯示其中 {SUPPORT_MAIL_MESSAGE_LIMIT} 封。</p>
          )}
          {messages.map((message) => (
            <MessageCard key={message.id} message={message} />
          ))}
        </div>
      )}
    </div>
  );
}
