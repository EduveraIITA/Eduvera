import type { VisitOnboardingLinkReveal, VisitOnboardingLinkState } from '../../../packages/contracts/src/visit-onboarding';
import type { NativePendingAction, NativePendingInput, NativePendingScope } from './native-pending-action';

const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const revision = (value: unknown, minimum = 0): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
const instant = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value));
const keys = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).length === allowed.length && allowed.every(key => Object.prototype.hasOwnProperty.call(value, key));
const stateKeys = ['visit_id', 'visit_revision', 'revision', 'can_manage', 'can_issue', 'can_revoke', 'public_onboarding_supported', 'current'] as const;
const invalid = () => new Error('The current visit registration link could not be verified. Refresh this visit before continuing.');

export function gateVisitOnboardingRoot(schoolId: string, visitId: string) {
  if (!uuid(schoolId) || !uuid(visitId)) throw invalid();
  return `/api/v1/gate/schools/${schoolId}/visit-arrangements/${visitId}/onboarding-link/`;
}

/** Metadata only. A response containing a credential is never adopted as read state. */
export function readVisitOnboardingState(value: unknown, visitId: string): VisitOnboardingLinkState | null {
  const data = object(value);
  if (!uuid(visitId) || !data || !keys(data, stateKeys) || data.visit_id !== visitId || !revision(data.visit_revision, 1) || !revision(data.revision)
    || ['can_manage', 'can_issue', 'can_revoke', 'public_onboarding_supported'].some(key => typeof data[key] !== 'boolean')
    || !data.can_manage && (data.can_issue || data.can_revoke)) return null;
  if (data.current === null) return data.revision === 0 && !data.can_revoke ? data as unknown as VisitOnboardingLinkState : null;
  const current = object(data.current);
  if (!current || !keys(current, ['id', 'revision', 'state', 'ends_at', 'issued_at', 'registration_count']) || !uuid(current.id) || !revision(current.revision, 1) || current.revision !== data.revision
    || !['active', 'revoked', 'expired', 'cancelled', 'issuer_unavailable'].includes(String(current.state)) || !instant(current.ends_at) || !instant(current.issued_at) || !revision(current.registration_count)
    || current.state === 'revoked' && data.can_revoke || current.state === 'active' && !data.can_revoke) return null;
  return data as unknown as VisitOnboardingLinkState;
}

/** This canonical source label binds both revisions; it is not an authority grant. */
const sourceFingerprint = (visitId: string, visitRevision: number) => JSON.stringify(['gate_visit', visitId, visitRevision]);
export function gateVisitOnboardingInput(schoolId: string, state: VisitOnboardingLinkState, action: 'issue' | 'revoke', endsAt?: string): NativePendingInput {
  if (!readVisitOnboardingState(state, state.visit_id) || !state.can_manage || !(action === 'issue' ? state.can_issue && instant(endsAt) : state.can_revoke && endsAt === undefined)) throw invalid();
  return { endpoint: gateVisitOnboardingRoot(schoolId, state.visit_id), serverKey: 'command_id', replayPolicy: 'same_request',
    body: { action, expected_revision: state.revision, expected_visit_revision: state.visit_revision, ...(action === 'issue' ? { ends_at: endsAt } : {}) },
    source: { kind: 'gate_visit_onboarding', sourceId: state.visit_id, revision: state.revision, fingerprint: sourceFingerprint(state.visit_id, state.visit_revision) } };
}

/** Only the exact reusable-link command, never reveal or public account endpoints. */
export function gateVisitOnboardingActionAllowed(record: NativePendingAction, scope: NativePendingScope): boolean {
  try {
    const source = record.source;
    if (record.domain !== 'gate' || record.method !== 'POST' || record.replayPolicy !== 'same_request' || record.payload.kind !== 'json' || !source || source.kind !== 'gate_visit_onboarding' || !uuid(source.sourceId)) return false;
    if (!keys(record as unknown as Record<string, unknown>, ['version', 'domain', 'scope', 'clientId', 'ownerHref', 'endpoint', 'refreshPath', 'method', 'payload', 'source', 'phase', 'replayPolicy', 'createdAt'])
      || !keys(source as unknown as Record<string, unknown>, ['kind', 'sourceId', 'revision', 'fingerprint']) || !keys(record.payload, ['kind', 'body'])
      || !keys(record.scope as unknown as Record<string, unknown>, ['actorId', 'schoolId', 'mode', 'namespaceId', 'origin'])) return false;
    const root = gateVisitOnboardingRoot(scope.schoolId, source.sourceId), body = object(JSON.parse(record.payload.body));
    if (record.endpoint !== root || !body || !['issue', 'revoke'].includes(String(body.action)) || !keys(body, ['command_id', 'expected_revision', 'expected_visit_revision', 'action', ...(body.action === 'issue' ? ['ends_at'] : [])])
      || body.command_id !== record.clientId || !revision(body.expected_revision) || source.revision !== body.expected_revision || !revision(body.expected_visit_revision, 1)
      || source.fingerprint !== sourceFingerprint(source.sourceId, body.expected_visit_revision) || body.action === 'issue' && !instant(body.ends_at)) return false;
    const owner = new URL(record.ownerHref, 'https://thatcampus.invalid');
    if (owner.pathname !== '/areas/in-out/visits' || owner.searchParams.getAll('visit').length !== 1 || owner.searchParams.get('visit') !== source.sourceId || owner.searchParams.has('shared') || owner.searchParams.has('participant')) return false;
    return record.refreshPath === (record.phase === 'accepted' ? `${root}commands/${record.clientId}/` : root);
  } catch { return false; }
}

