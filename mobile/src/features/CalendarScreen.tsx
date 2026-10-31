import { createElement, useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MotionModal as Modal } from '../ui/Motion';
import DateTimePicker from '@react-native-community/datetimepicker';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from 'expo-router';
import type { WorkspaceManifest } from '../../../packages/contracts/src/workspace';
import type { CalendarCategory, CalendarEntry } from '../../../packages/contracts/src/wire/features/calendar/campusCalendarSources';
import type { PublishedCampusDatesPage } from '../../../packages/contracts/src/wire/features/calendar/campusPublishedDates';
import { useSession } from '../auth/SessionProvider';
import { useApi } from '../lib/query';
import { calendarDateRoot } from '../lib/calendar-date-policy';
import { nativeCalendarAttention } from '../lib/calendar-attention';
import { nativeCalendarChangeHref, nativeCalendarExactContextHref, nativeCalendarLocation } from '../lib/calendar-route';
import { useCalendarAttention } from '../lib/use-calendar-attention';
import { nativeCalendarDay, nativeCalendarMonthRange, nativeCalendarShiftMonth, nativeCalendarSourceLabels, nativeCalendarValidDate } from '../lib/native-calendar';
import { nativeCalendarSourceScope, nativeCalendarTimetableDestination, nativeScheduleDestination, type NativeScheduleAccess } from '../lib/schedule-access';
import { isInternalHref } from '../lib/api-policy';
import { CalendarMonthGrid } from '../ui/CalendarMonthGrid';
import { ChoiceMenu, ControlButton, Facts, InfoDisclosure } from '../ui/DomainControls';
import { Empty, Loading, Notice, Page, SearchField, usePageScroll } from '../ui/components';
import { Icon } from '../ui/Icon';
import { useTheme } from '../ui/theme';
import { useNativeCampusCalendarSources } from './calendar/useNativeCampusCalendarSources';
import { CalendarDateEditor } from './CalendarDateEditor';

