import { AssessmentScheduleAmendmentScreen } from './AssessmentScheduleAmendmentScreen';
import { formatCampusDateTime } from '../lib/browser-temporal';
import { mayAmendExamSchedule } from '../lib/assessment-schedule-amendments';
import { iconForDestination } from '../ui/icon-semantics';
import { useOperationContext } from '../lib/use-operation-context';
import { assessmentWorkspacePath } from '../lib/assessment-authoring';
import { ScreenBack, useScreenExitGuard } from '../ui/BackNavigation';
import React, { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Alert } from '../ui/Alert';
import { assertWorkspaceManifestContext, normalizeWorkspaceManifest } from '../../../packages/contracts/src/workspace-normalizer';
import type { AssessmentDetail as Detail, AssessmentWorkspace, FamilyResults as FamilyResultsWire, OwnAssessmentResults } from '../../../packages/contracts/src/assessments';
import type { FamilyReportCards, OwnReportCards } from '../../../packages/contracts/src/academic-reports';
import { assessmentPrimaryResult, creditNumber, policyDescription, reportPrimaryResult, resultNumber } from '../../../packages/contracts/src/result-presentation';
import { useSession } from '../auth/SessionProvider';
import { captureApiContext, getApiOrigin } from '../lib/api';
import { useNativePendingAction } from '../lib/native-pending-action';
import { useApi } from '../lib/query';
import { academicOfferingHref } from '../lib/academic-report-context';
import { assessmentResultRelationships, reportRelationshipKey, resolveAssessmentResultRelationship } from '../lib/academic-report-policy';
import { publishedOwnReportAttentionProof, publishedReportAttentionProof } from '../lib/report-attention';
import { useReportAttention } from '../lib/use-report-attention';
import { Button, Empty, Field, Loading, Notice, Page, Row, SearchField, Section } from '../ui/components';
import { ChoiceMenu, ControlButton, Disclosure, Facts, InfoDisclosure } from '../ui/DomainControls';
import { useTheme } from '../ui/theme';
import { PrintMarksheetControls } from './reports/PrintMarksheetControls';
import { PolicyDetails } from './reports/AcademicReportForms';
import { AssessmentAuthoringScreen } from './AssessmentAuthoringScreen';
import { AssessmentExamDay } from './AssessmentExamDayScreen';
import { AssessmentEvidenceScreen } from './AssessmentEvidenceScreen';
import { assessmentLifecycleInput,assessmentOperationAcceptedPath,assessmentOperationSaved,assessmentResultsInput } from '../lib/assessment-operations';
import { AssessmentPages, AssessmentResultRow, AssessmentStatus, PublishedResultRow, PublishedResultSummary } from './assessments/AssessmentViews';

type Props = { href: string; onNavigate: (href: string) => void };
type ResultDraft = { result_id: string; outcome: string; marks: string; grade: string; feedback: string; expected_revision: number; reason: string };
const queryOf = (href: string) => new URLSearchParams(href.split('?')[1] ?? '');
function hrefWith(href: string, values: Record<string, string>) { const q = queryOf(href); for (const [key, value] of Object.entries(values)) { if (value) q.set(key, value); else q.delete(key); } return `${href.split('?')[0]}${q.size ? `?${q}` : ''}`; }
const nice = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : 'The action was not confirmed.';
const when = (value: string | null) => value ? new Date(value).toLocaleString() : 'Not scheduled';
const assessmentStatuses = ['all', 'draft', 'scheduled', 'marking', 'submitted', 'moderated', 'published', 'cancelled'];
const assessmentStatusLabel = (value: string) => value === 'all' ? 'All assessments' : value === 'submitted' ? 'To review' : value === 'moderated' ? 'Ready to publish' : nice(value);
export function nativeAssessmentMark(value: string, maximum: string) {
  const parsed = value.trim();
  if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(parsed)) throw new Error('Enter valid marks with at most two decimal places.');
  const number = Number(parsed), limit = Number(maximum);
  if (!Number.isFinite(limit) || limit <= 0 || number > limit) throw new Error('Marks must be within this assessment’s maximum.');
  return number;
}

