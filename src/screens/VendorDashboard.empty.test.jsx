import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VendorDashboard } from './VendorDashboard';

vi.mock('../lib/firebase', () => ({
  db: {},
  appId: 'test-app',
  auth: {},
  functions: {},
  storage: {},
}));

describe('VendorDashboard empty assignment state', () => {
  it('renders the assigned-work panel without a missing icon', () => {
    render(
      <VendorDashboard
        user={{ uid: 'vendor-1' }}
        vendor={{ uid: 'vendor-1', name: 'E2E Test Studio (do not use)' }}
        jobRequests={[]}
        loading={false}
        assignedTasks={[]}
        assignedRundown={[]}
        assignedResources={[]}
      />,
    );
    expect(screen.getByText('暫時未有指派工作')).toBeTruthy();
  });
});
