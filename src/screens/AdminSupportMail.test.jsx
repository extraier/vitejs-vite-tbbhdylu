// Admin support mailbox.
//
// Covers the admin gate, the empty inbox, the thread list (newest
// first, including a thread with missing fields), and the thread
// reader (the live test message, an HTML-only body, and a message
// with an empty Message-ID plus incomplete attachment metadata).

const mocks = vi.hoisted(() => {
  const readSnapshot = async (q) => {
    const name = q?.ref?.name;
    const threadFilter = (q?.constraints || []).find(
      (constraint) => constraint.type === 'where' && constraint.field === 'threadId',
    );
    const source = name === 'inbound_messages' ? mocks.messages : mocks.threads;
    const rows = threadFilter
      ? source.filter((row) => row.threadId === threadFilter.value)
      : source;
    return {
      forEach(callback) {
        for (const row of rows) {
          callback({ id: row.id, data: () => ({ ...row }) });
        }
      },
      size: rows.length,
    };
  };
  return {
    threads: [],
    messages: [],
    getDocs: vi.fn(readSnapshot),
    setDoc: vi.fn(() => {
      throw new Error('support mail is read-only');
    }),
    updateDoc: vi.fn(() => {
      throw new Error('support mail is read-only');
    }),
    deleteDoc: vi.fn(() => {
      throw new Error('support mail is read-only');
    }),
    readSnapshot,
  };
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('../lib/firebase', () => ({
  db: {},
  appId: 'test-app',
}));

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    collection: vi.fn((_db, name) => ({ name })),
    query: vi.fn((ref, ...constraints) => ({ ref, constraints })),
    orderBy: vi.fn((field, direction) => ({ type: 'orderBy', field, direction })),
    where: vi.fn((field, op, value) => ({ type: 'where', field, op, value })),
    limit: vi.fn((n) => ({ type: 'limit', n })),
    getDocs: (...args) => mocks.getDocs(...args),
    setDoc: (...args) => mocks.setDoc(...args),
    updateDoc: (...args) => mocks.updateDoc(...args),
    deleteDoc: (...args) => mocks.deleteDoc(...args),
  };
});

import { AdminSupportMail, htmlToText, sortMessagesChronological, sortThreadsNewestFirst } from './AdminSupportMail';

const TEST_THREAD_ID = 'd34516a03e5ff36b';

function threadFixture() {
  return [
    {
      id: 'older-thread',
      subject: 'Older question',
      lastFrom: 'Ada <ada@example.com>',
      lastSnippet: 'Still waiting',
      status: 'closed',
      messageCount: 3,
      recipientBase: 'hello',
      lastMessageAt: new Date('2026-11-01T08:00:00Z'),
    },
    {
      id: TEST_THREAD_ID,
      threadId: TEST_THREAD_ID,
      recipientBase: 'support',
      subject: 'test',
      lastFrom: 'Roger Lau <roger-lau@outlook.com>',
      lastSnippet: 'Test',
      messageCount: 1,
      status: 'open',
      lastMessageAt: new Date('2026-11-16T00:48:32Z'),
    },
    {
      id: 'sparse-thread',
    },
  ];
}

function messageFixture() {
  return [
    {
      id: 'html-only',
      threadId: TEST_THREAD_ID,
      from: 'Earlier Person <earlier@example.com>',
      to: 'support@savetheday.io',
      subject: 'earlier note',
      bodyHtml: '<p>Hello <b>there</b></p><script>alert(1)</script>',
      createdAt: new Date('2026-11-16T00:40:00Z'),
      attachments: [],
    },
    {
      id: 'flhtOweMdk7FKwxlNk5F',
      threadId: TEST_THREAD_ID,
      messageId: '',
      from: 'Roger Lau <roger-lau@outlook.com>',
      to: 'support@savetheday.io',
      subject: 'test',
      bodyPlain: 'Test',
      strippedText: 'Test',
      createdAt: new Date('2026-11-16T00:48:32Z'),
      attachments: [],
    },
    {
      id: 'sparse-msg',
      threadId: TEST_THREAD_ID,
      messageId: '',
      from: '',
      to: '',
      subject: '',
      bodyPlain: '   ',
      attachments: [
        {
          path: 'messages/d34516a03e5ff36b/1731718112000-photo.png',
          name: 'photo.png',
          mimeType: 'image/png',
          size: 2048,
          bucket: 'savetheday-2377a.firebasestorage.app',
        },
        { path: 'messages/d34516a03e5ff36b/missing-meta' },
      ],
      attachmentCount: 2,
    },
  ];
}

