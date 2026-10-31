import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkspaceManifest } from '../../packages/contracts/src/workspace';
import type { AcademicReportWorkspace, GradingPolicyConfiguration, GradingSchemeDetail, ReportBatchDetail } from '../../packages/contracts/src/academic-reports';
import { academicReportRoute, gradingConfigurationError, initialReportComponent, initialReportReviewMode, reportBatchMatches, reportWorkspaceMatches, reportRelationships, reportSchemeMatches, reportSchemeDraftDirty, reportSubjectDraftDirty, resolveReportRelationship, subjectPlanError } from '../src/lib/academic-report-policy';

test('leaving a new report scheme protects every edit, including approval mode alone', () => {
  const initial = { termId: '', classId: '', policyId: '', name: '', code: '', programme: '', termIndex: '', reviewMode: initialReportReviewMode };
  assert.equal(reportSchemeDraftDirty(initial), false);
  for (const field of ['termId', 'classId', 'policyId', 'name', 'code', 'programme', 'termIndex'] as const) assert.equal(reportSchemeDraftDirty({ ...initial, [field]: 'edited' }), true, field);
  assert.equal(reportSchemeDraftDirty({ ...initial, reviewMode: 'owner_review' }), true);
  assert.equal(reportSchemeDraftDirty({ ...initial, reviewMode: initialReportReviewMode }), false);
});
test('leaving a subject grading plan protects the initial component before a subject is selected', () => {
  const initial = { subjectId: '', credits: '', courseCode: '', pass: '', components: [{ ...initialReportComponent, assessment_ids: [] as string[] }] };
  assert.equal(reportSubjectDraftDirty(initial), false);
  for (const field of ['subjectId', 'credits', 'courseCode', 'pass'] as const) assert.equal(reportSubjectDraftDirty({ ...initial, [field]: 'edited' }), true, field);
  for (const field of ['code', 'name', 'weight'] as const) assert.equal(reportSubjectDraftDirty({ ...initial, components: [{ ...initial.components[0]!, [field]: 'edited' }] }), true, field);
  assert.equal(reportSubjectDraftDirty({ ...initial, components: [{ ...initial.components[0]!, assessment_ids: ['publication'] }] }), true);
  assert.equal(reportSubjectDraftDirty({ ...initial, components: [...initial.components, { ...initialReportComponent, assessment_ids: [] }] }), true);
  assert.equal(reportSubjectDraftDirty({ ...initial, components: [] }), true);
  assert.equal(reportSubjectDraftDirty({ ...initial, components: [{ ...initialReportComponent, assessment_ids: [] }] }), false);
});
const manifest = (surfaces: unknown[]): WorkspaceManifest => ({ areas: [{ key: 'reports', surfaces }] }) as unknown as WorkspaceManifest;
const surface = (kind: string, id: string) => ({ key: `progress:${kind}:${id}`, label: id, href: `/areas/reports/progress?scope=${kind}&student_id=${id}`, scopes: [{ kind, id }], capabilities: [] });
test('progress uses the exact manifest relationship and never crosses learner contexts', () => {
  const source = manifest([surface('self', 'me'), surface('dependent', 'child-a'), surface('dependent', 'child-b')]);
  assert.equal(resolveReportRelationship(source, '/areas/reports/progress?scope=dependent&student_id=child-b')?.studentId, 'child-b');
  for (const query of ['scope=dependent', 'student_id=foreign', 'scope=', 'student_id=', 'scope=dependent&student_id=me', 'scope=self&scope=self&student_id=me', 'scope=dependent&student_id=child-b&student_id=child-b']) assert.equal(resolveReportRelationship(source, `/areas/reports/progress?${query}`), null, query);
  assert.equal(resolveReportRelationship(manifest([surface('dependent', 'only')]), '/areas/reports/progress')?.studentId, 'only');
  assert.equal(reportRelationships(manifest([surface('self', 'me'), surface('self', 'me')])).length, 0);
  assert.equal(reportRelationships(manifest([{ ...surface('dependent', 'a'), scopes: [{ kind: 'dependent', id: 'b' }] }])).length, 0);
});
test('report routes retain query modes and reject mixed, duplicate, unknown or empty exact selectors', () => {
  assert.deepEqual(academicReportRoute('/areas/reports/remarks?view=schemes&scheme=source'), { view: 'schemes', batchId: null, schemeId: 'source', create: null, sourcePolicyId: null, status: 'all' });
  assert.equal(academicReportRoute('/areas/reports/remarks?view=policies&create=policy&policy=source')?.sourcePolicyId, 'source');
  for (const query of ['batch=', 'scheme=', 'batch=a&scheme=b', 'batch=a&batch=a', 'create=policy&batch=a', 'view=unknown', 'status=unknown', 'policy=a', 'view=schemes&view=schemes']) assert.equal(academicReportRoute(`/areas/reports/remarks?${query}`), null, query);
});
const configuration: GradingPolicyConfiguration = { schema_version: 1, result_format: 'percentage', grade_point_scale: null, decimal_places: 2, aggregation: 'equal', absence_treatment: 'incomplete', exemption_treatment: 'exclude', gpa_failure_treatment: 'include', bands: [{ code: 'F', label: 'Below pass', minimum_percentage: 0, maximum_percentage: 39.99, grade_points: null, passed: false }, { code: 'P', label: 'Pass', minimum_percentage: 40, maximum_percentage: 100, grade_points: null, passed: true }] };
test('grading policy review rejects missing ranges, duplicate codes, invalid points and hidden zero conversion', () => {
  assert.equal(gradingConfigurationError(configuration), null);
  assert.ok(gradingConfigurationError({ ...configuration, bands: [{ ...configuration.bands[0]!, maximum_percentage: 40 }, configuration.bands[1]!] }));
  assert.ok(gradingConfigurationError({ ...configuration, bands: configuration.bands.map(band => ({ ...band, code: 'P' })) }));
  assert.ok(gradingConfigurationError({ ...configuration, decimal_places: 5 }));
  assert.ok(gradingConfigurationError({ ...configuration, result_format: 'gpa', grade_point_scale: 10 }));
  const gpa = { ...configuration, result_format: 'gpa' as const, grade_point_scale: 10, aggregation: 'credit_weighted' as const, bands: configuration.bands.map(band => ({ ...band, grade_points: band.passed ? 10 : 0 })) };
  assert.equal(gradingConfigurationError(gpa), null); assert.ok(gradingConfigurationError({ ...gpa, bands: [{ ...gpa.bands[0]!, grade_points: 11 }, gpa.bands[1]!] }));
  assert.equal(configuration.absence_treatment, 'incomplete');
});
const schemeSummary = { id: 'scheme', class_section_id: 'class', term_id: 'term', name: 'Scheme', code: 'SCHEME', term_name: 'Term', academic_year: '2026', class_name: 'Class', status: 'draft', review_mode: 'independent', absence_treatment: 'incomplete', revision: 1, subject_count: 1, report_count: 1 };
const batchSummary = { id: 'batch', scheme_id: 'scheme', scheme_name: 'Scheme', class_name: 'Class', term_name: 'Term', correction_reason: '', generated_at: '2026-10-29T10:00:00Z', status: 'draft', review_mode: 'independent', revision: 1, sequence: 1, published_at: null };
const workspace = { mode: 'admin', schemes: [schemeSummary], batches: [batchSummary], references: { terms: [{ id: 'term', name: 'Term', academic_year: '2026' }], classes: [{ id: 'class', name: 'Class', academic_year: '2026' }], subjects: [{ id: 'subject', name: 'Subject' }], assessments: [{ id: 'assessment', title: 'Assessment', maximum_marks: '100', publication_sequence: 1, subject_id: 'subject', class_section_id: 'class', term_id: 'term' }, { id: 'other-class', title: 'Other', maximum_marks: '100', publication_sequence: 1, subject_id: 'subject', class_section_id: 'other', term_id: 'term' }] } } as unknown as Extract<AcademicReportWorkspace, { mode: 'admin' }>;
const scheme = { scheme: schemeSummary, bands: [], subjects: [{ id: 'subject-plan', subject_id: 'subject', subject_name: 'Subject' }], components: [{ id: 'component', scheme_subject_id: 'subject-plan', code: 'TERM', name: 'Term assessment', weight_percentage: '100', assessment_ids: ['assessment'], assessment_titles: ['Assessment'] }] } as unknown as GradingSchemeDetail;
test('selected scheme, batch, learner and component chains must belong to the current source', () => {
  assert.equal(reportSchemeMatches(scheme, 'scheme', workspace), true); assert.equal(reportSchemeMatches({ ...scheme, scheme: { ...scheme.scheme, class_section_id: 'other' } }, 'scheme', workspace), false);
  const batch = { batch: { ...batchSummary, class_section_id: 'class', academic_year: '2026' }, students: [{ id: 'row', student_id: 'learner', first_name: 'Learner', last_name: '', admission_number: 'ADM', overall_grade: '', class_teacher_comment: '', principal_comment: '', comment_revision: 1, outcome: 'incomplete' }], subjects: [{ id: 'subject', report_student_id: 'row', subject_name: 'Subject', grade: '', outcome: 'incomplete' }], components: [{ id: 'component', report_subject_id: 'subject', component_name: 'Term', weight_percentage: '100', outcome: 'incomplete' }] } as unknown as ReportBatchDetail;
  assert.equal(reportBatchMatches(batch, 'batch', workspace), true); assert.equal(reportBatchMatches({ ...batch, students: [...batch.students, ...batch.students] }, 'batch', workspace), false); assert.equal(reportBatchMatches({ ...batch, components: [{ ...batch.components[0]!, report_subject_id: 'foreign' }] }, 'batch', workspace), false);
});
test('subject plans retain the exact class/term publication identity, unique sources and one-hundred-percent weighting', () => {
  const plan = { subjectId: 'subject', credits: null, courseCode: null, components: [{ code: 'TERM', name: 'Term result', weight_percentage: 100, assessment_ids: ['assessment'] }] };
  assert.equal(subjectPlanError(plan, scheme, workspace), null);
  assert.ok(subjectPlanError({ ...plan, components: [{ ...plan.components[0]!, assessment_ids: ['other-class'] }] }, scheme, workspace));
  assert.ok(subjectPlanError({ ...plan, components: [{ ...plan.components[0]!, weight_percentage: 50 }] }, scheme, workspace));
  assert.ok(subjectPlanError({ ...plan, components: [{ ...plan.components[0]!, assessment_ids: ['assessment', 'assessment'] }] }, scheme, workspace));
  const creditScheme = { ...scheme, scheme: { ...scheme.scheme, result_policy: { configuration: { ...configuration, aggregation: 'credit_weighted' } } } } as GradingSchemeDetail;
  assert.ok(subjectPlanError(plan, creditScheme, workspace)); assert.equal(subjectPlanError({ ...plan, credits: 4, courseCode: 'COURSE' }, creditScheme, workspace), null);
});

test('malformed workspace/detail reads surface unavailable rather than an empty or zero report', () => {
  assert.equal(reportWorkspaceMatches(workspace, 'campus'), true);
  assert.equal(reportWorkspaceMatches({ ...workspace, schemes: [{ ...workspace.schemes[0]!, school_id: 'foreign' }] } as unknown as AcademicReportWorkspace, 'campus'), false);
  for (const invalid of [null, {}, { ...workspace, schemes: [null] }, { ...workspace, references: null }, { ...workspace, batches: [{ ...batchSummary, scheme_id: 'foreign' }] }, { ...workspace, schemes: [{ ...schemeSummary, report_count: undefined }] }]) assert.equal(reportWorkspaceMatches(invalid as AcademicReportWorkspace), false);
  assert.equal(reportSchemeMatches({ ...scheme, subjects: [null] } as unknown as GradingSchemeDetail, 'scheme', workspace), false);
  assert.equal(reportSchemeMatches({ ...scheme, scheme: { ...scheme.scheme, revision: 0 } }, 'scheme', workspace), false);
});
