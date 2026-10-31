import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiSchoolCalendarDay } from '../school/api';
import { CampusDatesCalendar } from './CampusDatesCalendar';
import type { CalendarEntry, CalendarSourceState, CampusCalendarScope } from './campusCalendarSources';
import type { useCampusCalendarSources } from './useCampusCalendarSources';

const mocks = vi.hoisted(() => ({ sources: vi.fn(), publish: vi.fn(), correct: vi.fn(), cancel: vi.fn() }));
vi.mock('./useCampusCalendarSources', () => ({ useCampusCalendarSources: mocks.sources }));
vi.mock('./campusPublishedDates', () => ({ publishCampusDate: mocks.publish, correctCampusDate: mocks.correct, cancelCampusDate: mocks.cancel }));
vi.mock('../simulation/applicationTime', () => ({ applicationNow: () => new Date('2026-10-27T23:30:00.000Z') }));
vi.mock('../attention/AttentionOpenAcknowledgement', () => ({ AttentionOpenAcknowledgement: () => <p>Exact update acknowledged</p> }));

type CalendarData = ReturnType<typeof useCampusCalendarSources>;
const scope: CampusCalendarScope = { schoolId: 'campus-one', surfaceKey: 'assigned', timeZone: 'Asia/Kolkata', includeDining: true, eventHref: '/areas/events/assigned' };
const day: ApiSchoolCalendarDay = { id: 'closure-one', date: '2026-10-28', label: 'Building maintenance', kind: 'emergency_closure', is_instructional: false, reason: 'West building only', revision: 2 };
const entry = (patch: Partial<CalendarEntry> = {}): CalendarEntry => ({ id: 'dates:closure-one', category: 'dates', sourceId: 'closure-one', title: 'Building maintenance', startsOn: '2026-10-28', endsOn: '2026-10-28', allDay: true, status: 'Closure', ...patch });
const source = (key: CalendarSourceState['key'] = 'dates', status: CalendarSourceState['status'] = 'ready'): CalendarSourceState => ({ key, label: key === 'dates' ? 'Campus dates' : 'Events', status, retry: vi.fn() });
const data = (patch: Partial<CalendarData> = {}): CalendarData => ({ entries: [entry()], sources: [source()], campusDays: [day], daysLoaded: true, denied: false,
  canManagePublishedDates: false, refreshPublishedDates: vi.fn().mockResolvedValue(undefined), ...patch });

function Location() { return <span aria-label="Calendar URL">{useLocation().search}</span>; }
function mount(path = '/areas/calendar?date=2026-10-28', currentScope = scope) {
  const tree = () => <MemoryRouter initialEntries={[path]}><CampusDatesCalendar scope={currentScope} /><Location /></MemoryRouter>;
  const rendered = render(tree());
  return { ...rendered, refresh: () => rendered.rerender(tree()) };
}
const parameters = () => new URLSearchParams(screen.getByLabelText('Calendar URL').textContent);

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
beforeEach(() => { mocks.sources.mockReturnValue(data()); });
afterEach(() => { cleanup(); mocks.sources.mockReset(); mocks.publish.mockReset(); mocks.correct.mockReset(); mocks.cancel.mockReset(); });

