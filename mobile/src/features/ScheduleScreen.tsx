import { ScreenBack } from '../ui/BackNavigation';
import React, { createElement, useMemo, useState } from 'react';
import { Linking, Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { assertWorkspaceManifestContext, normalizeWorkspaceManifest } from '../../../packages/contracts/src/workspace-normalizer';
import type { WorkspaceManifest } from '../../../packages/contracts/src/workspace';
import { useSession } from '../auth/SessionProvider';
import { useApi } from '../lib/query';
import { nativeRelationshipTimetableMatches, nativeRelationshipTimetablePath, nativeScheduleDestination, nativeScheduleOptions, resolveNativeScheduleAccess, type NativeScheduleAccess } from '../lib/schedule-access';
import { Button, Empty, Loading, Notice, Page, Row, Section } from '../ui/components';
import { ChoiceMenu, ControlButton, SegmentedControl } from '../ui/DomainControls';
import { useTheme } from '../ui/theme';
import { CalendarScreen } from './CalendarScreen';
import { Icon, iconForDestination } from '../ui/Icon';
import { SchedulePlanning } from './SchedulePlanning';
import { AcademicScheduleScreen } from './AcademicScheduleScreen';

type Props = { href: string; onNavigate: (href: string) => void };
type Occurrence = { id: string; title: string; purpose: string; starts_at: string; ends_at: string; local_date: string; timezone: string; space_label: string | null; state: string; attendance_mode: string; can_open_register?: boolean; source: string; source_href?: string; teaching_session_href?: string; location_label?: string; location_kind?: string; location_url?: string; participants: Array<{ person_id: string; label: string; attendance_expected?: boolean }> };
type OccurrencePage = { items: Occurrence[]; page: number; page_size: number; total: number; total_pages: number; timezone?: string };
type CampusDay = { id: string; date: string; is_instructional: boolean; label: string; reason?: string };
function dateInZone(now: Date, zone: string) { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now); const part = (key: string) => parts.find(value => value.type === key)?.value; return `${part('year')}-${part('month')}-${part('day')}`; }
function shift(date: string, amount: number) { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + amount); return value.toISOString().slice(0, 10); }
function validDate(value: string | null): value is string { return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value; }
function hrefWith(href: string, values: Record<string, string>) { const query = new URLSearchParams(href.split('#')[0]!.split('?')[1] ?? ''); for (const [key, value] of Object.entries(values)) { if (value) query.set(key, value); else query.delete(key); } return `${href.split('#')[0]!.split('?')[0]}${query.size ? `?${query}` : ''}`; }
function interval(item: Occurrence) { try { const format = new Intl.DateTimeFormat(undefined, { timeZone: item.timezone, hour: 'numeric', minute: '2-digit' }); return `${format.format(new Date(item.starts_at))} – ${format.format(new Date(item.ends_at))}`; } catch { return 'Time unavailable'; } }
function ScheduleDateControl({ date, onChange }: { date: string; onChange: (date: string) => void }) {
  const { colors, dark } = useTheme(), [open, setOpen] = useState(false);
  if (Platform.OS === 'web') return createElement('input', { type: 'date', value: date, 'aria-label': 'Select timetable date', onChange: (event: { target: { value: string } }) => { if (validDate(event.target.value)) onChange(event.target.value); }, style: { width: '100%', minWidth: 0, minHeight: 44, fontSize: 16, padding: 8, border: `1px solid ${colors.border}`, borderRadius: 16, color: colors.ink, backgroundColor: colors.surface, colorScheme: dark ? 'dark' : 'light' } });
  return Platform.OS === 'ios' || open ? <DateTimePicker mode="date" display={Platform.OS === 'ios' ? 'compact' : 'default'} timeZoneName="UTC" value={new Date(`${date}T12:00:00Z`)} style={{ minHeight: 44 }} themeVariant={dark ? 'dark' : 'light'} accentColor={colors.action} onValueChange={(_event, value) => { setOpen(false); onChange(value.toISOString().slice(0, 10)); }} onDismiss={() => setOpen(false)} accessibilityLabel="Select timetable date" /> : <ControlButton title="Choose date" onPress={() => setOpen(true)} />;
}
function ScheduleDateNavigation({ date, today, onChange }: { date: string; today: string; onChange: (date: string) => void }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Pressable accessibilityRole="button" accessibilityLabel="Previous day" onPress={() => onChange(shift(date, -1))} style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="back" size={20} muted /></Pressable><View style={{ flex: 1, minWidth: 0 }}><ScheduleDateControl date={date} onChange={onChange} /></View><Pressable accessibilityRole="button" accessibilityLabel="Next day" onPress={() => onChange(shift(date, 1))} style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="arrow" size={20} muted /></Pressable>{date !== today ? <ControlButton title="Today" onPress={() => onChange(today)} /> : null}</View>;
}

