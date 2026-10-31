/** Pure, owner-qualified policy for retained native fee-review commands. */
export interface NativeFeeAction {
  version: 1; scopeKey: string; schoolId: string; key: string; invoiceId: string; reviewId: string;
  action: 'report' | 'decide' | 'withdraw'; path: string; confirmationPath: string; body: string; phase: 'unknown' | 'accepted';
}
export interface NativeFeeConfirmation {
  state: string; handler?: string; invoice_id?: string; command_id?: string; source_id?: string | null; action?: string | null;
  result?: { id?: string; invoice_id?: string };
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
function apiError(cause: unknown) {
  return cause instanceof Error && cause.name === 'ApiError' && typeof (cause as Error & { status?: unknown }).status === 'number'
    ? cause as Error & { status: number; details?: unknown } : null;
}
export function nativeFeeReviewObsolete(cause: unknown, command: Pick<NativeFeeAction, 'key' | 'invoiceId' | 'reviewId' | 'body'>) {
  const failure = apiError(cause); if (!failure || failure.status !== 409) return false;
  let revision: unknown;
  try { revision = object(JSON.parse(command.body)).expected_revision; } catch { return false; }
  if (!Number.isSafeInteger(revision) || Number(revision) < 0) return false;
  const error = object(object(failure.details).error), proof = object(object(error.fields).native_fee_review_obsolete);
  return error.code === 'native_fee_review_obsolete' && proof.handler === 'finance.payment_review'
    && proof.confirmation === 'permanently_inapplicable' && proof.receipt_state === 'absent'
    && proof.invoice_id === command.invoiceId && proof.review_id === command.reviewId && proof.command_id === command.key
    && proof.expected_revision === revision && Number.isSafeInteger(proof.current_revision) && Number(proof.current_revision) >= Number(revision)
    && (proof.reason === 'stream_advanced' && Number(proof.current_revision) > Number(revision) || ['ledger_basis_diverged', 'already_decided'].includes(String(proof.reason)));
}
export function nativeFeeFailureDisposition(cause: unknown, command: NativeFeeAction, previouslyUncertain: boolean, knownAccepted = false): 'accepted' | 'obsolete' | 'refused' | 'unknown' {
  // A failed refresh or persistence write cannot revoke a proved accepted outcome.
  if (knownAccepted || command.phase === 'accepted') return 'accepted';
  if (nativeFeeReviewObsolete(cause, command)) return 'obsolete';
  const failure = apiError(cause);
  // A refusal on a later attempt cannot prove what happened to an earlier POST.
  if (!previouslyUncertain && failure && failure.status >= 400 && failure.status < 500 && failure.status !== 409) return 'refused';
  return 'unknown';
}
export function matchesNativeFeeConfirmation(receipt: NativeFeeConfirmation | undefined, command: Pick<NativeFeeAction, 'key' | 'invoiceId' | 'reviewId' | 'action'>) {
  return !!receipt && receipt.handler === 'finance.payment_review' && receipt.invoice_id === command.invoiceId && receipt.command_id === command.key
    && ['accepted', 'pending', 'not_found', 'not_accepted'].includes(receipt.state)
    && (receipt.state === 'not_found' || receipt.source_id === command.reviewId && receipt.action === command.action)
    && (receipt.state !== 'accepted' || receipt.result?.id === command.reviewId && receipt.result.invoice_id === command.invoiceId);
}
export function validateNativeFeeAction(value: unknown, scopeKey: string, schoolId: string): value is NativeFeeAction {
  const command = object(value), uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  if (command.version !== 1 || command.scopeKey !== scopeKey || command.schoolId !== schoolId
    || !['report', 'decide', 'withdraw'].includes(String(command.action)) || !['unknown', 'accepted'].includes(String(command.phase))
    || !['key', 'invoiceId', 'reviewId'].every(name => typeof command[name] === 'string' && uuid.test(command[name] as string)) || typeof command.body !== 'string') return false;
  const root = `/api/v1/schools/${encodeURIComponent(schoolId)}/fees`;
  const path = command.action === 'report' ? `${root}/invoices/${encodeURIComponent(String(command.invoiceId))}/payment-reviews/`
    : `${root}/payment-reviews/${encodeURIComponent(String(command.reviewId))}/${command.action === 'decide' ? 'decision' : 'withdraw'}/`;
  if (command.path !== path || typeof command.confirmationPath !== 'string') return false;
  try {
    const url = new URL(command.confirmationPath, 'https://thatcampus.invalid');
    const recovery = command.action === 'withdraw' && url.pathname === `${root}/payment-reviews/${command.reviewId}/recovery/`;
    if (!command.confirmationPath.startsWith('/') || url.origin !== 'https://thatcampus.invalid' || !recovery && url.pathname !== `${root}/payment-reviews/workspace/` || url.hash
      || [...url.searchParams.keys()].some(name => !(recovery ? ['command_id'] : ['invoice_id', 'command_id', 'person_id', 'student_id']).includes(name))
      || ['invoice_id', 'command_id', 'person_id', 'student_id'].some(name => url.searchParams.getAll(name).length > 1)
      || !recovery && url.searchParams.get('invoice_id') !== command.invoiceId || url.searchParams.get('command_id') !== command.key
      || url.searchParams.has('person_id') && url.searchParams.has('student_id')) return false;
    const body = object(JSON.parse(command.body));
    return body.command_id === command.key && Number.isSafeInteger(body.expected_revision) && Number(body.expected_revision) >= 0
      && (command.action !== 'report' || body.review_id === command.reviewId);
  } catch { return false; }
}
