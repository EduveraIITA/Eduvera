import { ScreenBack } from '../../ui/BackNavigation';
import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { InsightStudent, PrincipalInsights } from '../../../../packages/contracts/src/wire/features/principal-insights/api';
import { ApiError } from '../../lib/api';
import { useApi } from '../../lib/query';
import { nativeInsightsBackParent, nativeInsightsRoute, type NativeInstitutionInsightTopic } from '../../lib/native-insights';
import { nativeInstitutionInsightHref, nativeInstitutionInsightPage, nativeInstitutionInsightPath, nativeInstitutionInsightsMatches } from '../../lib/native-institution-insights';
import { Button, Empty, Loading, Notice, Row, Section } from '../../ui/components';
import { ChoiceMenu, ControlButton, Disclosure, InfoDisclosure, SegmentedControl } from '../../ui/DomainControls';
import { useTheme } from '../../ui/theme';
import { Icon } from '../../ui/Icon';
import { TemporalField } from '../../ui/TemporalField';
import { DomainPages, DomainText, domainDate } from '../ResourcesScreen';
import { InsightBars, InsightCoverageWeek, InsightDonut, InsightMeter, InsightMetric, InsightPanel } from './InsightVisuals';

export interface InstitutionInsightsProps { schoolId: string; href: string; onNavigate: (href: string) => void; overview?: boolean | 'attention' | 'operations' }
const topicTitles: Record<NativeInstitutionInsightTopic, string> = { review: 'Attendance review', recording: 'Missing records', followups: 'Family follow-ups', 'learning-review': 'Learning review', operations: 'Coverage & deadlines', finance: 'Fee balances' };
const numeric = (value: number) => Number.isFinite(value) ? new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(value) : 'Unavailable';
const percentage = (value: number | null) => value === null || !Number.isFinite(value) ? 'Not enough records' : `${numeric(value)}%`;
const money = (value: number) => Number.isFinite(value) ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value / 100) : 'Amount unavailable';
const date = (value: string) => { const parts = value.slice(0, 10).split('-').map(Number); return parts.length === 3 ? new Date(parts[0]!, parts[1]! - 1, parts[2]!, 12).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : value; };
const query = (href: string) => new URL(href, 'https://thatcampus.invalid').searchParams;
const pageNumber = (href: string, key: string) => Number(query(href).get(key) ?? '1');
function topicHref(href: string, topic: NativeInstitutionInsightTopic, studentId?: string) {
  const params = query(href); params.set('scope', 'institution'); params.delete('student_id');
  for (const key of ['insight_page', 'recording_page', 'followups_page', 'learning_page', 'coverage_page', 'deadlines_page', 'fee_bands_page']) params.delete(key);
  return `/areas/insights/${topic}${studentId ? `/${encodeURIComponent(studentId)}` : ''}?${params}`;
}
function registerHref(classId: string, when: string, studentId?: string) {
  return `/areas/attendance/registers?${new URLSearchParams({ class_section_id: classId, date: when, ...(studentId ? { student_id: studentId } : {}) })}`;
}

