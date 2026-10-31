import { createElement, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MotionModal as Modal } from '../ui/Motion';
import DateTimePicker from '@react-native-community/datetimepicker';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { InfoIcon } from 'phosphor-react-native/src/icons/Info';
import { ClockIcon } from 'phosphor-react-native/src/icons/Clock';
import { CalendarBlankIcon } from 'phosphor-react-native/src/icons/CalendarBlank';
import type { WorkspaceEntry, WorkspaceManifest, WorkspaceView, WorkspaceWorkItem } from '../../../packages/contracts/src/workspace';
import { assertWorkspaceManifestContext, normalizeWorkspaceManifest } from '../../../packages/contracts/src/workspace-normalizer';
import { useSession } from '../auth/SessionProvider';
import { useApi } from '../lib/query';
import { Button, Empty, LinkButton, ListGroup, Loading, Notice, Page, Row, SearchField, usePageScroll } from '../ui/components';
import { ControlButton } from '../ui/DomainControls';
import { ScreenBack } from '../ui/BackNavigation';
import { workspaceWorkRecovery } from '../lib/workspace-work-recovery';
import { attendanceWorkDestination } from '../lib/attendance-work-destination';
import { Icon, iconForDestination } from '../ui/Icon';
import { useTheme } from '../ui/theme';
import { themeRadii } from '../ui/theme-tokens';

interface WorkspaceScreenProps {
  view: WorkspaceView;
  onNavigate: (href: string) => void;
  selectedWorkId?: string | null;
}

type Navigate = WorkspaceScreenProps['onNavigate'];
const titles: Record<WorkspaceView, string> = { today: 'Today', work: 'Work', areas: 'Areas', more: 'More' };
const todaySubtitle = 'Your campus day, together.';

/** A workspace is visible only after matching all three server-confirmed scopes. */
export function WorkspaceScreen({ view, onNavigate, selectedWorkId }: WorkspaceScreenProps) {
  const { user, schoolId, environment, scopeKey } = useSession();
  const query = useApi<unknown>(user && schoolId ? '/api/v1/workspace' : null);
  const resolved = useMemo(() => {
    if (!query.data) return { manifest: null, error: null };
    try {
      const manifest = normalizeWorkspaceManifest(query.data);
      if (!user?.id || !schoolId || !environment) throw new Error('Confirm your account and campus before opening this workspace.');
      assertWorkspaceManifestContext(manifest, { actorUserId: user.id, institutionId: schoolId, environment });
      return { manifest, error: null };
    } catch (error) {
      return { manifest: null, error: error instanceof Error ? error.message : 'The workspace response could not be verified.' };
    }
  }, [environment, query.data, schoolId, user?.id]);
  const refresh = () => { void query.refetch(); };
  const page = (children: ReactNode) => <Page title={titles[view]} subtitle={view === 'today' ? todaySubtitle : undefined} refreshing={query.isRefetching} onRefresh={refresh}>{children}</Page>;

  if (!user || !schoolId) return page(<Empty title="Choose a campus" message="Your workspace becomes available after an active campus relationship is selected." />);
  if (environment?.mode === 'simulation' && environment.unavailable) return page(<Empty title="Simulation is unavailable" message="Your selected world could not be confirmed. Open Simulation to recover it or return to Live." onRetry={refresh} />);
  if (query.isPending) return page(<Loading />);
  if (query.error || resolved.error || !resolved.manifest) return page(<Empty title="Your workspace could not be opened" message={resolved.error ?? (query.error instanceof Error ? query.error.message : 'Refresh to confirm your current workspace.')} onRetry={refresh} />);
  const manifest = resolved.manifest;
  return <Page title={titles[view]} refreshing={query.isRefetching} onRefresh={refresh}>
    <WorkspaceBody key={`${scopeKey}:${view}`} view={view} manifest={manifest} onNavigate={onNavigate} selectedWorkId={selectedWorkId} />
  </Page>;
}

