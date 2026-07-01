// Tests for RoleSimulator — the dark "developer-mode" pill bar.
//
// Source of truth: src/components/RoleSimulator.jsx.
//
// What's covered here (regression guards):
//   1. Non-admin doesn't see any admin pills
//   2. Admin sees all three pills with correct labels
//   3. The 🛍️ 商戶控制台 pill is highlighted when currentView === 'admin-vendors'
//   4. Clicking the 🛍️ 商戶控制台 pill fires onSwitch('admin-vendors')

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { RoleSimulator } from './RoleSimulator';

describe('RoleSimulator — admin pills', () => {
  it('non-admin sees no admin pills', () => {
    render(
      <RoleSimulator
        userRole="owner"
        isAdmin={false}
        currentView={null}
        onSwitch={() => {}}
      />,
    );
    // The three role pills are still there.
    expect(screen.getByText(/主理新人/)).toBeTruthy();
    expect(screen.getByText(/商戶 \(Vendor\)/)).toBeTruthy();
    // But the three admin pills are absent.
    expect(screen.queryByText(/商戶數據/)).toBeNull();
    expect(screen.queryByText(/管理員控制台/)).toBeNull();
    expect(screen.queryByText(/商戶控制台/)).toBeNull();
  });

  it('admin sees all three admin pills', () => {
    render(
      <RoleSimulator
        userRole="owner"
        isAdmin
        currentView={null}
        onSwitch={() => {}}
      />,
    );
    expect(screen.getByText(/商戶數據/)).toBeTruthy();
    expect(screen.getByText(/管理員控制台/)).toBeTruthy();
    expect(screen.getByText(/商戶控制台/)).toBeTruthy();
  });

  it('🛍️ 商戶控制台 pill is active when currentView=admin-vendors', () => {
    render(
      <RoleSimulator
        userRole="owner"
        isAdmin
        currentView="admin-vendors"
        onSwitch={() => {}}
      />,
    );
    const pill = screen.getByText(/商戶控制台/).closest('button');
    expect(pill).toBeTruthy();
    // Active = emerald-500 background class.
    expect(pill.className).toMatch(/bg-emerald-500/);
    // And the inactive ones stay slate.
    const dataPill = screen.getByText(/商戶數據/).closest('button');
    expect(dataPill.className).toMatch(/bg-slate-800/);
  });

  it('clicking 🛍️ 商戶控制台 fires onSwitch with admin-vendors', () => {
    const onSwitch = vi.fn();
    render(
      <RoleSimulator
        userRole="owner"
        isAdmin
        currentView={null}
        onSwitch={onSwitch}
      />,
    );
    fireEvent.click(screen.getByText(/商戶控制台/));
    expect(onSwitch).toHaveBeenCalledWith('admin-vendors');
  });

  it('show=false hides everything (RoleSimulator returns null)', () => {
    const { container } = render(
      <RoleSimulator
        userRole="owner"
        isAdmin
        currentView={null}
        onSwitch={() => {}}
        show={false}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});