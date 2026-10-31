import type { WorkspaceAreaSurface, WorkspaceManifest } from '../../../packages/contracts/src/workspace';
import type { AcademicReportWorkspace, GradingPolicyConfiguration, GradingSchemeDetail, ReportBatchDetail } from '../../../packages/contracts/src/academic-reports';

export const initialReportReviewMode = 'independent';
export const initialReportComponent = { code: 'TERM', name: 'Term assessment', weight: '100' } as const;
export function reportSchemeDraftDirty(draft: { termId: string; classId: string; policyId: string; name: string; code: string; programme: string; termIndex: string; reviewMode: string }) {
  return !!(draft.termId || draft.classId || draft.policyId || draft.name || draft.code || draft.programme || draft.termIndex || draft.reviewMode !== initialReportReviewMode);
}
export function reportSubjectDraftDirty(draft: { subjectId: string; credits: string; courseCode: string; pass: string; components: readonly { code: string; name: string; weight: string; assessment_ids: readonly string[] }[] }) {
  return !!(draft.subjectId || draft.credits || draft.courseCode || draft.pass || draft.components.length !== 1 || draft.components.some(component => component.code !== initialReportComponent.code || component.name !== initialReportComponent.name || component.weight !== initialReportComponent.weight || component.assessment_ids.length > 0));
}

