import type { FamilyReportCards, OwnReportCards, ResultPolicySnapshot } from '../../../packages/contracts/src/academic-reports';
import type { FamilyResults, OwnAssessmentResults } from '../../../packages/contracts/src/assessments';
import { creditNumber, cumulativeUnavailableReason, policyDescription, reportPrimaryResult, resultNumber } from '../../../packages/contracts/src/result-presentation';

export type PublishedLearnerTarget = { studentId: string; personId?: never } | { personId: string; studentId?: never };
export type PublishedSelection = { kind: 'report'; batchId: string } | { kind: 'assessment'; assessmentId: string; publicationId: string };
export const escapeMarksheetHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const missing = '-';
const nice = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
type Field = readonly [label: string, value: string | number];
type Report = FamilyReportCards['reports'][number];
type Assessment = FamilyResults['results'][number];

const facts = (fields: readonly Field[], className: string) => `<dl class="${className}">${fields.map(([label, value]) =>
  `<div><dt>${escapeMarksheetHtml(label)}</dt><dd>${escapeMarksheetHtml(value)}</dd></div>`).join('')}</dl>`;
const table = (columns: string[], rows: (string | number)[][], label: string) => `<table aria-label="${escapeMarksheetHtml(label)}">
  <thead><tr>${columns.map(column => `<th scope="col">${escapeMarksheetHtml(column)}</th>`).join('')}</tr></thead>
  <tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${escapeMarksheetHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
</table>`;
const notes = (fields: readonly Field[]) => fields.length
  ? `<section><h2>Remarks</h2>${fields.map(([label, value]) => `<p><strong>${escapeMarksheetHtml(label)}</strong> ${escapeMarksheetHtml(value)}</p>`).join('')}</section>` : '';
const displayNumber = (value: string | number | null | undefined, policy?: ResultPolicySnapshot | null, suffix = '') => {
  const number = resultNumber(value, policy);
  return number === '—' ? missing : number + suffix;
};
const displayCredits = (value: string | number | null | undefined) => {
  const number = creditNumber(value);
  return number === '—' ? missing : number;
};
const publishedDate = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
    : missing;
};

const printStyles = `
@page { size: A4; margin: 12mm 14mm; }
* { box-sizing: border-box; }
body { margin: 0; color: #202329; font: 10pt/1.32 Arial, Helvetica, sans-serif; background: #fff; }
.sheet { max-width: 180mm; margin: 0 auto; padding: 11mm 8mm; }
header { text-align: center; border-top: 4px double #27374d; border-bottom: 1px solid #27374d; padding: 10pt 0 9pt; break-inside: avoid; }
.issuer { margin: 0; color: #27374d; font: bold 22pt/1.16 Georgia, 'Times New Roman', serif; overflow-wrap: anywhere; }
h1 { margin: 10pt 0 3pt; font-size: 12pt; letter-spacing: .13em; text-transform: uppercase; }
.session { margin: 0; font-size: 10pt; color: #343a44; overflow-wrap: anywhere; }
.simulation { margin: 0 0 8pt; padding: 4pt 7pt; border: 1px solid #896213; color: #68480d; font-weight: bold; overflow-wrap: anywhere; }
.simulation-print { display: none; }
dl { margin: 0; }
.identity, .summary { display: grid; grid-template-columns: 1fr 1fr; margin: 9pt 0 0; border: 1px solid #aab0ba; }
.identity > div, .summary > div { min-width: 0; padding: 4pt 7pt; border-bottom: 1px solid #c5c9cf; }
.identity > div:nth-child(odd) { border-right: 1px solid #c5c9cf; }
.identity > div:last-child { border-bottom: 0; }
.identity > div:last-child:nth-child(odd) { grid-column: 1 / -1; border-right: 0; }
.identity > div:nth-last-child(2):nth-child(odd) { border-bottom: 0; }
dt { color: #444a55; font-size: 8pt; letter-spacing: .06em; text-transform: uppercase; }
dd { margin: 2pt 0 0; font-weight: bold; overflow-wrap: anywhere; }
.summary { display: flex; flex-wrap: wrap; border: 0; border-top: 2px solid #27374d; border-left: 1px solid #aab0ba; break-inside: avoid; }
.summary > div { flex: 1 0 25%; border-right: 1px solid #aab0ba; }
.summary dd { color: #27374d; font: bold 13pt/1.2 Georgia, 'Times New Roman', serif; }
section { margin-top: 8pt; }
h2 { margin: 0 0 5pt; font-size: 9pt; letter-spacing: .075em; text-transform: uppercase; color: #27374d; break-after: avoid; }
p { margin: 4pt 0; overflow-wrap: anywhere; white-space: pre-wrap; orphans: 2; widows: 2; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
th, td { border: 1px solid #aab0ba; padding: 4pt 6pt; vertical-align: top; overflow-wrap: anywhere; }
th { text-align: left; font-size: 8.5pt; background: #edf0f4; color: #202b3b; }
.results th:first-child, .results td:first-child { width: 5%; text-align: center; white-space: nowrap; }
.results th:nth-child(n+3), .results td:nth-child(n+3) { text-align: center; }
.results.with-code th:nth-child(3), .results.with-code td:nth-child(3) { text-align: left; }
.results th { overflow-wrap: normal; }
.results td:last-child { white-space: nowrap; }
.results tbody tr:nth-child(even) { background: #f8f9fa; }
.detail { color: #444a55; font-size: 8.5pt; }
.detail table { font-size: 8.5pt; }
.detail th, .detail td { padding: 2pt 5pt; }
.appendix { margin-top: 18pt; }
footer { margin-top: 10pt; border-top: 4px double #27374d; padding-top: 6pt; font-size: 8pt; color: #444a55; break-inside: avoid; }
footer p { margin: 0 0 2pt; }
@media print {
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { max-width: none; padding: 0; }
  .appendix { margin-top: 0; break-before: page; }
  .simulation-print { display: block; position: fixed; inset: 43% 0 auto; text-align: center; z-index: 2;
    transform: rotate(-22deg); pointer-events: none; color: rgba(116, 78, 17, .16); font: bold 43pt/1 Georgia, serif; }
}
`;