function WorkspaceBody({ view, manifest, onNavigate: navigate, selectedWorkId }: WorkspaceScreenProps & { manifest: WorkspaceManifest }) {
  const { colors } = useTheme();
  const onNavigate = (href: string) => navigate(attendanceWorkDestination(manifest, href));
  const [wideContext, setWideContext] = useState(false);
  const freshness = manifest.freshness.state === 'unknown' ? 'Freshness is not available'
    : `${manifest.freshness.state === 'current' ? 'Current as of' : manifest.freshness.state === 'refreshing' ? 'Updating from' : 'Last confirmed'} ${manifest.freshness.as_of}`;
  return <View onLayout={event => setWideContext(event.nativeEvent.layout.width >= 768)} style={[styles.workspace, { gap: view === 'today' ? wideContext ? 32 : 28 : view === 'work' ? 24 : 32 }]}>
    {view === 'today' ? <View style={[styles.contextBar, { flexDirection: wideContext ? 'row' : 'column', alignItems: wideContext ? 'center' : 'flex-start' }]}>
      <Text style={[styles.dateLabel, styles.contextScope, { color: colors.ink }]}>{manifest.context.date_label ?? todaySubtitle}</Text>
      <View style={styles.freshnessRow}><ClockIcon size={13} color={colors.muted} /><Text style={[styles.freshness, { color: colors.muted }]}>{freshness}</Text></View>
    </View> : null}
    {manifest.context.scope_label ? <Text style={[styles.context, { color: colors.muted }]}>{manifest.context.scope_label}</Text> : null}
    {view === 'today' ? <Today manifest={manifest} onNavigate={onNavigate} /> : null}
    {view === 'work' ? <Work manifest={manifest} onNavigate={onNavigate} wide={wideContext} selectedWorkId={selectedWorkId} /> : null}
    {view === 'areas' ? <Areas manifest={manifest} onNavigate={onNavigate} /> : null}
    {view === 'more' ? <More manifest={manifest} onNavigate={onNavigate} /> : null}
  </View>;
}

/** Workspace rhythm follows its web view without changing other native domains. */
function WorkspaceSection({ title, action, count, directory = false, compact = false, children }: { title: string; action?: { title: string; onPress: () => void }; count?: string; directory?: boolean; compact?: boolean; children: ReactNode }) {
  const { colors } = useTheme();
  return <View style={styles.section}><View style={[styles.sectionHeader, !directory && !compact && styles.todaySectionHeader]}><Text accessibilityRole="header" aria-level={2} style={[styles.sectionTitle, { color: colors.ink }]}>{title}</Text>{count ? <Text accessibilityLiveRegion="polite" style={[styles.sectionCount, directory && styles.directoryTotal, { color: colors.muted }]}>{count}</Text> : null}{action ? <LinkButton title={action.title} onPress={action.onPress} /> : null}</View>{children}</View>;
}

function entryTiming(entry: WorkspaceEntry, timeZone: string) {
  if (!entry.starts_at || !Number.isFinite(Date.parse(entry.starts_at))) return null;
  try {
    const time = new Intl.DateTimeFormat('en-IN', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true });
    const date = new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', year: 'numeric' });
    const start = new Date(entry.starts_at);
    const end = entry.ends_at && Number.isFinite(Date.parse(entry.ends_at)) ? new Date(entry.ends_at) : null;
    const endDate = end && date.format(start) !== date.format(end) ? date.format(end) : null;
    const range = end && !endDate && typeof time.formatRange === 'function' ? time.formatRange(start, end) : `${time.format(start)}${end ? `–${time.format(end)}` : ''}`;
    const label = `${range}${endDate ? ` · ends ${endDate}` : ''}`;
    return { date: date.format(start), time: label, label: `${date.format(start)} · ${label}` };
  } catch { return null; }
}

function Entry({ entry, timeZone, onNavigate, separator = false }: { entry: WorkspaceEntry; timeZone: string; onNavigate: Navigate; separator?: boolean }) {
  const { colors } = useTheme(), timing = entryTiming(entry, timeZone);
  const status = entry.status_label && !['Now', 'Next'].includes(entry.status_label) ? entry.status_label : undefined;
  const content = <>
    {timing ? <Text style={[styles.agendaDate, { color: colors.muted, borderColor: colors.border }]}>{timing.date}</Text> : null}
    <View style={styles.entryBody}>
      {timing?.time || entry.time_label ? <Text style={[styles.agendaTime, { color: colors.muted }]}>{timing?.time ?? entry.time_label}</Text> : null}
      <Text style={[styles.rowTitle, { color: colors.ink }]}>{entry.title}</Text>
      {entry.detail ? <Text style={[styles.body, { color: colors.muted }]}>{entry.detail}</Text> : null}
      {status ? <Text style={[styles.body, { color: entry.tone === 'critical' ? colors.danger : entry.tone === 'attention' ? colors.warning : colors.muted }]}>{status}</Text> : null}
    </View>
    {entry.href ? <Icon name="arrow" size={18} muted /> : null}
  </>;
  const rowStyle = [styles.agendaEntry, { borderTopWidth: separator ? StyleSheet.hairlineWidth : 0, borderColor: colors.border }];
  return entry.href ? <Pressable accessibilityRole="button" accessibilityLabel={[entry.title, timing?.label ?? entry.time_label, entry.detail, status, entry.action_label].filter(Boolean).join(', ')} onPress={() => onNavigate(entry.href!)} style={({ pressed }) => [...rowStyle, { opacity: pressed ? 0.7 : 1 }]}>{content}</Pressable> : <View style={rowStyle}>{content}</View>;
}

