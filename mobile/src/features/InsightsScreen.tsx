import { ScreenBack } from '../ui/BackNavigation';
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { AnalyticsOverview } from '../../../packages/contracts/src/wire/features/analytics/api';
import { assertWorkspaceManifestContext, normalizeWorkspaceManifest } from '../../../packages/contracts/src/workspace-normalizer';
import { useSession } from '../auth/SessionProvider';
import { useApi } from '../lib/query';
import { ApiError } from '../lib/api';
import { nativeInsightsAnalyticsPath, nativeInsightsContextHref, nativeInsightsFilters, nativeInsightsHref, nativeInsightsOptions, nativeInsightsResponseMatches, nativeInsightsRoute, resolveNativeInsightsAccess, type NativeInsightsAccess } from '../lib/native-insights';
import { Button, Empty, Loading, Page, Row, Section } from '../ui/components';
import { ChoiceMenu, ControlButton, Disclosure, InfoDisclosure, SegmentedControl } from '../ui/DomainControls';
import { useTheme } from '../ui/theme';
import { DomainPages, DomainText, domainHref, domainParams, type DomainScreenProps } from './ResourcesScreen';
import { InstitutionInsights } from './insights/InstitutionInsights';
import { AttendanceSpark, InsightBars, InsightDistribution, InsightDonut, InsightKpis, InsightMeter, InsightMetric, InsightPanel, type InsightSlice } from './insights/InsightVisuals';