beforeEach(() => {
  mocks.threads = [];
  mocks.messages = [];
  mocks.getDocs.mockReset();
  mocks.getDocs.mockImplementation(mocks.readSnapshot);
  mocks.setDoc.mockClear();
  mocks.updateDoc.mockClear();
  mocks.deleteDoc.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('AdminSupportMail access', () => {
  it('hides the inbox from non-admins and does not read Firestore', async () => {
    mocks.threads = threadFixture();
    render(<AdminSupportMail isAdmin={false} />);
    expect(screen.getByTestId('admin-support-mail-gate')).toBeTruthy();
    expect(screen.getByText('管理員專用')).toBeTruthy();
    expect(screen.queryByText('支援信箱')).toBeNull();
    expect(screen.queryByText('Roger Lau <roger-lau@outlook.com>')).toBeNull();
    await waitFor(() => {
      expect(mocks.getDocs).not.toHaveBeenCalled();
    });
  });

  it('is mounted in App only for admins, from the admin view switch', () => {
    const appSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../App.jsx'),
      'utf8',
    );
    expect(appSource).toContain("target === 'admin-support-mail'");
    expect(appSource).toContain("isAdmin && currentView === 'admin-support-mail'");
    expect(appSource).not.toContain("currentView === 'inbox' && isAdmin");
  });
});

describe('AdminSupportMail list', () => {
  it('shows an empty state when there are no threads', async () => {
    render(<AdminSupportMail isAdmin />);
    expect(await screen.findByTestId('admin-support-mail-empty')).toBeTruthy();
    expect(screen.getByText('未有支援郵件')).toBeTruthy();
    expect(screen.getByText(/當有人寄信去 support@savetheday.io/)).toBeTruthy();
  });

  it('lists threads newest first with subject, sender, snippet, time, status, and count', async () => {
    mocks.threads = threadFixture();
    render(<AdminSupportMail isAdmin />);
    const newest = await screen.findByTestId(`support-thread-${TEST_THREAD_ID}`);
    const rows = screen.getAllByTestId(/^support-thread-/);
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
      `support-thread-${TEST_THREAD_ID}`,
      'support-thread-older-thread',
      'support-thread-sparse-thread',
    ]);

    expect(newest.textContent).toContain('test');
    expect(newest.textContent).toContain('Roger Lau <roger-lau@outlook.com>');
    expect(newest.textContent).toContain('Test');
    expect(newest.textContent).toContain('16 Nov 2026, 00:48 UTC');
    expect(newest.textContent).toContain('未處理');
    expect(newest.textContent).toContain('1 封');
    expect(newest.textContent).toContain('support@savetheday.io');

    const older = screen.getByTestId('support-thread-older-thread');
    expect(older.textContent).toContain('已關閉');
    expect(older.textContent).toContain('3 封');
    expect(older.textContent).toContain('hello@savetheday.io');

    const sparse = screen.getByTestId('support-thread-sparse-thread');
    expect(sparse.textContent).toContain('（無主題）');
    expect(sparse.textContent).toContain('（未知寄件人）');
    expect(sparse.textContent).toContain('（無內容）');
    expect(sparse.textContent).toContain('—');

    const listQuery = mocks.getDocs.mock.calls[0][0];
    expect(listQuery.ref.name).toBe('inbound_threads');
    expect(listQuery.constraints).toEqual(expect.arrayContaining([
      { type: 'orderBy', field: 'lastMessageAt', direction: 'desc' },
    ]));
    expect(mocks.setDoc).not.toHaveBeenCalled();
    expect(mocks.updateDoc).not.toHaveBeenCalled();
    expect(mocks.deleteDoc).not.toHaveBeenCalled();
  });

  it('shows a load error and does not render thread contents', async () => {
    mocks.getDocs.mockRejectedValueOnce(new Error('permission-denied'));
    render(<AdminSupportMail isAdmin />);
    expect(await screen.findByText('載入失敗')).toBeTruthy();
    expect(screen.getByText('permission-denied')).toBeTruthy();
    expect(screen.queryByTestId('admin-support-mail-empty')).toBeNull();
  });
});