export function AssessmentsScreen(props: Props) {
  const { schoolId, scopeKey, user, environment } = useSession();
  const manifestQuery = useApi<unknown>(schoolId ? '/api/v1/workspace' : null);
  const manifest = useMemo(() => { try { if (!manifestQuery.data || !schoolId || !user) return null; const value = normalizeWorkspaceManifest(manifestQuery.data); assertWorkspaceManifestContext(value, { actorUserId: user.id, institutionId: schoolId, environment }); return value; } catch { return null; } }, [manifestQuery.data, schoolId, user?.id, environment]);
  if (!schoolId) return <Page title="Assessments"><Empty title="Choose a campus" /></Page>;
  if (manifestQuery.isPending) return <Page title="Assessments"><Loading /></Page>;
  if (manifestQuery.isError || !manifest) return <Page title="Assessments"><Empty title="Assessment access could not be confirmed" message={manifestQuery.error?.message} onRetry={() => void manifestQuery.refetch()} /></Page>;
  const surfaces = manifest.areas.find(area => area.key === 'assessments')?.surfaces ?? [], q = queryOf(props.href), path = props.href.split('?')[0];
  if (path === '/areas/assessments') return <Page title="Assessments" subtitle="Your assessment work and published results"><Section title="Available to you">{surfaces.length ? surfaces.map(surface => <Row key={surface.key} title={surface.label} detail={surface.description} icon={iconForDestination(surface.href)} iconDestination={surface.href} onPress={() => props.onNavigate(academicOfferingHref(surface.href, props.href))} />) : <Empty title="No assessment work is currently available" />}</Section></Page>;
  if (path.endsWith('/results') || path === '/areas/results') {
    const resultHref = path === '/areas/results' ? `/areas/assessments/results${q.size ? `?${q}` : ''}` : props.href;
    const options = assessmentResultRelationships(manifest), relationship = resolveAssessmentResultRelationship(manifest, resultHref), explicit = q.has('scope') || q.has('student_id') || q.has('person_id');
    if (relationship) return <NativeFamilyResults key={`${scopeKey}:${reportRelationshipKey(relationship)}`} {...props} href={resultHref} schoolId={schoolId} {...(relationship.kind === 'mine' ? { personId: relationship.personId } : { studentId: relationship.studentId })} label={relationship.label} relationships={options.map(option => ({ value: reportRelationshipKey(option), label: option.label, href: option.href }))} />;
    return <Page title="Results">{!explicit && options.length ? <Section title="Whose results?">{options.map(option => <Row key={reportRelationshipKey(option)} title={option.label} icon={iconForDestination(option.href)} iconDestination={option.href} onPress={() => props.onNavigate(academicOfferingHref(option.href, props.href))} />)}</Section> : <Empty title="This result account is unavailable" message="The exact selected learner is no longer in your current relationships." />}<ScreenBack title="Back to assessments" fallbackHref={'/areas/assessments'} /></Page>;
  }
  const surface = path.endsWith('/manage') ? 'manage' : path.endsWith('/assigned') ? 'assigned' : '';
  if (!surface || !surfaces.some(item => item.key === surface)) return <Page title="Assessments"><Empty title="This assessment workspace is unavailable" /><ScreenBack title="Back to assessments" fallbackHref={'/areas/assessments'} /></Page>;
  return <AssignedAssessments key={`${scopeKey}:${surface}`} {...props} schoolId={schoolId} />;
}