function documentHtml(institution: string, heading: string, session: string, worldLabel: string, content: string, release: Field, date: string, appendix = '') {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escapeMarksheetHtml(heading)}</title><style>${printStyles}</style></head><body><main class="sheet">
${worldLabel ? `<p class="simulation">${escapeMarksheetHtml(worldLabel)}</p><p class="simulation-print" aria-hidden="true">SIMULATION</p>` : ''}
<header><p class="issuer">${escapeMarksheetHtml(institution)}</p><h1>${escapeMarksheetHtml(heading)}</h1><p class="session">${escapeMarksheetHtml(session)}</p></header>
${content}
<footer><p><strong>Published</strong> ${escapeMarksheetHtml(publishedDate(date))} &nbsp; | &nbsp; <strong>${escapeMarksheetHtml(release[0])}</strong> ${escapeMarksheetHtml(release[1])}</p>
<p>Copy of the published academic record &middot; Generated by ThatCampus</p></footer>${appendix}</main></body></html>`;
}

function policyHtml(policy?: ResultPolicySnapshot | null) {
  if (!policy) return '';
  const gpa = policy.configuration.result_format === 'gpa';
  const columns = ['Grade', 'Percentage range', ...(gpa ? ['Grade points'] : []), 'Passing grade'];
  const rows = policy.configuration.bands.map(band => [
    `${band.code} · ${band.label}`, `${band.minimum_percentage}-${band.maximum_percentage}%`,
    ...(gpa ? [displayNumber(band.grade_points, policy)] : []), band.passed ? 'Yes' : 'No',
  ]);
  return `<section class="detail"><h2>Grading scale</h2><p>${escapeMarksheetHtml(`${policy.name} · version ${policy.version} · ${policyDescription(policy)}`)}</p>