function Today({ manifest, onNavigate }: { manifest: WorkspaceManifest; onNavigate: Navigate }) {
  const { colors } = useTheme();
  const [moreUpcoming, setMoreUpcoming] = useState(false);
  const [automaticOpen, setAutomaticOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const { today } = manifest;
  const needsMe = manifest.work.items.filter(item => item.direction !== 'waiting');
  const current = today.now[0];
  const calendar = manifest.areas.find(area => area.key === 'calendar');
  const timezone = manifest.context.time_zone ?? 'UTC';
  const completed = today.completed_automatically ?? [];
  const needsCount = manifest.work.counts?.needs_me ?? needsMe.length;
  const currentTime = current?.time_label;
  const hasContent = today.now.length || today.next.length || needsMe.length || today.attention.total;
  return <>
    {manifest.work.coverage === 'partial' ? <Notice tone="warning" message="Some work could not be included. Check Work and the owning areas before treating this view as complete." /> : null}
    {!hasContent && manifest.work.coverage !== 'partial' ? <Empty title="Your day has room" message="Your available schedule and work will appear here when they become current." /> : null}
    {current ? <WorkspaceSection title="Now">
      <View style={[styles.current, { backgroundColor: colors.row, borderColor: colors.border }]}>
        <View style={styles.currentContext}><View style={[styles.currentBadge, { backgroundColor: colors.logoGreenSoft }]}><Icon name="today" size={30} /></View>{currentTime ? <Text style={[styles.currentTime, { color: colors.muted }]}>{currentTime}</Text> : null}</View>
        <Text accessibilityRole="header" style={[styles.currentTitle, { color: colors.ink }]}>{current.title}</Text>
        {current.detail ? <Text style={[styles.body, { color: colors.muted }]}>{current.detail}</Text> : null}
        {current.href ? <Pressable accessibilityRole="button" onPress={() => onNavigate(current.href!)} style={({ pressed }) => [styles.primaryAction, { backgroundColor: colors.action, opacity: pressed ? .75 : 1 }]}><Text style={[styles.primaryActionText, { color: colors.onAction }]}>{current.action_label ?? 'View activity'}</Text><Icon name="arrow" size={18} color={colors.onAction} /></Pressable> : null}
        {current.source_label ? <View style={styles.currentEvidence}><Pressable accessibilityRole="button" accessibilityState={{ expanded: sourceOpen }} onPress={() => setSourceOpen(!sourceOpen)} style={styles.sourceToggle}><InfoIcon size={16} color={colors.muted} /><Text style={[styles.source, styles.sourceToggleLabel, { color: colors.muted }]}>Schedule details</Text></Pressable>{sourceOpen ? <Text style={[styles.source, { color: colors.muted }]}>{current.source_label}{current.source_at ? ` · ${current.source_at}` : ''}</Text> : null}</View> : null}
      </View>
      {today.now.length > 1 ? <View>{today.now.slice(1).map((entry, index) => <Entry key={entry.id} entry={entry} timeZone={timezone} separator={index > 0} onNavigate={onNavigate} />)}</View> : null}
    </WorkspaceSection> : null}
    {needsMe.length || today.attention.total ? <WorkspaceSection title="Needs attention" action={{ title: 'All work', onPress: () => onNavigate('/work') }}>
      {today.attention.overdue || today.attention.due_soon ? <Text style={[styles.attentionSummary, { color: colors.muted }]}>{[today.attention.overdue ? `${today.attention.overdue} overdue` : null, today.attention.due_soon ? `${today.attention.due_soon} due soon` : null].filter(Boolean).join(' · ')}</Text> : null}
      <View style={[styles.attentionGroup, { backgroundColor: colors.row, borderColor: colors.border }]}>{needsMe.length ? needsMe.slice(0, 2).map((item, index) => <WorkRow key={item.id} item={item} preview separator={index > 0} onNavigate={onNavigate} />) : <View style={styles.groupFallback}><Row variant="plain" title={`${today.attention.total} ${today.attention.total === 1 ? 'item needs' : 'items need'} your attention`} detail="Review your available requests, tasks and offers." icon="work" onPress={() => onNavigate('/work')} /></View>}</View>
      {needsCount > 2 ? <View style={styles.trailingLink}><LinkButton title={`${needsCount - Math.min(needsMe.length, 2)} more needing you`} onPress={() => onNavigate('/work')} /></View> : null}
    </WorkspaceSection> : null}
    {today.next.length ? <WorkspaceSection title="Next" action={calendar ? { title: 'Calendar', onPress: () => onNavigate(calendar.href) } : undefined}>
      <View>{(moreUpcoming ? today.next : today.next.slice(0, 3)).map((entry, index) => <Entry key={entry.id} entry={entry} separator={index > 0} timeZone={timezone} onNavigate={onNavigate} />)}</View>
      {today.next.length > 3 ? <LinkButton title={moreUpcoming ? 'Show less' : `More upcoming · ${today.next.length - 3}`} expanded={moreUpcoming} onPress={() => setMoreUpcoming(!moreUpcoming)} /> : null}
    </WorkspaceSection> : null}
    {completed.length ? <View style={[styles.automatic, { borderColor: colors.border }]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: automaticOpen }} onPress={() => setAutomaticOpen(!automaticOpen)} style={styles.automaticSummary}><Text style={[styles.automaticTitle, { color: colors.ink }]}>Completed automatically</Text><Text style={[styles.sectionCount, { color: colors.muted }]}>{completed.length}</Text><View style={{ transform: [{ rotate: automaticOpen ? '-90deg' : '90deg' }] }}><Icon name="chevron" size={17} muted /></View></Pressable>
      {automaticOpen ? <View style={styles.automaticBody}>{completed.map((entry, index) => <Entry key={entry.id} entry={entry} separator={index > 0} timeZone={timezone} onNavigate={onNavigate} />)}</View> : null}
    </View> : null}
  </>;
}

