import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EventDateEditor } from './EventDateEditor';

describe('EventDateEditor', () => {
  it('starts empty when the event has no date and saves only what the user picks', async () => {
    const onSave = vi.fn(() => Promise.resolve());
    render(<EventDateEditor date="" onSave={onSave} />);
    expect(screen.getByLabelText('預定日期').value).toBe('');
    fireEvent.change(screen.getByLabelText('預定日期'), { target: { value: '2027-06-15' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存日期' }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('2027-06-15');
    });
  });
});
