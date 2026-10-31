import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityCalendar } from './ActivityCalendar';
import { activityCalendarColumnWidth } from './activityCalendarLayout';
import { activityDates } from './activityExperience';

const capture = vi.hoisted<{ props: Record<string, unknown> }>(() => ({ props: {} }));
vi.mock('@fullcalendar/react', () => ({ default: (props: Record<string, unknown>) => { capture.props = props; return <div data-testid="calendar"/>; } }));
vi.mock('@fullcalendar/react/timegrid', () => ({ default: {} }));
vi.mock('@fullcalendar/react/interaction', () => ({ default: {} }));
vi.mock('@fullcalendar/react/themes/monarch', () => ({ default: {} }));
afterEach(cleanup);

describe('readable activity calendar', () => {
  it('keeps a single readable day grid without hidden event piles or edit permission', () => {
    render(<ActivityCalendar date="2026-10-28" timezone="Asia/Kolkata" occurrences={[]} canManage={false} onSelect={vi.fn()} onCreate={vi.fn()}/>);
    expect(capture.props.eventMaxStack).toBeUndefined();
    expect(capture.props.slotEventOverlap).toBe(false);
    expect(capture.props.moreLinkClick).toBeUndefined();
    expect(capture.props.initialView).toBe('timeGridDay');
    expect(capture.props.dayHeaders).toBe(false);
    expect(capture.props.editable).toBe(false);
    expect(capture.props.selectable).toBe(false);
    expect(capture.props.slotDuration).toBe('00:30:00');
    expect(screen.getByRole('region')).toHaveAttribute('tabindex', '0');
  });
  it('keeps a seven-day selector range and adjacent events in the same lane', () => {
    expect(activityDates('2026-10-28', 'week')).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
    const item = (starts_at: string, ends_at: string) => ({ starts_at, ends_at, state: 'expected' as const });
    expect(activityCalendarColumnWidth([item('2026-10-28T09:00Z', '2026-10-28T10:00Z'), item('2026-10-28T10:00Z', '2026-10-28T11:00Z')])).toBe(200);
    expect(activityCalendarColumnWidth([item('2026-10-28T09:00Z', '2026-10-28T11:00Z'), item('2026-10-28T10:00Z', '2026-10-28T12:00Z')])).toBe(288);
  });
});