/** Read-only content inside the canonical Insights Page; root verifies contribution access. */
export function InstitutionInsights({ schoolId, href, onNavigate, overview = false }: InstitutionInsightsProps) {
  const route = nativeInsightsRoute(href);
  const path = nativeInstitutionInsightPath(schoolId, href);
  const result = useApi<unknown>(path);
  const refresh = () => { void result.refetch(); };
  const clearClass = query(href).has('class') || query(href).has('class_id') || query(href).has('insight_class') ? <Button title="Clear class filter" kind="secondary" onPress={() => onNavigate(nativeInstitutionInsightHref(href, { class: null, class_id: null, insight_class: null }))} /> : null;
  if (!path || !overview && route.kind !== 'institution-review') return <Empty title="This institution insight is unavailable" message="Open a current institution review from Insights." />;
  if (result.isPending) return overview === 'operations' ? null : <Loading label={overview ? 'Loading attention summary…' : 'Loading review evidence…'} />;
  if (result.isError) return overview === 'operations' ? null : <><Empty title={result.error instanceof ApiError && result.error.status === 403 ? 'Institution insights access is unavailable' : 'Attention summary unavailable'} message={result.error instanceof ApiError && result.error.status === 403 ? 'Your current campus authority does not permit this review. Refresh your workspace to confirm the work available to you.' : result.error.message} onRetry={refresh} />{clearClass}</>;
  if (!nativeInstitutionInsightsMatches(result.data, schoolId, href)) return overview === 'operations' ? null : <><Empty title="The institution review could not be confirmed" message="The returned campus, class, learner or reporting window did not match this view. Refresh before using these insights." onRetry={refresh} />{clearClass}</>;
  const data = result.data;
  if (overview === true || overview === 'attention') {
    const gaps = data.schedule.reduce((sum, item) => sum + item.unassigned, 0);
    return <Section title="For your attention"><DomainText>As of {date(data.operational_date)}</DomainText><View style={{ gap: 0 }}>
      <Row variant="plain" icon="attendance" title={data.engagement.total ? `${numeric(data.engagement.total)} ${data.engagement.total === 1 ? 'student' : 'students'} to check in with` : 'Attendance review'} detail={`${data.engagement.total ? `${numeric(data.engagement.without_followup)} without an open follow-up` : 'No declines meeting the review rules'} · ${data.period.days}-day comparison to ${date(data.period.end)}`} onPress={() => onNavigate(topicHref(href, 'review'))} />
      {data.followups.overdue > 0 ? <Row variant="plain" separator title={`${numeric(data.followups.overdue)} overdue follow-ups`} detail="Review owners and next steps" onPress={() => onNavigate(topicHref(href, 'followups'))} /> : null}
      {gaps > 0 ? <Row variant="plain" separator title={`${numeric(gaps)} periods need teacher coverage`} detail="Next 7 days" onPress={() => onNavigate(topicHref(href, 'operations'))} /> : null}
    </View></Section>;
  }
  if (overview === 'operations') {
    const planned = data.schedule.reduce((sum, item) => sum + item.planned, 0), unassigned = data.schedule.reduce((sum, item) => sum + item.unassigned, 0), due = data.fees.reduce((sum, item) => sum + item.due_paise, 0), paid = data.fees.reduce((sum, item) => sum + item.paid_paise, 0);
    return <Section title="School operations"><DomainText>As of {date(data.operational_date)}</DomainText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
        <View style={{ flexGrow: 1, flexBasis: '46%', minWidth: 260 }}><InsightPanel title="Teaching coverage" icon="timetable" onPress={() => onNavigate(topicHref(href, 'operations'))}><InsightMetric value={planned ? `${Math.round((planned - unassigned) / planned * 100)}%` : '—'} label="periods assigned" /><InsightCoverageWeek days={data.schedule} /><DomainText>{numeric(planned - unassigned)} of {numeric(planned)} periods assigned · next 7 days</DomainText>{data.deadlines.length ? <DomainText>{numeric(data.deadlines.length)} class-days with overlapping deadlines</DomainText> : null}</InsightPanel></View>
        <View style={{ flexGrow: 1, flexBasis: '46%', minWidth: 260 }}><InsightPanel title="Fees due" icon="fees" onPress={() => onNavigate(topicHref(href, 'finance'))}><InsightMetric value={money(data.fees.reduce((sum, item) => sum + item.balance_paise, 0))} label="outstanding" /><DomainText>Against {money(due)} net fees due</DomainText><InsightMeter value={due > 0 ? paid / due * 100 : null} label="Fees allocated" /><DomainText>{money(paid)} allocated · future instalments excluded</DomainText></InsightPanel></View>
      </View>
      <Row variant="plain" title="Family follow-ups" detail={`${numeric(data.followups.awaiting + data.followups.review)} open · ${numeric(data.followups.overdue)} overdue now`} onPress={() => onNavigate(topicHref(href, 'followups'))} />
    </Section>;
  }
  if (route.kind !== 'institution-review') return null;
  return <>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
      <DomainText>{['review', 'recording', 'learning-review'].includes(route.topic) ? `${date(data.period.start)} to ${date(data.period.end)}` : `As of ${date(data.operational_date)}`}</DomainText>
      <ControlButton title="Refresh" onPress={refresh} disabled={result.isFetching} />
    </View>
    {!route.studentId ? <ReviewFilters data={data} href={href} learning={route.topic === 'learning-review'} reviewWindow={['review', 'recording', 'learning-review'].includes(route.topic)} onNavigate={onNavigate} /> : null}
    {route.topic === 'review' ? route.studentId ? <StudentReview data={data} studentId={route.studentId} href={href} onNavigate={onNavigate} /> : <AttendanceReview data={data} href={href} onNavigate={onNavigate} />
      : route.topic === 'recording' ? <RecordingReview data={data} href={href} onNavigate={onNavigate} />
        : route.topic === 'followups' ? <FollowupReview data={data} href={href} onNavigate={onNavigate} />
          : route.topic === 'learning-review' ? <LearningReview data={data} href={href} onNavigate={onNavigate} />
            : route.topic === 'operations' ? <OperationsReview data={data} href={href} onNavigate={onNavigate} />
              : <FinanceReview data={data} href={href} onNavigate={onNavigate} />}
    <DomainText>Updated {domainDate(data.generated_at, data.timezone)} · {data.school_name}</DomainText>
  </>;
}