export function ScheduleScreen(props: Props) {
  const { schoolId, scopeKey, user, environment } = useSession();
  const manifest = useApi<unknown>(schoolId ? '/api/v1/workspace' : null);
  const resolved = useMemo(() => {
    try { if (!manifest.data || !schoolId || !user) return null; const value = normalizeWorkspaceManifest(manifest.data); assertWorkspaceManifestContext(value, { actorUserId: user.id, institutionId: schoolId, environment }); return value; } catch { return null; }
  }, [manifest.data, schoolId, user?.id, environment]);
  const title = props.href.startsWith('/areas/timetable') ? 'Timetable' : 'Calendar';
  if (!schoolId) return <Page title="Calendar"><Empty title="Choose a campus" message="Your agenda follows your active campus." /></Page>;
  if (manifest.isPending) return <Page title={title}><Loading /></Page>;
  if (manifest.isError || !resolved) return <Page title={title}><Empty title="Schedule access could not be confirmed" message={manifest.error?.message} onRetry={() => void manifest.refetch()} /></Page>;
  if (props.href.split('#')[0]!.split('?')[0]?.startsWith('/areas/timetable/planning')) {
    const requestedSchool = new URLSearchParams(props.href.split('#')[0]!.split('?')[1] ?? '').get('school');
    if (requestedSchool && requestedSchool !== schoolId) return <Page title="Timetable planning"><Empty title="This planning link belongs to another campus" message="Select that campus explicitly before opening its planning work." /></Page>;
    const surface = resolved.areas.find(area => area.key === 'timetable')?.surfaces.find(surface => surface.key === 'planning');
    return surface ? <SchedulePlanning key={`${scopeKey}:planning`} {...props} schoolId={schoolId} timeZone={environment.virtual_clock?.time_zone ?? resolved.context.time_zone ?? 'UTC'} /> : <Page title="Timetable planning"><Empty title="Planning is unavailable with your current responsibilities" onRetry={() => void manifest.refetch()} /></Page>;
  }
  const options = nativeScheduleOptions(resolved, props.href), selected = resolveNativeScheduleAccess(resolved, props.href), query = new URLSearchParams(props.href.split('#')[0]!.split('?')[1] ?? '');
  if (!selected) {
    const canChoose = !query.has('student_id') && !query.has('surface') && (!query.has('scope') || ['self', 'dependent'].includes(query.get('scope')!));
    const choices = canChoose ? options.filter(option => !query.has('scope') || option.kind === query.get('scope')) : [];
    return <Page title={title}>{choices.length ? <Section title="Choose a schedule">{choices.map(option => <Row key={option.surface.key} icon={iconForDestination(option.surface.href, 'timetable')} iconDestination={option.surface.href} title={option.surface.label} detail={option.surface.description} onPress={() => props.onNavigate(nativeScheduleDestination(option.surface.href, query))} />)}</Section> : <Empty title="This schedule is unavailable" message="The selected responsibility or relationship is no longer in your current campus access." onRetry={() => void manifest.refetch()} />}</Page>;
  }
  const zone = environment.virtual_clock?.time_zone ?? resolved.context.time_zone ?? 'UTC';
  if (props.href.split('#')[0]!.split('?')[0] === '/areas/calendar') return <CalendarScreen key={`${scopeKey}:${selected.surface.key}`} {...props} manifest={resolved} options={options} selected={selected} onRefreshAccess={() => { void manifest.refetch(); }} />;
  const common = { ...props, schoolId, selected, options, zone };
  if(selected.kind==='assigned'&&query.get('source')==='academic')return <AcademicScheduleScreen key={`${scopeKey}:${props.href}`} {...props} schoolId={schoolId} timeZone={zone}/>;
  return selected.kind === 'self' || selected.kind === 'dependent'
    ? <RelationshipAgenda key={`${scopeKey}:${selected.surface.key}:${props.href}`} {...common} manifest={resolved} />
    : <Agenda key={`${scopeKey}:${selected.surface.key}:${props.href}`} {...common} />;
}
type AgendaProps = Props & { schoolId: string; selected: NativeScheduleAccess; options: NativeScheduleAccess[]; zone: string };
function ScheduleChoices({ href, onNavigate, options, selected }: Props & { options: NativeScheduleAccess[]; selected: NativeScheduleAccess }) {
  return options.length > 1 ? <ChoiceMenu label="Choose schedule" value={selected.surface.key} options={options.map(option => ({ value: option.surface.key, label: option.surface.label }))} onChange={value => { const option = options.find(candidate => candidate.surface.key === value); if (option) onNavigate(nativeScheduleDestination(option.surface.href, new URLSearchParams(href.split('#')[0]!.split('?')[1] ?? ''))); }} /> : null;
}
type PublishedPeriod = { id: string; weekday: number; period_number: number; starts_at: string; ends_at: string; display_title: string; room: string; subject: { name: string } | null; teacher: { name: string } | null; cancelled?: boolean; materials?: string[]; notice?: string; date?: string | null };
type RelationshipTimetable = { student: { id: string; user?: { display_name?: string }; current_enrollment?: { term?: { name?: string } } }; class_name: string; mode: 'day' | 'week'; selected_date: string; days: Array<{ weekday: number; weekday_label: string; periods: PublishedPeriod[] }>; day_plan?: { id: string; date: string; version: number; notice: string; cancelled_periods: number } | null; schedule_source?: { id: string; revision: number; starts_on: string; ends_on: string } | null };
function RelationshipAgenda({ href, onNavigate, schoolId, selected, options, zone, manifest }: AgendaProps & { manifest: WorkspaceManifest }) {
  const { environment } = useSession(), { colors } = useTheme();
  const params = new URLSearchParams(href.split('#')[0]!.split('?')[1] ?? '');
  const today = dateInZone(new Date(environment.virtual_clock?.now ?? Date.now()), zone), date = validDate(params.get('date')) ? params.get('date')! : today;
  const periodId = params.get('period_id') ?? '';
  const week = params.get('view') === 'week';
  const timetable = useApi<RelationshipTimetable>(nativeRelationshipTimetablePath(selected, date));
  const days = useApi<{ results: CampusDay[] }>(`/api/v1/calendar/days/?${new URLSearchParams({ school_id: schoolId, from: date, to: date })}`);
  const authorized = !timetable.isError && nativeRelationshipTimetableMatches(timetable.data, selected);
  const data = authorized ? timetable.data : undefined, weekday = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
  const visible = data?.days.filter(day => week || day.weekday === weekday) ?? [];
  const chosenPeriod = visible.flatMap(day => day.periods).find(period => period.id === periodId);
  const dateValue = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), 12);
  const changeDate = (value: string) => onNavigate(hrefWith(href, { date: value, period_id: '', occurrence_id: '', calendar_page: '', page: '', calendar_change_id: '', calendar_change_kind: '', calendar_revision: '', calendar_record_revision: '', attention_notification_id: '' }));
  const other = manifest.areas.find(area => area.key === 'calendar')?.surfaces.find(surface => surface.key === `calendar:${selected.kind}:${selected.studentId}`);
  const periodTime = (period: PublishedPeriod) => `${period.starts_at.slice(0, 5)} – ${period.ends_at.slice(0, 5)}`;
  return <Page title="Timetable" subtitle={`${selected.relationshipLabel ?? (selected.kind === 'self' ? 'My schedule' : 'Learner schedule')}${data?.class_name ? ` · ${data.class_name}` : ''}`} refreshing={timetable.isRefetching || days.isRefetching} onRefresh={() => { void timetable.refetch(); void days.refetch(); }}>
    <ScheduleChoices href={href} onNavigate={onNavigate} options={options} selected={selected} />
    <ScheduleDateNavigation date={date} today={today} onChange={changeDate} />
    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}><View style={{ flex: 1, minWidth: 160 }}><SegmentedControl label="Timetable view" value={week ? 'week' : 'day'} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }]} onChange={value => onNavigate(hrefWith(href, { view: value }))} /></View>{other ? <ControlButton title="Calendar" onPress={() => onNavigate(nativeScheduleDestination(other.href, params))} /> : null}</View>
    <Text style={{ color: colors.muted, fontSize: 14 }}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(dateValue)} · Times use {zone}.</Text>
    {days.isError ? <Empty title="Campus dates could not load" message={days.error.message} onRetry={() => void days.refetch()} /> : days.data?.results.map(day => <Notice key={day.id} tone={day.is_instructional ? 'info' : 'warning'} message={`${day.is_instructional ? 'Campus date' : 'Campus closure'} · ${day.label}${day.reason ? `\n${day.reason}` : ''}`} />)}
    {timetable.isPending ? <Loading /> : timetable.isError || !data ? <Empty title="This learner's published schedule could not load" message={timetable.error?.message ?? 'The response did not match the exact selected learner. Refresh this schedule.'} onRetry={() => void timetable.refetch()} /> : <>
      {data.day_plan?.date === date ? <Notice tone="warning" message={`Updated school day · version ${data.day_plan.version}\n${data.day_plan.notice || 'A revised schedule has been published.'}${data.day_plan.cancelled_periods ? `\n${data.day_plan.cancelled_periods} periods cancelled` : ''}`} /> : null}
      {chosenPeriod ? <Section title={chosenPeriod.display_title || chosenPeriod.subject?.name || `Period ${chosenPeriod.period_number}`}><ScreenBack title="Back to periods" fallbackHref={hrefWith(href, { period_id: '' })} /><Row title="When" detail={`${periodTime(chosenPeriod)} · ${zone}`} status={chosenPeriod.cancelled ? 'Cancelled' : 'Published'} /><Row title="Room" detail={chosenPeriod.room || 'Not assigned'} />{chosenPeriod.teacher ? <Row title="Teacher" detail={chosenPeriod.teacher.name} /> : null}{chosenPeriod.notice ? <Notice message={chosenPeriod.notice} /> : null}{chosenPeriod.materials?.length ? <Section title="Materials">{chosenPeriod.materials.map((material, index) => <Row key={`${index}:${material}`} title={material} />)}</Section> : null}</Section> : visible.length ? visible.map(day => <Section key={day.weekday} title={week ? day.weekday_label : 'Published periods'}>{day.periods.length ? day.periods.map(period => <Row key={period.id} icon="timetable" title={period.display_title || period.subject?.name || `Period ${period.period_number}`} detail={`${periodTime(period)}${period.room ? ` · ${period.room}` : ''}${period.teacher ? `\n${period.teacher.name}` : ''}${period.notice ? `\n${period.notice}` : ''}`} status={period.cancelled ? 'Cancelled' : `Period ${period.period_number}`} onPress={() => onNavigate(hrefWith(href, { period_id: period.id }))} />) : <Empty title="No published periods" />}</Section>) : <Empty title="No published periods on this date" />}
      {data.schedule_source ? <Notice message={`Published schedule revision ${data.schedule_source.revision} · ${data.schedule_source.starts_on} to ${data.schedule_source.ends_on}`} /> : null}
      <Notice message="Published plans describe expectations. They do not prove attendance or completion." />
    </>}
  </Page>;
}
function Agenda({ href, onNavigate, schoolId, selected: access, options, zone }: AgendaProps) {
  const { environment } = useSession(), { colors } = useTheme();
  const query = new URLSearchParams(href.split('#')[0]!.split('?')[1] ?? '');
  const today = zone ? dateInZone(new Date(environment.virtual_clock?.now ?? Date.now()), zone) : undefined;
  const requested = query.get('date'), date = validDate(requested) ? requested : today;
  const page = Math.max(1, Number.parseInt(query.get('calendar_page') ?? query.get('page') ?? '1', 10) || 1);
  const selectedId = query.get('occurrence_id') ?? '';
  const [linkError, setLinkError] = useState('');
  const occurrences = useApi<OccurrencePage>(date ? `/api/v1/schools/${encodeURIComponent(schoolId)}/activities/occurrences?${new URLSearchParams({ from: date, until: date, page: String(page), page_size: '25', state: 'expected' })}` : null);
  const days = useApi<{ results: CampusDay[] }>(date ? `/api/v1/calendar/days/?${new URLSearchParams({ school_id: schoolId, from: date, to: date })}` : null);
  const selected = !occurrences.isError ? occurrences.data?.items.find(item => item.id === selectedId) : undefined;
  const changeDate = (next: string) => onNavigate(hrefWith(href, { date: next, calendar_page: '', page: '', occurrence_id: '' }));
  const dateValue = date ? new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), 12) : new Date();
  const scopeQuery = () => { const result = new URLSearchParams(query); result.delete('occurrence_id'); result.delete('calendar_page'); result.delete('page'); return result; };
  const sourceHref = (target: string) => { const current = scopeQuery(), next = new URLSearchParams(target.split('?')[1] ?? ''); for (const [key, value] of current) if (!next.has(key)) next.set(key, value); return `${target.split('?')[0]}${next.size ? `?${next}` : ''}`; };
  return <Page title="Timetable" subtitle={`${access.surface.label}${date ? ` · ${new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(dateValue)}` : ''}`} refreshing={occurrences.isRefetching || days.isRefetching} onRefresh={() => { void occurrences.refetch(); void days.refetch(); }}>
    <ScheduleChoices href={href} onNavigate={onNavigate} options={options} selected={access} />
    {!date ? <Empty title="Campus time could not load" /> : <>
      <ScheduleDateNavigation date={date} today={today!} onChange={changeDate} />
      {zone ? <Text style={{ color: colors.muted, fontSize: 14 }}>Times use {zone}.</Text> : null}
      {days.isPending ? <Loading /> : days.isError ? <Empty title="Campus dates could not load" message={days.error.message} onRetry={() => void days.refetch()} /> : days.data?.results.map(day => <Notice key={day.id} tone={day.is_instructional ? 'info' : 'warning'} message={`${day.is_instructional ? 'Campus date' : 'Campus closure'} · ${day.label}${day.reason ? `\n${day.reason}` : ''}`} />)}
      {selected ? <Section title={selected.title}><ScreenBack title="Back to agenda" fallbackHref={hrefWith(href, { occurrence_id: '' })} /><Row title="When" detail={`${selected.local_date} · ${interval(selected)} · ${selected.timezone}`} /><Row title="Place" detail={selected.space_label || selected.location_label || (selected.location_kind === 'online' ? 'Online' : 'Not assigned')} /><Row title="Attendance" detail={selected.attendance_mode === 'none' ? 'Not required' : 'Participant register'} /><Section title="Scheduled people">{selected.participants.length ? selected.participants.map(person => <Row key={person.person_id} title={person.label} detail={person.attendance_expected === false ? 'Activity lead · not expected in attendance' : 'Scheduled participant'} />) : <Empty title="No scheduled people visible" />}</Section>{selected.can_open_register && selected.attendance_mode === 'roll_call' ? <Button title="Open participant register" onPress={() => onNavigate(sourceHref(`/areas/attendance/registers?${new URLSearchParams({ date: selected.local_date, occurrence_id: selected.id })}`))} /> : null}{selected.teaching_session_href ? <Button title="Open teaching session" kind="secondary" onPress={() => onNavigate(sourceHref(selected.teaching_session_href!))} /> : null}{selected.source_href ? <Button title={selected.source === 'event' ? 'Open event' : selected.source === 'examination' ? 'Open examination' : 'Open source details'} kind="secondary" onPress={() => onNavigate(sourceHref(selected.source_href!))} /> : null}{selected.location_url ? <Button title="Open joining link" kind="secondary" onPress={() => { setLinkError(''); try { const url = new URL(selected.location_url!); if (!['https:', 'http:'].includes(url.protocol)) throw new Error('The joining link is not a supported web address.'); void Linking.openURL(url.toString()).catch(() => setLinkError('The joining link could not be opened.')); } catch (cause) { setLinkError(cause instanceof Error ? cause.message : 'The joining link is invalid.'); } }} /> : null}{linkError ? <Notice tone="danger" message={linkError} /> : null}<Notice message="Published plans describe expectations. They do not prove attendance or completion." /></Section> : <Section title="Activities starting today">{occurrences.isPending ? <Loading /> : occurrences.isError ? <Empty title="Activities could not load" message={occurrences.error.message} onRetry={() => void occurrences.refetch()} /> : !occurrences.data?.items.length ? <Empty title="No published activities on this date" message={page > 1 ? 'Return to the first page or choose another date.' : 'Your agenda shows activities within your current scope.'} /> : occurrences.data.items.map(item => <Row key={item.id} icon="timetable" title={item.title} detail={`${interval(item)} · ${item.purpose.replaceAll('_', ' ')}${item.space_label || item.location_label ? `\n${item.space_label || item.location_label}` : ''}`} onPress={() => onNavigate(hrefWith(href, { occurrence_id: item.id }))} />)}{(occurrences.data?.total_pages ?? 1) > 1 || page > 1 ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Button title="Previous activities" kind="secondary" disabled={page <= 1} onPress={() => onNavigate(hrefWith(href, { calendar_page: String(page - 1) }))} /><Button title={`Page ${page} of ${occurrences.data?.total_pages ?? '…'}`} kind="secondary" disabled onPress={() => {}} /><Button title="Next activities" kind="secondary" disabled={page >= (occurrences.data?.total_pages ?? 1)} onPress={() => onNavigate(hrefWith(href, { calendar_page: String(page + 1) }))} /></View> : null}</Section>}
    </>}
  </Page>;
}
