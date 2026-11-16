// 2026-11-16 — Regression for the production crash
// `ReferenceError: assignableVendors is not defined`.
//
// TaskRow's edit branch renders <TaskFullEditor assignableVendors={...}>.
// That identifier has to be a TaskRow prop, and CoupleChecklist has to
// pass the list it already receives from App.jsx. The add-task form
// was already wired; only edit mode was not. Mounting the real screen
// (not a markup mirror) is what catches the free-variable throw.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { CoupleChecklist } from './CoupleChecklist';

const vendor = { uid: 'vendor-may', name: '花店阿May' };

const task = {
  id: 't1',
  title: '訂花',
  category: '',
  isCompleted: false,
  estimatedCost: 0,
  actualCost: 0,
  venue: '',
  dueDate: '',
  dueTime: '',
};

const newTaskForm = {
  categoryTop: '',
  categorySub: '',
  categoryKey: '',
  customTitle: '',
  venue: '',
  dueDate: '',
  dueTime: '',
  estimatedCost: '',
  assignedVendor: null,
  assignedContactId: '',
  assignedHelperMode: 'pick',
  assignedHelperId: '',
  assignedHelperName: '',
};

function renderChecklist(overrides = {}) {
  const onUpdateTask = vi.fn().mockResolvedValue(undefined);
  const onNewTaskFormChange = vi.fn();
  const props = {
    tasks: [task],
    vendors: [],
    activeCategory: null,
    activeVenue: null,
    editingTaskId: task.id,
    onClearEditingTask: () => {},
    onSelectCategory: () => {},
    onToggleTask: () => {},
    onDeleteTask: () => {},
    onUpdateTaskCost: () => {},
    onUpdateTask,
    newTaskForm,
    onNewTaskFormChange,
    onAddTask: (e) => e.preventDefault(),
    onClearActiveCategory: () => {},
    onGoDiscover: () => {},
    onGoJobBoard: () => {},
    onOpenChat: () => {},
    onSelectVendor: () => {},
    vendorContacts: [],
    helpers: [],
    currentUser: { uid: 'owner-1', displayName: '志明' },
    user: { uid: 'owner-1' },
    currentEvent: { id: 'event-1' },
    ownerNames: { boyName: '志明', girlName: '春嬌' },
    assignableVendors: [vendor],
    ...overrides,
  };
  const view = render(<CoupleChecklist {...props} />);
  return { ...view, onUpdateTask, onNewTaskFormChange };
}

function editorRoot() {
  const heading = screen.getByRole('heading', { name: '編輯任務' });
  return heading.parentElement.parentElement;
}

describe('CoupleChecklist — edit mode assignableVendors', () => {
  it('opens the task editor without throwing and offers the assignable vendor', () => {
    renderChecklist();
    const editor = editorRoot();
    expect(within(editor).getByRole('option', { name: '花店阿May' })).toBeTruthy();
    expect(within(editor).queryByRole('option', { name: '未有對話過嘅商戶' })).toBeNull();
  });

  it('writes the picked vendor when the edited task is saved', async () => {
    const { onUpdateTask } = renderChecklist();
    const editor = editorRoot();
    const select = within(editor).getByRole('option', { name: '花店阿May' }).closest('select');
    fireEvent.change(select, { target: { value: vendor.uid } });
    fireEvent.click(within(editor).getByRole('button', { name: /儲存/ }));
    await waitFor(() => {
      expect(onUpdateTask).toHaveBeenCalledWith(
        task.id,
        expect.objectContaining({
          assignedVendorUid: vendor.uid,
          assignedVendorName: vendor.name,
        }),
      );
    });
  });

  it('keeps the add-task picker on the same vendor list', () => {
    renderChecklist({ editingTaskId: null });
    expect(screen.queryByRole('heading', { name: '編輯任務' })).toBeNull();
    expect(screen.getByText('訂花')).toBeTruthy();
    expect(screen.getByRole('option', { name: '花店阿May' })).toBeTruthy();
  });

  it('renders an empty vendor picker when the list is omitted', () => {
    renderChecklist({ assignableVendors: undefined });
    const editor = editorRoot();
    expect(within(editor).getByRole('option', { name: '未有對話過嘅商戶' })).toBeTruthy();
  });
});