export type ReportRelationship = { kind: 'self' | 'dependent'; studentId: string; label: string; href: string };
export const reportQuery = (href: string) => new URLSearchParams(href.split('?')[1] ?? '');
export function reportHref(href: string, values: Record<string, string>) {
  const query = reportQuery(href); for (const [key, value] of Object.entries(values)) value ? query.set(key, value) : query.delete(key);
  return `${href.split('?')[0]}${query.size ? `?${query}` : ''}`;
}
export function reportRelationships(manifest: WorkspaceManifest): ReportRelationship[] {
  const candidates = (manifest.areas.find(area => area.key === 'reports')?.surfaces ?? []).flatMap((surface: WorkspaceAreaSurface) => {
    const match = /^progress:(self|dependent):([^:]+)$/.exec(surface.key); if (!match) return [];
    const kind = match[1] as ReportRelationship['kind'], studentId = match[2]!, query = reportQuery(surface.href);
    if (surface.href.split('?')[0] !== '/areas/reports/progress' || query.getAll('scope').length !== 1 || query.get('scope') !== kind || query.getAll('student_id').length !== 1 || query.get('student_id') !== studentId || !surface.scopes.some(scope => scope.kind === kind && scope.id === studentId)) return [];
    return [{ kind, studentId, label: surface.label, href: surface.href }];
  });
  return candidates.filter(candidate => candidates.filter(other => other.kind === candidate.kind && other.studentId === candidate.studentId).length === 1);
}
export function resolveReportRelationship(manifest: WorkspaceManifest, href: string): ReportRelationship | null {
  const query = reportQuery(href), options = reportRelationships(manifest);
  if (href.split('?')[0] !== '/areas/reports/progress' || ['scope', 'student_id'].some(key => query.getAll(key).length > 1)) return null;
  const scope = query.get('scope'), id = query.get('student_id');
  if (query.has('scope') && !['self', 'dependent'].includes(scope ?? '') || query.has('student_id') && !id) return null;
  const matches = options.filter(option => (!scope || option.kind === scope) && (!id || option.studentId === id));
  return matches.length === 1 ? matches[0]! : null;
}
export type ReportRoute = { view: 'releases' | 'schemes' | 'policies'; batchId: string | null; schemeId: string | null; create: 'scheme' | 'policy' | null; sourcePolicyId: string | null; status: string };
export function academicReportRoute(href: string): ReportRoute | null {
  if (href.split('?')[0] !== '/areas/reports/remarks') return null;
  const q = reportQuery(href);
  if (['view', 'batch', 'scheme', 'create', 'policy', 'status'].some(key => q.getAll(key).length > 1)) return null;
  if (q.has('view') && !['releases', 'schemes', 'policies'].includes(q.get('view')!) || q.has('status') && !['all', 'draft', 'reviewed', 'published', 'cancelled'].includes(q.get('status')!)) return null;
  const batchId = q.get('batch'), schemeId = q.get('scheme'), create = q.get('create');
  if (q.has('batch') && !batchId || q.has('scheme') && !schemeId || batchId && schemeId || create && !['scheme', 'policy'].includes(create) || create && (batchId || schemeId) || q.has('policy') && (create !== 'policy' || !q.get('policy'))) return null;
  return { view: q.get('view') as ReportRoute['view'] ?? 'releases', batchId, schemeId, create: create as ReportRoute['create'], sourcePolicyId: q.get('policy'), status: q.get('status') ?? 'all' };
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === 'string';
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(string);
const positiveRevision = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
const fields = (value: Record<string, unknown>, keys: string[]) => keys.every(key => string(value[key]));
const campusMatches = (value: unknown, schoolId?: string) => !schoolId || record(value) && (!Object.prototype.hasOwnProperty.call(value, 'school_id') || value.school_id === schoolId);
const uniqueIds = (values: Array<{ id: string }>) => new Set(values.map(value => value.id)).size === values.length;
function policySnapshotMatches(value: unknown) {
  if (value === null || value === undefined) return true;
  return record(value) && fields(value, ['policy_id', 'name', 'code', 'semantic_fingerprint']) && positiveRevision(value.version) && record(value.configuration) && !gradingConfigurationError(value.configuration as unknown as GradingPolicyConfiguration);
}
function schemeSummaryMatches(value: unknown, counts = false) {
  return record(value) && fields(value, ['id', 'term_id', 'class_section_id', 'name', 'code', 'term_name', 'academic_year', 'class_name']) && ['draft', 'active', 'archived'].includes(String(value.status)) && ['independent', 'owner_review'].includes(String(value.review_mode)) && ['zero', 'incomplete'].includes(String(value.absence_treatment)) && positiveRevision(value.revision) && policySnapshotMatches(value.result_policy) && (!counts || [value.subject_count, value.report_count].every(count => Number.isSafeInteger(count) && Number(count) >= 0));
}
function batchSummaryMatches(value: unknown) {
  return record(value) && fields(value, ['id', 'scheme_id', 'scheme_name', 'class_name', 'term_name', 'correction_reason', 'generated_at']) && ['draft', 'reviewed', 'published', 'cancelled'].includes(String(value.status)) && ['independent', 'owner_review'].includes(String(value.review_mode)) && positiveRevision(value.revision) && positiveRevision(value.sequence) && (value.published_at === null || string(value.published_at)) && policySnapshotMatches(value.result_policy);
}
export function reportWorkspaceMatches(data: AcademicReportWorkspace, schoolId?: string): boolean {
  try {
    if (!campusMatches(data, schoolId) || !['admin', 'staff'].includes(data?.mode) || !Array.isArray(data.schemes) || !data.schemes.every(item => campusMatches(item, schoolId) && schemeSummaryMatches(item, true)) || !uniqueIds(data.schemes) || !Array.isArray(data.batches) || !data.batches.every(item => campusMatches(item, schoolId) && batchSummaryMatches(item)) || !uniqueIds(data.batches) || data.batches.some(batch => !data.schemes.some(scheme => scheme.id === batch.scheme_id))) return false;
    if (data.policies && (!Array.isArray(data.policies) || !uniqueIds(data.policies) || data.policies.some(policy => !campusMatches(policy, schoolId) || !record(policy) || !fields(policy, ['id', 'name', 'code']) || !positiveRevision(policy.version) || !positiveRevision(policy.revision) || !['draft', 'active'].includes(policy.status) || gradingConfigurationError(policy.configuration)))) return false;
    if (data.mode === 'admin') {
      const references = data.references;
      if (!references || !Array.isArray(references.terms) || !references.terms.every(item => record(item) && fields(item, ['id', 'name', 'academic_year'])) || !uniqueIds(references.terms) || !Array.isArray(references.classes) || !references.classes.every(item => record(item) && fields(item, ['id', 'name', 'academic_year'])) || !uniqueIds(references.classes) || !Array.isArray(references.subjects) || !references.subjects.every(item => record(item) && fields(item, ['id', 'name'])) || !uniqueIds(references.subjects) || !Array.isArray(references.assessments) || !references.assessments.every(item => record(item) && fields(item, ['id', 'title', 'subject_id', 'class_section_id', 'term_id', 'maximum_marks']) && positiveRevision(item.publication_sequence)) || !uniqueIds(references.assessments)) return false;
    }
    return true;
  } catch { return false; }
}
export function reportBatchMatches(data: ReportBatchDetail, id: string, workspace: AcademicReportWorkspace, schoolId?: string): boolean {
  try {
    const source = workspace.batches.find(batch => batch.id === id), scheme = workspace.schemes.find(item => item.id === source?.scheme_id);
    return !!source && !!scheme && campusMatches(data, schoolId) && campusMatches(data?.batch, schoolId) && batchSummaryMatches(data?.batch) && data.batch.id === id && data.batch.scheme_id === source.scheme_id && data.batch.class_section_id === scheme.class_section_id && string(data.batch.academic_year) && data.batch.revision >= source.revision && Array.isArray(data.students) && data.students.every(student => campusMatches(student, schoolId) && record(student) && fields(student, ['id', 'student_id', 'first_name', 'last_name', 'admission_number', 'overall_grade', 'class_teacher_comment', 'principal_comment']) && positiveRevision(student.comment_revision) && ['complete', 'incomplete', 'withheld'].includes(student.outcome) && policySnapshotMatches(student.result_policy)) && new Set(data.students.map(student => student.student_id)).size === data.students.length && uniqueIds(data.students) && Array.isArray(data.subjects) && data.subjects.every(subject => campusMatches(subject, schoolId) && record(subject) && fields(subject, ['id', 'report_student_id', 'subject_name', 'grade']) && ['complete', 'incomplete', 'exempt', 'withheld'].includes(subject.outcome) && data.students.some(student => student.id === subject.report_student_id)) && uniqueIds(data.subjects) && Array.isArray(data.components) && data.components.every(component => campusMatches(component, schoolId) && record(component) && fields(component, ['id', 'report_subject_id', 'component_name', 'weight_percentage']) && ['complete', 'incomplete', 'exempt'].includes(component.outcome) && data.subjects.some(subject => subject.id === component.report_subject_id)) && uniqueIds(data.components);
  } catch { return false; }
}
export function reportSchemeMatches(data: GradingSchemeDetail, id: string, workspace: AcademicReportWorkspace, schoolId?: string): boolean {
  try {
    const source = workspace.schemes.find(scheme => scheme.id === id);
    return !!source && campusMatches(data, schoolId) && campusMatches(data?.scheme, schoolId) && schemeSummaryMatches(data?.scheme) && data.scheme.id === id && data.scheme.term_id === source.term_id && data.scheme.class_section_id === source.class_section_id && data.scheme.revision >= source.revision && Array.isArray(data.bands) && data.bands.every(band => record(band) && fields(band, ['id', 'code', 'label', 'minimum_percentage', 'maximum_percentage'])) && uniqueIds(data.bands) && Array.isArray(data.subjects) && data.subjects.every(subject => campusMatches(subject, schoolId) && record(subject) && fields(subject, ['id', 'subject_id', 'subject_name'])) && uniqueIds(data.subjects) && Array.isArray(data.components) && data.components.every(component => campusMatches(component, schoolId) && record(component) && fields(component, ['id', 'scheme_subject_id', 'code', 'name', 'weight_percentage']) && strings(component.assessment_ids) && strings(component.assessment_titles) && component.assessment_ids.length === component.assessment_titles.length && data.subjects.some(subject => subject.id === component.scheme_subject_id)) && uniqueIds(data.components);
  } catch { return false; }
}
export function gradingConfigurationError(configuration: GradingPolicyConfiguration): string | null {
  if (configuration.schema_version !== 1 || !['percentage', 'grade', 'gpa'].includes(configuration.result_format) || !['equal', 'credit_weighted'].includes(configuration.aggregation) || !['incomplete', 'zero'].includes(configuration.absence_treatment) || configuration.exemption_treatment !== 'exclude' || !['include', 'withhold'].includes(configuration.gpa_failure_treatment) || !Number.isInteger(configuration.decimal_places) || configuration.decimal_places < 0 || configuration.decimal_places > 4) return 'Review the result format, precision and treatment settings.';
  if (configuration.result_format === 'gpa' && (!(Number(configuration.grade_point_scale) > 0) || Number(configuration.grade_point_scale) > 100 || configuration.aggregation !== 'credit_weighted')) return 'GPA requires a valid grade-point scale and credit weighting.';
  if (configuration.result_format !== 'gpa' && configuration.grade_point_scale !== null) return 'Only GPA policies use a grade-point scale.';
  const bands = [...configuration.bands].sort((a, b) => a.minimum_percentage - b.minimum_percentage);
  if (!bands.length || bands.length > 30 || new Set(bands.map(band => band.code.trim().toUpperCase())).size !== bands.length) return 'Use one to thirty uniquely coded grading bands.';
  for (let index = 0; index < bands.length; index++) {
    const band = bands[index]!;
    if (!band.code.trim() || band.code.length > 24 || !band.label.trim() || band.label.length > 80 || !Number.isFinite(band.minimum_percentage) || !Number.isFinite(band.maximum_percentage) || band.minimum_percentage < 0 || band.maximum_percentage > 100 || band.minimum_percentage > band.maximum_percentage || Math.abs(band.minimum_percentage * 100 - Math.round(band.minimum_percentage * 100)) > 0.000001 || Math.abs(band.maximum_percentage * 100 - Math.round(band.maximum_percentage * 100)) > 0.000001) return 'Review each grading band name and percentage range, using hundredths.';
    if (index === 0 ? band.minimum_percentage !== 0 : Math.abs(band.minimum_percentage - bands[index - 1]!.maximum_percentage - 0.01) > 0.000001) return 'Bands must cover zero to one hundred without gaps or overlap, in hundredths.';
    if (configuration.result_format === 'gpa' ? band.grade_points === null || !Number.isFinite(band.grade_points) || band.grade_points < 0 || band.grade_points > Number(configuration.grade_point_scale) : band.grade_points !== null) return 'Review the grade points for this result format.';
  }
  return bands.at(-1)!.maximum_percentage === 100 ? null : 'Bands must cover up to one hundred percent.';
}
export function subjectPlanError(input: { subjectId: string; credits: number | null; courseCode: string | null; components: Array<{ code: string; name: string; weight_percentage: number; assessment_ids: string[] }> }, scheme: GradingSchemeDetail, data: Extract<AcademicReportWorkspace, { mode: 'admin' }>): string | null {
  if (!data.references.subjects.some(subject => subject.id === input.subjectId)) return 'Choose an available subject.';
  if (!input.components.length || input.components.length > 20 || new Set(input.components.map(component => component.code.trim().toUpperCase())).size !== input.components.length || Math.abs(input.components.reduce((sum, component) => sum + component.weight_percentage, 0) - 100) > 0.000001) return 'Use uniquely coded components whose weights total one hundred percent.';
  const eligible = new Set(data.references.assessments.filter(item => item.subject_id === input.subjectId && item.class_section_id === scheme.scheme.class_section_id && item.term_id === scheme.scheme.term_id).map(item => item.id));
  const selected: string[] = [];
  for (const component of input.components) {
    if (!component.code.trim() || component.code.length > 32 || component.name.trim().length < 2 || component.name.length > 100 || !Number.isFinite(component.weight_percentage) || component.weight_percentage <= 0 || component.weight_percentage > 100 || !component.assessment_ids.length || component.assessment_ids.length > 30 || component.assessment_ids.some(id => !eligible.has(id))) return 'Each component needs a name, positive weight and published assessments for this exact class, term and subject.';
    selected.push(...component.assessment_ids);
  }
  if (new Set(selected).size !== selected.length) return 'A published assessment can be mapped only once in a subject plan.';
  const credits = scheme.scheme.result_policy?.configuration;
  if ((credits?.result_format === 'gpa' || credits?.aggregation === 'credit_weighted') && (!input.courseCode || input.courseCode.length < 2 || input.courseCode.length > 80 || !input.credits || input.credits <= 0 || input.credits > 1000)) return 'Provide the stable course code and positive credits required by this policy.';
  return null;
}