type ReviewProps = { data: PrincipalInsights; href: string; onNavigate: (href: string) => void };
function ReviewFilters({ data, href, onNavigate, learning, reviewWindow }: ReviewProps & { learning: boolean; reviewWindow: boolean }) {
  const [open, setOpen] = useState(false);
  const change = (values: Record<string, string | null>) => onNavigate(nativeInstitutionInsightHref(href, { insight_page: null, recording_page: null, followups_page: null, learning_page: null, learning_participation_page: null, coverage_page: null, deadlines_page: null, fee_bands_page: null, ...values }));
  // The verified read owns today's campus date, including the selected Simulation clock.
  // A local noon preserves that civil day in both native and browser date controls.
  const maximumDate = new Date(`${data.operational_date}T12:00:00`);
  return <View style={{ gap: 10 }}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}><View style={{ flex: 1, minWidth: 140 }}><ChoiceMenu label="Review class" value={data.class_section_id ?? ''} options={[{ value: '', label: 'All classes' }, ...data.classes.map(item => ({ value: item.id, label: item.name }))]} onChange={value => change({ class: value || null, class_id: null, insight_class: null })} /></View>{reviewWindow ? <ControlButton title={open ? 'Close period' : 'Review period'} onPress={() => setOpen(value => !value)} /> : null}</View>
    {open ? <>
      <DomainText>Comparison window</DomainText>
      <SegmentedControl label="Comparison window" value={String(data.period.days)} options={[14, 28, 56].map(days => ({ value: String(days), label: `${days} days` }))} onChange={value => change({ insight_days: value })} />
      <TemporalField label="Review ending date" mode="date" value={data.period.end} maximumDate={maximumDate} onChange={value => change({ date: value })} />
      {query(href).has('date') ? <ControlButton title="Use current campus date" onPress={() => change({ date: null })} /> : null}
      {learning ? <ChoiceMenu label="Review scored results below" value={String(data.threshold)} options={[...new Set([40, 50, 60, data.threshold])].sort((a, b) => a - b).map(threshold => ({ value: String(threshold), label: `${threshold}%` }))} onChange={value => change({ insight_threshold: value })} /> : null}
    </> : null}
  </View>;
}

