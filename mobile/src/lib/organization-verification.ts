import type { InstitutionApplication } from '../../../packages/contracts/src/wire/features/onboarding/api';
import type { ProgressiveWorkspace } from '../../../packages/contracts/src/wire/features/onboarding/progressive-api';
import type { MoreActionPlan, MoreActionRecord } from './more-action';
export function nativeVerificationState(source: ProgressiveWorkspace | undefined, schoolId: string) {
  if (!source?.workspace || source.workspace.id !== schoolId || !Array.isArray(source.applications)) return null;
  const workspace = source.workspace;
  const application = source.applications.find(item => item.workspace_school_id === schoolId || item.provisioned_school_id === schoolId);
  if (application && (!Number.isSafeInteger(application.revision) || application.revision < 1)) return null;
  const approved = workspace.verification_status === 'approved';
  return { workspace, application, approved, canStart: !approved && (!application || ['rejected', 'withdrawn'].includes(application.status)), needsInformation: !approved && application?.status === 'needs_information' };
}
export function validateNativeVerification(plan: MoreActionPlan, source: ProgressiveWorkspace | undefined, schoolId: string, mode: string) {
  const state = nativeVerificationState(source, schoolId), body = plan.body;
  if (mode !== 'live' || !state || state.approved || !state.canStart && !state.needsInformation || body.school_id !== schoolId || body.timezone !== state.workspace.timezone || body.declaration_accepted !== true) throw new Error('Confirm your current Live campus and declaration before submitting verification.');
  if (state.needsInformation && (!state.application || plan.sourceId !== state.application.id || plan.sourceRevision !== state.application.revision || body.application_id !== state.application.id) || !state.needsInformation && (plan.sourceId || body.application_id)) throw new Error('The verification review changed. Refresh it before submitting the requested details.');
  const fields: Record<string, [number, number]> = { institution_name: [2, 180], state_code: [2, 12], district: [2, 120], applicant_role_title: [2, 120], regulator_reference: [3, 180] };
  for (const [key, [min, max]] of Object.entries(fields)) if (typeof body[key] !== 'string' || body[key].trim().length < min || body[key].trim().length > max) throw new Error('Complete the organisation details and registration reference within the displayed limits.');
  if (!['school', 'college', 'coaching', 'hybrid'].includes(String(body.institution_kind)) || !['other', 'udise', 'aishe', 'board_affiliation', 'trust_registration'].includes(String(body.regulator_type))) throw new Error('Choose an organisation and registration-reference type.');
  if (body.website) { try { const url = new URL(String(body.website)); if (!['http:', 'https:'].includes(url.protocol) || String(body.website).length > 240) throw new Error(); } catch { throw new Error('Use a valid official website, or leave the optional website empty.'); } }
  const keys = ['school_id', 'application_id', 'timezone', 'institution_name', 'institution_kind', 'state_code', 'district', 'website', 'applicant_role_title', 'regulator_type', 'regulator_reference', 'declaration_accepted'];
  if (Object.keys(body).some(key => !keys.includes(key))) throw new Error('The verification request contains unsupported details.');
}
export function nativeVerificationRecovered(record: MoreActionRecord, source: ProgressiveWorkspace | undefined, schoolId: string) {
  const state = nativeVerificationState(source, schoolId); if (!state) return false;
  const application = source?.applications.find(item => item.id === (record.acceptedId ?? record.sourceId) && (item.workspace_school_id === schoolId || item.provisioned_school_id === schoolId));
  if (!application) return false;
  if (record.phase === 'accepted') return true;
  return Boolean(record.sourceId && record.sourceRevision && application.revision > record.sourceRevision && application.status !== 'needs_information' && verificationFieldsMatch(application, record.body));
}
function verificationFieldsMatch(application: InstitutionApplication, body: Record<string, unknown>) {
  return ['institution_name', 'institution_kind', 'timezone', 'state_code', 'district', 'website', 'applicant_role_title', 'regulator_type', 'regulator_reference'].every(key => String(application[key as keyof InstitutionApplication] ?? '').trim() === String(body[key] ?? '').trim());
}