export function NativeFamilyResults({ href, onNavigate, schoolId, studentId, personId, label, owningArea = 'assessments', relationships }: Props & { schoolId: string; studentId?: string; personId?: string; label: string; owningArea?: 'reports' | 'assessments'; relationships?: Array<{ value: string; label: string; href: string }> }) {
  const q = queryOf(href), assessmentId = q.get('assessment_id'), publicationId = q.get('publication_id'), reportId = q.get('report_batch_id');
  const target = personId && !studentId ? { personId } : studentId && !personId ? { studentId } : null;
  const suffix = target ? target.personId !== undefined ? `mine/?${new URLSearchParams({ person_id: target.personId })}` : `family/?${new URLSearchParams({ student_id: target.studentId })}` : null;
  const results = useApi<FamilyResultsWire | OwnAssessmentResults>(suffix ? `/api/v1/schools/${encodeURIComponent(schoolId)}/assessments/${suffix}` : null);
  const reports = useApi<FamilyReportCards | OwnReportCards>(suffix ? `/api/v1/schools/${encodeURIComponent(schoolId)}/academic-reports/${suffix}` : null);
  const [search, setSearch] = useState(q.get('result_search') ?? ''), [page, setPage] = useState(() => { const value = Number(q.get('result_page')); return Number.isSafeInteger(value) && value > 0 ? value : 1; });
  const [searchOpen, setSearchOpen] = useState(Boolean(q.get('result_search')));
  const [requestedYear, setYear] = useState(q.get('result_year') ?? '');
  const [kind, setKind] = useState(q.get('result_kind') === 'term' || q.get('result_kind') === 'assessment' ? q.get('result_kind')! : 'all');
  const resultData = results.data && Array.isArray(results.data.results) && (personId ? 'learner' in results.data && results.data.learner?.person_id === personId && results.data.learner.learner_id === personId : 'student' in results.data && results.data.student?.id === studentId) ? results.data : undefined;
  const reportData = reports.data && Array.isArray(reports.data.reports) && (personId ? 'learner' in reports.data && reports.data.learner?.person_id === personId && reports.data.learner.learner_id === personId : 'student' in reports.data && reports.data.student?.id === studentId) ? reports.data : undefined;
  const learner = resultData ? 'learner' in resultData ? resultData.learner : resultData.student : reportData ? 'learner' in reportData ? reportData.learner : reportData.student : undefined;
  const currentClass = resultData && 'student' in resultData ? resultData.student.class_name : null;
  const resultUnavailable = results.isError || !!results.data && !resultData, reportUnavailable = reports.isError || !!reports.data && !reportData;
  const invalidSelection = !target || !!personId && (q.get('scope') !== 'mine' || q.get('person_id') !== personId || q.has('student_id')) || !!studentId && (q.has('person_id') || q.has('student_id') && q.get('student_id') !== studentId || q.get('scope') === 'mine') || ['assessment_id', 'publication_id', 'report_batch_id', 'student_id', 'person_id', 'scope'].some(key => q.getAll(key).length > 1) || ['assessment_id', 'publication_id', 'report_batch_id'].some(key => q.has(key) && !q.get(key)) || !!(assessmentId || publicationId) && (!assessmentId || !publicationId || !!reportId);
  const exactResult = !resultUnavailable ? resultData?.results.find(result => result.id === assessmentId && result.publication_id === publicationId) : undefined;
  const exactReport = !reportUnavailable ? reportData?.reports.find(report => report.batch_id === reportId) : undefined;
  const years = [...new Set([...(resultUnavailable ? [] : resultData?.results.map(result => result.academic_year) ?? []), ...(reportUnavailable ? [] : reportData?.reports.map(report => report.academic_year) ?? [])])].filter(Boolean).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  const year = requestedYear === 'all' || years.includes(requestedYear) ? requestedYear : exactReport?.academic_year ?? exactResult?.academic_year ?? years[0] ?? 'all';
  const needle = search.trim().toLocaleLowerCase();
  const visibleReports = reportUnavailable ? [] : reportData?.reports.filter(report => (year === 'all' || report.academic_year === year) && (!needle || [report.scheme_name, report.term_name, report.academic_year, ...report.subjects.map(subject => subject.subject_name)].some(value => value.toLocaleLowerCase().includes(needle)))) ?? [];
  const visibleResults = resultUnavailable ? [] : resultData?.results.filter(result => (year === 'all' || result.academic_year === year) && (!needle || [result.title, result.subject_name, result.cycle_name, result.term_name, result.academic_year, nice(result.assessment_kind)].some(value => value.toLocaleLowerCase().includes(needle)))) ?? [];
  const records = [...(kind === 'term' ? [] : visibleResults.filter(result => kind === 'assessment' || !visibleReports.some(report => report.subjects.some(subject => subject.assessment_ids?.includes(result.id)))).map(result => ({ key: `assessment:${result.publication_id}:${result.id}`, title: result.title, detail: `${result.term_name} · ${result.academic_year}`, publishedAt: result.published_at, result }))), ...(kind === 'assessment' ? [] : visibleReports.map(report => ({ key: `report:${report.batch_id}`, title: report.scheme_name, detail: `${report.term_name} · ${report.academic_year}`, publishedAt: report.published_at, report })))].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const pages = Math.max(1, Math.ceil(records.length / 10)), currentPage = Math.min(page, pages), selected = !!(assessmentId || publicationId || reportId);
  const resultPrimary = exactResult ? assessmentPrimaryResult(exactResult) : null, reportPrimary = exactReport ? reportPrimaryResult(exactReport) : null;
  const attentionProof = invalidSelection ? null : personId ? publishedOwnReportAttentionProof(href, personId, !resultUnavailable && resultData && 'learner' in resultData ? resultData : undefined, !reportUnavailable && reportData && 'learner' in reportData ? reportData : undefined)
    : publishedReportAttentionProof(href, studentId!, !resultUnavailable && resultData && 'student' in resultData ? resultData : undefined, !reportUnavailable && reportData && 'student' in reportData ? reportData : undefined);
  useReportAttention(attentionProof, Math.max(results.dataUpdatedAt, reports.dataUpdatedAt), onNavigate);
  if (invalidSelection) return <Page title="Results & progress"><ScreenBack fallbackHref={`/areas/${owningArea}`} title={`Back to ${owningArea}`} /><Empty title="This published selection is invalid" message="Choose one exact report or assessment publication. No different publication was selected." /></Page>;
  return <Page title={exactResult?.title ?? exactReport?.scheme_name ?? 'Results & progress'} subtitle={learner ? `${learner.first_name} ${learner.last_name}${currentClass ? ` · ${currentClass}` : ''}` : label} refreshing={results.isRefetching || reports.isRefetching} onRefresh={() => { void results.refetch(); void reports.refetch(); }}>
    <ScreenBack fallbackHref={selected ? hrefWith(href, { assessment_id: '', publication_id: '', report_batch_id: '', attention_notification_id: '' }) : `/areas/${owningArea}`} title={selected ? 'Back to results' : `Back to ${owningArea}`} />
    {q.has('attention_notification_id') && selected && !attentionProof && !(reportId ? reports.isPending : results.isPending) ? <Notice tone="warning" message="This published result no longer matches the alert. It was not marked as opened." /> : null}
    {!selected && relationships && relationships.length > 1 ? <ChoiceMenu label="Learner" value={`${q.get('scope')}:${personId ?? studentId}`} options={relationships} onChange={value => { const option = relationships.find(item => item.value === value); if (option) onNavigate(option.href); }} /> : null}
    {selected ? (reportId ? reports.isPending : results.isPending) ? <Loading /> : exactResult && resultPrimary ? <>
      <PrintMarksheetControls schoolId={schoolId} {...target} selection={{ kind: 'assessment', assessmentId: exactResult.id, publicationId: exactResult.publication_id }} /><PublishedResultSummary label={resultPrimary.label} value={resultPrimary.value} secondary={resultPrimary.secondary ? `Grade ${resultPrimary.secondary}` : nice(exactResult.outcome)} />
      <Facts items={[{ label: 'Subject', value: exactResult.subject_name }, { label: 'Term', value: `${exactResult.term_name} · ${exactResult.academic_year}` }]} />
      {exactResult.feedback ? <Section title="Remarks"><Row title="Teacher" detail={exactResult.feedback} variant="plain" /></Section> : null}
      <InfoDisclosure title="Record details"><Facts items={[{ label: 'Release', value: String(exactResult.sequence) }, { label: 'Published', value: when(exactResult.published_at) }, { label: 'Cycle', value: exactResult.cycle_name }, { label: exactResult.context_kind === 'learning_offering' ? 'Course' : 'Class', value: exactResult.class_name ?? 'Not recorded' }]} />{exactResult.result_policy ? <Row title={exactResult.result_policy.name} detail={`Version ${exactResult.result_policy.version} · ${policyDescription(exactResult.result_policy)}`} variant="plain" /> : null}</InfoDisclosure>
    </> : exactReport && reportPrimary ? <>
      <PrintMarksheetControls schoolId={schoolId} {...target} selection={{ kind: 'report', batchId: exactReport.batch_id }} /><PublishedResultSummary label={reportPrimary.label} value={exactReport.outcome === 'withheld' ? 'Withheld' : reportPrimary.value} secondary={[reportPrimary.secondary ? `Grade ${reportPrimary.secondary}` : '', nice(exactReport.outcome), exactReport.sequence > 1 ? 'Corrected release' : ''].filter(Boolean).join(' · ')} />
      <Facts items={[{ label: 'Term', value: `${exactReport.term_name} · ${exactReport.academic_year}` }, { label: 'Subjects', value: `${exactReport.subjects.filter(subject => subject.outcome === 'complete').length} of ${exactReport.subjects.length} complete` }, ...(exactReport.cgpa != null ? [{ label: 'CGPA', value: exactReport.outcome === 'withheld' ? 'Withheld' : resultNumber(exactReport.cgpa, exactReport.result_policy) }] : [])]} />
      {exactReport.gpa_unavailable_reason || exactReport.cgpa_unavailable_reason ? <Notice message={`Calculation unavailable: ${nice(exactReport.cgpa_unavailable_reason ?? exactReport.gpa_unavailable_reason ?? '')}. Missing results were not converted to zero.`} /> : null}
      <Section title="Subjects">{exactReport.subjects.map(subject => <Row key={subject.id} title={subject.subject_name} detail={subject.outcome === 'withheld' || exactReport.outcome === 'withheld' ? 'Withheld' : [subject.course_code || null, subject.grade || null, !['grade', 'gpa'].includes(exactReport.result_policy?.configuration.result_format ?? '') && subject.percentage != null ? `${resultNumber(subject.percentage, exactReport.result_policy)}%` : null, exactReport.result_policy?.configuration.result_format === 'gpa' && subject.grade_points != null ? `${resultNumber(subject.grade_points, exactReport.result_policy)} grade points` : null, subject.credits != null ? `${creditNumber(subject.credits)} credits` : null, subject.passed === false ? 'Below pass' : subject.outcome !== 'complete' ? nice(subject.outcome) : null].filter(Boolean).join(' · ')} />)}</Section>
      {exactReport.class_teacher_comment || exactReport.principal_comment ? <Section title="Remarks">{exactReport.class_teacher_comment ? <Row title="Class teacher" detail={exactReport.class_teacher_comment} variant="plain" /> : null}{exactReport.principal_comment ? <Row title="Principal" detail={exactReport.principal_comment} variant="plain" /> : null}</Section> : null}
      <InfoDisclosure title="Record details"><Facts items={[{ label: 'Release', value: String(exactReport.sequence) }, { label: 'Published', value: when(exactReport.published_at) }, { label: 'Class', value: exactReport.class_name ?? 'Not recorded' }]} />{exactReport.correction_reason ? <Row title="Correction reason" detail={exactReport.correction_reason} variant="plain" /> : null}{exactReport.result_policy ? <><Row title={exactReport.result_policy.name} detail={`Version ${exactReport.result_policy.version} · ${policyDescription(exactReport.result_policy)}`} variant="plain" /><PolicyDetails configuration={exactReport.result_policy.configuration} />{exactReport.cumulative_sources?.map((source, index) => <Row key={index} title={source.course_code} detail={`Term ${source.term_index} · ${creditNumber(source.credits)} credits · ${source.grade_points == null ? 'Unknown' : resultNumber(source.grade_points, exactReport.result_policy)} points · ${source.included ? 'Included' : 'Superseded attempt'} · ${nice(source.outcome)} · Release ${source.batch_id.slice(0, 8).toUpperCase()}`} variant="plain" />)}</> : null}</InfoDisclosure>
    </> : <Empty title="This published result is unavailable" message={(reportId ? reports.error?.message : results.error?.message) ?? 'The exact publication no longer matches an available result. No different publication was selected.'} onRetry={() => { void results.refetch(); void reports.refetch(); }} /> : <>
      {resultUnavailable ? <Empty title="Assessment results could not load" message={results.error?.message ?? 'The returned learner does not match this exact result account.'} onRetry={() => void results.refetch()} /> : null}{reportUnavailable ? <Empty title="Term reports could not load" message={reports.error?.message ?? 'The returned learner does not match this exact report account.'} onRetry={() => void reports.refetch()} /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><ChoiceMenu label="Academic year" value={year} options={[{ value: 'all', label: 'All years' }, ...years.map(value => ({ value, label: value }))]} onChange={value => { setYear(value); setPage(1); }} /><ChoiceMenu label="Result type" value={kind} options={[{ value: 'all', label: 'All results' }, { value: 'term', label: 'Term reports' }, { value: 'assessment', label: 'Assessments' }]} onChange={value => { setKind(value); setPage(1); }} /><ControlButton title={searchOpen ? 'Close search' : 'Search'} kind="secondary" onPress={() => { if (searchOpen) { setSearch(''); setPage(1); } setSearchOpen(value => !value); }} /></View>
      {searchOpen ? <SearchField label="Find a result" value={search} onChangeText={value => { setSearch(value); setPage(1); }} placeholder="Subject, assessment or report" /> : null}
      {results.isPending && reports.isPending ? <Loading /> : records.length ? <Section title={`${records.length} published ${records.length === 1 ? 'result' : 'results'}`}>{records.slice((currentPage - 1) * 10, currentPage * 10).map(record => {
        const result = 'result' in record ? record.result : undefined, report = 'report' in record ? record.report : undefined;
        const primary = result ? assessmentPrimaryResult(result) : reportPrimaryResult(report!);
        const filters = { result_year: year, result_kind: kind, result_search: search, result_page: String(currentPage) };
        return <PublishedResultRow key={record.key} title={record.title} type={report ? 'Term report' : result!.subject_name} detail={record.detail} published={`Published ${new Date(record.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}${(result?.sequence ?? report?.sequence ?? 1) > 1 ? ' · Corrected' : ''}`} value={report?.outcome === 'withheld' ? 'Withheld' : primary.value} secondary={primary.label === 'SGPA' || primary.label === 'Grade points' ? primary.label : primary.secondary ? `Grade ${primary.secondary}` : undefined} onPress={() => result ? onNavigate(hrefWith(href, { ...filters, assessment_id: result.id, publication_id: result.publication_id, report_batch_id: '' })) : onNavigate(hrefWith(href, { ...filters, report_batch_id: report!.batch_id, assessment_id: '', publication_id: '' }))} />;
      })}</Section> : !results.isPending && !reports.isPending ? <Empty title={search || year !== 'all' || kind !== 'all' ? 'No matching results' : 'No published results here'} message={search || kind !== 'all' ? 'Try another year, result type or search.' : 'Results appear after the campus publishes them.'} /> : <Loading />}
      <AssessmentPages page={currentPage} pages={pages} total={records.length} pageSize={10} onPage={setPage} />
    </>}
  </Page>;
}

function AssignedAssessments({ href, onNavigate, schoolId }: Props & { schoolId: string }) {
  const q = queryOf(href), selectedId = q.get('assessment');
  const workspace = useApi<AssessmentWorkspace>(assessmentWorkspacePath(schoolId));
  const detail = useApi<Detail>(selectedId ? `/api/v1/schools/${encodeURIComponent(schoolId)}/assessments/${encodeURIComponent(selectedId)}/` : null);
  const [search, setSearch] = useState(''), [status, setStatus] = useState(q.get('status') ?? 'all'), [page, setPage] = useState(1);
  const [searchOpen, setSearchOpen] = useState(false);
  const items = workspace.isError ? [] : workspace.data?.assessments.filter(item => (!q.get('offering_id') || item.offering_id === q.get('offering_id')) && (status === 'all' || item.status === status) && `${item.title} ${item.subject_name} ${item.class_name}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) ?? [];
  const pages = Math.max(1, Math.ceil(items.length / 10)), currentPage = Math.min(page, pages);
  if (['assessment','create','edit','offering_id'].some(key => q.getAll(key).length>1) || selectedId && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(selectedId) || q.has('offering_id') && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(q.get('offering_id') ?? '')) return <Page title="Assessments"><Empty title="Choose one exact assessment" /></Page>;
  if (selectedId && ['schedule-amendment','confirm-schedule'].includes(q.get('edit') ?? '')) return <AssessmentScheduleAmendmentScreen href={href} schoolId={schoolId} assessmentId={selectedId} confirm={q.get('edit') === 'confirm-schedule'} />;
  if (['assessment','class-test','cycle'].includes(q.get('create') ?? '') || q.get('edit') === 'arrangements' && !!selectedId) return <AssessmentAuthoringScreen href={href} schoolId={schoolId} mode={q.get('edit') === 'arrangements' ? 'arrangements' : q.get('create') === 'cycle' ? 'cycle' : 'assessment'} assessmentId={selectedId ?? undefined} />;
  const accessLost = detail.isError && [401,403,404].includes(Number((detail.error as {status?: number})?.status));
  if (selectedId) return detail.isPending ? <Page title="Assessment"><Loading /></Page> : accessLost || !detail.data || detail.data.assessment.id !== selectedId ? <Page title="Assessment"><ScreenBack title="Back to assessments" fallbackHref={hrefWith(href, { assessment: '' })} /><Empty title="Assessment unavailable" message={detail.error?.message ?? 'The returned assessment did not match this exact selection.'} onRetry={() => void detail.refetch()} /></Page> : <AssessmentDetail key={selectedId} {...{ href, onNavigate, schoolId }} initial={detail.data} readFailure={detail.isError ? detail.error.message : ''} refresh={async () => { const transport = captureApiContext(); await detail.refetch({ throwOnError: true }); transport.assertCurrent(); await workspace.refetch(); transport.assertCurrent(); }} />;
  return <Page title={workspace.data?.mode === 'admin' ? 'Assessment coordination' : 'Assessments & marking'} refreshing={workspace.isRefetching} onRefresh={() => void workspace.refetch()}>
    <ScreenBack title="Back to assessments" fallbackHref={'/areas/assessments'} />
    {workspace.isPending ? <Loading /> : workspace.isError ? <Empty title="Assessments could not load" message={workspace.error.message} onRetry={() => void workspace.refetch()} /> : <>
      {workspace.data?.mode === 'admin' || workspace.data?.mode === 'staff' && workspace.data.can_plan_class_test ? <View style={{flexDirection: 'row',flexWrap: 'wrap',gap: 8}}><Button title={workspace.data.mode === 'admin' ? 'Plan assessment' : 'Plan class test'} onPress={() => onNavigate(hrefWith(href,{create: workspace.data?.mode === 'admin' ? 'assessment' : 'class-test'}))} />{workspace.data.mode === 'admin' ? <ControlButton title="Create assessment cycle" onPress={() => onNavigate(hrefWith(href,{create: 'cycle'}))} /> : null}</View> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <ChoiceMenu label="Filter assessments" value={status} options={assessmentStatuses.map(value => ({ value, label: `${assessmentStatusLabel(value)} · ${workspace.data?.assessments.filter(item => value === 'all' || item.status === value).length ?? 0}` }))} onChange={value => { setStatus(value); setPage(1); }} />
        <ControlButton title={searchOpen ? 'Close search' : 'Search'} kind="secondary" onPress={() => { if (searchOpen) { setSearch(''); setPage(1); } setSearchOpen(value => !value); }} />
      </View>
      {searchOpen ? <SearchField label="Find an assessment" value={search} onChangeText={value => { setSearch(value); setPage(1); }} placeholder="Title, subject or class" /> : null}
      <Section title="Assessments">{items.length ? items.slice((currentPage - 1) * 10, currentPage * 10).map(item => <Row key={item.id} title={item.title} detail={`${item.class_name} · ${item.subject_name}\n${item.scheduled_at ? formatCampusDateTime(item.scheduled_at, item.time_zone ?? workspace.data?.time_zone) : 'Not scheduled'}`} icon={iconForDestination(href)} iconDestination={href} onPress={() => onNavigate(hrefWith(href, { assessment: item.id, status }))}><AssessmentStatus value={item.status} /></Row>) : <Empty title="No assessments in this view" />}</Section>
      <AssessmentPages page={currentPage} pages={pages} total={items.length} pageSize={10} onPage={setPage} />
    </>}
  </Page>;
}

function AssessmentDetail({ href, onNavigate, schoolId, initial, refresh,readFailure }: Props & { schoolId: string; initial: Detail; refresh: () => Promise<void>;readFailure: string }) {
  const [baseline, setBaseline] = useState(initial);
  const { user, environment } = useSession(), { colors } = useTheme(), item = baseline.assessment;
  const root = `/api/v1/schools/${encodeURIComponent(schoolId)}/assessments/${encodeURIComponent(item.id)}`;
  const [drafts, setDrafts] = useState<ResultDraft[]>(baseline.results.map(result => ({ result_id: result.id, outcome: result.outcome, marks: result.marks ?? '', grade: result.grade, feedback: result.feedback, expected_revision: result.revision, reason: '' })));
  const [search, setSearch] = useState(''), [page, setPage] = useState(1), [note, setNote] = useState(''), [reading, setReading] = useState(false), [error, setError] = useState('');
  const [correcting,setCorrecting] = useState(false);
  const [examState,setExamState] = useState({dirty: false,pending: false});
  const captureOperation=useOperationContext(JSON.stringify([href,item.id]));
  const writer = useNativePendingAction<Detail>({ captureOperation,scope: { actorId: user!.id, schoolId, mode: environment.mode, namespaceId: environment.namespace_id ?? null, origin: getApiOrigin() }, domain: 'assessments', ownerHref: href, refreshPath: `${root}/`,resolveRefreshPath: assessmentOperationAcceptedPath, accepted: async (value, assertCurrent,action) => { const latest = assessmentOperationSaved(value,action); if (latest.assessment.id !== item.id) throw new Error('The saved assessment did not match this action.'); await refresh(); assertCurrent(); setBaseline(latest); setDrafts(latest.results.map(result => ({ result_id: result.id, outcome: result.outcome, marks: result.marks ?? '', grade: result.grade, feedback: result.feedback, expected_revision: result.revision, reason: '' }))); setNote(''); } });
  const busy = writer.busy || reading, pending = writer.action;
  const changes = drafts.filter(draft => { const original = baseline.results.find(result => result.id === draft.result_id)!; return draft.outcome !== original.outcome || draft.marks !== (original.marks ?? '') || draft.grade !== original.grade || draft.feedback !== original.feedback; });
  const dirty = changes.length > 0;
  const ownsResults = pending?.ownerHref === href && pending.source?.kind === 'assessment_results',ownsWorkflow = pending?.ownerHref === href && pending.source?.kind === 'assessment_lifecycle';
  useScreenExitGuard({ dirty: dirty && !ownsResults || !!note.trim() && !ownsWorkflow, blocked: busy, title: 'Leave this register?', message: 'Your unsaved result edits and workflow note will be lost. A retained submitted action remains recoverable.' });
  const remoteChanged = initial.assessment.revision > baseline.assessment.revision || initial.viewer_role !== baseline.viewer_role || initial.exam_operation?.sitting.revision !== baseline.exam_operation?.sitting.revision || initial.exam_operation?.viewer_assignment?.status !== baseline.exam_operation?.viewer_assignment?.status;
  const locked = writer.locked || reading || !!environment.unavailable || remoteChanged || !!readFailure || examState.dirty;
  useEffect(() => { if (busy || dirty || note.trim() || pending || initial.assessment.revision < baseline.assessment.revision) return; setBaseline(initial); setDrafts(initial.results.map(result => ({ result_id: result.id, outcome: result.outcome, marks: result.marks ?? '', grade: result.grade, feedback: result.feedback, expected_revision: result.revision, reason: '' }))); }, [initial, busy, dirty, pending,note]);
  const canCoordinate = baseline.viewer_role === 'admin';
  const mayRecordResults = (canCoordinate || baseline.viewer_role === 'examiner') && user?.id !== item.moderator_user_id;
  const canMark = (item.status === 'marking' || item.status === 'published' && correcting) && mayRecordResults;
  const canModerate = baseline.viewer_role === 'moderator' || canCoordinate && user?.id === item.moderator_user_id;
  const operation = baseline.exam_operation, preview = baseline.roster_preview;
  const roster = operation
    ? item.status === 'draft' && operation.sitting.state === 'planning'
      ? operation.readiness ? `${operation.readiness.candidate_count} learners · Preview` : 'Preview unavailable'
      : `${operation.candidates.length} learners${operation.candidates.length ? ' · Frozen' : ''}`
    : preview
      ? `${preview.count} learners · ${preview.frozen ? 'Frozen' : 'Preview'} for ${preview.as_of}`
      : `${item.roster_count || baseline.results.length} learners`;
  const act = (action: string, message: string) => { if (locked || dirty) return; Alert.alert(message, 'This uses the current saved assessment revision and your current authority.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Confirm', onPress: () => {try {void writer.run(assessmentLifecycleInput(baseline,schoolId,action,note.trim() || message));}catch(cause){setError(errorText(cause));}} }]); };
  const save = () => { try { const records = changes.map(draft => { const original = baseline.results.find(result => result.id === draft.result_id)!; if (draft.outcome === 'unrecorded') throw new Error('Choose an explicit outcome for every changed result.'); if (original.outcome !== 'unrecorded' && draft.reason.trim().length < 3) throw new Error('Add a reason when correcting an existing result.'); return { ...draft,reason: original.outcome === 'unrecorded' ? 'Initial marks entry' : draft.reason.trim(), marks: draft.outcome === 'scored' ? nativeAssessmentMark(draft.marks, item.maximum_marks) : null }; }); if (records.length) void writer.run(assessmentResultsInput(baseline,schoolId,records)); } catch (cause) { setError(errorText(cause)); } };
  const update = (id: string, values: Partial<ResultDraft>) => setDrafts(current => current.map(draft => draft.result_id === id ? { ...draft, ...values } : draft));
  const rows = baseline.results.filter(result => `${result.first_name} ${result.last_name}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())), pages = Math.max(1, Math.ceil(rows.length / 15)), currentPage = Math.min(page, pages);
  const loadSaved = () => Alert.alert('Read saved assessment?', pending ? 'The retained action will remain locked. Reading current state does not prove its exact command outcome.' : 'Local unsaved marks will be replaced by the current saved record.', [{ text: 'Keep this view', style: 'cancel' }, { text: 'Read saved', onPress: () => { setReading(true); void refresh().then(() => { if (!pending) { setBaseline(initial); setDrafts(initial.results.map(result => ({ result_id: result.id, outcome: result.outcome, marks: result.marks ?? '', grade: result.grade, feedback: result.feedback, expected_revision: result.revision, reason: '' }))); } }).catch(cause => setError(errorText(cause))).finally(() => setReading(false)); } }]);
  const evidenceId = queryOf(href).get('evidence_result');
  if (evidenceId) return <AssessmentEvidenceScreen href={href} onNavigate={onNavigate} schoolId={schoolId} detail={baseline} resultId={evidenceId} refresh={refresh} readFailure={readFailure} />;
  return <Page title={item.title} subtitle={`${item.class_name} · ${item.subject_name} · ${item.cycle_name}`} onRefresh={() => { if (dirty || pending) loadSaved(); else void refresh(); }} refreshing={busy}>
    <ScreenBack title="Back to assessments" disabled={busy} fallbackHref={hrefWith(href, { assessment: '' })} />
    <AssessmentStatus value={item.status} />
    {operation?.schedule_state === 'awaiting_confirmation' ? <Notice tone={operation.readiness?.can_schedule ? 'success' : 'warning'} message={operation.readiness?.can_schedule ? 'Ready for officer confirmation. Confirm the revised schedule before starting the sitting.' : 'Revised arrangements are published. The sitting is waiting for invigilation and schedule checks.'} /> : null}
    {readFailure ? <Notice tone="warning" message={`The saved assessment could not refresh. Your unsent entries remain here; new writes are disabled until a fresh read succeeds. ${readFailure}`} /> : null}
    {correcting && item.status === 'published' ? <><ScreenBack priority={1} title="Back to published result register" disabled={busy} onPress={() => {setCorrecting(false);setDrafts(baseline.results.map(result => ({result_id: result.id,outcome: result.outcome,marks: result.marks ?? '',grade: result.grade,feedback: result.feedback,expected_revision: result.revision,reason: ''})));}} /><Notice message="Corrections need independent moderation and a new release. The currently published result stays visible to families." /></> : null}
    <Facts items={[{ label: 'When & where', value: `${item.scheduled_at ? formatCampusDateTime(item.scheduled_at, operation?.time_zone ?? item.time_zone) : 'Not scheduled'}${item.venue ? `\n${item.venue}` : ''}` }, { label: 'Examiner', value: item.examiner_name }, { label: 'Moderator', value: item.moderator_name }, { label: 'Roster', value: roster }, { label: 'Maximum marks', value: item.maximum_marks }]} />
    {item.instructions ? <Row title="Instructions" detail={item.instructions} variant="plain" /> : null}
    {item.result_policy ? <InfoDisclosure title="Grading policy"><Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}>{item.result_policy.name} · Version {item.result_policy.version} · {policyDescription(item.result_policy)}. Grades and points are calculated from marks using this fixed policy.</Text></InfoDisclosure> : null}
    {item.moderation_note ? <Notice message={item.moderation_note} tone="warning" /> : null}{writer.resumeHref ? <ControlButton title="Return to retained assessment action" kind="secondary" onPress={() => onNavigate(writer.resumeHref!)} /> : null}{error || writer.error ? <Notice message={error || writer.error} tone="danger" /> : null}
    {remoteChanged ? <><Notice message="This assessment changed elsewhere. Your local edits are retained. Load the saved record before continuing." tone="warning" /><Button title="Load saved assessment" kind="secondary" disabled={busy} onPress={loadSaved} /></> : null}
    {pending ? <><Notice message="The exact action is securely retained across relaunch. A current-state read does not replace its owning command result." tone="warning" /><Button title={pending.phase === 'accepted' ? 'Refresh saved record' : pending.replayPolicy === 'inspect_only' ? 'Inspect saved record' : 'Retry identical request'} busy={busy} onPress={() => void writer.recover()} /><Button title="Load saved record" kind="secondary" disabled={busy} onPress={loadSaved} /></> : null}
    {!dirty && (canCoordinate && ['draft', 'scheduled', 'moderated'].includes(item.status) || canModerate && item.status === 'submitted' || canMark && baseline.results.length > 0) ? <>
      {canModerate && item.status === 'submitted' ? <Field label="Review or correction note" value={note} onChangeText={setNote} maxLength={1000} editable={!locked} /> : <Disclosure title="Workflow note (optional)"><Field label="Workflow note" value={note} onChangeText={setNote} maxLength={1000} editable={!locked} /></Disclosure>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {canCoordinate && mayAmendExamSchedule(baseline,environment.virtual_clock?.now ?? new Date().toISOString()) ? <ControlButton title="Change scheduled arrangements" disabled={locked || !!note.trim()} onPress={() => onNavigate(hrefWith(href,{edit:'schedule-amendment'}))} /> : null}
        {canCoordinate && operation?.schedule_state === 'awaiting_confirmation' ? <ControlButton title="Confirm revised schedule" disabled={locked || !!note.trim() || !operation.readiness?.can_schedule} onPress={() => onNavigate(hrefWith(href,{edit:'confirm-schedule'}))} /> : null}
        {canCoordinate && item.status === 'draft' && operation?.sitting.state === 'planning' ? <ControlButton title="Edit examination arrangements" disabled={locked || !!note.trim()} onPress={() => onNavigate(hrefWith(href,{edit: 'arrangements'}))} /> : null}
        {canCoordinate && item.status === 'draft' ? <ControlButton title="Schedule assessment" kind="primary" disabled={locked || operation?.readiness?.can_schedule === false} onPress={() => act('schedule', 'Schedule this assessment?')} /> : null}
        {canCoordinate && item.status === 'scheduled' && (!operation || operation.sitting.state === 'completed') ? <ControlButton title="Open marking" kind="primary" disabled={locked} onPress={() => act('open-marking', 'Open this result register for marking?')} /> : null}
        {canMark && baseline.results.length ? <ControlButton title="Submit for moderation" kind="primary" disabled={locked} onPress={() => act('submit', 'Submit this completed register for moderation?')} /> : null}
        {canModerate && item.status === 'submitted' ? <><ControlButton title="Approve register" kind="primary" disabled={locked} onPress={() => act('approve', 'Approve this reviewed result register?')} /><ControlButton title="Return for correction" kind="secondary" disabled={locked || note.trim().length < 3} onPress={() => act('return', 'Return this register to its examiner?')} /></> : null}
        {canCoordinate && item.status === 'moderated' ? <ControlButton title="Publish results" kind="primary" disabled={locked} onPress={() => act('publish', 'Release these approved results to learners and guardians?')} /> : null}
      </View>
    </> : null}
    {operation ? <AssessmentExamDay href={href} onNavigate={onNavigate} schoolId={schoolId} detail={baseline} blocked={dirty || reading || !!note.trim() || !!readFailure} refresh={refresh} onStateChange={setExamState} /> : null}
    {baseline.viewer_role !== 'invigilator' ? <Section title="Results">
      {item.status === 'published' && mayRecordResults && !correcting ? <ControlButton title="Correct published results" disabled={locked} onPress={() => setCorrecting(true)} /> : null}
      <Text accessibilityLiveRegion="polite" style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}>{baseline.results.filter(result => result.outcome !== 'unrecorded').length} of {baseline.results.length} recorded · {item.evidence_requirement === 'none' ? 'Evidence not collected' : `Evidence ${item.evidence_requirement}`}</Text>
      <SearchField label="Find a learner" value={search} onChangeText={value => { setSearch(value); setPage(1); }} placeholder="Learner name" />
      {rows.length ? rows.slice((currentPage - 1) * 15, currentPage * 15).map(result => <View key={result.id} style={{gap: 6}}><AssessmentResultRow result={result} assessment={item} draft={drafts.find(row => row.result_id === result.id)!} editable={canMark} disabled={locked} onChange={values => update(result.id, values)} /><ControlButton title={result.evidence_count ? `View ${result.evidence_count} evidence files` : canMark ? "Add supporting evidence" : "Evidence files"} disabled={busy || dirty} onPress={() => onNavigate(hrefWith(href,{evidence_result: result.id}))} /></View>) : <Empty title="No learner results in this view" message={operation ? 'Results appear after the examination is complete and marking opens.' : 'The roster appears when marking opens.'} />}
      <AssessmentPages page={currentPage} pages={pages} total={rows.length} pageSize={15} onPage={setPage} />
      {canMark && dirty ? <><Notice message={`${changes.length} changed results · Not saved`} /><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><ControlButton title="Save results" kind="primary" busy={busy} disabled={locked} onPress={save} /><ControlButton title="Discard edits & load saved" kind="secondary" disabled={busy} onPress={loadSaved} /></View></> : null}
    </Section> : null}
    {baseline.publications.length ? <InfoDisclosure title="Publication history">{baseline.publications.map(publication => <Row key={publication.id} title={`Release ${publication.sequence}`} detail={`${when(publication.published_at)}\n${publication.reason}`} variant="plain" />)}</InfoDisclosure> : null}
  </Page>;
}