function ReviewList<T>({ rows, href, pageKey, onNavigate, children, total }: { rows: readonly T[]; href: string; pageKey: string; onNavigate: (href: string) => void; children: (row: T, index: number) => ReactNode; total?: number }) {
  const page = nativeInstitutionInsightPage(rows, pageNumber(href, pageKey));
  return <>
    {page.rows.map(children)}
    {rows.length ? <DomainText>{Math.min((page.page - 1) * page.pageSize + 1, rows.length)}–{Math.min(page.page * page.pageSize, rows.length)} of {numeric(rows.length)} available records{total !== undefined && total > rows.length ? ` · ${numeric(total)} total; narrow by class to find more` : ''}</DomainText> : null}
    <DomainPages page={page.page} hasMore={page.page < page.totalPages} onChange={next => onNavigate(nativeInstitutionInsightHref(href, { [pageKey]: String(next) }))} />
  </>;
}

function AttendanceReview({ data, href, onNavigate }: ReviewProps) {
  const followup = query(href).get('followup'), missing = followup === 'all' ? false : followup === 'missing' || data.engagement.without_followup > 0;
  const students = missing ? data.engagement.without_followup_students : data.engagement.students, total = missing ? data.engagement.without_followup : data.engagement.total;
  return <>
    <Section title={data.engagement.without_followup ? 'Students who may need a check-in' : data.engagement.total ? 'Follow-ups are already open' : 'No attendance declines meet the review rules'}>
      {data.engagement.without_followup < data.engagement.total ? <SegmentedControl label="Attendance review list" value={missing ? 'missing' : 'all'} options={[{ value: 'missing', label: 'No follow-up', count: data.engagement.without_followup }, { value: 'all', label: 'All', count: data.engagement.total }]} onChange={value => onNavigate(nativeInstitutionInsightHref(href, { followup: value, insight_page: null }))} /> : null}
      {students.length ? <ReviewList rows={students} total={total} href={href} pageKey="insight_page" onNavigate={onNavigate}>{student => <ReviewPerson key={student.id} student={student} onPress={() => onNavigate(topicHref(href, 'review', student.id))} />}</ReviewList> : total > 0 ? <Empty title="The detailed review list is unavailable" message="Refresh the evidence or narrow by class before drawing a conclusion." /> : <DomainText>Missing records still need checking. No matching decline does not mean everyone attended.</DomainText>}
      <Row variant="plain" title="Check missing attendance records" detail={`${numeric(Math.max(0, data.attendance.expected - data.attendance.recorded))} expected student-days unrecorded`} onPress={() => onNavigate(topicHref(href, 'recording'))} />
      <InfoDisclosure title="Why these students?"><DomainText>Recorded attendance fell by at least 10 percentage points compared with the preceding {data.period.days} days. Both windows need at least 5 scored days and 80% recording completeness. This prompts review; it is not a diagnosis or disciplinary flag. Current enrolments and the effective timetable are used.</DomainText></InfoDisclosure>
    </Section>
  </>;
}

function ReviewPerson({ student, onPress }: { student: InsightStudent; onPress: () => void }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={`Review ${student.name}, ${percentage(student.current)}, down ${numeric(Math.abs(student.change))} percentage points`} onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, backgroundColor: colors.row, borderRadius: 20, opacity: pressed ? .7 : 1 })}>
    <View style={{ flex: 1, minWidth: 0, gap: 5 }}><Text style={{ color: colors.ink, fontSize: 16, lineHeight: 23, fontWeight: '600' }}>{student.name}</Text><DomainText>{student.class_name} · {student.open_followups ? 'Follow-up open' : 'No open follow-up'}</DomainText><Text style={{ color: colors.warning, fontSize: 14, lineHeight: 21 }}>Attendance down {numeric(Math.abs(student.change))} points</Text></View>
    <View style={{ alignItems: 'flex-end', gap: 5 }}><Text style={{ color: colors.ink, fontSize: 20, lineHeight: 26, fontWeight: '700' }}>{percentage(student.current)}</Text><DomainText>from {percentage(student.previous)}</DomainText></View><Icon name="chevron" size={18} muted />
  </Pressable>;
}

