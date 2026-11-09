import type { ResultReviewReceipt } from '../../../packages/contracts/src/assessment-result-reviews';
import type { NativePendingAction, NativePendingScope } from './native-pending-action';

const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
export const reviewUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const note = (value: unknown): value is string => typeof value === 'string' && value.length >= 3 && value.length <= 1000 && value === value.trim();
export const resultReviewRoot = (schoolId: string) => `/api/v1/schools/${encodeURIComponent(schoolId)}/assessments/result-reviews`;
export const resultReviewReceiptPath = (schoolId: string, clientKey: string) => `${resultReviewRoot(schoolId)}/receipts/${clientKey}/`;

export function resultReviewActionAllowed(record: NativePendingAction, scope: NativePendingScope) {
  try {
    const source = record.source, body = record.payload.kind === 'json' ? object(JSON.parse(record.payload.body)) : null;
    if (!source || !body || !reviewUuid(source.sourceId) || record.method !== 'POST' || record.replayPolicy !== 'same_request' || body.idempotency_key !== record.clientId) return false;
    const root = resultReviewRoot(scope.schoolId), owner = new URL(record.ownerHref, 'https://thatcampus.invalid');
    const read = record.phase === 'accepted' ? resultReviewReceiptPath(scope.schoolId, record.clientId) : record.endpoint;
    if (source.kind === 'result_review_submit') {
      const field = reviewUuid(body.person_id) && body.student_id === undefined ? 'person_id'
        : reviewUuid(body.student_id) && body.person_id === undefined ? 'student_id' : null;
      if (!field || !reviewUuid(source.fingerprint) || !reviewUuid(body.reviewer_user_id) || !note(body.note) || source.revision !== 0) return false;
      return ['/areas/assessments/results', '/areas/reports/progress'].includes(owner.pathname)
        && owner.searchParams.getAll('scope').length === 1 && !owner.searchParams.has(field === 'person_id' ? 'student_id' : 'person_id')
        && owner.searchParams.get('scope') === (field === 'person_id' ? 'mine' : 'self')
        && owner.searchParams.getAll(field).length === 1 && owner.searchParams.get(field) === body[field]
        && owner.searchParams.getAll('publication_id').length === 1 && owner.searchParams.get('publication_id') === source.sourceId
        && owner.searchParams.getAll('assessment_id').length === 1 && owner.searchParams.get('assessment_id') === source.fingerprint
        && record.endpoint === `${root}/mine/${source.fingerprint}/${source.sourceId}/`
        && record.refreshPath === (record.phase === 'accepted' ? read : `${read}?${field}=${body[field]}`)
        && Object.keys(body).length === 4;
    }
    if (source.kind !== 'result_review_decide' || !Number.isSafeInteger(source.revision) || source.revision < 1
      || body.expected_revision !== source.revision || Object.keys(body).length !== 4) return false;
    return ['/areas/assessments/manage', '/areas/assessments/assigned'].includes(owner.pathname)
      && owner.searchParams.getAll('result_review_id').length === 1 && owner.searchParams.get('result_review_id') === source.sourceId
      && record.endpoint === `${root}/${source.sourceId}/` && record.refreshPath === read
      && (body.action === 'reassign' ? reviewUuid(body.reviewer_user_id) : ['resolve', 'refer_correction'].includes(String(body.action)) && note(body.note));
  } catch { return false; }
}

export function assertResultReviewReceipt(value: unknown, record: NativePendingAction): ResultReviewReceipt {
  const receipt = object(value), review = object(receipt?.review), source = record.source;
  const body = record.payload.kind === 'json' ? object(JSON.parse(record.payload.body)) : null;
  const submit = source?.kind === 'result_review_submit';
  if (!source || !receipt || !review || !body || !resultReviewActionAllowed(record, record.scope)
    || receipt.client_key !== record.clientId || receipt.accepted_revision !== source.revision + 1
    || receipt.action !== (submit ? 'submit' : body.action) || !reviewUuid(receipt.accepted_reviewer_user_id)
    || (submit || body.action === 'reassign') && receipt.accepted_reviewer_user_id !== body.reviewer_user_id
    || !submit && body.action !== 'reassign' && receipt.accepted_reviewer_user_id !== record.scope.actorId
    || review.school_id !== record.scope.schoolId || !reviewUuid(review.id) || !Number.isSafeInteger(review.revision)
    || Number(review.revision) < source.revision + 1
    || (submit ? review.publication_id !== source.sourceId || review.assessment_id !== source.fingerprint || review.request_note !== body.note
      : review.id !== source.sourceId || body.action !== 'reassign' && review.response_note !== body.note)) {
    throw new Error('The receipt did not confirm this exact result review.');
  }
  return value as ResultReviewReceipt;
}

export function resultReviewRefreshPath(value: unknown, record: NativePendingAction) {
  assertResultReviewReceipt(value, record);
  return resultReviewReceiptPath(record.scope.schoolId, record.clientId);
}

export function definitiveResultReviewRefusal(value: unknown, record: NativePendingAction) {
  if (!resultReviewActionAllowed(record, record.scope)) return false;
  const outer = object(value), error = object(object(outer?.details)?.error), fields = object(error?.fields);
  return outer?.status === 409 && error?.code === 'result_review_stale'
    && fields?.idempotency_key === record.clientId && fields.school_id === record.scope.schoolId
    && fields.actor_user_id === record.scope.actorId && fields.source_id === record.source?.sourceId;
}
