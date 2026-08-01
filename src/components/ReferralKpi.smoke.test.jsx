import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReferralKpi } from './ReferralKpi';

describe('ReferralKpi', () => {
  it('renders the label and value', () => {
    render(<ReferralKpi icon={<span data-testid="icon">★</span>} label="已推薦" value={3} />);
    expect(screen.getByText('已推薦')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByTestId('icon')).toBeTruthy();
  });

  it('shows the tooltip via the title attribute', () => {
    render(<ReferralKpi label="額外儲存" value="1500MB" tooltip="每推薦一位建立婚禮嘅朋友可獲 +500MB 儲存空間" />);
    const tile = screen.getByText('額外儲存').closest('div.bg-white');
    expect(tile).not.toBeNull();
    expect(tile?.getAttribute('title')).toContain('+500MB');
  });

  it('renders the loading placeholder (…)', () => {
    render(<ReferralKpi label="已領取" value="…" />);
    expect(screen.getByText('…')).toBeTruthy();
  });
});
