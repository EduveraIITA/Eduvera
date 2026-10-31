import { useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import type { CampusAssertion, CampusViewResponse, CampusViewSpace } from '../../../../packages/contracts/src/campus-view';
import { activeSpaceAssertion, campusActivityTrail, campusDateFormatter } from '../../../../packages/contracts/src/campus-scene-records';
import { plannedHeadcount, roomCapacityPresentation, supportsSeatPattern } from '../../../../packages/contracts/src/campus-room-capacity';
import type { CampusKpiHeadline, CampusKpiMetric, CampusKpiPage, CampusKpiRange, CampusKpiResponse } from '../../../../packages/contracts/src/wire/features/campus-view/kpiApi';
import { useSession } from '../../auth/SessionProvider';
import { useApi } from '../../lib/query';
import { campusActivityEvidence, campusKpiResponse, campusKpiSeriesSegments, campusKpiValue, campusPublishedSnapshot, campusPublishedSourceHref } from '../../lib/campus-published-operations';
import { Empty, Loading, Notice, Row, SearchField, Section } from '../../ui/components';
import { ChoiceMenu, ControlButton, Disclosure, Facts } from '../../ui/DomainControls';
import { useTheme } from '../../ui/theme';

export interface CampusPublishedOperationsProps {
  href: string;
  onNavigate: (href: string) => void;
  schoolId: string;
  campusId: string;
  mode: 'spaces' | 'timetable' | 'activity' | 'kpis';
  spaceId?: string | null;
  onSelectPlace: (id: string) => void;
}
const pageOptions = [{ value: 'overview', label: 'Overview' }, { value: 'teaching', label: 'Teaching' }, { value: 'movement', label: 'Movement' }, { value: 'spaces', label: 'Spaces' }, { value: 'coordination', label: 'Coordination' }, { value: 'data_health', label: 'Data health' }] as const;
const rangeOptions = [{ value: 'today', label: 'Today' }, { value: '7d', label: '7 days' }, { value: '30d', label: '30 days' }, { value: '90d', label: '90 days' }, { value: '1y', label: '1 year' }] as const;
const readable = (value: string) => value.replaceAll('_', ' ');

/** Read-only dock content. Its owner keeps the published map and its navigation mounted. */
export function CampusPublishedOperations(props: CampusPublishedOperationsProps) {
  const session = useSession();
  const allowed = session.status === 'authenticated' && !!session.user && session.schoolId === props.schoolId && !!props.campusId
    && session.memberships.some(member => member.school_id === props.schoolId && member.role === 'admin' && member.access_scope !== 'assigned_work')
    && !session.environment.unavailable && (session.environment.mode === 'live' || !!session.environment.namespace_id && (!session.environment.institution_id || session.environment.institution_id === props.schoolId));
  if (!allowed) return <Notice tone="warning" message={session.environment.unavailable ? 'Campus operations are unavailable until this Simulation is recovered.' : 'Campus operations require an administrator in the current school and campus.'} />;
  return <ActiveOperations key={JSON.stringify([session.scopeKey, props.schoolId, props.campusId])} {...props} />;
}

function ActiveOperations(props: CampusPublishedOperationsProps) {
  const session = useSession(), focused = useIsFocused();
  const snapshotPath = `/api/v1/schools/${encodeURIComponent(props.schoolId)}/campus-view/?${new URLSearchParams({ campus_id: props.campusId })}`;
  const query = useApi<unknown>(props.mode !== 'kpis' || props.spaceId ? snapshotPath : null, { staleTime: 15_000, refetchInterval: session.environment.mode === 'live' ? 30_000 : false });
  const data = query.isSuccess && !query.isError ? campusPublishedSnapshot(query.data, { schoolId: props.schoolId, campusId: props.campusId, environment: session.environment }) : null;
  const current = useRef({ focused, scope: session.scopeKey, data, props }); current.current = { focused, scope: session.scopeKey, data, props };
  const navigate = (path: string) => { const state = current.current, safe = campusPublishedSourceHref(path); if (state.focused && state.scope === session.scopeKey && state.props.href === props.href && state.props.schoolId === props.schoolId && state.props.campusId === props.campusId && safe) state.props.onNavigate(safe); };
  const select = (id: string) => { const state = current.current; if (state.focused && state.scope === session.scopeKey && state.props.href === props.href && state.props.campusId === props.campusId && state.data?.spaces.some(space => space.id === id && space.campus_id === state.props.campusId)) state.props.onSelectPlace(id); };
  if (props.mode === 'kpis' && !props.spaceId) return <KpiPanel schoolId={props.schoolId} campusId={props.campusId} onNavigate={navigate} />;
  if (query.isPending) return <Loading label="Loading current campus operations…" />;
  if (!data) return <Empty title="Campus operations could not be verified" message="The published map remains available. Check the selected campus and connection, then retry this panel." onRetry={() => void query.refetch()} />;
  const timezone = data.campuses.find(campus => campus.id === props.campusId)?.timezone ?? data.school.timezone ?? 'UTC';
  const stamp = (value: string | null | undefined, date = true) => formatStamp(value, timezone, date);
  const selected = props.spaceId ? data.spaces.find(space => space.id === props.spaceId && space.campus_id === props.campusId) : null;
  return <View style={{ gap: 12 }}>
    <Facts items={[{ label: 'Campus', value: data.campuses.find(campus => campus.id === props.campusId)?.name ?? 'Selected campus' }, { label: 'Snapshot', value: stamp(data.as_of) }, { label: 'Time zone', value: timezone }]} />
    <ControlButton title="Refresh operations" busy={query.isFetching} onPress={() => void query.refetch()} />
    {props.spaceId ? selected ? <SpaceEvidence key={selected.id} space={selected} stamp={stamp} onNavigate={navigate} /> : <Empty title="This space is unavailable" message="The current campus source does not include this space. Choose another space on the map or refresh the panel." /> : <>
      {data.operations ? <Disclosure title="Current operational totals"><Facts items={[
        { label: 'Expected sessions', value: data.operations.current_expected_sessions }, { label: 'Expected teachers', value: data.operations.expected_teachers },
        { label: 'Gate observations', value: `${data.operations.gate_movements.entries} in · ${data.operations.gate_movements.exits} out · ${data.operations.gate_movements.accepted_points} accepted points` },
        { label: 'Gate scope', value: data.operations.gate_movements.scope === 'institution' ? 'Institution-wide' : 'Selected campus' },
        { label: 'Visitor register', value: `${data.operations.visitors_inside.count} recorded inside · Institution-wide` },
      ]} /><Notice message="Timetable totals are expectations. Gate records are boundary observations. Neither establishes anyone’s current physical location." /></Disclosure> : null}
      {props.mode === 'spaces' ? <SpacesPanel key="spaces" spaces={data.spaces.filter(space => space.campus_id === props.campusId)} onSelect={select} /> : <ActivityPanel key={props.mode} mode={props.mode === 'timetable' ? 'timetable' : 'activity'} data={data} stamp={stamp} onSelect={select} onNavigate={navigate} />}
    </>}
  </View>;
}

function formatStamp(value: string | null | undefined, timezone: string, includeDate = true) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Time unavailable';
  return campusDateFormatter(timezone, includeDate).format(new Date(value));
}