function StudentReview({ data, studentId, href, onNavigate }: ReviewProps & { studentId: string }) {
  const { colors } = useTheme();
  const student: InsightStudent | undefined | null = data.engagement.focused_student?.id === studentId ? data.engagement.focused_student : [...data.engagement.students, ...data.engagement.without_followup_students].find(item => item.id === studentId);
  if (!student) return <><Empty title="This learner is not in the current review list" message="Return to the review and check the class or comparison window. Another learner has not been selected." /><ScreenBack title="Back to attendance review" fallbackHref={nativeInsightsBackParent(href)?.href ?? topicHref(href, 'review')} /></>;
  return <>
    <ScreenBack title="Back to attendance review" fallbackHref={nativeInsightsBackParent(href)?.href ?? topicHref(href, 'review')} />
    <Section title={student.name}>
      <DomainText>{student.class_name} · {student.open_followups ? 'Follow-up already open' : 'No open follow-up'}</DomainText>
      <InsightPanel title="What changed"><InsightMetric value={numeric(Math.abs(student.change))} label="percentage-point drop in recorded attendance" /><InsightBars rows={[{ name: `${date(data.period.baseline_start)} to ${date(data.period.baseline_end)}`, value: student.previous, detail: `${numeric(student.previous_points)} of ${numeric(student.previous_scored)} counted days attended` }, { name: `${date(data.period.start)} to ${date(data.period.end)}`, value: student.current, detail: `${numeric(student.points)} of ${numeric(student.scored)} counted days attended` }]} /></InsightPanel>
      {student.missing_homework > 0 ? <Notice message={`No completion recorded for ${numeric(student.missing_homework)} homework items. Ask the teacher to confirm; missing completion records do not establish non-submission.`} /> : null}
      <Text accessibilityRole="header" style={{ color: colors.ink, fontSize: 20, lineHeight: 28, fontWeight: '600' }}>Next step</Text><DomainText>{student.open_followups ? 'Review the saved attendance and existing follow-up before contacting the family again.' : 'Review the evidence with the class teacher. Clarification belongs to a saved absence, late arrival or half day.'}</DomainText>
      <Button title={`Review ${student.class_name} register`} onPress={() => onNavigate(registerHref(student.class_id, data.period.end, student.id))} />
      <InfoDisclosure title="Evidence used"><DomainText>{numeric(student.recorded)} of {numeric(student.expected)} expected student-days recorded now; {numeric(student.previous_recorded)} of {numeric(student.previous_expected)} previously. Half days count as half; excused records are excluded from the percentage. Missing records are not absences.</DomainText></InfoDisclosure>
    </Section>
  </>;
}

function RecordingReview({ data, href, onNavigate }: ReviewProps) {
  return <InsightPanel title="Recording completeness">
    <InsightMetric value={percentage(data.attendance.completeness)} label="expected student-days recorded" /><DomainText>{numeric(data.attendance.recorded)} of {numeric(data.attendance.expected)} student-days</DomainText>
    {data.attendance.classes.length ? <ReviewList rows={data.attendance.classes} href={href} pageKey="recording_page" onNavigate={onNavigate}>{item => <View key={item.id} style={{ gap: 4 }}><Row variant="plain" title={item.name} detail={`${numeric(item.recorded)} of ${numeric(item.expected)} student-days recorded`} status={percentage(item.completeness)} onPress={() => onNavigate(registerHref(item.id, data.period.end))} /><InsightMeter value={item.completeness} label={`${item.name} recording completeness`} /></View>}</ReviewList> : <Empty title="No expected class-days in this review window" />}
    <DomainText>Missing records are not absences. This measures recorded student-days using current enrolments and the effective schedule; it does not measure submitted registers.</DomainText>
    <ControlButton title="Review attendance registers" onPress={() => onNavigate(data.class_section_id ? registerHref(data.class_section_id, data.period.end) : `/areas/attendance/registers?date=${encodeURIComponent(data.period.end)}`)} />
  </InsightPanel>;
}

