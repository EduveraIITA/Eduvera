import assert from 'node:assert/strict';
import test from 'node:test';
import type { FamilyReportCards, ResultPolicySnapshot } from '../../packages/contracts/src/academic-reports';
import type { FamilyResults } from '../../packages/contracts/src/assessments';
import { assessmentMarksheetHtml, escapeMarksheetHtml, loadPublishedMarksheet, reportMarksheetHtml } from '../src/lib/published-marksheet';

const report: FamilyReportCards['reports'][number] = { report_student_id: 'report-student', batch_id: 'release-two', sequence: 2, published_at: '2026-10-29T10:00:00Z', correction_reason: '<script>steal()</script>', scheme_id: 'scheme', scheme_name: 'Term <One>', term_name: 'First term', academic_year: '2026–2027', class_name: 'Historical class', outcome: 'incomplete', overall_percentage: null, overall_grade: '', class_teacher_comment: 'Review & continue', principal_comment: 'No inferred zero', subjects: [{ id: 'subject', subject_name: 'Physics <img src=x onerror=steal()>', color: '', icon: '', outcome: 'incomplete', percentage: null, grade: '', passed: null }] };
const data: FamilyReportCards = { student: { id: 'learner', first_name: 'Learner', last_name: '<Student>', admission_number: 'ADM&1', class_name: 'Current class' }, reports: [report] };
const assessment: FamilyResults['results'][number] = { id: 'assessment', title: 'Assessment', assessment_kind: 'test', maximum_marks: '50', scheduled_at: null, subject_name: 'Physics', color: '', icon: '', cycle_name: 'Cycle', term_name: 'Term', academic_year: '2026', class_name: 'Frozen class', publication_id: 'publication-two', sequence: 2, published_at: '2026-10-29T10:00:00Z', outcome: 'absent', marks: null, grade: '', feedback: 'Keep <all> meanings' };
test('private marksheet escapes every user string and includes immutable release/historical class semantics', () => {
  const html = reportMarksheetHtml(data, report, 'Campus <Name>', 'Simulation · run-a');
  assert.ok(html.startsWith('<!DOCTYPE html>')); assert.ok(html.includes('Term &lt;One&gt;')); assert.ok(html.includes('&lt;script&gt;steal()&lt;/script&gt;')); assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('Historical class')); assert.ok(!html.includes('Current class')); assert.ok(html.includes('release-two')); assert.ok(html.includes('Simulation · run-a')); assert.ok(html.includes('Not recorded')); assert.ok(!html.includes('<td>0%</td>'));
  assert.ok(html.includes("default-src 'none'")); assert.equal(escapeMarksheetHtml('"\'&<>'), '&quot;&#39;&amp;&lt;&gt;');
});
test('withheld and absent outcomes do not become zero marks or an inferred score', () => {
  const html = reportMarksheetHtml(data, { ...report, outcome: 'withheld', overall_percentage: '95', subjects: [{ ...report.subjects[0]!, percentage: '95', grade: 'A' }] }, 'Campus');
  assert.ok(html.includes('Withheld')); assert.ok(!html.includes('95%'));
  const absent = assessmentMarksheetHtml({ student: data.student, results: [assessment] }, assessment, 'Campus'); assert.ok(absent.includes('Absent')); assert.ok(!absent.includes('0/50')); assert.ok(absent.includes('publication-two')); assert.ok(absent.includes('Frozen class'));
});
test('printing refetches exact campus/learner and publication before preparing any private HTML', async () => {
  const paths: string[] = [];
  const html = await loadPublishedMarksheet({ schoolId: 'campus/a', studentId: 'learner', selection: { kind: 'report', batchId: 'release-two' }, schoolName: 'Campus', assertCurrent() {}, read: async <T>(path: string) => { paths.push(path); return data as T; } });
  assert.deepEqual(paths, ['/api/v1/schools/campus%2Fa/academic-reports/family/?student_id=learner']); assert.ok(html.includes('release-two'));
  await assert.rejects(loadPublishedMarksheet({ schoolId: 'campus', studentId: 'other', selection: { kind: 'report', batchId: 'release-two' }, schoolName: 'Campus', assertCurrent() {}, read: async <T>() => data as T }), /exact learner/);
  await assert.rejects(loadPublishedMarksheet({ schoolId: 'campus', studentId: 'learner', selection: { kind: 'report', batchId: 'older' }, schoolName: 'Campus', assertCurrent() {}, read: async <T>() => data as T }), /exact learner/);
  await assert.rejects(loadPublishedMarksheet({ schoolId: 'campus', studentId: 'learner', selection: { kind: 'report', batchId: 'release-two' }, schoolName: 'Campus', assertCurrent() {}, read: async <T>() => ({ ...data, reports: [report, report] }) as T }), /exact learner/);
});
test('assessment export never substitutes another publication of the same assessment', async () => {
  const family = { student: data.student, results: [assessment] };
  await assert.rejects(loadPublishedMarksheet({ schoolId: 'campus', studentId: 'learner', selection: { kind: 'assessment', assessmentId: 'assessment', publicationId: 'publication-one' }, schoolName: 'Campus', assertCurrent() {}, read: async <T>() => family as T }), /exact learner/);
  const html = await loadPublishedMarksheet({ schoolId: 'campus', studentId: 'learner', selection: { kind: 'assessment', assessmentId: 'assessment', publicationId: 'publication-two' }, schoolName: 'Campus', assertCurrent() {}, read: async <T>() => family as T }); assert.ok(html.includes('publication-two'));
});
test('selected-world change after authenticated read aborts printing before HTML is released', async () => {
  let current = true;
  await assert.rejects(loadPublishedMarksheet({ schoolId: 'campus', studentId: 'learner', selection: { kind: 'report', batchId: 'release-two' }, schoolName: 'Campus', assertCurrent() { if (!current) throw new Error('World changed'); }, read: async <T>() => { current = false; return data as T; } }), /World changed/);
});
test('a policy-derived grade preserves original marks, assessment type, exact publication and frozen policy', () => {
  const policy: ResultPolicySnapshot = { policy_id: 'frozen-policy', name: 'Letter <Grades>', code: 'LETTERS', version: 2, semantic_fingerprint: 'frozen', configuration: { schema_version: 1, result_format: 'grade', grade_point_scale: null, decimal_places: 2, aggregation: 'equal', absence_treatment: 'incomplete', exemption_treatment: 'exclude', gpa_failure_treatment: 'withhold', bands: [{ code: 'A', label: 'Strong', minimum_percentage: 80, maximum_percentage: 100, grade_points: null, passed: true }] } };
  const scored = { ...assessment, assessment_kind: 'project' as const, outcome: 'scored' as const, marks: '42', maximum_marks: '50', grade: 'A', result_policy: policy };
  const html = assessmentMarksheetHtml({ student: data.student, results: [scored] }, scored, 'Campus');
  assert.ok(html.includes('Grade: <strong>A</strong>')); assert.ok(html.includes('<strong>Original marks</strong> 42 / 50'));
  assert.ok(html.includes('<strong>Outcome</strong> Scored')); assert.ok(html.includes('<strong>Assessment type</strong> Project'));
  assert.ok(html.includes('Letter &lt;Grades&gt; · version 2')); assert.ok(html.includes('publication-two')); assert.ok(html.includes('Frozen class'));
  for (const outcome of ['absent', 'exempt', 'withheld'] as const) {
    const result = { ...scored, outcome, marks: null }, exportHtml = assessmentMarksheetHtml({ student: data.student, results: [result] }, result, 'Campus');
    assert.ok(exportHtml.includes(`<strong>Original marks</strong> ${outcome[0]!.toUpperCase()}${outcome.slice(1)}`));
    assert.ok(!exportHtml.includes('42 / 50')); assert.ok(!exportHtml.includes('0 / 50'));
  }
});