${table(columns, rows, 'Grading scale')}<p>${policy.configuration.absence_treatment === 'zero' ? 'Absences count as zero under this policy.' : 'Absences keep the aggregate incomplete.'} Exempt results are excluded.</p></section>`;
}

function reportSummary(report: Report, withheld: boolean): Field[] {
  if (withheld) return [['Result status', 'Withheld']];
  const policy = report.result_policy;
  const primary = reportPrimaryResult(report);
  const fields: Field[] = [[primary.label === 'Overall' && report.overall_percentage !== null ? 'Overall percentage' : primary.label,
    primary.value === '—' ? missing : primary.value]];
  if (policy?.configuration.result_format === 'gpa') {
    fields.push(['CGPA', displayNumber(report.cgpa, policy, ` / ${policy.configuration.grade_point_scale}`)]);
    if (report.credit_total != null) fields.push(['Term credits counted', displayCredits(report.credit_total)]);
    if (report.credit_points != null) fields.push(['Term credit points', displayNumber(report.credit_points, policy)]);
    if (report.cumulative_credits != null) fields.push(['Cumulative credits counted', displayCredits(report.cumulative_credits)]);
    if (report.cumulative_credit_points != null) fields.push(['Cumulative credit points', displayNumber(report.cumulative_credit_points, policy)]);
  } else if (primary.secondary && primary.value !== primary.secondary) {
    fields.push(['Overall grade', primary.secondary]);
  }
  fields.push(['Result status', nice(report.outcome)]);
  return fields;
}

export function reportMarksheetHtml(data: FamilyReportCards | OwnReportCards, report: Report, schoolName: string, worldLabel = ''): string {
  const learner = 'learner' in data ? data.learner : data.student;
  const policy = report.result_policy, format = policy?.configuration.result_format, gpa = format === 'gpa';
  const course = report.class_section_id === null || report.class_section_id === undefined && report.subjects.some(subject => Boolean(subject.course_code));
  const showCode = report.subjects.some(subject => Boolean(subject.course_code));
  const showCredits = gpa || policy?.configuration.aggregation === 'credit_weighted';
  const showPercentage = format !== 'grade' && !gpa;
  const withheld = report.outcome === 'withheld';
  const identity: Field[] = [['Student name', `${learner.first_name} ${learner.last_name}`.trim()]];
  if (learner.admission_number) identity.push(['Admission number', learner.admission_number]);
  if (!course && report.class_name) identity.push(['Class', report.class_name]);
  identity.push([report.term_index != null ? 'Semester' : 'Term', report.term_index ?? report.term_name], ['Academic year', report.academic_year]);
  const columns = ['No.', ...(showCode ? ['Code'] : []), course ? 'Course title' : 'Subject',
    ...(showPercentage ? ['Percentage'] : []), ...(showCredits ? ['Credits'] : []), 'Grade', ...(gpa ? ['Grade points'] : []), 'Result'];
  const rows = report.subjects.map((subject, index) => {
    const hidden = withheld || subject.outcome === 'withheld';
    const scored = !hidden && subject.outcome === 'complete';
    const status = hidden ? 'Withheld' : scored && subject.passed === true ? 'Pass' : scored && subject.passed === false ? 'Below pass' : nice(subject.outcome);
    return [index + 1, ...(showCode ? [subject.course_code || missing] : []), subject.subject_name,
      ...(showPercentage ? [scored ? displayNumber(subject.percentage, policy, '%') : missing] : []),
      ...(showCredits ? [displayCredits(subject.credits)] : []), scored ? subject.grade || missing : missing,
      ...(gpa ? [scored ? displayNumber(subject.grade_points, policy) : missing] : []), status];
  });
  const reasons = !withheld && gpa
    ? `${report.gpa == null && report.gpa_unavailable_reason ? `<p>SGPA: ${escapeMarksheetHtml(cumulativeUnavailableReason(report.gpa_unavailable_reason))}</p>` : ''}
       ${report.cgpa == null && report.cgpa_unavailable_reason ? `<p>CGPA: ${escapeMarksheetHtml(cumulativeUnavailableReason(report.cgpa_unavailable_reason))}</p>` : ''}` : '';
  const cumulative = !withheld && gpa && report.cumulative_sources?.length
    ? `<section class="detail appendix"><h2>Cumulative record basis</h2>
        <p>${escapeMarksheetHtml(`${learner.first_name} ${learner.last_name} · Release ${report.sequence} · ${report.batch_id}`)}</p>${table(['Course code', 'Semester', 'Credits', 'Grade points', 'Treatment', 'Release reference'],
        report.cumulative_sources.map(source => [source.course_code, source.term_index, displayCredits(source.credits),
          source.outcome === 'complete' ? displayNumber(source.grade_points, policy) : missing,
          source.included ? 'Counted' : 'Earlier attempt', source.batch_id]), 'Published cumulative sources')}</section>` : '';
  const remarks: Field[] = [];
  if (report.class_teacher_comment) remarks.push([course ? 'Academic remarks' : 'Class teacher', report.class_teacher_comment]);
  if (report.principal_comment) remarks.push([course ? 'Institution remarks' : 'Principal', report.principal_comment]);
  if (report.correction_reason) remarks.push(['Correction note', report.correction_reason]);
  const content = `${facts(identity, 'identity')}