function Choice<T extends string>({ label, options, value, onChange }: { label: string; options: readonly { value: T; label: string; count: number }[]; value: T; onChange: (value: T) => void }) {
  const { colors } = useTheme();
  return <View style={[styles.segments, { backgroundColor: colors.row }]} accessibilityLabel={label}>
    {options.map(option => <Pressable key={option.value} accessibilityRole="button" accessibilityLabel={`${option.label}, ${option.count} items`} accessibilityState={{ selected: value === option.value }} onPress={() => onChange(option.value)} style={({ pressed }) => [styles.choice, styles.segment, { backgroundColor: value === option.value ? colors.surface : 'transparent', opacity: pressed ? 0.75 : 1 }]}>
      <Text style={[styles.choiceText, { color: value === option.value ? colors.link : colors.muted }]}>{option.label}</Text>
      <Text style={[styles.segmentCount, { backgroundColor: colors.surfaceSoft, color: colors.muted }]}>{option.count}</Text>
    </Pressable>)}
  </View>;
}

function WorkRow({ item, onNavigate, separator = false, preview = false }: { item: WorkspaceWorkItem; onNavigate: Navigate; separator?: boolean; preview?: boolean }) {
  const { colors } = useTheme();
  const [wide, setWide] = useState(false);
  const kind = item.kind === 'request' ? 'Request' : item.kind === 'offer' ? 'Offer' : 'Task';
  const metadata = [...new Set([item.status_label, item.due_label].filter(Boolean))];
  const owner = item.direction === 'waiting' && item.state !== 'waiting_for_review' && item.owner ? `Sent to ${item.owner.label}` : null;
  const tone = item.urgency === 'overdue' || item.urgency === 'critical' ? colors.danger : item.urgency === 'due_soon' ? colors.warning : colors.muted;
  const action = <View style={styles.workAction}><Text style={[styles.actionText, { color: colors.link }]}>{item.action_label}</Text><Icon name="arrow" size={16} /></View>;
  return <Pressable onLayout={event => setWide(event.nativeEvent.layout.width > 600)} accessibilityRole="button" accessibilityLabel={[kind, ...metadata, item.title, item.detail, owner, item.source_label, item.action_label].filter(Boolean).join(', ')} onPress={() => onNavigate(item.href)} style={({ pressed }) => [styles.workRow, { borderTopWidth: separator ? StyleSheet.hairlineWidth : 0, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}>
    <View style={[styles.workIcon, wide && styles.workIconWide]}><Icon name={iconForDestination(item.href, item.kind === 'request' ? 'request' : item.kind === 'offer' ? 'offer' : 'task')} destination={item.href} size={28} /></View>
    <View style={styles.workBody}>
      <View style={styles.workMetadata}><Text style={[styles.metadata, styles.workKind, { color: preview && item.urgency === 'normal' ? colors.link : tone }]}>{kind}</Text>{metadata.map(label => <Text key={label} style={[styles.metadata, { color: tone }]}>{label}</Text>)}</View>
      <Text style={[styles.rowTitle, { color: colors.ink }]}>{item.title}</Text>
      {item.detail ? <Text style={[styles.body, { color: colors.muted }]}>{item.detail}</Text> : null}
      {owner ? <Text style={[styles.body, { color: colors.muted }]}>{owner}</Text> : null}
      {item.source_label ? <Text style={[styles.source, { color: colors.muted }]}>{item.source_label}{item.source_at ? ` · ${item.source_at}` : ''}</Text> : null}
      {!wide ? action : null}
    </View>
    {wide ? <View style={styles.workDesktopAction}>{action}</View> : null}
  </Pressable>;
}

function calendarDay(date: Date, formatter: Intl.DateTimeFormat) {
  const parts = formatter.formatToParts(date);
  return ['year', 'month', 'day'].map(key => parts.find(part => part.type === key)?.value ?? '').join('-');
}

/** The picker carries a civil date in UTC; record instants use the campus zone. */
function AddedOnPicker({ value, initialDay, open, onClose, onChange }: { value: string; initialDay: string; open: boolean; onClose: () => void; onChange: (value: string) => void }) {
  const { colors, dark } = useTheme();
  const [draft, setDraft] = useState(initialDay);
  useEffect(() => { if (open) setDraft(value || initialDay); }, [initialDay, open, value]);
  if (Platform.OS === 'web') return open ? <View style={{ gap: 8 }}><Text style={{ color: colors.muted, fontSize: 14 }}>Added on</Text>{createElement('input', { type: 'date', value: draft, 'aria-label': 'Added on', onChange: (event: { target: { value: string } }) => { const day = event.target.value; if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day + 'T12:00:00Z')) && new Date(day + 'T12:00:00Z').toISOString().slice(0, 10) === day) setDraft(day); }, style: { minHeight: 44, fontSize: 16, padding: 8, border: `1px solid ${colors.border}`, borderRadius: 16, backgroundColor: colors.surface, color: colors.ink, colorScheme: dark ? 'dark' : 'light' } })}<View style={{ flexDirection: 'row', gap: 8 }}><ControlButton title="Cancel" onPress={onClose} /><ControlButton title="Apply date" kind="primary" onPress={() => { onChange(draft); onClose(); }} /></View></View> : null;
  const date = new Date(`${draft}T12:00:00Z`);
  const picker = <DateTimePicker accessibilityLabel="Added on" value={date} mode="date" timeZoneName="UTC" display={Platform.OS === 'ios' ? 'inline' : 'default'} themeVariant={dark ? 'dark' : 'light'} accentColor={colors.link} onValueChange={(_event, next) => { const day = next.toISOString().slice(0, 10); setDraft(day); if (Platform.OS !== 'ios') { onChange(day); onClose(); } }} onDismiss={onClose} />;
  if (Platform.OS !== 'ios') return open ? picker : null;
  return <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}><SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}><ScrollView contentContainerStyle={styles.dateSheet} keyboardShouldPersistTaps="handled"><View style={styles.dateSheetHeader}><Text accessibilityRole="header" aria-level={2} style={[styles.sectionTitle, { color: colors.ink }]}>Added on</Text><ControlButton title="Cancel" onPress={onClose} /></View>{picker}<ControlButton title="Apply date" kind="primary" onPress={() => { onChange(draft); onClose(); }} /></ScrollView></SafeAreaView></SafeAreaProvider></Modal>;
}