function Note({ children }: { children: string }) {
  const { colors } = useTheme();
  return <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}>{children}</Text>;
}

function Source({ path, onNavigate, title = 'Open source' }: { path?: string | null; onNavigate: (href: string) => void; title?: string }) {
  const safe = campusPublishedSourceHref(path);
  return safe ? <ControlButton title={title} onPress={() => onNavigate(safe)} /> : null;
}

function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  return pages > 1 ? <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}><ControlButton title="Previous" disabled={page <= 1} onPress={() => onPage(page - 1)} /><Note>{`Page ${page} of ${pages}`}</Note><ControlButton title="Next" disabled={page >= pages} onPress={() => onPage(page + 1)} /></View> : null;
}

function SpacesPanel({ spaces, onSelect }: { spaces: CampusViewSpace[]; onSelect: (id: string) => void }) {
  const [search, setSearch] = useState(''), [kind, setKind] = useState('all'), [page, setPage] = useState(1);
  const kinds = [...new Set(spaces.map(space => space.kind))].sort();
  const filtered = spaces.filter(space => (kind === 'all' || space.kind === kind) && `${space.name} ${space.code} ${space.floor_label}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / 12)), currentPage = Math.min(page, pages);
  return <Section title="Campus spaces">
    <Note>Choose a space to inspect its expected, observed and accepted evidence.</Note>
    <SearchField label="Search campus spaces" placeholder="Name, code or floor" value={search} onChangeText={value => { setSearch(value.slice(0, 100)); setPage(1); }} />
    <ChoiceMenu label="Space kind" value={kind} options={[{ value: 'all', label: 'All spaces' }, ...kinds.map(value => ({ value, label: readable(value) }))]} onChange={value => { setKind(value); setPage(1); }} />
    {filtered.slice((currentPage - 1) * 12, currentPage * 12).map(space => {
      const expected = space.expected_now[0], gate = space.gate_activity_today;
      const count = plannedHeadcount([expected?.expected_count, ...space.assertions.expected.map(assertion => assertion.count)]);
      const seats = supportsSeatPattern(space.kind) ? roomCapacityPresentation(space.id, space.capacity, count) : null;
      const detail = gate ? `${gate.entries} in · ${gate.exits} out today` : expected?.subject_label || expected?.title || space.assertions.accepted[0]?.label || space.assertions.observed[0]?.label || space.assertions.expected[0]?.label || 'No current assertion';
      const status = expected?.teacher ? `Expected: ${expected.teacher.label}` : gate ? `${gate.accepted_points} accepted points` : seats?.compactLabel || readable(space.state_dimension);
      return <Row key={space.id} title={space.name} detail={[space.floor_label, detail].filter(Boolean).join(' · ')} status={status} statusTone="muted" onPress={() => onSelect(space.id)}>{seats ? <Note>{seats.accessibleSummary}</Note> : null}</Row>;
    })}
    {!filtered.length ? <Empty title="No matching campus spaces" message={spaces.length ? 'Try another name, code or kind.' : 'The current source has no spaces for this campus.'} /> : null}
    <Pagination page={currentPage} pages={pages} onPage={setPage} />
  </Section>;
}

function ActivityPanel({ mode, data, stamp, onSelect, onNavigate }: { mode: 'activity' | 'timetable'; data: CampusViewResponse; stamp: (value: string, date?: boolean) => string; onSelect: (id: string) => void; onNavigate: (href: string) => void }) {
  const [search, setSearch] = useState(''), [state, setState] = useState('all'), [page, setPage] = useState(1);
  const trail = campusActivityTrail(data).filter(item => mode !== 'timetable' || item.spatial_claim === 'expected_context_only' && ['in_progress', 'upcoming', 'ended'].includes(item.state ?? ''));
  const items = trail.filter(item => (state === 'all' || (mode === 'timetable' ? item.state : item.state_dimension) === state) && `${item.title} ${item.detail} ${item.source_label}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const pages = Math.max(1, Math.ceil(items.length / 12)), currentPage = Math.min(page, pages);
  const options = mode === 'timetable' ? [{ value: 'all', label: 'All periods' }, { value: 'in_progress', label: 'Now' }, { value: 'upcoming', label: 'Later today' }, { value: 'ended', label: 'Earlier today' }] : [{ value: 'all', label: 'All evidence' }, { value: 'expected', label: 'Expected plans' }, { value: 'observed', label: 'Observed points' }, { value: 'accepted', label: 'Accepted records' }, { value: 'unknown', label: 'Needs review' }];
  return <Section title={mode === 'timetable' ? 'Today’s timetable' : 'Recent activity'}>
    <Note>{mode === 'timetable' ? 'Current lessons appear first, followed by upcoming and earlier periods. These are expectations, not proof of physical presence.' : 'Source-backed records retain their evidence state. Silence is not treated as absence.'}</Note>
    <SearchField label={mode === 'timetable' ? 'Search timetable' : 'Search campus activity'} placeholder="Activity, class or source" value={search} onChangeText={value => { setSearch(value.slice(0, 100)); setPage(1); }} />
    <ChoiceMenu label={mode === 'timetable' ? 'Period state' : 'Evidence state'} value={state} options={options} onChange={value => { setState(value); setPage(1); }} />
    <Note>{`${items.length} matching ${mode === 'timetable' ? 'periods' : 'records'}`}</Note>
    {items.slice((currentPage - 1) * 12, currentPage * 12).map(item => <Row key={item.id} title={item.title} detail={item.detail} status={campusActivityEvidence(item)} statusTone={item.state_dimension === 'unknown' ? 'warning' : 'muted'}>
      <Note>{`${stamp(item.occurred_at, mode !== 'timetable')}${item.ends_at ? ` – ${stamp(item.ends_at, false)}` : ''} · ${item.source_label}`}</Note>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Source path={item.target_path} onNavigate={onNavigate} />{item.space_id && data.spaces.some(space => space.id === item.space_id) ? <ControlButton title="Inspect space" onPress={() => onSelect(item.space_id!)} /> : <Note>{mode === 'timetable' ? 'No mapped campus space is linked to this period.' : 'This record does not establish a mapped current location.'}</Note>}</View>
    </Row>)}
    {!items.length ? <Empty title={mode === 'timetable' ? 'No matching timetable entries' : 'No matching campus activity'} message={mode === 'timetable' ? 'Published classes and scheduled activities appear when the current sources provide them.' : 'Source-backed events will appear here. Missing records do not prove absence.'} /> : null}
    <Pagination page={currentPage} pages={pages} onPage={setPage} />
  </Section>;
}

function SpaceEvidence({ space, stamp, onNavigate }: { space: CampusViewSpace; stamp: (value: string | null | undefined, date?: boolean) => string; onNavigate: (href: string) => void }) {
  const active = activeSpaceAssertion(space), expected = space.expected_now[0], gate = space.gate_activity_today;
  const assertions = [...space.assertions.accepted, ...space.assertions.observed, ...space.assertions.expected];
  const [page, setPage] = useState(1), pages = Math.max(1, Math.ceil(assertions.length / 12)), currentPage = Math.min(page, pages);
  const count = plannedHeadcount([expected?.expected_count, ...space.assertions.expected.map(item => item.count)]), seating = supportsSeatPattern(space.kind) ? roomCapacityPresentation(space.id, space.capacity, count) : null;
  return <Section title={space.name}>
    <Facts items={[{ label: 'Kind', value: readable(space.kind) }, { label: 'Code', value: space.code || 'Not recorded' }, { label: 'Floor', value: space.floor_label || 'No floor recorded' }, { label: 'Selected assertion', value: active?.label ?? 'No current activity asserted' }, ...(seating ? [{ label: 'Planned capacity', value: seating.compactLabel }] : [])]} />
    {seating ? <Note>{seating.accessibleSummary}</Note> : null}
    {expected ? <Section title="Current timetable expectation"><Row title={expected.teacher ? `${expected.teacher.label} is expected here` : 'Scheduled activity'} detail={[expected.class_label, expected.subject_label || expected.title].filter(Boolean).join(' · ')} status={`${stamp(expected.starts_at, false)} – ${stamp(expected.ends_at, false)}`} statusTone="muted" /><Note>{`${expected.source.label}. This expectation does not prove physical presence.`}</Note><Source path={expected.source.target_path} onNavigate={onNavigate} title="Open activity source" /></Section> : null}
    {gate ? <Section title="Today’s accepted gate observations"><Facts items={[{ label: 'Movements', value: `${gate.entries} in · ${gate.exits} out` }, { label: 'Accepted points', value: gate.accepted_points }, { label: 'Latest observation', value: stamp(gate.latest_observed_at) }, { label: 'Source', value: gate.source_label }]} /><Note>These records describe boundary movements, not anyone’s current location.</Note></Section> : null}
    <Section title="Why this is shown">
      {assertions.slice((currentPage - 1) * 12, currentPage * 12).map(assertion => <AssertionEvidence key={`${assertion.dimension}:${assertion.id}`} assertion={assertion} stamp={stamp} onNavigate={onNavigate} />)}
      {!assertions.length ? <Notice message={expected ? 'The published assignment is an expectation, not observed presence.' : 'No schedule, device or accepted record currently places anyone in this space. Its state remains unknown.'} /> : null}
      <Pagination page={currentPage} pages={pages} onPage={setPage} />
    </Section>
    <Source path="/more/setup/institution/campus" title="Edit campus setup" onNavigate={onNavigate} />
  </Section>;
}

function AssertionEvidence({ assertion, stamp, onNavigate }: { assertion: CampusAssertion; stamp: (value: string | null | undefined) => string; onNavigate: (href: string) => void }) {
  const dimension = assertion.dimension === 'expected' ? 'Expected plan' : assertion.dimension === 'observed' ? 'Observed point' : 'Accepted record';
  const spatial = assertion.spatial_claim === 'bounded_space_presence' ? assertion.freshness === 'fresh' ? 'Current bounded space evidence' : 'Historical bounded space evidence' : assertion.spatial_claim === 'point_observation_only' ? 'Point evidence only' : assertion.spatial_claim === 'expected_context_only' ? 'Expected location only' : 'No spatial claim supplied';
  const historical = assertion.freshness === 'historical' || assertion.freshness === 'stale';
  return <Row title={assertion.label} detail={assertion.detail} status={`${dimension}${historical ? ' · Historical' : ''}`} statusTone="muted"><Note>{`${spatial} · ${assertion.source_label} · ${stamp(assertion.observed_at || assertion.valid_from)}`}</Note><Source path={assertion.target_path} onNavigate={onNavigate} /></Row>;
}

function KpiPanel({ schoolId, campusId, onNavigate }: { schoolId: string; campusId: string; onNavigate: (href: string) => void }) {
  const session = useSession(), [page, setPage] = useState<CampusKpiPage>('overview'), [range, setRange] = useState<CampusKpiRange>('today');
  const requestRange = page === 'overview' ? 'today' : range;
  const path = `/api/v1/schools/${encodeURIComponent(schoolId)}/campus-view/kpis?${new URLSearchParams({ page, range: requestRange, campus_id: campusId })}`;
  const query = useApi<unknown>(path, { staleTime: 30_000, refetchInterval: session.environment.mode === 'live' && (page === 'overview' || requestRange === 'today') ? 60_000 : false });
  const data = query.isSuccess && !query.isError ? campusKpiResponse(query.data, page, requestRange, campusId) : null;
  return <Section title="Campus performance">
    <Note>{session.environment.mode === 'simulation' ? 'Simulation performance · Recorded data from this selected world' : 'Live performance · Recorded school data'}</Note>
    <ChoiceMenu label="Performance page" value={page} options={pageOptions} onChange={value => { if (pageOptions.some(option => option.value === value)) setPage(value as CampusKpiPage); }} />
    {page !== 'overview' ? <ChoiceMenu label="Performance history" value={range} options={rangeOptions} onChange={value => { if (rangeOptions.some(option => option.value === value)) setRange(value as CampusKpiRange); }} /> : <Note>The overview shows today’s current snapshot.</Note>}
    <ControlButton title="Refresh campus performance" busy={query.isFetching} onPress={() => void query.refetch()} />
    {query.isPending ? <Loading label="Loading campus performance…" /> : !data ? <Empty title="Campus KPIs could not be verified" message="The map remains available. Check the current campus and connection, then retry." onRetry={() => void query.refetch()} /> : <>
      <Facts items={[{ label: 'Scope', value: data.scope.campus_label }, { label: 'Period', value: `${formatStamp(data.period.from, data.period.timezone)} – ${formatStamp(data.period.to, data.period.timezone)}` }, { label: 'Updated', value: formatStamp(data.generated_at, data.period.timezone) }, { label: 'Time zone', value: data.period.timezone }]} />
      {page === 'overview' ? <KpiOverview data={data} onNavigate={onNavigate} /> : <MetricList key={page + ':' + requestRange} data={data} onNavigate={onNavigate} />}
    </>}
  </Section>;
}

function KpiOverview({ data, onNavigate }: { data: CampusKpiResponse; onNavigate: (href: string) => void }) {
  const overview = data.overview;
  const keyed = (overview?.headline_keys ?? []).flatMap(key => { const metric = data.metrics.find(item => item.key === key); return metric ? [metric] : []; });
  const fallback = keyed.length ? keyed : data.metrics.slice(0, 4);
  const headlines: CampusKpiHeadline[] = overview?.headlines?.length ? overview.headlines : fallback.map(metric => ({ key: metric.key, label: metric.label, value: metric.value, unit: metric.unit, availability: metric.availability, value_context: metric.value_context ?? 'selected_period' }));
  const incomplete = data.metrics.filter(metric => metric.availability !== 'available' || metric.unknown_count > 0);
  const evidence = overview?.evidence_state ?? (incomplete.some(metric => metric.availability === 'unavailable') ? 'unavailable' : incomplete.length ? 'partial' : 'available');
  const entries = data.metrics.find(metric => metric.key === 'access.gate_entries_recorded'), exits = data.metrics.find(metric => metric.key === 'access.gate_exits_recorded');
  return <View style={{ gap: 12 }}>
    <Section title="Campus snapshot">
      {headlines.map(headline => { const metric = data.metrics.find(item => item.key === headline.key); return <Row key={headline.key} title={headline.label} detail={campusKpiValue(headline.value, headline.unit)} status={`${headline.availability === 'available' ? 'Available evidence' : headline.availability === 'partial' ? 'Partial evidence' : 'Unavailable'} · ${metric?.scope === 'institution' ? 'Institution-wide' : 'Selected campus'}${metric?.unknown_count ? ` · ${metric.unknown_count} unknown` : ''}`} statusTone={headline.availability === 'available' ? 'muted' : 'warning'}>
        <Note>{valueContext(headline.value_context)}</Note>{metric?.numerator !== null && metric?.numerator !== undefined && metric.denominator !== null ? <Note>{`${metric.numerator} of ${metric.denominator}`}</Note> : null}
        {headline.secondary ? <Note>{`${headline.secondary.label}: ${headline.secondary.value === null && headline.secondary.availability === 'unavailable' ? 'Unavailable' : campusKpiValue(headline.secondary.value, 'count')}`}</Note> : null}
        <Source path={metric?.target_path} onNavigate={onNavigate} />
      </Row>; })}
      {!headlines.length ? <Empty title="No campus KPIs are available yet" message="Values appear when configured operations produce enough source records." /> : null}
    </Section>
    {overview?.composition ? <Composition composition={overview.composition} /> : null}
    {entries && exits ? <GateFlow entries={entries} exits={exits} data={data} /> : null}
    <Bottlenecks items={overview?.bottlenecks ?? []} evidence={evidence} incomplete={incomplete.length} total={data.metrics.length} onNavigate={onNavigate} />
    <Disclosure title="Inspect all snapshot measures"><MetricList data={data} onNavigate={onNavigate} /></Disclosure>
  </View>;
}

function valueContext(context: CampusKpiMetric['value_context']) {
  return context === 'active_at_as_of' ? 'Active at the snapshot time' : context === 'current_at_as_of' ? 'Current at the snapshot time' : context === 'trailing_15_minutes' ? 'Trailing 15 minutes' : context === 'latest_interval_with_response_evidence' ? 'Latest interval with response evidence' : 'Selected period';
}

function Composition({ composition }: { composition: NonNullable<CampusKpiResponse['overview']>['composition'] }) {
  const { colors } = useTheme(), total = composition.slices.reduce((sum, slice) => sum + slice.value, 0), circumference = 2 * Math.PI * 52;
  const tone = { accepted: colors.positive, observed: colors.link, expected: colors.muted, unknown: colors.border, review: colors.warning };
  let offset = 0;
  return <Section title={composition.label}>
    {!total ? <Note>No current records for this breakdown.</Note> : <View style={{ alignItems: 'center' }}><Svg accessible={Platform.OS === 'web' ? undefined : false} aria-hidden={Platform.OS === 'web' ? true : undefined} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" width={160} height={160} viewBox="0 0 144 144"><Circle cx={72} cy={72} r={52} fill="none" stroke={colors.border} strokeWidth={16} />{composition.slices.filter(slice => slice.value > 0).map(slice => { const length = slice.value / total * circumference, start = offset; offset += length; return <Circle key={slice.key} cx={72} cy={72} r={52} fill="none" stroke={tone[slice.tone]} strokeWidth={16} strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-start} transform="rotate(-90 72 72)" />; })}<SvgText x={72} y={72} textAnchor="middle" fill={colors.ink} fontSize={20}>{campusKpiValue(total, 'count')}</SvgText><SvgText x={72} y={90} textAnchor="middle" fill={colors.muted} fontSize={10}>{composition.unit}</SvgText></Svg></View>}
    <Facts items={composition.slices.map(slice => ({ label: slice.label, value: `${campusKpiValue(slice.value, 'count')} ${composition.unit} · ${readable(slice.tone)}` }))} />
  </Section>;
}

function GateFlow({ entries, exits, data }: { entries: CampusKpiMetric; exits: CampusKpiMetric; data: CampusKpiResponse }) {
  const { colors } = useTheme(), exitByBucket = new Map(exits.series.map(point => [point.bucket_start, point]));
  const points = entries.series.slice(-16).map(entry => ({ entry, exit: exitByBucket.get(entry.bucket_start) }));
  const values = points.flatMap(point => [point.entry.value, point.exit?.value ?? null]).filter((value): value is number => value !== null);
  const maximum = Math.max(1, ...values), groupWidth = 280 / Math.max(1, points.length), barWidth = Math.max(2, Math.min(7, groupWidth * .3));
  return <Section title="Recorded gate flow">
    <Note>{`Latest ${points.length} ${data.bucket.label.toLowerCase()} intervals · Accepted boundary observations. These are not a current-presence count.`}</Note>
    {!values.length ? <Note>No accepted gate records are available for these intervals.</Note> : <Svg accessible={Platform.OS === 'web' ? undefined : false} aria-hidden={Platform.OS === 'web' ? true : undefined} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" width="100%" height={110} viewBox="0 0 320 110"><Line x1={20} x2={300} y1={86} y2={86} stroke={colors.border} />{points.map(({ entry, exit }, index) => { const center = 20 + groupWidth * (index + .5); return <ViewlessBars key={entry.bucket_start} center={center} width={barWidth} entry={entry.value} exit={exit?.value ?? null} maximum={maximum} />; })}<SvgText x={20} y={104} fill={colors.muted} fontSize={10}>{points[0] ? formatStamp(points[0].entry.bucket_start, data.period.timezone, false) : ''}</SvgText><SvgText x={300} y={104} textAnchor="end" fill={colors.muted} fontSize={10}>{points.at(-1) ? formatStamp(points.at(-1)!.entry.bucket_start, data.period.timezone, false) : ''}</SvgText></Svg>}
    <Note>Entries use the first bar; exits use the second. Missing intervals remain unknown.</Note>
    <Disclosure title="Inspect gate intervals"><Facts items={points.map(({ entry, exit }) => ({ label: formatStamp(entry.bucket_start, data.period.timezone), value: `${entry.value === null ? 'Unknown' : entry.value} in · ${exit?.value == null ? 'Unknown' : exit.value} out` }))} /></Disclosure>
  </Section>;
}

function ViewlessBars({ center, width, entry, exit, maximum }: { center: number; width: number; entry: number | null; exit: number | null; maximum: number }) {
  const { colors } = useTheme();
  return <>{entry !== null ? <Rect x={center - width - 1} y={86 - entry / maximum * 70} width={width} height={entry / maximum * 70} fill={colors.positive} rx={2} /> : null}{exit !== null ? <Rect x={center + 1} y={86 - exit / maximum * 70} width={width} height={exit / maximum * 70} fill={colors.link} rx={2} /> : null}</>;
}

function Bottlenecks({ items, evidence, incomplete, total, onNavigate }: { items: NonNullable<CampusKpiResponse['overview']>['bottlenecks']; evidence: string; incomplete: number; total: number; onNavigate: (href: string) => void }) {
  const [page, setPage] = useState(1), pages = Math.max(1, Math.ceil(items.length / 8)), currentPage = Math.min(page, pages);
  return <Section title="Operational bottlenecks">
    {items.slice((currentPage - 1) * 8, currentPage * 8).map(item => <Row key={item.id} title={item.label} detail={item.detail} status={`${item.severity === 'important' ? 'Important' : 'Review'} · ${item.count} · ${readable(item.evidence_dimension)}`} statusTone="warning"><Note>{`${item.source_label} · ${item.scope === 'institution' ? 'Institution-wide' : 'Selected campus'}`}</Note><Source path={item.target_path} onNavigate={onNavigate} /></Row>)}
    {!items.length ? <Notice message={`No bottlenecks are recorded in the available source data. This is not an all-clear when evidence is missing or partial.${evidence !== 'available' ? incomplete ? ` ${incomplete} of ${total} measures have incomplete coverage.` : ` Source coverage is ${evidence}.` : ''}`} /> : null}
    <Pagination page={currentPage} pages={pages} onPage={setPage} />
  </Section>;
}

function MetricList({ data, onNavigate }: { data: CampusKpiResponse; onNavigate: (href: string) => void }) {
  const [page, setPage] = useState(1), pages = Math.max(1, Math.ceil(data.metrics.length / 6)), currentPage = Math.min(page, pages);
  return <View style={{ gap: 12 }}>
    <Note>{`${data.bucket.label} intervals. Gaps remain gaps when evidence is unavailable.`}</Note>
    {data.metrics.slice((currentPage - 1) * 6, currentPage * 6).map(metric => <Metric key={metric.key} metric={metric} data={data} onNavigate={onNavigate} />)}
    {!data.metrics.length ? <Empty title="No KPIs for this view yet" message="This page will populate when its operations and evidence sources are configured." /> : null}
    <Pagination page={currentPage} pages={pages} onPage={setPage} />
  </View>;
}

function Metric({ metric, data, onNavigate }: { metric: CampusKpiMetric; data: CampusKpiResponse; onNavigate: (href: string) => void }) {
  const { colors } = useTheme(), [page, setPage] = useState(1), pages = Math.max(1, Math.ceil(metric.series.length / 12)), currentPage = Math.min(page, pages);
  const chart = campusKpiSeriesSegments(metric.series, 280, 76, metric.unit), missing = metric.series.filter(point => point.value === null).length;
  return <Section title={metric.label}>
    <Note>{metric.description}</Note><Text style={{ color: colors.ink, fontSize: 27, fontWeight: '600' }}>{campusKpiValue(metric.value, metric.unit)}</Text>
    <Facts items={[{ label: 'Evidence', value: metric.availability === 'available' ? 'Available' : metric.availability === 'partial' ? 'Partial evidence' : 'Unavailable' }, { label: 'Scope', value: metric.scope === 'institution' ? 'Institution-wide' : 'Selected campus' }, { label: 'Value period', value: valueContext(metric.value_context) }, { label: 'Source', value: metric.source_label }, { label: 'Evidence types', value: metric.evidence_dimensions.map(value => value === 'expected' ? 'Plan' : value === 'observed' ? 'Observation' : 'Accepted record').join(' · ') || 'None available' }, { label: 'Unknown items', value: metric.unknown_count }, ...(metric.source_max_at ? [{ label: 'Newest source', value: formatStamp(metric.source_max_at, data.period.timezone) }] : []), ...(metric.numerator !== null && metric.denominator !== null ? [{ label: 'Recorded basis', value: `${metric.numerator} of ${metric.denominator}` }] : [])]} />
    {metric.availability !== 'available' || metric.unavailable_reason ? <Notice tone="warning" message={metric.unavailable_reason ?? (metric.availability === 'partial' ? 'This measure uses partial source coverage for the selected period.' : 'Configured sources do not support this measure for the selected period.')} /> : null}
    <Note>{`${metric.series.length} intervals · ${missing} without sufficient evidence${metric.series[0] ? ` · ${formatStamp(metric.series[0].bucket_start, data.period.timezone)} to ${formatStamp(metric.series.at(-1)!.bucket_end, data.period.timezone)}` : ''}`}</Note>
    {chart.segments.length ? <Svg accessible={Platform.OS === 'web' ? undefined : false} aria-hidden={Platform.OS === 'web' ? true : undefined} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" width="100%" height={120} viewBox="0 0 320 120"><Line x1={28} x2={308} y1={88} y2={88} stroke={colors.border} /><SvgText x={24} y={16} textAnchor="end" fill={colors.muted} fontSize={10}>{campusKpiValue(chart.max, metric.unit)}</SvgText><SvgText x={24} y={90} textAnchor="end" fill={colors.muted} fontSize={10}>0</SvgText>{chart.segments.map((segment, index) => <Path key={index} d={segment.map((point, position) => `${position ? 'L' : 'M'}${point.x + 28},${point.y + 12}`).join(' ')} stroke={colors.link} strokeWidth={2} fill="none" />)}{chart.segments.flatMap(segment => metric.series.length <= 48 || segment.length === 1 ? segment.map(point => <Circle key={point.index} cx={point.x + 28} cy={point.y + 12} r={2.5} fill={colors.link} />) : [])}<SvgText x={28} y={110} fill={colors.muted} fontSize={10}>{metric.series[0] ? formatStamp(metric.series[0].bucket_start, data.period.timezone, data.bucket.kind === 'day') : ''}</SvgText><SvgText x={308} y={110} textAnchor="end" fill={colors.muted} fontSize={10}>{metric.series.at(-1) ? formatStamp(metric.series.at(-1)!.bucket_start, data.period.timezone, data.bucket.kind === 'day') : ''}</SvgText></Svg> : <Note>No interval has enough evidence to plot.</Note>}
    <Disclosure title="Inspect interval data">
      {metric.series.slice((currentPage - 1) * 12, currentPage * 12).map(point => <Row key={point.bucket_start} title={formatStamp(point.bucket_start, data.period.timezone)} detail={`${campusKpiValue(point.value, metric.unit)} · ${point.unknown_count} unknown`}>{point.numerator !== null && point.denominator !== null ? <Note>{`${point.numerator} of ${point.denominator}`}</Note> : null}</Row>)}
      {!metric.series.length ? <Note>No intervals returned for this measure.</Note> : null}<Pagination page={currentPage} pages={pages} onPage={setPage} />
    </Disclosure>
    <Source path={metric.target_path} onNavigate={onNavigate} />
  </Section>;
}