const number = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-IN', { maximumFractionDigits: 1 }) : '—';
const percent = (value: number | null | undefined) => value == null ? '—' : number(value) + '%';
const date = (value: string) => new Date(value + 'T12:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const titles = { attendance: 'Attendance trends', results: 'Result analysis', progress: 'Assessment progress', institution: 'Institution snapshot', registers: 'Register submission', review: 'Attendance review', recording: 'Missing records', followups: 'Family follow-ups', 'learning-review': 'Learning review', operations: 'Coverage & deadlines', finance: 'Fee balances' };
const periods = [{ value: 'term', label: 'This term' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }];

export function InsightsScreen(props: DomainScreenProps) {
  const { schoolId, user, environment, scopeKey } = useSession();
  const query = useApi<unknown>(schoolId ? '/api/v1/workspace' : null);
  const manifest = useMemo(() => {
    try {
      if (!query.data || !schoolId || !user) return null;
      const value = normalizeWorkspaceManifest(query.data);
      assertWorkspaceManifestContext(value, { actorUserId: user.id, institutionId: schoolId, environment });
      return value;
    } catch { return null; }
  }, [query.data, schoolId, user?.id, environment]);
  if (query.isPending) return <Page title="Insights"><Loading /></Page>;
  if (query.error || !manifest || !schoolId) return <Page title="Insights"><Empty title="Insights access could not be confirmed" message={query.error?.message} onRetry={() => void query.refetch()} /></Page>;
  const access = resolveNativeInsightsAccess(manifest, props.href), options = nativeInsightsOptions(manifest);
  if (!access) return <Page title="Insights"><Empty title="This Insights view is unavailable" message="The selected context is not part of your current access." onRetry={() => void query.refetch()} /><ScreenBack title="Back to Areas" fallbackHref={'/areas'} /></Page>;
  return <InsightsContent key={scopeKey + ':' + access.surface.key + ':' + props.href} {...props} schoolId={schoolId} access={access} options={options} />;
}

function InsightsContent({ href, onNavigate, schoolId, access, options }: DomainScreenProps & { schoolId: string; access: NativeInsightsAccess; options: NativeInsightsAccess[] }) {
  const { colors } = useTheme();
  const route = nativeInsightsRoute(href), filters = nativeInsightsFilters(href, access);
  const query = useApi<unknown>(nativeInsightsAnalyticsPath(schoolId, access, href));
  const data = !query.error && nativeInsightsResponseMatches(query.data, schoolId, access, href) ? query.data : undefined;
  const family = access.kind === 'self' || access.kind === 'dependent';
  const change = (values: Record<string, string | undefined>) => onNavigate(domainHref(href.split('?')[0]!, domainParams(nativeInsightsHref(access, route.topic, href)), values));
  const title = route.topic ? titles[route.topic] : 'Insights';
  const review = route.kind === 'institution-review';
  const denied = !filters || route.kind === 'invalid' || review && access.kind !== 'institution' || !review && !nativeInsightsAnalyticsPath(schoolId, access, href);
  const institutionOverview = route.kind === 'overview' && access.kind === 'institution';
  const periodControl = <ChoiceMenu label="Trend period" value={filters?.period ?? 'term'} options={periods} onChange={value => change({ period: value })} />;
  return <Page title={title} subtitle={options.length < 2 && access.kind === 'dependent' ? access.contextLabel : undefined} refreshing={query.isRefetching} onRefresh={!review ? () => void query.refetch() : undefined}>
    {options.length > 1 ? <ChoiceMenu label="View" value={access.surface.key} options={options.map(option => ({ value: option.surface.key, label: option.contextLabel }))} onChange={value => { const next = options.find(option => option.surface.key === value); if (next) onNavigate(nativeInsightsContextHref(next, href)); }} /> : null}
    {!review ? <View style={styles.controls}>
      {!family && route.topic !== 'institution' && (data?.classes.length || filters?.classId) ? <View style={{ flex: 1, minWidth: 140 }}><ChoiceMenu label="Class" value={filters?.classId ?? ''} options={[{ value: '', label: access.kind === 'institution' ? 'All classes' : 'My work' }, ...(data?.classes.map(item => ({ value: item.id, label: item.name })) ?? []), ...(filters?.classId && !data?.classes.some(item => item.id === filters.classId) ? [{ value: filters.classId, label: 'Selected class' }] : [])]} onChange={value => change({ class: value || undefined, class_id: undefined, insight_class: undefined })} /></View> : <View style={{ flex: 1 }}><DomainText>{route.topic === 'institution' ? 'Current institution' : data?.scope_label ?? access.contextLabel}</DomainText></View>}
      {!institutionOverview && route.topic !== 'institution' ? periodControl : null}
      <ControlButton title="Refresh" disabled={query.isFetching} onPress={() => void query.refetch()} />
    </View> : null}
    {!denied && institutionOverview ? <InstitutionInsights {...{ schoolId, href, onNavigate }} overview="attention" /> : null}
    {denied ? <Empty title="This Insights topic is unavailable" message="Choose an authorized view or return to its overview." />
      : review ? <InstitutionInsights {...{ schoolId, href, onNavigate }} />
      : query.isPending ? <Loading label="Loading insights…" />
      : query.error || !data ? <><Empty title={query.error instanceof ApiError && query.error.status === 403 ? 'Access to this Insights view is unavailable' : 'Insights could not be confirmed'} message={query.error instanceof ApiError && query.error.status === 403 ? 'The server could not confirm your current access to this work. You can retry or use Change view to choose another authorized context.' : query.error?.message ?? 'The response did not match the selected context and filters.'} onRetry={() => void query.refetch()} />{filters?.classId ? <Button title="Clear class filter" kind="secondary" onPress={() => change({ class: undefined, class_id: undefined, insight_class: undefined })} /> : null}</>
      : <>
        {institutionOverview && data.institution ? <Section title="Institution snapshot"><DomainText>Current records · {date(data.institution.as_of)}</DomainText><InsightKpis items={[{ label: 'Enrolled students', value: number(data.institution.students) }, { label: 'Active staff', value: number(data.institution.teaching_staff + data.institution.non_teaching_staff) }, { label: 'Classes with students', value: number(data.institution.populated_classes) }, { label: 'Average class size', value: number(data.institution.average_class_size) }]} onPress={() => onNavigate(nativeInsightsHref(access, 'institution', href))} /></Section> : null}
        {institutionOverview ? <View style={styles.sectionHeading}><Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.ink }]}>Trends & results</Text>{periodControl}</View> : null}
        <View style={styles.periodCaption}><DomainText>{route.topic === 'institution' && data.institution ? 'Current records · ' + date(data.institution.as_of) : date(data.range.from) + ' – ' + date(data.range.to)}</DomainText><DomainText>{data.term.name}{data.range.capped && route.topic !== 'institution' ? ' · Latest 366 days' : ''}</DomainText></View>
        {route.kind === 'overview' ? <>
          <View style={styles.grid}>
            {data.attendance ? <MetricCard title="Attendance" icon="attendancePatterns" value={percent(data.attendance.percentage)} label="recorded attendance" detail={number(data.attendance.attended) + ' of ' + number(data.attendance.denominator) + (family ? ' days attended' : ' student-days attended')} onPress={() => onNavigate(nativeInsightsHref(access, 'attendance', href))}><AttendanceSpark data={data.attendance.trend} /></MetricCard> : null}
            {data.registers ? <MetricCard title="Register submission" icon="registers" value={percent(data.registers.percentage)} label="of scheduled registers" detail={number(data.registers.submitted + data.registers.locked) + ' of ' + number(data.registers.expected) + ' submitted · ' + number(data.registers.outstanding) + ' not submitted'} onPress={() => onNavigate(nativeInsightsHref(access, 'registers', href))}><DomainText>Current timetable · includes today</DomainText><InsightMeter value={data.registers.percentage} label="Registers submitted or locked" /></MetricCard> : null}
            {data.assessments ? <MetricCard title="Results" icon="assessmentResults" value={percent(data.assessments.overall.average)} label={family ? 'Personal average' : data.selected_class_id ? 'Class average' : access.kind === 'institution' ? 'Institution average' : 'Assigned-work average'} detail={`${number(data.assessments.overall.scored)} scored results · Averages, not term grades`} onPress={() => onNavigate(nativeInsightsHref(access, 'results', href))}><InsightBars rows={data.assessments.subjects.slice(0, 3).map(item => ({ name: item.name, value: item.average }))} /></MetricCard> : null}
            {data.assessments && !family ? <View style={styles.summaryItem}><InsightPanel title="Assessment progress" icon="assessmentPlanning" onPress={() => onNavigate(nativeInsightsHref(access, 'progress', href))}><InsightDonut compact label="Assessment progress" slices={assessmentSlices(data.assessments.pipeline, true)} /><DomainText>{number(data.assessments.pipeline.filter(item => ['submitted', 'moderated'].includes(item.status)).reduce((sum, item) => sum + item.count, 0))} awaiting review or publication</DomainText></InsightPanel></View> : null}
          </View>
          {!data.attendance && !data.assessments && !data.institution && !data.registers ? <Empty title="No trend data is available in this view" /> : null}
        </> : <AnalyticsDetail {...{ data, access, href, onNavigate }} onCompare={value => change({ compare: value })} />}
        <DomainText>Updated {new Date(data.generated_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} · {access.kind === 'assigned' ? 'Current assignments only' : family ? 'Personal overview' : 'Institution overview'}</DomainText>
      </>}
    {!denied && institutionOverview ? <InstitutionInsights {...{ schoolId, href, onNavigate }} overview="operations" /> : null}
  </Page>;
}