function FollowupReview({ data, href, onNavigate }: ReviewProps) {
  const total = data.followups.awaiting + data.followups.review;
  return <InsightPanel title="Open follow-ups">
    <InsightDonut label="Current follow-up status" slices={[{ label: 'Awaiting family reply', value: data.followups.awaiting, tone: 'action' }, { label: 'School review', value: data.followups.review, tone: 'warning' }]} />{data.followups.overdue > 0 ? <DomainText>{numeric(data.followups.overdue)} overdue</DomainText> : null}
    {data.followups.details.length ? <ReviewList rows={data.followups.details} total={total} href={href} pageKey="followups_page" onNavigate={onNavigate}>{item => <Row variant="plain" separator key={item.id} title={item.student_name} detail={`${item.state === 'in_review' ? 'School review' : 'Awaiting reply'} · Owner: ${item.owner}\nAttendance source · ${date(item.attendance_date)}${item.class_id ? '' : '\nExact source register unavailable'}`} status={item.overdue ? 'Overdue' : undefined} onPress={item.class_id ? () => onNavigate(registerHref(item.class_id, item.attendance_date)) : undefined} />}</ReviewList> : total ? <Empty title="The follow-up detail list is unavailable" message="Refresh or narrow by class to inspect the open work." /> : <Empty title="No open follow-ups in this scope" />}
    <DomainText>{numeric(data.followups.resolved)} resolved between {date(data.period.start)} and {date(data.period.end)}. Counts follow-up records, not unique students; resolution does not establish improved attendance. Open a source register to review its existing follow-up.</DomainText>
  </InsightPanel>;
}

function LearningReview({ data, href, onNavigate }: ReviewProps) {
  const assessed = data.learning.filter(item => item.assessed > 0);
  return <InsightPanel title="Results to review">
    <InsightMetric value={numeric(assessed.reduce((sum, item) => sum + item.below, 0))} label={`scored results below ${numeric(data.threshold)}%`} /><DomainText>Latest result releases published in this review window</DomainText>
    {assessed.length ? <ReviewList rows={assessed} href={href} pageKey="learning_page" onNavigate={onNavigate}>{item => <View key={item.id} style={{ gap: 4 }}><Row variant="plain" title={`${item.class_name} · ${item.subject}`} detail={`${numeric(item.below)} of ${numeric(item.assessed)} scored results below ${numeric(data.threshold)}% · ${item.title}`} onPress={() => onNavigate(`/areas/assessments/manage?assessment=${encodeURIComponent(item.id)}`)} /><InsightMeter value={item.below / item.assessed * 100} label={`Results below review threshold, ${item.title}`} /></View>}</ReviewList> : <Empty title="No scored, published assessments in this review window" />}
    <DomainText>This is a review threshold, not a pass/fail policy or topic mastery. A learner may appear in several assessments. The review window uses publication dates; the results average uses assessment dates. Unpublished and missing scores are excluded.</DomainText>
    <Disclosure title="Assessment participation"><ReviewList rows={data.learning} href={href} pageKey="learning_participation_page" onNavigate={onNavigate}>{item => <Row key={item.id} variant="plain" separator title={item.title} detail={`${item.class_name} · ${numeric(item.assessed)} of ${numeric(item.roster)} scored\nPublished ${date(item.published_at)}`} />}</ReviewList></Disclosure>
    <ControlButton title="Open assessments" onPress={() => onNavigate('/areas/assessments/manage')} />
  </InsightPanel>;
}

