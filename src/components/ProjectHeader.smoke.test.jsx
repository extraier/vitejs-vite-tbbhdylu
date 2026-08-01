import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProjectHeader } from './ProjectHeader';

describe('ProjectHeader', () => {
  it('shows the current project name and exposes rename beside the brand mark', () => {
    const onRename = vi.fn();
    render(
      <ProjectHeader
        event={{ id: 'event-1', name: '志明 & 春嬌' }}
        onRename={onRename}
      />,
    );

    expect(screen.getByText('志明 & 春嬌')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重新命名婚禮專案' }));
    expect(onRename).toHaveBeenCalledOnce();
  });
});