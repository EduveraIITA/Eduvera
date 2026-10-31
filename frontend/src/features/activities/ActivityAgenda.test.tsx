import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityAgenda } from './ActivityAgenda';
import type { ActivityOccurrence } from './api';

afterEach(cleanup);
const occurrence = (id: string, starts_at: string, ends_at: string, extra: Partial<ActivityOccurrence> = {}): ActivityOccurrence => ({
  id, school_id: 'campus', activity_id: id, plan_version_id: null, title: `Activity ${id}`, purpose: 'teaching',
  starts_at, ends_at, local_date: starts_at.slice(0, 10), timezone: 'Asia/Kolkata', space_id: null, space_label: 'Lab 2',
  attendance_mode: 'none', source_revision: 1, source: 'academic', source_ref: id, state: 'expected', participants: [], ...extra,
});
const show = (items: ActivityOccurrence[], extra = {}) => {
  const onSelect = vi.fn();
  render(<ActivityAgenda occurrences={items} from="2026-10-28" today="2026-10-28" timezone="Asia/Kolkata" filtered={false} onSelect={onSelect} {...extra} />);
  return onSelect;
};

describe('Activity agenda', () => {
  it('groups and orders by campus dates rather than UTC or browser dates, and opens the exact source', async () => {
    const tomorrow = occurrence('tomorrow', '2026-10-28T20:00:00Z', '2026-10-28T21:30:00Z');
    const early = occurrence('early', '2026-10-28T02:30:00Z', '2026-10-28T03:00:00Z');
    const onSelect = show([tomorrow, occurrence('late', '2026-10-28T03:30:00Z', '2026-10-28T05:00:00Z'), early]);
    const sections = screen.getAllByRole('region').filter(region => region.getAttribute('aria-labelledby'));
    expect(sections).toHaveLength(2);
    expect(within(sections[0]).getByRole('heading')).toHaveTextContent('28 OctToday');
    expect(within(sections[0]).getAllByRole('button')[0]).toHaveTextContent('Activity early');
    expect(within(sections[1]).getByRole('heading')).toHaveTextContent('29 OctTomorrow');
    expect(within(sections[1]).getByRole('button')).toHaveTextContent('1h 30m');
    expect(within(sections[1]).getByRole('button')).toHaveTextContent('1:30 AM');
    await userEvent.tab();
    expect(within(sections[0]).getAllByRole('button')[0]).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(early);
  });
  it('keeps overnight carryover understandable without duplicating it or inventing empty dates', () => {
    show([occurrence('night', '2026-10-27T18:00:00Z', '2026-10-28T03:00:00Z'), occurrence('cancelled', '2026-10-29T03:00:00Z', '2026-10-29T04:00:00Z', { state: 'cancelled' })]);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button')).toHaveTextContent('Ongoing');
    expect(screen.getByRole('button')).toHaveTextContent('Started 27 Oct');
    expect(screen.getByRole('button')).toHaveTextContent('ends Oct 28');
    expect(screen.getByRole('heading')).toHaveTextContent('28 Oct');
    expect(screen.queryByText(/No meetings|No activities on/)).not.toBeInTheDocument();
  });
  it('uses off-site/online location labels and distinguishes a page search from an empty range', () => {
    show([occurrence('online', '2026-10-28T04:00:00Z', '2026-10-28T05:00:00Z', { space_label: null, location_kind: 'online', location_label: 'Teams call' })]);
    expect(screen.getByRole('button')).toHaveTextContent('Lesson · Teams call');
    cleanup();
    show([], { filtered: true });
    expect(screen.getByText('No activities match your search on this page.')).toBeVisible();
    cleanup();
    show([]);
    expect(screen.getByText('No scheduled activities in this date range.')).toBeVisible();
  });
});
