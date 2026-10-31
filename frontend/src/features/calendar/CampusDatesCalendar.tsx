import { useEffect, useRef, useState } from 'react';
import { Filter, Plus, Search, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { DateNavigation, DateViewSelect } from '../../components/date-navigation/DateNavigation';
import { monthDateLabel } from '../../components/date-navigation/dateMath';
import { activityDate, activityPage, campusDate } from '../activities/activityExperience';
import { applicationNow } from '../simulation/applicationTime';
import { CalendarAttentionGate, calendarAttentionResolution } from './CalendarRoutes';
import { CalendarEntryList, calendarCategoryLabels } from './CalendarEntryList';
import { CalendarEntryDetail } from './CalendarEntryDetail';
import { CampusDateEditor, type CampusDateAction } from './CampusDateEditor';
import type { PublishedCampusDate } from './campusPublishedDates';
import { useCampusCalendarSources } from './useCampusCalendarSources';
import type { CalendarCategory, CampusCalendarScope } from './campusCalendarSources';
import './campus-dates-calendar.css';

const attentionKeys = ['calendar_change_id', 'calendar_change_kind', 'calendar_revision', 'calendar_record_revision', 'attention_notification_id'];
const positive = (value: string | null) => value && /^[1-9][0-9]*$/.test(value) ? Number(value) : undefined;
const categories = Object.keys(calendarCategoryLabels) as CalendarCategory[];

/** Important dates are source-owned facts, not another activity planner. */
export function CampusDatesCalendar({ scope }: { scope: CampusCalendarScope }) {
  const [params, setParams] = useSearchParams();
  const today = campusDate(applicationNow(), scope.timeZone);
  const date = activityDate(params.get('date'), today);
  const from = `${date.slice(0, 7)}-01`;
  const until = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const view = params.get('view') === 'list' || params.get('view') === 'day' ? 'list' : 'month';
  const search = params.get('q')?.slice(0, 120) ?? '';
  const page = activityPage(params.get('calendar_page'));
  const [searchOpen, setSearchOpen] = useState(Boolean(search));
  const [filtersOpen, setFiltersOpen] = useState(categories.includes(params.get('type') as CalendarCategory));
  const [editor, setEditor] = useState<{ action: CampusDateAction; record?: PublishedCampusDate } | null>(null), [notice, setNotice] = useState('');
  const searchInput = useRef<HTMLInputElement>(null), searchButton = useRef<HTMLButtonElement>(null), filterButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const data = useCampusCalendarSources(scope, from, until);
  const category = data.sources.some(source => source.key === params.get('type')) ? params.get('type') as CalendarCategory : 'all';
  const filtered = data.entries.filter(entry => (category === 'all' || entry.category === category) && `${entry.title} ${entry.categoryLabel ?? ''} ${entry.location ?? ''} ${entry.summary ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn) || (a.startsAt ?? '').localeCompare(b.startsAt ?? '') || a.title.localeCompare(b.title));
  const wholeMonth = view === 'list' || Boolean(search);
  const shown = filtered.filter(entry => wholeMonth ? entry.startsOn <= until && entry.endsOn >= from : entry.startsOn <= date && entry.endsOn >= date);
  const resultFrom = wholeMonth ? from : date;
  const selected = data.entries.find(entry => entry.id === params.get('entry'));
  const incomplete = data.sources.some(source => source.status !== 'ready');
  const set = (values: Record<string, string>, moving = false) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!('calendar_page' in values)) next.delete('calendar_page');
    next.delete('dining_page');
    if (!('entry' in values)) next.delete('entry');
    if (moving) for (const key of attentionKeys) next.delete(key);
    setParams(next);
  };
  useEffect(() => { if (searchOpen) searchInput.current?.focus(); }, [searchOpen]);
  const closeSearch = () => { set({ q: '' }); setSearchOpen(false); searchButton.current?.focus(); };
  const target = { selected: date, notificationId: params.get('attention_notification_id') ?? undefined, changeId: params.get('calendar_change_id') ?? undefined,
    changeKind: params.get('calendar_change_kind') === 'created' || params.get('calendar_change_kind') === 'removed' ? params.get('calendar_change_kind') as 'created' | 'removed' : undefined,
    changeRevision: positive(params.get('calendar_revision')), recordRevision: positive(params.get('calendar_record_revision')) };
  const exact = data.daysLoaded && calendarAttentionResolution(data.campusDays, target) === 'exact';
  if (data.denied) return <div className="activity-error" role="alert"><p>Your Calendar access changed. Refresh to use your current access.</p><button type="button" onClick={() => data.sources.forEach(source => source.retry())}>Refresh calendar</button></div>;
  return <section className="campus-dates-calendar" aria-label="Important campus dates">
    <div className="campus-calendar-intro"><p className="campus-calendar-purpose">Important dates, deadlines and changes</p>
      {data.canManagePublishedDates ? <button type="button" className="campus-calendar-add" onClick={() => { setNotice(''); setEditor({ action: 'publish' }); }}><Plus size={16} aria-hidden="true" />Add important date</button> : null}</div>
    {notice ? <p className="activity-notice" role="status">{notice}</p> : null}
    <CalendarAttentionGate target={target} days={data.campusDays} loaded={data.daysLoaded} />
    <DateNavigation date={date} view="month" showDates={view === 'month'} today={today} onDateChange={value => set({ date: value }, true)} onToday={() => set({ date: today }, true)} getDayInfo={day => {
      const entries = filtered.filter(entry => entry.startsOn <= day && entry.endsOn >= day);
      const types = [...new Set(entries.map(entry => entry.category))];
      return { label: entries.length ? `${entries.length} important ${entries.length === 1 ? 'date' : 'dates'}: ${types.map(type => calendarCategoryLabels[type]).join(', ')}` : undefined,
        indicator: types.length ? <span className="campus-calendar-marks" aria-hidden="true">{types.map(type => <i key={type} className={`campus-calendar-mark campus-calendar-mark--${type}`} />)}</span> : undefined };
    }} toolbarTools={<>
      <div className="campus-calendar-tools"><DateViewSelect value={view} label="Calendar view" options={['month', 'list']} onChange={value => set({ view: value })} /><div>
        <button ref={filterButton} type="button" aria-label="Filter calendar dates" aria-expanded={filtersOpen} aria-controls="calendar-date-filters" onClick={() => setFiltersOpen(!filtersOpen)}><Filter size={18} aria-hidden="true" /><span>Filter{category !== 'all' ? ' · 1' : ''}</span></button>
        <button ref={searchButton} type="button" aria-label={searchOpen ? 'Close calendar search' : 'Search important dates'} aria-expanded={searchOpen} aria-controls="calendar-date-search" onClick={() => searchOpen ? closeSearch() : setSearchOpen(true)}>{searchOpen ? <X size={18} aria-hidden="true" /> : <Search size={18} aria-hidden="true" />}</button>
      </div></div>
      {filtersOpen ? <div id="calendar-date-filters" className="campus-calendar-filters" onKeyDown={event => { if (event.key === 'Escape') { setFiltersOpen(false); filterButton.current?.focus(); } }}><label>Date type<select value={category} onChange={event => set({ type: event.target.value === 'all' ? '' : event.target.value })}><option value="all">All important dates</option>{data.sources.map(source => <option key={source.key} value={source.key}>{calendarCategoryLabels[source.key]}</option>)}</select></label></div> : null}
      {searchOpen ? <label id="calendar-date-search" className="campus-calendar-search"><Search size={18} aria-hidden="true" /><span className="sr-only">Search this month's important dates</span><input ref={searchInput} value={search} maxLength={120} placeholder="Find an important date" onChange={event => set({ q: event.target.value })} onKeyDown={event => { if (event.key === 'Escape') closeSearch(); }} /></label> : null}
    </>} />
    {data.sources.filter(source => source.status !== 'ready').map(source => <div key={source.key} className={`campus-calendar-source campus-calendar-source--${source.status}`} role={source.status === 'error' ? 'alert' : 'status'}><span>{source.status === 'loading' ? `Loading ${source.label.toLowerCase()}…` : source.message ?? `${source.label} ${source.status === 'partial' ? 'are only partly loaded. Markers show loaded dates.' : 'could not load. Other dates are shown separately.'}`}</span>{source.status !== 'loading' ? <button type="button" onClick={source.retry}>Retry {source.label.toLowerCase()}</button> : null}</div>)}
    <section className="campus-calendar-results" aria-labelledby="calendar-dates-heading">
      <h2 id="calendar-dates-heading" ref={heading} tabIndex={-1}>{search ? `Search results · ${monthDateLabel(date)}` : wholeMonth ? monthDateLabel(date) : new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00Z`))}</h2>
      {wholeMonth ? <p className="activity-caption">{search ? 'Matching important dates across the selected month' : 'Important dates across the selected month'}</p> : null}
      {exact ? <p className="activity-notice">This date matches the update you opened.</p> : null}
      <CalendarEntryList entries={shown} from={resultFrom} timezone={scope.timeZone} page={page} onPage={next => { set({ calendar_page: String(next) }); window.requestAnimationFrame(() => heading.current?.focus()); }} onSelect={entry => set({ entry: entry.id, calendar_page: String(page) })}
        empty={incomplete ? 'Dates are still loading or unavailable. This is not a complete calendar.' : search || category !== 'all' ? `No matching important dates ${wholeMonth ? 'this month' : 'for this day'}. Try another filter or date.` : wholeMonth ? 'No published important dates this month. Routine sessions are in Timetable.' : 'No published important dates for this day. Routine sessions are in Timetable.'} />
    </section>
    {selected && !editor ? <CalendarEntryDetail entry={selected} timezone={scope.timeZone} canManagePublication={data.canManagePublishedDates}
      onCorrect={() => setEditor({ action: 'correct', record: selected.publication })} onCancel={() => setEditor({ action: 'cancel', record: selected.publication })}
      onClose={() => { const next = new URLSearchParams(params); next.delete('entry'); setParams(next, { replace: true }); }} /> : null}
    {editor ? <CampusDateEditor schoolId={scope.schoolId} date={date} {...editor} canManage={data.canManagePublishedDates}
      refresh={data.refreshPublishedDates}
      onClose={() => setEditor(null)} onSaved={() => { setNotice(editor.action === 'publish' ? 'Important date published.' : editor.action === 'correct' ? 'Date correction saved.' : 'Date cancelled.'); setEditor(null); window.requestAnimationFrame(() => heading.current?.focus()); }} /> : null}
  </section>;
}