describe('Important campus dates experience', () => {
  it('defaults to a source-marked month overview without assuming weekends or a whole-campus closure', () => {
    mocks.sources.mockReturnValue(data({ entries: [entry(), entry({ id: 'events:fair', category: 'events', title: 'Open campus fair', sourceId: 'fair', startsOn: '2026-10-29', endsOn: '2026-10-29' })] }));
    mount('/areas/calendar');
    expect(screen.getByRole('combobox', { name: 'Calendar view' })).toHaveValue('month');
    expect(within(screen.getByRole('group', { name: 'Choose date' })).getAllByRole('button')).toHaveLength(31);
    expect(screen.getByRole('button', { name: /Wednesday, 28 October, 1 important date: Campus dates, today/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Thursday, 29 October, 1 important date: Events/ })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Saturday, 31 October' })).not.toHaveClass('is-muted');
    expect(screen.getByRole('button', { name: /Building maintenance/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Open campus fair/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/No school|Campus closed|School calendar/i)).not.toBeInTheDocument();
    expect(mocks.sources).toHaveBeenLastCalledWith(scope, '2026-10-01', '2026-10-31');
  });

  it('keeps date, search and type when switching Month/List and resets only the result page', async () => {
    mocks.sources.mockReturnValue(data({ entries: [entry({ category: 'events', title: 'Robotics fair' })], sources: [source(), source('events')] }));
    mount('/areas/calendar?date=2026-10-28&view=month&q=Robotics&type=events&calendar_page=2');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Calendar view' }), 'list');
    expect(parameters().get('view')).toBe('list');
    expect(parameters().get('date')).toBe('2026-10-28');
    expect(parameters().get('q')).toBe('Robotics');
    expect(parameters().get('type')).toBe('events');
    expect(parameters().has('calendar_page')).toBe(false);
    expect(screen.getByRole('heading', { name: 'Search results · October 2026' })).toBeVisible();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Calendar view' }), 'month');
    expect(screen.getByRole('group', { name: 'Choose date' })).toBeVisible();
    expect(parameters().get('q')).toBe('Robotics');
    expect(parameters().get('type')).toBe('events');
  });

  it('reveals optional search and filters, with Escape restoring focus and clearing search', async () => {
    mocks.sources.mockReturnValue(data({ sources: [source(), source('events')] }));
    mount();
    expect(screen.queryByRole('textbox', { name: /Search this month/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Date type' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Search important dates' }));
    const search = screen.getByRole('textbox', { name: "Search this month's important dates" });
    expect(search).toHaveFocus();
    await userEvent.type(search, 'maintenance');
    expect(parameters().get('q')).toBe('maintenance');
    await userEvent.keyboard('{Escape}');
    expect(parameters().has('q')).toBe(false);
    expect(screen.getByRole('button', { name: 'Search important dates' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Filter calendar dates' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Date type' }), 'events');
    expect(parameters().get('type')).toBe('events');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('combobox', { name: 'Date type' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filter calendar dates' })).toHaveFocus();
  });

  it('shows the selected day in Month and the complete selected month in List, in finite pages of eight', async () => {
    const workshops = Array.from({ length: 9 }, (_, index) => entry({ id: `events:workshop-${index}`, sourceId: `workshop-${index}`, category: 'events', title: `Workshop ${index + 1}` }));
    mocks.sources.mockReturnValue(data({ entries: [entry({ id: 'past', title: 'Past visit', startsOn: '2026-10-27', endsOn: '2026-10-27' }), ...workshops, entry({ id: 'future', title: 'Future fair', startsOn: '2026-10-29', endsOn: '2026-10-29' })] }));
    mount();
    expect(screen.getAllByRole('button', { name: /Workshop \d/ })).toHaveLength(8);
    expect(screen.queryByRole('button', { name: /Past visit|Future fair/ })).not.toBeInTheDocument();
    expect(screen.getByText('Page 1 of 2 · 9 important dates')).toBeVisible();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Calendar view' }), 'list');
    expect(screen.getByText('Page 1 of 2 · 11 important dates')).toBeVisible();
    expect(screen.getByRole('button', { name: /Past visit/ })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeVisible();
    expect(screen.getByText('Important dates across the selected month')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
    expect(screen.getByText('Page 2 of 2 · 11 important dates')).toBeVisible();
    expect(screen.getAllByRole('button', { name: /Workshop \d/ })).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Future fair/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Past visit/ })).not.toBeInTheDocument();
    expect(parameters().get('calendar_page')).toBe('2');
    await vi.waitFor(() => expect(screen.getByRole('heading', { name: 'October 2026' })).toHaveFocus());
  });

  it('searches matching dates across the whole loaded month without changing the selected date or view', async () => {
    mocks.sources.mockReturnValue(data({ entries: [
      entry({ id: 'events:past', title: 'Research open day', startsOn: '2026-10-05', endsOn: '2026-10-05' }),
      entry({ id: 'events:future', title: 'Research colloquium', startsOn: '2026-10-30', endsOn: '2026-10-30' }),
      entry({ id: 'events:other-month', title: 'Research out of range', startsOn: '2026-11-01', endsOn: '2026-11-01' }), entry(),
    ] }));
    mount('/areas/calendar?date=2026-10-28&view=month&scope=self&student_id=learner-1');
    await userEvent.click(screen.getByRole('button', { name: 'Search important dates' }));
    await userEvent.type(screen.getByRole('textbox', { name: "Search this month's important dates" }), 'Research');
    expect(screen.getByRole('heading', { name: 'Search results · October 2026' })).toBeVisible();
    expect(screen.getByText('Matching important dates across the selected month')).toBeVisible();
    expect(screen.getByRole('button', { name: /Research open day/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Research colloquium/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Research out of range|Building maintenance/ })).not.toBeInTheDocument();
    expect(parameters().get('date')).toBe('2026-10-28');
    expect(parameters().get('view')).toBe('month');
    expect(parameters().get('scope')).toBe('self');
    expect(parameters().get('student_id')).toBe('learner-1');
    expect(screen.getByRole('button', { name: /Wednesday, 28 October, today/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: /Building maintenance/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Research open day|Research colloquium/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search important dates' })).toHaveFocus();
  });

  it('keeps carryover events ongoing at the month boundary, not ordinary earlier dates in the same month', () => {
    mocks.sources.mockReturnValue(data({ entries: [
      entry({ id: 'carryover', title: 'Research festival', startsOn: '2026-09-29', endsOn: '2026-10-03' }),
      entry({ id: 'past', title: 'Earlier October event', startsOn: '2026-10-05', endsOn: '2026-10-05' }),
      entry({ id: 'ended', title: 'Ended last month', startsOn: '2026-09-29', endsOn: '2026-09-30' }),
    ] }));
    mount('/areas/calendar?date=2026-10-28&view=list');
    const carryover = screen.getByRole('button', { name: /Research festival/ });
    expect(carryover).toHaveTextContent('Ongoing');
    expect(carryover).toHaveTextContent('Through 3 Oct');
    expect(screen.getByRole('heading', { name: 'Thursday, 1 Oct' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Earlier October event/ })).toHaveTextContent('All day');
    expect(screen.queryByRole('button', { name: /Ended last month/ })).not.toBeInTheDocument();
  });

  it('opens current source details, makes cancellation explicit and uses the owning route without an editor', async () => {
    mocks.sources.mockReturnValue(data({ entries: [entry({ id: 'events:fair', category: 'events', title: 'Robotics open day', sourceId: 'fair', allDay: false, startsAt: '2026-10-28T07:00:00Z', endsAt: '2026-10-28T08:00:00Z', location: 'West building', status: 'Cancelled', summary: 'Moved to next month', href: '/areas/events/assigned/fair' })] }));
    mount();
    const row = screen.getByRole('button', { name: /Robotics open day/ });
    expect(row).toHaveTextContent('Cancelled');
    await userEvent.click(row);
    const detail = screen.getByRole('dialog', { name: 'Robotics open day' });
    expect(detail).toHaveTextContent('Cancelled');
    expect(detail).toHaveTextContent('West building');
    expect(detail).toHaveTextContent('Moved to next month');
    expect(detail).toHaveTextContent('Asia/Kolkata');
    expect(within(detail).getByRole('link', { name: 'Open event' })).toHaveAttribute('href', '/areas/events/assigned/fair');
    expect(within(detail).queryByRole('button', { name: /Save|Edit|Publish/i })).not.toBeInTheDocument();
    await userEvent.click(within(detail).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(parameters().has('entry')).toBe(false);
  });

  it.each([false, true])('only offers native publication management with current server authorization (%s)', async canManage => {
    const publication = { id: 'native-date', school_id: scope.schoolId, title: 'Project exhibition', description: 'Student projects and demonstrations.', starts_on: '2026-10-28', ends_on: '2026-10-28', category_label: 'Campus life', state: 'published' as const, revision: 1, academic_term_id: null, provenance: null };
    mocks.sources.mockReturnValue(data({ entries: [entry({ id: 'milestones:native-date', category: 'milestones', title: publication.title, categoryLabel: publication.category_label, publication })], sources: [source('milestones')], canManagePublishedDates: canManage }));
    mount();
    expect(Boolean(screen.queryByRole('button', { name: 'Add important date' }))).toBe(canManage);
    const row = screen.getByRole('button', { name: /Project exhibition/ });
    expect(row).toHaveTextContent('Campus life');
    await userEvent.click(row);
    expect(Boolean(screen.queryByRole('button', { name: 'Correct date' }))).toBe(canManage);
    expect(Boolean(screen.queryByRole('button', { name: 'Cancel date' }))).toBe(canManage);
    if (canManage) {
      await userEvent.click(screen.getByRole('button', { name: 'Correct date' }));
      expect(screen.getByRole('dialog', { name: 'Correct date' })).toBeVisible();
      expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(publication.title);
      expect(parameters().get('entry')).toBe('milestones:native-date');
    }
  });

  it.each([false, true])('does not turn another source or a cancelled native date into an editable publication (%s)', async cancelled => {
    const publication = { id: 'native-date', school_id: scope.schoolId, title: 'Cancelled exhibition', description: '', starts_on: '2026-10-28', ends_on: '2026-10-28', category_label: 'Academic', state: 'cancelled' as const, revision: 2, academic_term_id: null, provenance: null, cancellation_reason: 'The programme has been withdrawn.' };
    mocks.sources.mockReturnValue(data({ entries: [entry(cancelled ? { category: 'milestones', title: publication.title, publication, status: 'Cancelled' } : {})], canManagePublishedDates: true }));
    mount();
    await userEvent.click(screen.getByRole('button', { name: cancelled ? /Cancelled exhibition/ : /Building maintenance/ }));
    expect(screen.queryByRole('button', { name: 'Correct date' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel date' })).not.toBeInTheDocument();
    if (cancelled) {
      expect(screen.getByRole('dialog')).toHaveTextContent(publication.cancellation_reason);
      expect(screen.getByRole('dialog')).toHaveTextContent('Current version 2');
    }
  });

  it('keeps the saved publication distinct from a failed query refresh without changing date, view or person context', async () => {
    const publication = { id: 'new-date', school_id: scope.schoolId, title: 'Project exhibition', description: '', starts_on: '2026-10-28', ends_on: '2026-10-28', category_label: 'Campus date', state: 'published' as const, revision: 1, academic_term_id: null, provenance: null };
    const refresh = vi.fn().mockRejectedValueOnce(new Error('Read unavailable')).mockResolvedValueOnce(undefined);
    mocks.sources.mockReturnValue(data({ canManagePublishedDates: true, refreshPublishedDates: refresh }));
    mocks.publish.mockResolvedValue(publication);
    mount('/areas/calendar?date=2026-10-28&view=list&scope=self&student_id=learner-1');
    await userEvent.click(screen.getByRole('button', { name: 'Add important date' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), publication.title);
    await userEvent.click(screen.getByRole('button', { name: 'Publish date' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Saved. The updated calendar could not be loaded.');
    expect(screen.queryByText('Important date published.')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh calendar' }));
    expect(screen.getByRole('status')).toHaveTextContent('Important date published.');
    expect(mocks.publish).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(parameters().get('date')).toBe('2026-10-28');
    expect(parameters().get('view')).toBe('list');
    expect(parameters().get('student_id')).toBe('learner-1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('removes a retained detail when its source fails rather than continuing to display stale records', async () => {
    mocks.sources.mockReturnValue(data({ entries: [entry({ id: 'events:fair', category: 'events', title: 'Current fair', href: '/areas/events/assigned/fair' })], sources: [source(), source('events')] }));
    const rendered = mount();
    await userEvent.click(screen.getByRole('button', { name: /Current fair/ }));
    expect(screen.getByRole('dialog', { name: 'Current fair' })).toBeVisible();
    mocks.sources.mockReturnValue(data({ entries: [], sources: [source(), source('events', 'error')] }));
    rendered.refresh();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Current fair/ })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/Events could not load/);
  });

  it.each(['loading', 'partial', 'error'] as const)('does not claim an empty complete calendar when a source is %s', status => {
    mocks.sources.mockReturnValue(data({ entries: [], sources: [source(), source('events', status)] }));
    mount();
    expect(screen.getByText('Dates are still loading or unavailable. This is not a complete calendar.')).toBeVisible();
    expect(screen.queryByText(/No published important dates/)).not.toBeInTheDocument();
    expect(screen.getByRole(status === 'error' ? 'alert' : 'status')).toBeVisible();
  });

  it('hides all retained entries and controls after Calendar access is denied', async () => {
    const retry = vi.fn();
    mocks.sources.mockReturnValue(data({ denied: true, sources: [{ ...source(), retry }] }));
    mount('/areas/calendar?date=2026-10-28&entry=dates%3Aclosure-one');
    expect(screen.getByRole('alert')).toHaveTextContent('Your Calendar access changed.');
    expect(screen.queryByText('Building maintenance')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Calendar view' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh calendar' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('acknowledges only the exact source revision and retains stale-update feedback after revision changes', () => {
    const rendered = mount('/areas/calendar?date=2026-10-28&calendar_change_id=closure-one&calendar_change_kind=created&calendar_revision=7&calendar_record_revision=2&attention_notification_id=notice-one');
    expect(screen.getByText('Exact update acknowledged')).toBeInTheDocument();
    expect(screen.getByText('This date matches the update you opened.')).toBeInTheDocument();
    mocks.sources.mockReturnValue(data({ campusDays: [{ ...day, revision: 3 }] }));
    rendered.refresh();
    expect(screen.queryByText('Exact update acknowledged')).not.toBeInTheDocument();
    expect(screen.queryByText('This date matches the update you opened.')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('It was not marked as opened.');
  });

  it('navigates month boundaries with clamping and returns to the campus-clock date, not the device UTC day', async () => {
    mount('/areas/calendar?date=2026-10-31&calendar_change_id=closure-one&attention_notification_id=notice-one');
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(parameters().get('date')).toBe('2026-11-30');
    expect(parameters().has('calendar_change_id')).toBe(false);
    expect(parameters().has('attention_notification_id')).toBe(false);
    expect(mocks.sources).toHaveBeenLastCalledWith(scope, '2026-11-01', '2026-11-30');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Calendar view' }), 'list');
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(parameters().get('date')).toBe('2026-12-30');
    await userEvent.click(screen.getByRole('button', { name: /Go to today/ }));
    expect(parameters().get('date')).toBe('2026-10-28');
    expect(screen.queryByRole('button', { name: /Go to today/ })).not.toBeInTheDocument();
  });

  it('navigates List by month across December and January, retaining exact-person context and native date selection', async () => {
    mount('/areas/calendar?date=2026-12-31&view=list&scope=dependent&student_id=learner-2&calendar_page=2');
    expect(screen.queryByRole('group', { name: 'Choose date' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next day' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(parameters().get('date')).toBe('2027-01-31');
    expect(parameters().get('view')).toBe('list');
    expect(parameters().get('scope')).toBe('dependent');
    expect(parameters().get('student_id')).toBe('learner-2');
    expect(parameters().has('calendar_page')).toBe(false);
    expect(mocks.sources).toHaveBeenLastCalledWith(scope, '2027-01-01', '2027-01-31');
    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(parameters().get('date')).toBe('2026-12-31');
    fireEvent.change(screen.getByLabelText('Choose date', { selector: 'input' }), { target: { value: '2027-02-14' } });
    expect(parameters().get('date')).toBe('2027-02-14');
    expect(mocks.sources).toHaveBeenLastCalledWith(scope, '2027-02-01', '2027-02-28');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Calendar view' }), 'month');
    expect(screen.getByRole('button', { name: 'Sunday, 14 February' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: /Go to today/ }));
    expect(parameters().get('date')).toBe('2026-10-28');
    expect(parameters().get('scope')).toBe('dependent');
    expect(parameters().get('student_id')).toBe('learner-2');
  });
});