function AnalyticsDetail({ data, access, href, onNavigate, onCompare }: { data: AnalyticsOverview; access: NativeInsightsAccess; href: string; onNavigate: (href: string) => void; onCompare: (value: string) => void }) {
  const route = nativeInsightsRoute(href), filters = nativeInsightsFilters(href, access), family = access.kind === 'self' || access.kind === 'dependent';
  const attendance = data.attendance, results = data.assessments;
  const comparison = !family && filters?.comparison === 'class';
  const comparisonControls = !family ? <SegmentedControl label="Compare attendance or results" value={comparison ? 'class' : 'subject'} options={[{ value: 'subject', label: 'By subject' }, { value: 'class', label: 'By class' }]} onChange={onCompare} /> : null;
  if (route.topic === 'attendance' && attendance) return <>
    <InsightPanel title="Recorded attendance"><InsightMetric value={percent(attendance.percentage)} label="recorded attendance" />
    {family && attendance.percentage !== null ? <DomainText>{attendance.percentage < data.term.attendance_threshold ? 'Below minimum' : 'At or above minimum'} · {data.term.attendance_threshold}% required</DomainText> : null}
    <DomainText>{number(attendance.attended)} of {number(attendance.denominator)} {family ? 'days' : 'student-days'} attended</DomainText>
    <AttendanceSpark data={attendance.trend} minimum={family ? data.term.attendance_threshold : undefined} />
    <DomainText>Only recorded attendance counts. Missing records are not absences.</DomainText>
    <Disclosure title="View chart data"><InsightRows rows={attendance.trend.map(item => ({ id: item.date, name: date(item.date) + (item.end !== item.date ? ' – ' + date(item.end) : ''), value: item.percentage, detail: number(item.attended) + ' / ' + number(item.denominator) + ' counted days' }))} /></Disclosure>
    <ControlButton title="View attendance" onPress={() => onNavigate(family
      ? '/areas/attendance/records?' + new URLSearchParams({ scope: access.kind, student_id: access.studentId!, date: data.range.to })
      : '/areas/attendance/registers?' + new URLSearchParams({ date: data.range.to, ...(data.selected_class_id ? { class_section_id: data.selected_class_id } : {}) }))} /></InsightPanel>
    <InsightPanel title="Recorded days"><InsightDonut label="Recorded attendance breakdown" slices={[{ label: 'Present', value: attendance.present, tone: 'positive' }, { label: 'Late', value: attendance.late, tone: 'action' }, { label: 'Half day', value: attendance.half_day, tone: 'warning' }, { label: 'Absent', value: attendance.absent, tone: 'danger' }, { label: 'Excused', value: attendance.excused, tone: 'muted' }]} /><InfoDisclosure title="How attendance is counted"><DomainText>Late counts as present; half days count as ½. Excused records are excluded. {family ? 'Overall attendance does not establish subject eligibility.' : 'A student-day is one student’s daily record, not one lesson.'}</DomainText></InfoDisclosure></InsightPanel>
    <InsightPanel title={comparison ? 'Attendance by class' : 'Attendance by subject'}>{comparisonControls}<InsightRows rows={comparison ? attendance.classes.map(item => ({ id: item.id, name: item.name, value: item.percentage, detail: number(item.attended) + ' / ' + number(item.denominator) + ' student-days' })) : attendance.subjects.map(item => ({ id: item.id, name: item.name, value: item.percentage, detail: number(item.attended) + ' / ' + number(item.counted) + (family ? ' lessons' : ' student-lessons') }))} /><DomainText>{comparison ? 'Daily attendance, not register completion.' : 'Derived from recorded days and the effective timetable, not separately marked lesson attendance. Excused lessons are excluded.'}</DomainText></InsightPanel>
    {access.kind === 'institution' ? <Row title="Attendance review" detail="Students who may need a check-in" variant="plain" onPress={() => onNavigate(domainHref('/areas/insights/review', domainParams(nativeInsightsHref(access, 'review', href)), { via: 'attendance' }))} /> : null}
  </>;
  if (route.topic === 'results' && results) return <>
    <InsightPanel title="Published results"><InsightMetric value={percent(results.overall.average)} label={family ? 'Personal average' : data.selected_class_id ? 'Class average' : access.kind === 'institution' ? 'Institution average' : 'Assigned-work average'} />
    <DomainText>{number(results.overall.scored)} scored results · {number(results.overall.other)} without a score</DomainText>
    {comparisonControls}
    <InsightRows rows={(comparison ? results.classes : results.subjects).map(item => ({ id: item.id, name: item.name, value: item.average, detail: number(item.scored) + ' scored results' }))} />
    <DomainText>Average marks as percentages · not an official term grade. Subjects and classes may have different tests and sample sizes. These comparisons do not rank learners or teachers.</DomainText>
    <InfoDisclosure title="How scores are counted"><DomainText>Individual score percentages are equally weighted. Only the latest published results count, dated by assessment date. Absent, exempt, withheld and unevaluated results are excluded, not zero.</DomainText></InfoDisclosure>
    <ControlButton title={family ? 'View results & feedback' : 'View assessments'} onPress={() => onNavigate(family ? '/areas/assessments/results?' + new URLSearchParams({ scope: access.kind, student_id: access.studentId! }) : '/areas/assessments/' + (access.kind === 'institution' ? 'manage' : 'assigned'))} /></InsightPanel>
    {results.overall.scored > 0 ? <InsightPanel title="Behind the average"><InsightDistribution counts={results.overall.distribution} /><DomainText>Counts results, not unique students. These bands are not pass/fail rules.</DomainText></InsightPanel> : null}
    {access.kind === 'institution' ? <Row title="Learning review" detail="Published results below a review threshold" variant="plain" onPress={() => onNavigate(domainHref('/areas/insights/learning-review', domainParams(nativeInsightsHref(access, 'learning-review', href)), { via: 'results' }))} /> : null}
  </>;
  if (route.topic === 'progress' && results && !family) return <>
    {results.pipeline.some(item => item.status === 'submitted' && item.count > 0) ? <Row title={`${number(results.pipeline.find(item => item.status === 'submitted')?.count)} assessments awaiting review`} variant="plain" onPress={() => onNavigate(`/areas/assessments/${access.kind === 'institution' ? 'manage' : 'assigned'}?status=submitted`)} /> : null}
    <InsightPanel title="Assessment stages"><InsightDonut label="Assessment stages" slices={assessmentSlices(results.pipeline)} />
    <DomainText>Current status of assessments dated in this period; undated drafts use their creation date.</DomainText>
    <ControlButton title="Open assessment workspace" onPress={() => onNavigate('/areas/assessments/' + (access.kind === 'institution' ? 'manage' : 'assigned'))} /></InsightPanel>
  </>;
  if (route.topic === 'institution' && data.institution && access.kind === 'institution') {
    const item = data.institution;
    return <><InsightPanel title="Students & classes"><InsightMetric value={number(item.students)} label="enrolled students" /><DomainText>{number(item.populated_classes)} classes with students · {number(item.average_class_size)} students per class</DomainText>
      <InsightRows unit="count" rows={item.classes.map(cls => ({ id: cls.id, name: cls.name, value: cls.students, detail: 'Active enrolled students' }))} />
      <DomainText>{number(item.configured_classes)} configured classes. Average class size excludes empty classes.</DomainText>
      <InfoDisclosure title="How enrolment is counted"><DomainText>Active enrolments in the selected term, starting by {date(item.enrollment_as_of)}. Students do not need an app account to count. This is the current enrolment record, not historical intake growth or room capacity.</DomainText></InfoDisclosure>
      <ControlButton title="View students & guardians" onPress={() => onNavigate('/areas/people/records')} /></InsightPanel>
      <InsightPanel title="Staff mix"><InsightDonut label="Active staff mix" slices={[{ label: 'Teaching', value: item.teaching_staff, tone: 'action' }, { label: 'Non-teaching', value: item.non_teaching_staff, tone: 'positive' }]} /><InsightMetric value={number(item.students_per_teacher)} label="students per teacher" />
      <DomainText>Active teaching staff headcount, including part-time staff. Not a full-time-equivalent ratio, teaching load or staffing compliance measure.</DomainText>
      <InfoDisclosure title="How staff are counted"><DomainText>Active staff profiles who have joined by {date(item.as_of)}. Onboarding, inactive and future joiners are excluded; an app account is not required.</DomainText></InfoDisclosure><ControlButton title="View staff" onPress={() => onNavigate('/areas/people/records')} /></InsightPanel></>;
  }
  if (route.topic === 'registers' && data.registers && access.kind === 'institution') {
    const item = data.registers;
    return <><InsightPanel title="Scheduled registers"><InsightMetric value={percent(item.percentage)} label="submitted or locked" /><InsightDonut label="Scheduled register states" slices={[{ label: 'Submitted', value: item.submitted, tone: 'action' }, { label: 'Locked', value: item.locked, tone: 'positive' }, { label: 'Not submitted', value: item.outstanding, tone: 'warning' }]} />
      <DomainText>Includes today. Not submitted does not mean overdue or students absent.</DomainText>
      <InfoDisclosure title="How registers are counted"><DomainText>One register per class and scheduled day with active enrolled students. Uses the effective timetable, including published date changes and activities; closures, cancelled lessons and days before enrolment are excluded. Reopened drafts count as not submitted. This measures submission, not verified attendance accuracy.</DomainText></InfoDisclosure>
      {item.unscheduled_classes ? <DomainText>{number(item.unscheduled_classes)} enrolled classes have no scheduled days. Check the timetable before treating this as institution-wide coverage.</DomainText> : null}</InsightPanel>
      <InsightPanel title="By class"><InsightRows rows={item.classes.map(cls => ({ id: cls.id, name: cls.name, value: cls.percentage, detail: number(cls.submitted + cls.locked) + ' of ' + number(cls.expected) + ' submitted · ' + number(cls.outstanding) + ' not submitted', ...(cls.latest_unsubmitted ? { onPress: () => onNavigate('/areas/attendance/registers?' + new URLSearchParams({ class_section_id: cls.id, date: cls.latest_unsubmitted! })) } : {}) }))} /></InsightPanel></>;
  }
  return <Empty title="This topic is not available with your current access" />;
}

