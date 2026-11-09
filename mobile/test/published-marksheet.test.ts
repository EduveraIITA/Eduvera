import assert from 'node:assert/strict';
import test from 'node:test';
import type { FamilyReportCards, OwnReportCards, ResultPolicySnapshot } from '../../packages/contracts/src/academic-reports';
import type { FamilyResults } from '../../packages/contracts/src/assessments';
import { assessmentMarksheetHtml, escapeMarksheetHtml, loadPublishedMarksheet, reportMarksheetHtml } from '../src/lib/published-marksheet';

const report: FamilyReportCards['reports'][number] = { report_student_id: 'report-student', batch_id: 'release-two', sequence: 2, published_at: '2026-10-29T10:00:00Z', correction_reason: '<script>steal()</script>', scheme_id: 'scheme', scheme_name: 'Term <One>', term_name: 'First term', academic_year: '2026–2027', class_name: 'Historical class', outcome: 'incomplete', overall_percentage: null, overall_grade: '', class_teacher_comment: 'Review & continue', principal_comment: 'No inferred zero', subjects: [{ id: 'subject', subject_name: 'Physics <img src=x onerror=steal()>', color: '', icon: '', outcome: 'incomplete', percentage: null, grade: '', passed: null }] };
const data: FamilyReportCards = { student: { id: 'learner', first_name: 'Learner', last_name: '<Student>', admission_number: 'ADM&1', class_name: 'Current class' }, reports: [report] };
const assessment: FamilyResults['results'][number] = { id: 'assessment', title: 'Assessment', assessment_kind: 'test', maximum_marks: '50', scheduled_at: null, subject_name: 'Physics', color: '', icon: '', cycle_name: 'Cycle', term_name: 'Term', academic_year: '2026', class_name: 'Frozen class', publication_id: 'publication-two', sequence: 2, published_at: '2026-10-29T10:00:00Z', outcome: 'absent', marks: null, grade: '', feedback: 'Keep <all> meanings' };
test('private marksheet escapes every user string and includes immutable release/historical class semantics', () => {
  const html = reportMarksheetHtml(data, report, 'Campus <Name>', 'Simulation · run-a');
  assert.ok(html.startsWith('<!DOCTYPE html>')); assert.ok(html.includes('Term &lt;One&gt;')); assert.ok(html.includes('&lt;script&gt;steal()&lt;/script&gt;')); assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('<dt>Class</dt><dd>Historical class</dd>')); assert.ok(!html.includes('Current class')); assert.ok(html.includes('release-two')); assert.ok(html.includes('Simulation · run-a')); assert.ok(html.includes('<td>-</td>')); assert.ok(!html.includes('<td>0%</td>'));
  assert.ok(html.includes("default-src 'none'")); assert.equal(escapeMarksheetHtml('"\'&<>'), '&quot;&#39;&amp;&lt;&gt;');
});
test('withheld and absent outcomes do not become zero marks or an inferred score', () => {
  const html = reportMarksheetHtml(data, { ...report, outcome: 'withheld', overall_percentage: '95', subjects: [{ ...report.subjects[0]!, percentage: '95', grade: 'A' }] }, 'Campus');
  assert.ok(html.includes('Withheld')); assert.ok(!html.includes('95%'));
  const absent = assessmentMarksheetHtml({ student: data.student, results: [assessment] }, assessment, 'Campus'); assert.ok(absent.includes('Absent')); assert.ok(!absent.includes('0/50')); assert.ok(absent.includes('publication-two')); assert.ok(absent.includes('Frozen class'));
});
test('a published course examination names the course instead of a class on its marksheet', () => {
  const result = { ...assessment, assessment_kind: 'exam', context_kind: 'learning_offering' as const, class_name: 'Distributed Systems' };
  const html = assessmentMarksheetHtml({ student: data.student, results: [result] }, result, 'Campus');
  assert.match(html, /<dt>Course<\/dt><dd>Distributed Systems<\/dd>/);
  assert.doesNotMatch(html, /Historical class/);
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
test('canonical own print refetches the exact person publication without a family or invented student target',async()=>{
  const own:OwnReportCards={learner:{learner_id:'person',person_id:'person',student_id:null,first_name:'Anaya',last_name:'Rao',admission_number:null},reports:[report]},paths:string[]=[];
  const html=await loadPublishedMarksheet({schoolId:'campus',personId:'person',selection:{kind:'report',batchId:report.batch_id},schoolName:'Campus',assertCurrent(){},read:async<T>(path:string)=>{paths.push(path);return own as T;}});
  assert.deepEqual(paths,['/api/v1/schools/campus/academic-reports/mine/?person_id=person']);assert.match(html,/Anaya Rao/);assert.doesNotMatch(html,/Admission number/);assert.ok(!html.includes('student_id'));
  await assert.rejects(loadPublishedMarksheet({schoolId:'campus',personId:'other',selection:{kind:'report',batchId:report.batch_id},schoolName:'Campus',assertCurrent(){},read:async<T>()=>own as T}),/exact learner/);
  const ownResults={learner:own.learner,results:[assessment]};
  await loadPublishedMarksheet({schoolId:'campus',personId:'person',selection:{kind:'assessment',assessmentId:assessment.id,publicationId:assessment.publication_id},schoolName:'Campus',assertCurrent(){},read:async<T>(path:string)=>{assert.equal(path,'/api/v1/schools/campus/assessments/mine/?person_id=person');return ownResults as T;}});
  const legacy={...data,reports:[{...report,class_name:null}]};
  const familyHtml=await loadPublishedMarksheet({schoolId:'campus',studentId:data.student.id,selection:{kind:'report',batchId:report.batch_id},schoolName:'Campus',assertCurrent(){},read:async<T>()=>legacy as T});assert.doesNotMatch(familyHtml,/<dt>Class<\/dt>/);
});
test('a policy-derived grade preserves original marks, assessment type, exact publication and frozen policy', () => {
  const policy: ResultPolicySnapshot = { policy_id: 'frozen-policy', name: 'Letter <Grades>', code: 'LETTERS', version: 2, semantic_fingerprint: 'frozen', configuration: { schema_version: 1, result_format: 'grade', grade_point_scale: null, decimal_places: 2, aggregation: 'equal', absence_treatment: 'incomplete', exemption_treatment: 'exclude', gpa_failure_treatment: 'withhold', bands: [{ code: 'A', label: 'Strong', minimum_percentage: 80, maximum_percentage: 100, grade_points: null, passed: true }] } };
  const scored = { ...assessment, assessment_kind: 'project' as const, outcome: 'scored' as const, marks: '42', maximum_marks: '50', grade: 'A', result_policy: policy };
  const html = assessmentMarksheetHtml({ student: data.student, results: [scored] }, scored, 'Campus');
  assert.ok(html.includes('<th scope="col">Grade</th>')); assert.ok(html.includes('<td>50</td><td>42</td><td>A</td><td>Recorded</td>'));
  assert.ok(html.includes('<dt>Assessment type</dt><dd>Project</dd>'));
  assert.ok(html.includes('Letter &lt;Grades&gt; · version 2')); assert.ok(html.includes('publication-two')); assert.ok(html.includes('Frozen class'));
  for (const outcome of ['absent', 'exempt', 'withheld'] as const) {
    const result = { ...scored, outcome, marks: null }, exportHtml = assessmentMarksheetHtml({ student: data.student, results: [result] }, result, 'Campus');
    assert.ok(exportHtml.includes(`<td>50</td><td>-</td><td>-</td><td>${outcome[0]!.toUpperCase()}${outcome.slice(1)}</td>`));
    assert.ok(!exportHtml.includes('42 / 50')); assert.ok(!exportHtml.includes('0 / 50'));
  }
});

test('GPA print follows frozen result precision with compact exact credits and no invented zero or mutation',()=>{
  const base:ResultPolicySnapshot={policy_id:'gpa',name:'Frozen GPA',code:'GPA',version:1,semantic_fingerprint:'frozen',configuration:{schema_version:1,result_format:'gpa',grade_point_scale:10,decimal_places:2,aggregation:'credit_weighted',absence_treatment:'incomplete',exemption_treatment:'exclude',gpa_failure_treatment:'include',bands:[{code:'P',label:'Pass',minimum_percentage:0,maximum_percentage:100,grade_points:10,passed:true}]}};
  for(const places of [0,2,4]){
    const policy={...base,configuration:{...base.configuration,decimal_places:places}},published:FamilyReportCards['reports'][number]={...report,outcome:'complete',result_policy:policy,gpa:'10.0000',cgpa:'9.8765',credit_total:'4.0000',credit_points:'40.0000',cumulative_credits:'4.2500',cumulative_credit_points:'42.5000',subjects:[{...report.subjects[0]!,outcome:'complete',percentage:'80',grade:'P',passed:true,grade_points:'10.0000',credits:'4.2500'}],cumulative_sources:[{course_code:'CS501',credits:4.25,grade_points:10,passed:true,outcome:'complete',term_index:1,batch_id:'release-two',report_student_id:'row',report_subject_id:'subject',percentage:80,included:true,reason:'latest_attempt'}]};
    if(places===2){const tie={...published,result_policy:{...policy,configuration:{...policy.configuration,bands:[{...policy.configuration.bands[0]!,grade_points:9.995}]}},subjects:[{...published.subjects[0]!,grade_points:'9.9950'}]},tieHtml=reportMarksheetHtml(data,tie,'Campus');assert.ok(tieHtml.includes('<td>10.00</td>'));assert.ok(!tieHtml.includes('<td>9.99</td>'));}
    const original=JSON.stringify(published),html=reportMarksheetHtml(data,published,'Campus');
    assert.ok(html.includes(`<dt>CGPA</dt><dd>${(9.8765).toFixed(places)} / 10</dd>`));assert.ok(html.includes('<td>4.25</td>'));assert.ok(html.includes(`<dt>Term credit points</dt><dd>${(40).toFixed(places)}</dd>`));assert.ok(html.includes(`<td>4.25</td><td>${(10).toFixed(places)}</td><td>Counted</td>`));assert.equal(JSON.stringify(published),original);
    const zero=reportMarksheetHtml(data,{...published,gpa:'0.0000',cgpa:'0.0000',subjects:[{...published.subjects[0]!,grade_points:'0.0000'}]},'Campus');assert.ok(zero.includes(`<dt>CGPA</dt><dd>${(0).toFixed(places)} / 10</dd>`));assert.ok(zero.includes(`<td>${(0).toFixed(places)}</td>`));
    const missing=reportMarksheetHtml(data,{...published,gpa:null,cgpa:null,credit_total:null,credit_points:null,subjects:[{...published.subjects[0]!,grade_points:null,credits:null}]},'Campus');assert.ok(!missing.includes('<dt>Term credit points</dt>'));assert.ok(missing.includes('<td>-</td>'));assert.ok(missing.includes('<dt>CGPA</dt><dd>-</dd>'));
  }
});

test('the print layout identifies the institution and separates semester and class reports', () => {
  const college = { ...report, class_section_id: null, term_index: 2, class_name: 'Course scheme alias', subjects: [{ ...report.subjects[0]!, course_code: 'PHY201', outcome: 'complete', percentage: '86', grade: 'A', passed: true }] };
  const html = reportMarksheetHtml(data, college, 'Aaranya Institute of Technology');
  assert.match(html, /<header><p class="issuer">Aaranya Institute of Technology<\/p><h1>Statement of Marks<\/h1>/);
  assert.match(html, /<dt>Semester<\/dt><dd>2<\/dd>/);
  assert.match(html, /<th scope="col">Code<\/th><th scope="col">Course title<\/th>/);
  assert.match(html, /<td>PHY201<\/td>/);
  assert.doesNotMatch(html, /Course scheme alias/);
  const school = reportMarksheetHtml(data, { ...college, class_section_id: 'class-1', term_index: null }, 'Campus');
  assert.match(school, /<h1>Report Card<\/h1>/);
  assert.match(school, /<th scope="col">Subject<\/th>/);
});

test('a withheld term omits grades, totals, pass flags and cumulative sources', () => {
  const policy: ResultPolicySnapshot = { policy_id: 'gpa', name: 'Ten point scale', code: 'GPA', version: 1, semantic_fingerprint: 'frozen',
    configuration: { schema_version: 1, result_format: 'gpa', grade_point_scale: 10, decimal_places: 2, aggregation: 'credit_weighted',
      absence_treatment: 'incomplete', exemption_treatment: 'exclude', gpa_failure_treatment: 'include',
      bands: [{ code: 'A', label: 'Strong', minimum_percentage: 80, maximum_percentage: 100, grade_points: 10, passed: true }] } };
  const hidden = { ...report, class_section_id: null, outcome: 'withheld' as const, result_policy: policy, gpa: '8.23', cgpa: '8.63',
    credit_points: '71.98', cumulative_credit_points: '81.45',
    subjects: [{ ...report.subjects[0]!, outcome: 'complete', grade: 'F', grade_points: '7.97', passed: false }],
    cumulative_sources: [{ course_code: 'HIDDEN-COURSE', credits: 4, grade_points: 7.97, passed: false, outcome: 'complete', term_index: 1,
      batch_id: 'hidden-source', report_student_id: 'student', report_subject_id: 'subject', percentage: 60, included: true, reason: 'latest_attempt' as const }] };
  const html = reportMarksheetHtml(data, hidden, 'Campus');
  assert.match(html, /<h1>Semester Grade Card<\/h1>/);
  assert.match(html, /<dt>Result status<\/dt><dd>Withheld<\/dd>/);
  assert.doesNotMatch(html, /8\.23|8\.63|71\.98|81\.45|7\.97|Below pass|HIDDEN-COURSE|hidden-source|<td>F<\/td>/);
});

test('letter-grade report tables omit numerical score and GPA columns', () => {
  const policy: ResultPolicySnapshot = { policy_id: 'letters', name: 'Letter grades', code: 'GRADE', version: 1, semantic_fingerprint: 'frozen',
    configuration: { schema_version: 1, result_format: 'grade', grade_point_scale: null, decimal_places: 2, aggregation: 'equal',
      absence_treatment: 'incomplete', exemption_treatment: 'exclude', gpa_failure_treatment: 'withhold',
      bands: [{ code: 'A', label: 'Strong', minimum_percentage: 80, maximum_percentage: 100, grade_points: null, passed: true }] } };
  const issued = { ...report, result_policy: policy, overall_grade: 'A', overall_percentage: '92', outcome: 'complete' as const,
    subjects: [{ ...report.subjects[0]!, outcome: 'complete', percentage: '92', grade: 'A', passed: true }] };
  const html = reportMarksheetHtml(data, issued, 'Campus');
  const results = html.match(/<section class="results">[\s\S]*?<\/section>/)?.[0];
  assert.ok(results);
  assert.match(results, /<th scope="col">Grade<\/th>/);
  assert.match(results, /<td>A<\/td><td>Pass<\/td>/);
  assert.doesNotMatch(results, /Percentage|Grade points|92%|SGPA/);
  assert.match(html, /<dt>Grade<\/dt><dd>A<\/dd>/);
});