describe('AdminSupportMail thread', () => {
  it('reads the test message and tolerates empty or missing fields', async () => {
    mocks.threads = threadFixture();
    mocks.messages = messageFixture();
    const { container } = render(<AdminSupportMail isAdmin />);
    fireEvent.click(await screen.findByTestId(`support-thread-${TEST_THREAD_ID}`));

    const thread = await screen.findByTestId('admin-support-mail-thread');
    expect(thread.textContent).toContain(`對話 ${TEST_THREAD_ID}`);
    expect(thread.textContent).toContain(`support+${TEST_THREAD_ID}@savetheday.io`);

    const live = await screen.findByTestId('support-message-flhtOweMdk7FKwxlNk5F');
    expect(live.textContent).toContain('Roger Lau <roger-lau@outlook.com>');
    expect(live.textContent).toContain('support@savetheday.io');
    expect(live.textContent).toContain('test');
    expect(live.textContent).toContain('16 Nov 2026, 00:48 UTC');
    expect(live.textContent).toContain('Test');
    expect(live.textContent).not.toContain('Message-ID');

    const htmlMessage = screen.getByTestId('support-message-html-only');
    expect(htmlMessage.textContent).toContain('Hello there');
    expect(htmlMessage.textContent).not.toContain('alert(1)');
    expect(htmlMessage.querySelector('b')).toBeNull();
    expect(htmlMessage.querySelector('script')).toBeNull();

    const sparse = screen.getByTestId('support-message-sparse-msg');
    expect(sparse.textContent).toContain('（未知寄件人）');
    expect(sparse.textContent).toContain('（無主題）');
    expect(sparse.textContent).toContain('（無內文）');
    expect(sparse.textContent).toContain('photo.png');
    expect(sparse.textContent).toContain('image/png');
    expect(sparse.textContent).toContain('2.0 KB');
    expect(sparse.textContent).toContain('messages/d34516a03e5ff36b/1731718112000-photo.png');
    expect(sparse.textContent).toContain('missing-meta');
    expect(sparse.textContent).toContain('storage rules');
    expect(sparse.querySelector('a')).toBeNull();
    expect(container.querySelector('a[href*="firebasestorage"]')).toBeNull();

    const cards = screen.getAllByTestId(/^support-message-/);
    expect(cards.map((card) => card.getAttribute('data-testid'))).toEqual([
      'support-message-html-only',
      'support-message-flhtOweMdk7FKwxlNk5F',
      'support-message-sparse-msg',
    ]);

    const messageQuery = mocks.getDocs.mock.calls.find((call) => call[0]?.ref?.name === 'inbound_messages');
    expect(messageQuery[0].constraints).toEqual(expect.arrayContaining([
      { type: 'where', field: 'threadId', op: '==', value: TEST_THREAD_ID },
    ]));
    expect(messageQuery[0].constraints.some((constraint) => constraint.type === 'orderBy')).toBe(false);
  });

  it('shows an empty thread state when a conversation has no messages', async () => {
    mocks.threads = [{
      id: 'empty-thread',
      subject: 'No body yet',
      lastFrom: 'Sam <sam@example.com>',
      status: 'open',
      messageCount: 0,
      lastMessageAt: new Date('2026-11-10T00:00:00Z'),
    }];
    render(<AdminSupportMail isAdmin />);
    fireEvent.click(await screen.findByTestId('support-thread-empty-thread'));
    expect(await screen.findByText('呢個對話未有郵件')).toBeTruthy();
  });

  it('shows attachment metadata when the file list is missing and does not link the file', async () => {
    mocks.threads = [{
      id: 'att-thread',
      subject: 'With file',
      lastFrom: 'Pat <pat@example.com>',
      status: 'open',
      messageCount: 1,
      lastMessageAt: new Date('2026-11-12T00:00:00Z'),
    }];
    mocks.messages = [{
      id: 'att-msg',
      threadId: 'att-thread',
      from: 'Pat <pat@example.com>',
      to: 'support@savetheday.io',
      subject: 'With file',
      bodyPlain: 'See attached',
      attachmentCount: 1,
      attachments: null,
      createdAt: new Date('2026-11-12T00:00:00Z'),
    }];
    render(<AdminSupportMail isAdmin />);
    fireEvent.click(await screen.findByTestId('support-thread-att-thread'));
    const card = await screen.findByTestId('support-message-att-msg');
    expect(card.textContent).toContain('有 1 個附件，但訊息冇檔案資料。');
    expect(card.textContent).toContain('storage rules');
    expect(card.querySelector('a')).toBeNull();
  });

  it('returns to the list from a thread', async () => {
    mocks.threads = threadFixture();
    mocks.messages = messageFixture();
    render(<AdminSupportMail isAdmin />);
    fireEvent.click(await screen.findByTestId(`support-thread-${TEST_THREAD_ID}`));
    expect(await screen.findByTestId('admin-support-mail-thread')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '返回對話' }));
    expect(screen.queryByTestId('admin-support-mail-thread')).toBeNull();
    expect(screen.getByTestId(`support-thread-${TEST_THREAD_ID}`)).toBeTruthy();
  });
});

describe('support mail helpers', () => {
  it('sorts threads newest first and parks undated threads last', () => {
    const sorted = sortThreadsNewestFirst([
      { id: 'b', lastMessageAt: new Date('2026-01-02T00:00:00Z') },
      { id: 'a' },
      { id: 'c', updatedAt: new Date('2026-01-03T00:00:00Z') },
    ]);
    expect(sorted.map((thread) => thread.id)).toEqual(['c', 'b', 'a']);
  });

  it('sorts messages oldest first and parks undated messages last', () => {
    const sorted = sortMessagesChronological([
      { id: 'later', createdAt: '2026-11-16T00:48:32Z' },
      { id: 'none' },
      { id: 'earlier', createdAt: { seconds: Date.parse('2026-11-16T00:40:00Z') / 1000 } },
    ]);
    expect(sorted.map((message) => message.id)).toEqual(['earlier', 'later', 'none']);
  });

  it('strips html to text and drops scripts', () => {
    expect(htmlToText('<p>Hello <b>there</b></p><script>alert(1)</script>')).toBe('Hello there');
    expect(htmlToText('')).toBe('');
    expect(htmlToText(null)).toBe('');
  });
});