function OperationsReview({ data, href, onNavigate }: ReviewProps) {
  const planned = data.schedule.reduce((sum, item) => sum + item.planned, 0), unassigned = data.schedule.reduce((sum, item) => sum + item.unassigned, 0);
  return <>
    <InsightPanel title="Teaching coverage · next 7 days">
      <InsightDonut label="Scheduled teaching coverage" slices={[{ label: 'Assigned', value: planned - unassigned, tone: 'positive' }, { label: 'Unassigned', value: unassigned, tone: 'warning' }]} />
      {data.schedule.length ? <ReviewList rows={data.schedule} href={href} pageKey="coverage_page" onNavigate={onNavigate}>{item => <View key={item.date} style={{ gap: 4 }}><Row variant="plain" title={date(item.date)} detail={`${numeric(item.planned - item.unassigned)} of ${numeric(item.planned)} periods assigned · ${numeric(item.cancelled)} cancelled`} status={item.unassigned ? `${numeric(item.unassigned)} unassigned` : undefined} onPress={() => onNavigate(`/areas/timetable/schedule?date=${encodeURIComponent(item.date)}`)} /><InsightMeter value={item.planned ? (item.planned - item.unassigned) / item.planned * 100 : null} label={`Teaching coverage ${item.date}`} /></View>}</ReviewList> : <Empty title="No planned teaching periods returned" />}
      <DomainText>Assigned does not mean taught. Unaccepted cover remains unassigned. These are the next 7 days from {date(data.operational_date)}, independent of the historical review window.</DomainText>
    </InsightPanel>
    <InsightPanel title="Overlapping deadlines">
      <DomainText>Class-days with at least 3 homework or assessment deadlines in the next 7 days.</DomainText>
      {data.deadlines.length ? <ReviewList rows={data.deadlines} href={href} pageKey="deadlines_page" onNavigate={onNavigate}>{item => <Row variant="plain" separator key={`${item.class_id}:${item.date}`} title={item.class_name} detail={`${date(item.date)} · ${numeric(item.homework)} homework, ${numeric(item.assessments)} assessments`} status={`${numeric(item.total)} due`} />}</ReviewList> : <Empty title="No overlapping deadlines meet this rule" />}
      <DomainText>This measures timing conflicts; it does not estimate hours or assignment difficulty.</DomainText>
    </InsightPanel>
  </>;
}

function FinanceReview({ data, href, onNavigate }: ReviewProps) {
  const order = ['Due today', '1–30 days', '31–60 days', '61–90 days', '91+ days'];
  const fees = [...data.fees].sort((a, b) => order.indexOf(a.band) - order.indexOf(b.band));
  const maxBalance = Math.max(1, ...fees.map(item => item.balance_paise));
  return <InsightPanel title="Outstanding fees">
    <InsightMetric value={money(fees.reduce((sum, item) => sum + item.balance_paise, 0))} label="outstanding" /><DomainText>{money(fees.reduce((sum, item) => sum + item.paid_paise, 0))} allocated against {money(fees.reduce((sum, item) => sum + item.due_paise, 0))} net fees due</DomainText>
    {fees.length ? <ReviewList rows={fees} href={href} pageKey="fee_bands_page" onNavigate={onNavigate}>{item => <View key={item.band} style={{ gap: 4 }}><Row variant="plain" title={item.band} detail={`${money(item.paid_paise)} allocated against ${money(item.due_paise)} due`} status={money(item.balance_paise)} /><InsightMeter value={item.balance_paise / maxBalance * 100} label={`${item.band} share of largest ageing balance`} /></View>}</ReviewList> : <Empty title="No fee invoices are due" />}
    <DomainText>As of {date(data.operational_date)}. Credits, allocated payments and refunds are included; future instalments are excluded. Due today is not overdue. This view contains aggregate ageing, not individual balances.</DomainText>
    <ControlButton title="Open fee ledger" onPress={() => onNavigate('/areas/fees/ledger')} />
  </InsightPanel>;
}
export { topicTitles as nativeInstitutionInsightTitles };
