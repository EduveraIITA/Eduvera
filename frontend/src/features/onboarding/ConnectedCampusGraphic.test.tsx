import { useState } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectedCampusGraphic } from './ConnectedCampusGraphic';
import { ConnectedCampus } from './StartingPoints';
import type { GoalKey, StartingGoal } from './progressive-api';

afterEach(cleanup);

describe('connected campus illustration', () => {
  it('keeps the central Campus and five foundation labels readable outside the decorative artwork', () => {
    render(<ConnectedCampusGraphic />);
    const foundation = screen.getByLabelText('Shared campus foundation');
    for (const label of ['Campus', 'People', 'Groups', 'Places', 'Schedules', 'Resources']) {
      const text = within(foundation).getByText(label);
      expect(text).toBeVisible();
      expect(text.closest('svg')).toBeNull();
      expect(text.closest('[aria-hidden="true"]')).toBeNull();
    }
  });

  it('adds no controls, focusable artwork or live announcements', () => {
    const { container } = render(<ConnectedCampusGraphic />);
    const illustrations = container.querySelectorAll('svg');
    expect(illustrations).toHaveLength(7);
    for (const illustration of illustrations) {
      expect(illustration).toHaveAttribute('aria-hidden', 'true');
      expect(illustration).toHaveAttribute('focusable', 'false');
      expect(illustration).not.toHaveAttribute('tabindex');
    }
    expect(container.querySelector('button, a, input, select, textarea, [tabindex], [contenteditable="true"]')).toBeNull();
    expect(container.querySelector('[aria-live]')).toBeNull();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('connects five static nodes to the separate Campus without a circular orbit or track', () => {
    render(<ConnectedCampusGraphic />);
    const foundation = screen.getByLabelText('Shared campus foundation');
    const nodes = foundation.querySelector('.connected-campus-graphic__nodes');
    const connections = foundation.querySelector('.connected-campus-graphic__connections');
    const center = foundation.querySelector('.connected-campus-graphic__center');
    expect(nodes).not.toBeNull();
    expect(connections?.querySelectorAll('line')).toHaveLength(5);
    expect(foundation.querySelector('.connected-campus-graphic__orbit, .connected-campus-graphic__track')).toBeNull();
    expect(center).not.toBeNull();
    expect(center?.parentElement).toBe(foundation);
    expect(center?.closest('.connected-campus-graphic__nodes')).toBeNull();
    expect(center).toHaveTextContent('Campus');
    const satellites = nodes!.querySelectorAll('.connected-campus-graphic__satellite');
    expect(satellites).toHaveLength(5);
    for (const satellite of satellites) expect(satellite.parentElement).toBe(nodes);
    for (const label of ['People', 'Groups', 'Places', 'Schedules', 'Resources']) {
      const text = within(nodes!).getByText(label);
      expect(text.closest('.connected-campus-graphic__satellite')?.parentElement).toBe(nodes);
    }
    expect(within(nodes!).queryByText('Campus')).not.toBeInTheDocument();
  });

  it('can appear more than once without duplicate SVG or document IDs', () => {
    const { container } = render(<><ConnectedCampusGraphic /><ConnectedCampusGraphic /></>);
    expect(screen.getAllByLabelText('Shared campus foundation')).toHaveLength(2);
    const ids = Array.from(container.querySelectorAll('[id]'), element => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const label of ['Campus', 'People', 'Groups', 'Places', 'Schedules', 'Resources']) expect(screen.getAllByText(label)).toHaveLength(2);
  });

  it('does not intercept keyboard focus or alter the independent priority choice', async () => {
    const selected: GoalKey[] = ['attendance', 'gate'];
    const catalogue: StartingGoal[] = [
      { key: 'attendance', label: 'Attendance', description: 'Take a register', destination: '/areas/attendance/registers', selection_kind: 'goal', selected: true },
      { key: 'gate', label: 'Entry & exit', description: 'Record arrivals and departures', destination: '/areas/in-out/operate', selection_kind: 'goal', selected: true },
    ];
    const changed = vi.fn();
    function Harness() {
      const [priority, setPriority] = useState<GoalKey>('attendance');
      return <ConnectedCampus catalogue={catalogue} selected={selected} priority={priority} onPriority={value => { changed(value); setPriority(value); }} />;
    }
    render(<Harness />);
    const user = userEvent.setup();
    const foundation = screen.getByLabelText('Shared campus foundation');
    const illustrations = Array.from(foundation.querySelectorAll('svg'));
    const nodes = foundation.querySelector('.connected-campus-graphic__nodes');
    const center = foundation.querySelector('.connected-campus-graphic__center');
    expect(changed).not.toHaveBeenCalled();
    await user.tab();
    expect(screen.getByRole('radio', { name: 'Attendance' })).toHaveFocus();
    await user.click(screen.getByRole('radio', { name: 'Entry & exit' }));
    expect(changed).toHaveBeenCalledExactlyOnceWith('gate');
    expect(screen.getByRole('radio', { name: 'Entry & exit' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Attendance' })).not.toBeChecked();
    expect(foundation.querySelector('.connected-campus-graphic__nodes')).toBe(nodes);
    expect(foundation.querySelector('.connected-campus-graphic__center')).toBe(center);
    Array.from(foundation.querySelectorAll('svg')).forEach((illustration, index) => expect(illustration).toBe(illustrations[index]));
  });
});