interface Props {
  href: string; onNavigate: (href: string) => void; manifest: WorkspaceManifest;
  selected: NativeScheduleAccess; options: NativeScheduleAccess[]; onRefreshAccess: () => void;
}
const dateLabel = (value: string, long = false) => new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', ...(long ? { weekday: 'long' as const } : {}), day: 'numeric', month: long ? 'long' : 'short', year: 'numeric' }).format(new Date(`${value}T12:00:00Z`));
const monthLabel = (value: string) => new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${value}T12:00:00Z`));

/** Calendar composes published important dates. Routine activities remain Timetable. */
export function CalendarScreen(props: Props) {
  const { environment } = useSession();
  const scope = nativeCalendarSourceScope(props.manifest, props.selected);
  const exactHref = nativeCalendarExactContextHref(props.manifest, props.selected, props.href);
  useEffect(() => { if (exactHref && exactHref !== props.href) props.onNavigate(exactHref); }, [exactHref, props.href, props.onNavigate]);
  let today = '';
  try { today = nativeCalendarDay(environment.mode === 'simulation' ? environment.virtual_clock?.now ?? '' : Date.now(), scope.timeZone); } catch { /* No wall-clock or timezone fallback for an unavailable context. */ }
  if (environment.unavailable || !nativeCalendarValidDate(today)) return <Page title="Calendar"><Empty title="Campus time could not be confirmed" message="Refresh your campus context before loading important dates." onRetry={props.onRefreshAccess} /></Page>;
  if (!exactHref) return <Page title="Calendar"><Empty title="This Calendar context could not be confirmed" onRetry={props.onRefreshAccess} /></Page>;
  if (exactHref !== props.href) return <Page title="Calendar"><Loading /></Page>;
  return <CalendarBody {...props} today={today} />;
}

function CalendarBody({ href, onNavigate, manifest, selected, options, onRefreshAccess, today }: Props & { today: string }) {
  const { colors } = useTheme();
  const focused = useIsFocused();
  const scope = nativeCalendarSourceScope(manifest, selected);
  const params = nativeCalendarLocation(href).params;
  const date = nativeCalendarValidDate(params.get('date')) ? params.get('date')! : today;
  const view = params.get('view') === 'list' || params.get('view') === 'day' ? 'list' : 'month';
  const search = params.get('q')?.slice(0, 120) ?? '';
  const [searchOpen, setSearchOpen] = useState(Boolean(search));
  const [filtersOpen, setFiltersOpen] = useState(Boolean(params.get('type')));
  const [pickerOpen, setPickerOpen] = useState(false);
  const { from, until } = nativeCalendarMonthRange(date);
  const data = useNativeCampusCalendarSources(scope, from, until);
  const attention = nativeCalendarAttention(href, selected, { loaded: data.daysLoaded, days: data.campusDays, from, until });
  const opened = useCalendarAttention(attention.proof, data.daysVerifiedAt);
  const publicationAccess = useApi<PublishedCampusDatesPage>(`${calendarDateRoot(scope.schoolId)}?${new URLSearchParams({ from, until, page: '1' })}`);
  const canManageDates = publicationAccess.isSuccess && !publicationAccess.isError && publicationAccess.data.from === from && publicationAccess.data.until === until && publicationAccess.data.can_manage === true;
  const refresh = () => { onRefreshAccess(); data.refresh(); };
  const change = (values: Record<string, string>, moving = false) => {
    onNavigate(nativeCalendarChangeHref(href, values, moving));
  };
  const category = data.sources.some(source => source.key === params.get('type')) ? params.get('type') as CalendarCategory : 'all';
  const filtered = data.entries.filter(entry => (category === 'all' || entry.category === category) && `${entry.title} ${entry.categoryLabel ?? ''} ${entry.location ?? ''} ${entry.summary ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const wholeMonth = view === 'list' || Boolean(search);
  const shown = filtered.filter(entry => wholeMonth ? entry.startsOn <= until && entry.endsOn >= from : entry.startsOn <= date && entry.endsOn >= date);
  const requestedPage = Number(params.get('calendar_page') ?? 1), pages = Math.max(1, Math.ceil(shown.length / 8));
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, pages) : 1;
  const visible = shown.slice((page - 1) * 8, page * 8);
  const groups = new Map<string, CalendarEntry[]>();
  const resultFrom = wholeMonth ? from : date;
  for (const entry of visible) { const day = entry.startsOn < resultFrom ? resultFrom : entry.startsOn; groups.set(day, [...groups.get(day) ?? [], entry]); }
  const currentEntry = data.entries.find(entry => entry.id === params.get('entry'));
  const incomplete = data.sources.some(source => source.state !== 'ready');
  const categoryColor: Record<CalendarCategory, string> = { milestones: colors.positive, dates: colors.positive, events: colors.link, assessments: colors.warning, services: colors.danger };
  const campus = options.find(option => option.kind === 'assigned') ?? options.find(option => option.kind === 'manage');
  const scopeOptions = options.filter(option => option.kind === 'self' || option.kind === 'dependent' || option === campus || option.kind === 'availability' && !campus);
  const labelFor = (option: NativeScheduleAccess) => option.kind === 'self' ? 'My calendar' : option.kind === 'dependent' ? `${option.relationshipLabel ?? 'Learner'} calendar` : 'Campus dates';
  const selectedScope = selected.kind === 'assigned' || selected.kind === 'manage' ? campus?.surface.key ?? selected.surface.key : selected.surface.key;
  const timetableParams = new URLSearchParams(params); timetableParams.set('date', date);
  const timetableHref = nativeCalendarTimetableDestination(manifest, selected, timetableParams);
  const closeSearch = () => { setSearchOpen(false); change({ q: '' }); };
  if (data.denied) return <Page title="Calendar"><Empty title="Your Calendar access changed" message="Refresh to use your current campus access." onRetry={refresh} /></Page>;
  if (params.has('calendar_action')) return <CalendarDateEditor {...{ href, date, onNavigate }} schoolId={scope.schoolId} />;
  return <Page title="Calendar" refreshing={data.refreshing} onRefresh={refresh}>
    <View style={styles.calendar}>
      <View style={styles.contextBar}>{scopeOptions.length > 1 ? <ChoiceMenu label="Choose calendar scope" value={selectedScope} options={scopeOptions.map(option => ({ value: option.surface.key, label: labelFor(option) }))} onChange={value => { const option = scopeOptions.find(candidate => candidate.surface.key === value); if (option) onNavigate(nativeScheduleDestination(option.surface.href, params)); }} /> : <Text style={[styles.body, { color: colors.muted }]}>{labelFor(selected)}</Text>}{timetableHref ? <ControlButton title="Timetable" onPress={() => onNavigate(timetableHref)} /> : null}</View>
      <Text style={[styles.body, { color: colors.muted }]}>Important dates, deadlines and changes</Text>
      {attention.resolution === 'stale' && data.daysLoaded ? <Notice message="This calendar update no longer matches the campus day. It was not marked as opened." /> : attention.resolution === 'exact' ? <Notice message="This date matches the update you opened." /> : null}
      {opened.error ? <View style={{ gap: 8 }}><Notice tone="warning" message={opened.error} /><ControlButton title="Retry opening acknowledgement" onPress={opened.retry} /></View> : null}
      {canManageDates ? <ControlButton title="Add important date" kind="primary" onPress={() => change({ calendar_action: 'publish', calendar_date_id: '' })} /> : null}
      <View style={styles.monthNavigation}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => change({ date: nativeCalendarShiftMonth(date, -1) }, true)} style={styles.iconButton}><Icon name="back" size={20} muted /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Choose date, ${monthLabel(date)}`} onPress={() => setPickerOpen(true)} style={styles.monthButton}><Text style={[styles.monthTitle, { color: colors.ink }]}>{monthLabel(date)}</Text><View style={{ transform: [{ rotate: '90deg' }] }}><Icon name="chevron" size={15} muted /></View></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => change({ date: nativeCalendarShiftMonth(date, 1) }, true)} style={styles.iconButton}><Icon name="arrow" size={20} muted /></Pressable>
        {date !== today ? <ControlButton title="Today" onPress={() => change({ date: today }, true)} /> : null}
      </View>
      <View style={styles.tools}><ChoiceMenu label="Calendar view" value={view} options={[{ value: 'month', label: 'Month' }, { value: 'list', label: 'List' }]} onChange={value => change({ view: value })} /><View style={styles.secondaryTools}><ControlButton title={category === 'all' ? 'Filter' : 'Filter · 1'} onPress={() => setFiltersOpen(!filtersOpen)} /><Pressable accessibilityRole="button" accessibilityLabel={searchOpen ? 'Close calendar search' : 'Search important dates'} accessibilityState={{ expanded: searchOpen }} onPress={() => searchOpen ? closeSearch() : setSearchOpen(true)} style={styles.iconButton}><Icon name={searchOpen ? 'close' : 'search'} size={20} muted /></Pressable></View></View>
      {filtersOpen ? <ChoiceMenu label="Date type" value={category} options={[{ value: 'all', label: 'All important dates' }, ...data.sources.map(source => ({ value: source.key, label: nativeCalendarSourceLabels[source.key] }))]} onChange={value => change({ type: value === 'all' ? '' : value })} /> : null}
      {searchOpen ? <SearchField variant="outlined" label="Search this month's important dates" placeholder="Find an important date" value={search} onChangeText={value => change({ q: value.slice(0, 120) })} /> : null}
      {view === 'month' ? <CalendarMonthGrid date={date} today={today} onDateChange={value => change({ date: value }, true)} getDayInfo={day => { const entries = filtered.filter(entry => entry.startsOn <= day && entry.endsOn >= day); const types = [...new Set(entries.map(entry => entry.category))]; return { label: day < from || day > until ? 'Outside selected month; select to load dates' : entries.length ? `${entries.length} ${incomplete ? 'loaded ' : ''}important ${entries.length === 1 ? 'date' : 'dates'}: ${types.map(type => nativeCalendarSourceLabels[type]).join(', ')}` : incomplete ? 'Dates are still loading or unavailable' : 'No published important dates', markers: types.map(type => ({ key: type, color: categoryColor[type] })) }; }} /> : null}
      {data.sources.filter(source => source.state !== 'ready').map(source => <View key={source.key} style={[styles.sourceNotice, { backgroundColor: colors.surfaceSoft }]}><Text accessibilityRole={source.state === 'error' ? 'alert' : 'text'} style={[styles.body, { color: source.state === 'error' ? colors.danger : colors.muted }]}>{source.state === 'loading' ? `Loading ${source.label.toLowerCase()}…` : source.message}</Text>{source.state !== 'loading' ? <ControlButton title={`Retry ${source.label.toLowerCase()}`} onPress={source.retry} /> : null}</View>)}
      <View style={styles.results}><Text accessibilityRole="header" style={[styles.resultsTitle, { color: colors.ink }]}>{search ? `Search results · ${monthLabel(date)}` : wholeMonth ? monthLabel(date) : dateLabel(date, true)}</Text>
        {wholeMonth ? <Text style={[styles.caption, { color: colors.muted }]}>{search ? 'Matching important dates across the selected month' : 'Important dates across the selected month'}</Text> : null}
        {groups.size ? [...groups].map(([day, entries]) => <View key={day}>{wholeMonth ? <Text accessibilityRole="header" style={[styles.groupDate, { color: colors.muted }]}>{dateLabel(day, true)}</Text> : null}{entries.map((entry, entryIndex) => <CalendarRow key={entry.id} entry={entry} timezone={scope.timeZone} resultFrom={resultFrom} categoryColor={categoryColor[entry.category]} separator={entryIndex > 0} onPress={() => change({ entry: entry.id, calendar_page: String(page) })} />)}</View>) : <Text style={[styles.empty, { color: colors.muted }]}>{incomplete ? 'Dates are still loading or unavailable. This is not a complete calendar.' : search || category !== 'all' ? `No matching important dates ${wholeMonth ? 'this month' : 'for this day'}. Try another filter or date.` : `No published important dates ${wholeMonth ? 'this month' : 'for this day'}. Routine sessions are in Timetable.`}</Text>}
        {pages > 1 ? <CalendarPagination page={page} pages={pages} total={shown.length} onChange={next => change({ calendar_page: String(next) })} /> : null}
      </View>
      <InfoDisclosure title="Calendar sources and time"><Text style={[styles.body, { color: colors.muted }]}>Times use {scope.timeZone}. Markers describe published source facts. Routine sessions and duties are in Timetable.</Text></InfoDisclosure>
    </View>
    <CalendarDatePicker date={date} open={pickerOpen && focused} onClose={() => setPickerOpen(false)} onChange={value => change({ date: value }, true)} />
    {currentEntry && focused ? <CalendarDetail entry={currentEntry} timezone={scope.timeZone} onClose={() => change({ entry: '', calendar_page: String(page) })} onNavigate={onNavigate} canManage={canManageDates} onEdit={action => change({ calendar_action: action, calendar_date_id: currentEntry.sourceId, entry: '' })} /> : null}
  </Page>;
}

function CalendarPagination({ page, pages, total, onChange }: { page: number; pages: number; total: number; onChange: (page: number) => void }) {
  const { colors } = useTheme(), scrollToTop = usePageScroll();
  const change = (next: number) => { onChange(next); scrollToTop(); };
  return <View style={styles.pagination}><ControlButton title="Previous" disabled={page === 1} onPress={() => change(page - 1)} /><Text style={[styles.caption, { color: colors.muted }]}>Page {page} of {pages} · {total} dates</Text><ControlButton title="Next" disabled={page === pages} onPress={() => change(page + 1)} /></View>;
}

function clock(instant: string, timezone: string) { try { return new Intl.DateTimeFormat('en-IN', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(instant)); } catch { return 'Time unavailable'; } }
function CalendarRow({ entry, timezone, resultFrom, categoryColor, separator, onPress }: { entry: CalendarEntry; timezone: string; resultFrom: string; categoryColor: string; separator?: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const timing = entry.startsOn < resultFrom ? 'Ongoing' : entry.allDay ? 'All day' : entry.startsAt ? clock(entry.startsAt, timezone) : 'Date';
  return <Pressable accessibilityRole="button" accessibilityLabel={[entry.title, timing, entry.categoryLabel ?? nativeCalendarSourceLabels[entry.category], entry.location, entry.status].filter(Boolean).join(', ')} onPress={onPress} style={({ pressed }) => [styles.entry, { borderTopWidth: separator ? StyleSheet.hairlineWidth : 0, borderColor: colors.border, opacity: pressed ? .7 : 1 }]}><View style={styles.entryTime}><Text style={[styles.time, { color: colors.ink }]}>{timing}</Text>{entry.endsOn !== entry.startsOn ? <Text style={[styles.caption, { color: colors.muted }]}>Through {dateLabel(entry.endsOn)}</Text> : null}</View><View style={styles.entryBody}><Text style={[styles.entryTitle, { color: colors.ink }]}>{entry.title}</Text><Text style={[styles.entryMetadata, { color: colors.muted }]}><Text style={{ color: categoryColor }}>{entry.categoryLabel || nativeCalendarSourceLabels[entry.category]}</Text>{entry.location ? ` · ${entry.location}` : ''}</Text>{entry.status ? <Text style={[styles.entryMetadata, { color: entry.status.toLowerCase().includes('cancel') ? colors.danger : colors.muted }]}>{entry.status}</Text> : null}</View><Icon name="chevron" size={16} muted /></Pressable>;
}

function CalendarDatePicker({ date, open, onClose, onChange }: { date: string; open: boolean; onClose: () => void; onChange: (date: string) => void }) {
  const { colors, dark } = useTheme();
  if (Platform.OS === 'web') return open ? <View style={{ gap: 8 }}><Text style={[styles.body, { color: colors.muted }]}>Choose date</Text>{createElement('input', { type: 'date', value: date, 'aria-label': 'Select calendar date', onChange: (event: { target: { value: string } }) => { if (nativeCalendarValidDate(event.target.value)) { onChange(event.target.value); onClose(); } }, style: { minHeight: 44, fontSize: 16, padding: 8, border: `1px solid ${colors.border}`, borderRadius: 16, color: colors.ink, backgroundColor: colors.surface, colorScheme: dark ? 'dark' : 'light' } })}<ControlButton title="Done" onPress={onClose} /></View> : null;
  const picker = open ? <DateTimePicker accessibilityLabel="Select calendar date" mode="date" timeZoneName="UTC" display={Platform.OS === 'ios' ? 'inline' : 'default'} value={new Date(`${date}T12:00:00Z`)} themeVariant={dark ? 'dark' : 'light'} accentColor={colors.link} onValueChange={(_event, value) => { onChange(value.toISOString().slice(0, 10)); onClose(); }} onDismiss={onClose} /> : null;
  if (Platform.OS !== 'ios') return picker;
  return <Modal visible={open} presentationStyle="pageSheet" animationType="slide" onRequestClose={onClose}><SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}><ScrollView contentContainerStyle={styles.sheet}><View style={styles.sheetHeader}><Text accessibilityRole="header" style={[styles.monthTitle, { color: colors.ink }]}>Choose date</Text><ControlButton title="Done" onPress={onClose} /></View>{picker}</ScrollView></SafeAreaView></SafeAreaProvider></Modal>;
}

function CalendarDetail({ entry, timezone, onClose, onNavigate, canManage, onEdit }: { entry: CalendarEntry; timezone: string; onClose: () => void; onNavigate: (href: string) => void; canManage: boolean; onEdit: (action: 'correct' | 'cancel') => void }) {
  const { colors } = useTheme();
  const publication = entry.category === 'milestones' ? entry.publication : undefined;
  const timing = `${dateLabel(entry.startsOn)}${entry.endsOn !== entry.startsOn ? ` – ${dateLabel(entry.endsOn)}` : ''}${entry.allDay ? ' · All day' : entry.startsAt ? `\n${clock(entry.startsAt, timezone)}${entry.endsAt ? ` – ${clock(entry.endsAt, timezone)}` : ''} · ${timezone}` : ''}`;
  const sourceHref = entry.href && isInternalHref(entry.href) ? entry.href : null;
  return <Modal visible presentationStyle="pageSheet" animationType="slide" onRequestClose={onClose}><SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}><ScrollView contentContainerStyle={styles.sheet}>
    <View style={styles.sheetHeader}><Text accessibilityRole="header" style={[styles.detailTitle, { color: colors.ink }]}>{entry.title}</Text><ControlButton title="Done" onPress={onClose} /></View><Text style={[styles.body, { color: colors.muted }]}>{entry.categoryLabel || nativeCalendarSourceLabels[entry.category]}</Text>
    <Facts items={[{ label: 'When', value: timing }, ...(entry.location ? [{ label: 'Where', value: entry.location }] : []), ...(entry.status ? [{ label: 'Status', value: entry.status }] : []), ...(publication?.state === 'cancelled' && publication.cancellation_reason ? [{ label: 'Cancellation reason', value: publication.cancellation_reason }] : [])]} />
    {entry.summary ? <Text style={[styles.body, { color: colors.ink }]}>{entry.summary}</Text> : null}{entry.revision ? <Text style={[styles.caption, { color: colors.muted }]}>Current version {entry.revision}</Text> : null}
    {publication?.state === 'published' && canManage ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><ControlButton title="Correct date" onPress={() => onEdit('correct')} /><ControlButton title="Cancel date" kind="danger" onPress={() => onEdit('cancel')} /></View> : null}
    {sourceHref ? <ControlButton title={entry.category === 'events' ? 'Open event' : entry.category === 'assessments' ? 'Open assessments' : entry.category === 'services' ? 'View service change' : 'View source'} kind="primary" onPress={() => onNavigate(sourceHref)} /> : null}<Text style={[styles.caption, { color: colors.muted }]}>{publication ? 'Publishing a date does not change teaching, bookings, payments or results.' : 'Changes are maintained in the original record.'}</Text>
  </ScrollView></SafeAreaView></SafeAreaProvider></Modal>;
}

const styles = StyleSheet.create({
  calendar: { gap: 16, paddingTop: 4 }, body: { fontSize: 14, lineHeight: 21 }, caption: { fontSize: 12, lineHeight: 18 },
  contextBar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  monthNavigation: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  iconButton: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  monthButton: { flex: 1, minWidth: 100, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }, monthTitle: { fontSize: 18, lineHeight: 26, fontWeight: '600', flexShrink: 1 },
  tools: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, secondaryTools: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  sourceNotice: { padding: 12, borderRadius: 16, gap: 4 }, results: { gap: 12 }, resultsTitle: { fontSize: 18, lineHeight: 26, fontWeight: '600' }, groupDate: { fontSize: 14, lineHeight: 21, paddingVertical: 8 },
  entry: { minHeight: 72, paddingVertical: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 12 }, entryTime: { width: 64, gap: 4 }, time: { fontSize: 13, lineHeight: 20, fontWeight: '600' }, entryBody: { flex: 1, minWidth: 0, gap: 4 }, entryTitle: { fontSize: 16, lineHeight: 23, fontWeight: '600' }, entryMetadata: { fontSize: 13, lineHeight: 20 }, empty: { paddingVertical: 16, fontSize: 14, lineHeight: 23 },
  pagination: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sheet: { padding: 20, paddingBottom: 40, gap: 16 }, sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }, detailTitle: { flex: 1, fontSize: 22, lineHeight: 29, fontWeight: '600' },
});