function MetricCard({ title, icon, value, label, detail, onPress, children }: React.PropsWithChildren<{ title: string; icon: string; value: string; label: string; detail: string; onPress: () => void }>) {
  return <View style={styles.summaryItem}><InsightPanel {...{ title, icon, onPress }}><InsightMetric {...{ value, label }} />{children}<DomainText>{detail}</DomainText></InsightPanel></View>;
}
function assessmentSlices(pipeline: NonNullable<AnalyticsOverview['assessments']>['pipeline'], compact = false): InsightSlice[] {
  const stages: { label: string; statuses: string[]; tone: InsightSlice['tone'] }[] = compact
    ? [{ label: 'Published', statuses: ['published'], tone: 'positive' }, { label: 'In progress', statuses: ['draft', 'scheduled', 'marking', 'submitted', 'moderated'], tone: 'action' }, { label: 'Cancelled', statuses: ['cancelled'], tone: 'muted' }]
    : [{ label: 'Draft', statuses: ['draft'], tone: 'muted' }, { label: 'Scheduled', statuses: ['scheduled'], tone: 'action' }, { label: 'Being marked', statuses: ['marking'], tone: 'action' }, { label: 'Awaiting review', statuses: ['submitted'], tone: 'warning' }, { label: 'Ready to publish', statuses: ['moderated'], tone: 'warning' }, { label: 'Published', statuses: ['published'], tone: 'positive' }, { label: 'Cancelled', statuses: ['cancelled'], tone: 'muted' }];
  return stages.map(stage => ({ label: stage.label, tone: stage.tone, value: pipeline.filter(item => stage.statuses.includes(item.status)).reduce((sum, item) => sum + item.count, 0) }));
}
type InsightRow = { id: string; name: string; value: number | null; detail: string; onPress?: () => void };
function InsightRows({ title, rows, unit = 'percent' }: { title?: string; rows: InsightRow[]; unit?: 'percent' | 'count' }) {
  const { colors } = useTheme(), [page, setPage] = useState(1);
  const max = unit === 'percent' ? 100 : Math.max(1, ...rows.map(row => row.value ?? 0));
  const currentPage = Math.max(1, Math.min(page, Math.ceil(rows.length / 8) || 1));
  const content = <>{rows.length ? rows.slice((currentPage - 1) * 8, currentPage * 8).map(row => <View key={row.id} style={{ gap: 4, paddingVertical: 8 }}><Row variant="plain" title={row.name} detail={row.detail} status={unit === 'percent' ? percent(row.value) : number(row.value)} onPress={row.onPress} />{row.value !== null ? <View style={{ height: 5, backgroundColor: colors.row, borderRadius: 3 }}><View style={{ height: 5, width: `${Math.max(0, Math.min(1, row.value / max)) * 100}%`, backgroundColor: colors.action, borderRadius: 3 }} /></View> : null}</View>) : <DomainText>No records are available in this period.</DomainText>}<DomainPages page={currentPage} onChange={setPage} hasMore={currentPage * 8 < rows.length} /></>;
  return title ? <Section title={title}>{content}</Section> : <View style={{ gap: 12 }}>{content}</View>;
}

const styles = StyleSheet.create({
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 }, summaryItem: { flexGrow: 1, flexBasis: '46%', minWidth: 260 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginTop: 12 }, sectionTitle: { fontSize: 20, lineHeight: 28, fontWeight: '700' },
  periodCaption: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 4 },
});