/** The POST's credential is deliberately ignored; only an opaque exact receipt is retained. */
export function gateVisitOnboardingAcceptedPath(value: unknown, action: NativePendingAction) {
  if (!gateVisitOnboardingActionAllowed(action, action.scope) || action.payload.kind !== 'json') throw invalid();
  const result = object(value), receipt = object(result?.receipt), body = object(JSON.parse(action.payload.body))!;
  if (!result || !keys(result, [...stateKeys, 'receipt', 'join_url']) || !(result.join_url === null || typeof result.join_url === 'string') || !receipt || !keys(receipt, ['command_id', 'link_id', 'revision', 'action', 'replayed']) || receipt.command_id !== action.clientId || receipt.link_id !== action.clientId
    || receipt.revision !== Number(body.expected_revision) + 1 || receipt.action !== body.action || typeof receipt.replayed !== 'boolean') throw invalid();
  const metadata = result && Object.fromEntries(stateKeys.map(key => [key, result[key]]));
  const state = readVisitOnboardingState(metadata, action.source!.sourceId);
  if (!state || state.revision < receipt.revision || state.visit_revision < Number(body.expected_visit_revision)) throw invalid();
  return `${action.endpoint}commands/${action.clientId}/`;
}

export function assertVisitOnboardingReceipt(value: unknown, action: NativePendingAction) {
  const result = object(value), body = action.payload.kind === 'json' ? object(JSON.parse(action.payload.body)) : null;
  if (!gateVisitOnboardingActionAllowed(action, action.scope) || !body || !result || !keys(result, ['state', 'command_id', 'visit_id', 'source_id', 'revision', 'action'])
    || result.state !== 'accepted' || result.command_id !== action.clientId || result.visit_id !== action.source!.sourceId || result.source_id !== action.clientId || result.revision !== Number(body.expected_revision) + 1 || result.action !== body.action) throw invalid();
}

/** The server's fixed public route keeps its secret in a fragment, never a request URL. */
export function visitOnboardingShareUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/.test(value)) throw invalid();
  let url: URL; try { url = new URL(value); } catch { throw invalid(); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!(url.protocol === 'https:' || url.protocol === 'http:' && local) || url.username || url.password || url.pathname !== '/visit-join' || url.search || !/^#token=[A-Za-z0-9_-]{43}$/.test(url.hash) || url.href !== value) throw invalid();
  return value;
}

export function readVisitOnboardingReveal(value: unknown, state: VisitOnboardingLinkState): VisitOnboardingLinkReveal {
  const data = object(value);
  if (!state.can_manage || !state.public_onboarding_supported || state.current?.state !== 'active' || !data || !keys(data, ['visit_id', 'visit_revision', 'link_id', 'revision', 'ends_at', 'join_url'])
    || data.visit_id !== state.visit_id || data.visit_revision !== state.visit_revision || data.link_id !== state.current.id || data.revision !== state.revision || data.ends_at !== state.current.ends_at) throw invalid();
  visitOnboardingShareUrl(data.join_url); return data as unknown as VisitOnboardingLinkReveal;
}

export function sameVisitOnboardingSource(a: VisitOnboardingLinkState, b: VisitOnboardingLinkState) {
  return a.visit_id === b.visit_id && a.visit_revision === b.visit_revision && a.revision === b.revision && a.can_manage === b.can_manage && a.can_issue === b.can_issue && a.can_revoke === b.can_revoke && a.public_onboarding_supported === b.public_onboarding_supported
    && a.current?.id === b.current?.id && a.current?.state === b.current?.state && a.current?.ends_at === b.current?.ends_at;
}