<section class="results${showCode ? ' with-code' : ''}"><h2>${course ? 'Course results' : 'Subject results'}</h2>
${rows.length ? table(columns, rows, 'Published subject results') : '<p>No subject results are recorded.</p>'}</section>
${facts(reportSummary(report, withheld), 'summary')}${reasons ? `<div class="detail">${reasons}</div>` : ''}${notes(remarks)}${policyHtml(policy)}`;
  return documentHtml(schoolName, course ? gpa || format === 'grade' ? 'Semester Grade Card' : 'Statement of Marks' : 'Report Card',
    report.scheme_name, worldLabel, content, ['Release reference', `${report.sequence} · ${report.batch_id}`], report.published_at, cumulative);
}

export function assessmentMarksheetHtml(data: FamilyResults | OwnAssessmentResults, result: Assessment, schoolName: string, worldLabel = ''): string {
  const learner = 'learner' in data ? data.learner : data.student;
  const policy = result.result_policy, format = policy?.configuration.result_format;
  const scored = result.outcome === 'scored';
  const hasMaximum = Boolean(result.maximum_marks?.trim()) && Number.isFinite(Number(result.maximum_marks)) && Number(result.maximum_marks) > 0;
  const hasMarks = scored && result.marks != null && Boolean(result.marks.trim()) && Number.isFinite(Number(result.marks));
  const identity: Field[] = [['Student name', `${learner.first_name} ${learner.last_name}`.trim()]];
  if (learner.admission_number) identity.push(['Admission number', learner.admission_number]);
  if (result.class_name && (result.context_kind !== 'learning_offering' || result.class_name !== result.subject_name)) {
    identity.push([result.context_kind === 'learning_offering' ? 'Course' : 'Class', result.class_name]);
  }
  identity.push(['Term', result.term_name], ['Academic year', result.academic_year], ['Assessment type', nice(result.assessment_kind)]);
  const percentage = format === 'percentage', points = format === 'gpa';
  const grade = Boolean(policy || scored && result.grade);
  const columns = ['No.', 'Subject', 'Maximum marks', 'Marks obtained', ...(percentage ? ['Percentage'] : []),
    ...(grade ? ['Grade'] : []), ...(points ? ['Grade points'] : []), 'Result'];
  const values = [1, result.subject_name, hasMaximum ? result.maximum_marks : missing, hasMarks ? result.marks! : missing,
    ...(percentage ? [scored ? displayNumber(result.percentage, policy, '%') : missing] : []),
    ...(grade ? [scored ? result.grade || missing : missing] : []),
    ...(points ? [scored ? displayNumber(result.grade_points, policy) : missing] : []), scored ? 'Recorded' : nice(result.outcome)];
  const content = `${facts(identity, 'identity')}<section class="results"><h2>Examination result</h2>
${table(columns, [values], 'Published assessment result')}</section>${notes(result.feedback ? [['Examiner', result.feedback]] : [])}${policyHtml(policy)}`;
  return documentHtml(schoolName, 'Statement of Marks', `${result.title} · ${result.cycle_name}`, worldLabel, content,
    ['Release reference', `${result.sequence} · ${result.publication_id}`], result.published_at);
}

/** Refetch the exact authenticated publication at the user's explicit print action. */
export async function loadPublishedMarksheet(options: PublishedLearnerTarget & { schoolId: string; selection: PublishedSelection; schoolName: string; worldLabel?: string; assertCurrent(): void; read<T>(path: string): Promise<T> }): Promise<string> {
  options.assertCurrent();
  const root = `/api/v1/schools/${encodeURIComponent(options.schoolId)}`, own = options.personId !== undefined;
  if (own ? !options.personId || options.studentId !== undefined : !options.studentId) throw new Error('Choose one exact published learner account.');
  const suffix = own ? `mine/?${new URLSearchParams({ person_id: options.personId! })}` : `family/?${new URLSearchParams({ student_id: options.studentId! })}`;
  const identityMatches = (data: FamilyReportCards | OwnReportCards | FamilyResults | OwnAssessmentResults) => own ? 'learner' in data && data.learner?.person_id === options.personId && data.learner.learner_id === options.personId : 'student' in data && data.student?.id === options.studentId;
  let html: string;
  if (options.selection.kind === 'report') {
    const data = await options.read<FamilyReportCards | OwnReportCards>(`${root}/academic-reports/${suffix}`); options.assertCurrent();
    const reports = data?.reports?.filter(report => report.batch_id === (options.selection as { batchId: string }).batchId);
    if (!data || !identityMatches(data) || reports?.length !== 1) throw new Error('This exact learner and published report could not be verified. No different release was printed.');
    html = reportMarksheetHtml(data, reports[0]!, options.schoolName, options.worldLabel);
  } else {
    const data = await options.read<FamilyResults | OwnAssessmentResults>(`${root}/assessments/${suffix}`); options.assertCurrent(); const selection = options.selection;
    const results = data?.results?.filter(result => result.id === selection.assessmentId && result.publication_id === selection.publicationId);
    if (!data || !identityMatches(data) || results?.length !== 1) throw new Error('This exact learner and assessment publication could not be verified. No different release was printed.');
    html = assessmentMarksheetHtml(data, results[0]!, options.schoolName, options.worldLabel);
  }
  if (html.length > 2_000_000) throw new Error('This marksheet exceeds the device print limit. Nothing was printed.'); options.assertCurrent(); return html;
}