function Work({ manifest, onNavigate, wide, selectedWorkId }: { manifest: WorkspaceManifest; onNavigate: Navigate; wide: boolean; selectedWorkId?: string | null }) {
  const { colors } = useTheme();
  const scrollToTop = usePageScroll();
  const [direction, setDirection] = useState<'needs_me' | 'waiting'>('needs_me');
  const [search, setSearch] = useState('');
  const [date, setDate] = useState('');
  const [page, setPage] = useState(1);
  const [dateOpen, setDateOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const timeZone = manifest.context.time_zone ?? 'UTC';
  const dayFormatter = useMemo(() => { try { return new Intl.DateTimeFormat('en-CA', { timeZone, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit' }); } catch { return null; } }, [timeZone]);
  const sourceNow = manifest.context.environment.kind === 'simulation' ? new Date(manifest.context.environment.virtual_now) : new Date();
  const initialDay = dayFormatter && Number.isFinite(sourceNow.getTime()) ? calendarDay(sourceNow, dayFormatter) : '';
  const needsMe = manifest.work.items.filter(item => item.direction !== 'waiting');
  const waiting = manifest.work.items.filter(item => item.direction === 'waiting');
  const query = search.trim().toLocaleLowerCase();
  const filtered = (direction === 'waiting' ? waiting : needsMe).filter(item => (!date || Boolean(dayFormatter && item.created_at && Number.isFinite(Date.parse(item.created_at)) && calendarDay(new Date(item.created_at), dayFormatter) === date))
    && `${item.title} ${item.detail ?? ''} ${item.status_label ?? ''} ${item.owner?.label ?? ''} ${item.source_label ?? ''}`.toLocaleLowerCase().includes(query));
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  const activePage = Math.min(page, pages);
  const items = filtered.slice((activePage - 1) * 10, activePage * 10);
  const partial = manifest.work.coverage === 'partial';
  const recovery = workspaceWorkRecovery(manifest.work.items, selectedWorkId);
  useEffect(() => { if (selectedWorkId) scrollToTop(); }, [scrollToTop, selectedWorkId]);
  const hasFilters = Boolean(query || date);
  const clearFilters = () => { setSearch(''); setDate(''); setPage(1); };
  const changePage = (next: number) => { setPage(next); scrollToTop(); };
  const resultLabel = pages > 1 ? `${(activePage - 1) * 10 + 1}–${(activePage - 1) * 10 + items.length} of ${filtered.length}` : `${filtered.length} ${filtered.length === 1 ? 'item' : 'items'}`;
  return <>
    <View style={styles.workControls}>
      <View style={[styles.controlColumns, wide && styles.controlColumnsWide]}>
        <View style={wide ? styles.controlColumn : undefined}><Choice label="Work views" value={direction} options={[{ value: 'needs_me', label: 'Needs me', count: manifest.work.counts?.needs_me ?? needsMe.length }, { value: 'waiting', label: 'Waiting', count: manifest.work.counts?.waiting ?? waiting.length }]} onChange={value => { setDirection(value); setPage(1); }} /></View>
        {manifest.work.items.length ? <View style={[styles.tools, wide && styles.controlColumn]}>
          <View style={styles.search}><SearchField variant="outlined" label={`Search ${direction === 'waiting' ? 'waiting work' : 'work needing you'}`} value={search} onChangeText={(value: string) => { setSearch(value.slice(0, 120)); setPage(1); }} placeholder="Find work" /></View>
          <Pressable accessibilityRole="button" accessibilityLabel={date ? `Date filter set to ${date}` : 'Filter by added date'} accessibilityState={{ expanded: dateOpen }} onPress={() => setDateOpen(!dateOpen)} style={({ pressed }) => [styles.dateButton, { borderColor: colors.border, backgroundColor: date ? colors.positiveSoft : colors.surface, opacity: pressed ? .7 : 1 }]}><CalendarBlankIcon size={18} color={date ? colors.link : colors.muted} /><Text style={[styles.dateButtonText, { color: date ? colors.link : colors.muted }]}>{date ? 'Date set' : 'Date'}</Text></Pressable>
        </View> : null}
      </View>
      {dateOpen ? <View style={[styles.dateFilter, wide && styles.dateFilterWide]}><Text style={[styles.source, { color: colors.muted }]}>Added on</Text>{initialDay ? <ControlButton title={date || 'Choose date'} onPress={() => setPickerOpen(true)} /> : <Text style={[styles.source, { color: colors.muted }]}>The campus date could not be confirmed.</Text>}{date ? <ControlButton title="Clear date" onPress={() => { setDate(''); setPage(1); }} /> : null}</View> : null}
    </View>
    {initialDay ? <AddedOnPicker value={date} initialDay={initialDay} open={pickerOpen} onClose={() => setPickerOpen(false)} onChange={value => { setDate(value); setPage(1); }} /> : null}
    {partial ? <Notice tone="warning" message="Some work could not be included. Check the owning areas before treating this queue as complete." /> : null}
    {recovery ? <View role="status" accessibilityLabel="Work item recovery" accessibilityLiveRegion="polite" style={styles.recovery}>
      <Text accessibilityRole="header" style={[styles.recoveryTitle, { color: colors.ink }]}>{recovery.title}</Text>
      <Text style={[styles.body, { color: colors.muted }]}>{recovery.explanation}</Text>
      {recovery.status ? <Text style={[styles.body, { color: colors.muted }]}>{recovery.status}</Text> : null}
      <ScreenBack title="Back to Work" fallbackHref="/work" />
    </View> : null}
    {items.length ? <WorkspaceSection compact title={direction === 'waiting' ? 'Waiting on others' : 'Open work'} count={`${resultLabel}${partial ? ' available' : ''}`}>
      <ListGroup>{items.map((item, index) => <WorkRow key={item.id} item={item} separator={index > 0} onNavigate={onNavigate} />)}</ListGroup>
    </WorkspaceSection> : <Empty title={hasFilters ? 'No matching work' : partial ? 'No work could be shown' : direction === 'waiting' ? 'No tracked requests are waiting' : 'Nothing needs you right now'} message={hasFilters ? 'Try another search or added date.' : partial ? 'Check the owning areas while part of this queue is unavailable.' : direction === 'waiting' ? 'Submitted work appears here while someone else needs to respond.' : 'You can follow your requests in Waiting.'} />}
    {hasFilters ? <LinkButton title="Clear filters" onPress={clearFilters} /> : null}
    {pages > 1 ? <View style={styles.pagination}>
      <LinkButton title="Previous" disabled={activePage === 1} onPress={() => changePage(activePage - 1)} />
      <Text style={[styles.pageNumber, { color: colors.muted }]}>Page {activePage} of {pages}</Text>
      <LinkButton title="Next" disabled={activePage === pages} onPress={() => changePage(activePage + 1)} />
    </View> : null}
  </>;
}

function DirectoryRow({ title, detail, icon, iconDestination, count, separator, onPress }: { title: string; detail?: string | null; icon: string; iconDestination?: string; count?: number; separator?: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={[`Open ${title}`, detail, count ? `${count} items need attention` : null].filter(Boolean).join(', ')} onPress={onPress} style={({ pressed }) => [styles.directoryRow, { borderTopWidth: separator ? StyleSheet.hairlineWidth : 0, borderColor: colors.border, opacity: pressed ? .7 : 1 }]}><View style={styles.directoryIcon}><Icon name={icon} size={30} destination={iconDestination} /></View><View style={styles.directoryBody}><Text style={[styles.rowTitle, { color: colors.ink }]}>{title}</Text>{detail ? <Text style={[styles.body, { color: colors.muted }]}>{detail}</Text> : null}</View>{count ? <Text style={[styles.attentionCount, { color: colors.warning, backgroundColor: colors.warningSoft }]}>{count}</Text> : null}<Icon name="arrow" size={17} muted /></Pressable>;
}

function Areas({ manifest, onNavigate }: { manifest: WorkspaceManifest; onNavigate: Navigate }) {
  return manifest.areas.length ? <WorkspaceSection directory title="Available to you" count={`${manifest.areas.length} ${manifest.areas.length === 1 ? 'area' : 'areas'}`}>
    <View>
      {manifest.areas.map((area, index) => <DirectoryRow key={area.key} separator={index > 0} title={area.label} detail={area.description} count={area.attention_count} icon={iconForDestination(area.href, area.icon ?? area.key)} iconDestination={area.href} onPress={() => onNavigate(area.href)} />)}
    </View>
  </WorkspaceSection> : <Empty title="No work areas are active" message="Your available areas will appear when a responsibility or capability is assigned." />;
}

function More({ manifest, onNavigate }: { manifest: WorkspaceManifest; onNavigate: Navigate }) {
  const { colors } = useTheme();
  const [search, setSearch] = useState('');
  const groups = manifest.more.groups?.length ? manifest.more.groups : [
    ...(manifest.more.setup.length ? [{ key: 'setup', label: 'Campus setup', items: manifest.more.setup }] : []),
    ...(manifest.more.other?.length ? [{ key: 'other', label: 'Other tools', items: manifest.more.other }] : []),
  ];
  const query = search.trim().toLocaleLowerCase();
  const filtered = groups.map(group => ({ ...group, items: group.items.filter(item => `${group.label} ${item.label} ${item.description ?? ''}`.toLocaleLowerCase().includes(query)) })).filter(group => group.items.length);
  return <>
    {groups.length ? <SearchField variant="pill" label="Search account, setup and tools" value={search} onChangeText={setSearch} placeholder="Search account, setup and tools" /> : <Empty title="No additional tools" message="Setup and lower-frequency tools will appear here when they are available to you." />}
    {groups.length && !filtered.length ? <Empty title="No matching tools" message="Try another name, or clear the search to see everything available to you." /> : null}
    {filtered.map(group => <WorkspaceSection directory key={group.key} title={group.label}>
      <View>{group.items.map((item, index) => <DirectoryRow key={item.key} separator={index > 0} title={item.label} detail={item.description} icon={iconForDestination(item.href, item.icon ?? item.key)} iconDestination={item.href} onPress={() => onNavigate(item.href)} />)}</View>
    </WorkspaceSection>)}
    {groups.length ? <View style={styles.contextNote}><ClockIcon size={14} color={colors.muted} /><Text style={[styles.contextNoteText, { color: colors.muted }]}>Available tools update with your current responsibilities.</Text></View> : null}
  </>;
}

const styles = StyleSheet.create({
  workspace: { paddingTop: 12, paddingBottom: 24 },
  section: { gap: 12 },
  sectionHeader: { minHeight: 28, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, rowGap: 4 },
  todaySectionHeader: { minHeight: 44 },
  sectionTitle: { flexGrow: 1, flexShrink: 1, fontSize: 20, lineHeight: 26, fontWeight: '700', letterSpacing: -.5 },
  sectionCount: { fontSize: 12, lineHeight: 18 },
  directoryTotal: { fontSize: 11, fontWeight: '600' },
  contextBar: { minHeight: 44, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 16, rowGap: 4 },
  contextScope: { flexGrow: 1, flexShrink: 1 },
  context: { fontSize: 14, lineHeight: 20 },
  dateLabel: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  freshness: { flexShrink: 1, fontSize: 12, lineHeight: 18 },
  freshnessRow: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' },
  body: { fontSize: 14, lineHeight: 21 },
  rowTitle: { fontSize: 16, lineHeight: 23, fontWeight: '600' },
  metadata: { fontSize: 12, lineHeight: 18, fontWeight: '500' },
  source: { fontSize: 12, lineHeight: 18 },
  current: { borderRadius: themeRadii.radiusCard, borderWidth: 1, padding: 20 },
  currentContext: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  currentBadge: { width: 40, height: 40, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  currentTitle: { marginTop: 12, marginBottom: 6, fontSize: 22, lineHeight: 29, fontWeight: '600', letterSpacing: -.55 },
  currentTime: { flex: 1, fontSize: 14, lineHeight: 21 },
  primaryAction: { minHeight: 48, alignSelf: 'flex-start', maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16, borderRadius: themeRadii.radiusControl, paddingVertical: 12, paddingHorizontal: 16 },
  primaryActionText: { flexShrink: 1, fontSize: 15, lineHeight: 22, fontWeight: '600' },
  currentEvidence: { marginTop: 12 },
  sourceToggle: { minHeight: 44, alignSelf: 'flex-start', maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 8 },
  sourceToggleLabel: { flexShrink: 1, textDecorationLine: 'underline' },
  trailingLink: { alignItems: 'flex-end' },
  attentionSummary: { fontSize: 14, lineHeight: 21, marginTop: -4 },
  attentionGroup: { borderWidth: 1, borderRadius: themeRadii.radiusRow, overflow: 'hidden' },
  automatic: { borderWidth: 1, borderRadius: themeRadii.radiusCard, overflow: 'hidden' },
  automaticSummary: { minHeight: 52, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  automaticTitle: { flex: 1, fontSize: 13, lineHeight: 20, fontWeight: '700' },
  automaticBody: { paddingHorizontal: 14 },
  agendaEntry: { minHeight: 80, flexDirection: 'row', alignItems: 'center', paddingVertical: 16, gap: 12 },
  agendaDate: { width: 76, flexShrink: 0, paddingRight: 12, borderRightWidth: StyleSheet.hairlineWidth, fontSize: 13, lineHeight: 20 },
  agendaTime: { fontSize: 13, lineHeight: 20, fontWeight: '600' },
  entryBody: { flex: 1, minWidth: 0, gap: 4 },
  workRow: { minHeight: 96, flexDirection: 'row', alignItems: 'flex-start', padding: 16, gap: 12 },
  groupFallback: { paddingHorizontal: 16 },
  workIcon: { width: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' },
  workIconWide: { width: 36 },
  workBody: { flex: 1, minWidth: 0, gap: 4 },
  workMetadata: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: 4 },
  workKind: { fontWeight: '700' },
  workAction: { minHeight: 24, marginTop: 4, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '100%' },
  workDesktopAction: { maxWidth: '35%', alignSelf: 'center' },
  actionText: { flexShrink: 1, fontSize: 14, lineHeight: 21, fontWeight: '600' },
  segments: { flexDirection: 'row', padding: 4, gap: 4, borderRadius: themeRadii.radiusControl },
  choice: { minHeight: 48, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'center' },
  segment: { flex: 1, minWidth: 0 },
  choiceText: { flexShrink: 1, fontSize: 15, lineHeight: 22, fontWeight: '600', textAlign: 'center' },
  segmentCount: { minWidth: 24, paddingVertical: 2, paddingHorizontal: 6, borderRadius: 12, textAlign: 'center', fontSize: 12, lineHeight: 18 },
  workControls: { gap: 12 },
  controlColumns: { gap: 12 },
  controlColumnsWide: { flexDirection: 'row', gap: 24, alignItems: 'flex-start' },
  controlColumn: { flex: 1, minWidth: 0 },
  tools: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  search: { flex: 1, minWidth: 0 },
  dateButton: { minHeight: 48, borderWidth: 1, borderRadius: themeRadii.radiusControl, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  dateButtonText: { fontSize: 14, lineHeight: 21, flexShrink: 1 },
  dateFilter: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  dateFilterWide: { alignSelf: 'flex-end', width: '48%' },
  dateSheet: { flexGrow: 1, padding: 20, gap: 20 },
  dateSheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  directoryRow: { minHeight: 84, paddingVertical: 18, flexDirection: 'row', alignItems: 'center', gap: 10 },
  directoryIcon: { width: 42, minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  directoryBody: { flex: 1, minWidth: 0, gap: 3 },
  attentionCount: { minWidth: 24, minHeight: 24, paddingHorizontal: 6, paddingVertical: 4, borderRadius: 12, fontSize: 10, lineHeight: 16, fontWeight: '800', textAlign: 'center' },
  contextNote: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  contextNoteText: { flex: 1, fontSize: 11, lineHeight: 17 },
  pagination: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  pageNumber: { fontSize: 12, lineHeight: 18 },
  recovery: { gap: 12, marginTop: 12 },
  recoveryTitle: { fontSize: 20, lineHeight: 27, fontWeight: '600' },
});
