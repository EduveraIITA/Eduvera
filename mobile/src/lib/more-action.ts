export type MoreActionKind = 'feedback_create' | 'feedback_close' | 'feedback_respond' | 'verification_submit';
export interface MoreActionPlan { sourceId?: string; sourceRevision?: number; body: Record<string, unknown> }
export interface MoreActionRecord extends MoreActionPlan { version: 1; scopeKey: string; kind: MoreActionKind; phase: 'unknown' | 'accepted'; acceptedId?: string }
export interface MoreActionState { ready: boolean; blocked: boolean; busy: boolean; pending: MoreActionRecord | null; error: string }
export interface MoreActionGuard { assertCurrent(): void }
export interface MoreActionContext { assertActive(): void; validate(plan: MoreActionPlan): void; recover(record: MoreActionRecord): Promise<boolean> }
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export function moreActionEndpoint(kind: MoreActionKind, schoolId: string, plan: MoreActionPlan, mode: string): string {
  if (!uuid(schoolId) || !object(plan.body)) throw new Error('The original campus action could not be verified.');
  if (kind === 'verification_submit') {
    if (mode !== 'live' || plan.body.school_id !== schoolId || plan.sourceId && (plan.body.application_id !== plan.sourceId || !uuid(plan.sourceId))) throw new Error('Organization verification belongs to the exact Live campus.');
    return '/api/v1/onboarding/institution-applications/';
  }
  const root = `/api/v1/schools/${encodeURIComponent(schoolId)}/teacher-feedback/`;
  if (kind === 'feedback_create' && !plan.sourceId) return root;
  if (!uuid(plan.sourceId)) throw new Error('The exact feedback request could not be verified.');
  if (kind === 'feedback_close') return `${root}${plan.sourceId}/close/`;
  if (kind === 'feedback_respond') return `${root}${plan.sourceId}/responses/`;
  throw new Error('The original action kind is unavailable.');
}
export function moreActionAcceptedId(record: MoreActionRecord, result: unknown, schoolId: string): string | null {
  if (!object(result)) return null;
  if (record.kind === 'feedback_respond') return result.submitted === true ? record.sourceId ?? null : null;
  if (record.kind === 'feedback_close') return result.id === record.sourceId && result.closed === true ? record.sourceId! : null;
  if (!uuid(result.id)) return null;
  if (record.kind === 'feedback_create') return result.id;
  return (result.workspace_school_id === schoolId || result.provisioned_school_id === schoolId) && (!record.sourceId || result.id === record.sourceId) ? result.id : null;
}
export function validMoreActionRecord(value: unknown, scopeKey: string, kind: MoreActionKind, schoolId: string, mode: string): value is MoreActionRecord {
  if (!object(value) || value.version !== 1 || value.scopeKey !== scopeKey || value.kind !== kind || !['unknown', 'accepted'].includes(String(value.phase)) || !object(value.body) || value.sourceRevision !== undefined && (!Number.isSafeInteger(value.sourceRevision) || Number(value.sourceRevision) < 1) || value.acceptedId !== undefined && !uuid(value.acceptedId) || value.phase === 'accepted' && !uuid(value.acceptedId)) return false;
  try { moreActionEndpoint(kind, schoolId, value as unknown as MoreActionRecord, mode); return true; } catch { return false; }
}

/** Exact private intent survives lost responses. Unsupported receipt paths never imply replay. */
export class MoreActionJournal {
  private state: MoreActionState = { ready: false, blocked: false, busy: false, pending: null, error: '' };
  private listeners = new Set<(state: MoreActionState) => void>();
  private loading?: Promise<void>;
  constructor(private options: { scopeKey: string; kind: MoreActionKind; schoolId: string; mode: string; read(): Promise<string | null>; write(value: string): Promise<void>; clear(): Promise<void>; capture(): MoreActionGuard; send(path: string, body: string): Promise<unknown> }) {}
  snapshot() { return this.state; }
  subscribe(listener: (state: MoreActionState) => void) { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }
  private update(value: Partial<MoreActionState>) { this.state = { ...this.state, ...value }; for (const listener of this.listeners) listener(this.state); }
  hydrate() { return this.loading ??= (async () => { try { const raw = await this.options.read(), record: unknown = raw ? JSON.parse(raw) : null; if (raw && !validMoreActionRecord(record, this.options.scopeKey, this.options.kind, this.options.schoolId, this.options.mode)) throw new Error('The retained action could not be verified. Its bytes were kept; new actions are blocked.'); this.update({ ready: true, pending: record as MoreActionRecord | null }); } catch (cause) { this.update({ ready: true, blocked: true, error: this.message(cause) }); } })(); }
  private message(cause: unknown) { return cause instanceof Error ? cause.message : 'The action could not be confirmed.'; }
  private async operate(context: MoreActionContext, action: (guard: MoreActionGuard) => Promise<void>) {
    if (!this.state.ready || this.state.blocked || this.state.busy) return;
    this.update({ busy: true, error: '' });
    try { const captured = this.options.capture(), guard = { assertCurrent: () => { captured.assertCurrent(); context.assertActive(); } }; guard.assertCurrent(); await action(guard); }
    catch (cause) { this.update({ error: this.message(cause) }); }
    finally { this.update({ busy: false }); }
  }
  private async recover(record: MoreActionRecord, context: MoreActionContext, guard: MoreActionGuard) {
    const confirmed = await context.recover(record); guard.assertCurrent();
    if (!confirmed) { this.update({ error: record.phase === 'accepted' ? 'This action was saved. Refresh its owning record to finish.' : 'The result is still unconfirmed. Review the owning records before repeating anything.' }); return; }
    await this.options.clear(); guard.assertCurrent(); this.update({ pending: null, error: '' });
  }
  private async dispatch(record: MoreActionRecord, context: MoreActionContext, guard: MoreActionGuard, previouslyUncertain = false) {
    context.validate(record); guard.assertCurrent();
    // Storage failure is a dispatch barrier; the private intent must survive first.
    try { await this.options.write(JSON.stringify(record)); } catch (cause) { this.update({ blocked: true }); throw cause; }
    this.update({ pending: record }); guard.assertCurrent();
    let result: unknown;
    try { result = await this.options.send(moreActionEndpoint(record.kind, this.options.schoolId, record, this.options.mode), JSON.stringify(record.body)); }
    catch (cause) {
      const status = cause && typeof cause === 'object' && 'status' in cause ? cause.status : undefined;
      if (!previouslyUncertain && typeof status === 'number' && status >= 400 && status < 500 && ![408, 409, 429].includes(status)) { guard.assertCurrent(); await this.options.clear(); guard.assertCurrent(); this.update({ pending: null }); }
      throw cause;
    }
    guard.assertCurrent();
    const acceptedId = moreActionAcceptedId(record, result, this.options.schoolId);
    if (!acceptedId) throw new Error('The response did not confirm this exact action. Check the original result.');
    const accepted = { ...record, phase: 'accepted' as const, acceptedId }; this.update({ pending: accepted });
    await this.options.write(JSON.stringify(accepted)); guard.assertCurrent(); await this.recover(accepted, context, guard);
  }
  run(plan: MoreActionPlan, context: MoreActionContext) { if (this.state.pending) return Promise.resolve(); return this.operate(context, async guard => { const snapshot = JSON.parse(JSON.stringify(plan)) as MoreActionPlan; const record: MoreActionRecord = { ...snapshot, version: 1, scopeKey: this.options.scopeKey, kind: this.options.kind, phase: 'unknown' }; if (!validMoreActionRecord(record, record.scopeKey, record.kind, this.options.schoolId, this.options.mode)) throw new Error('This action cannot be retained safely.'); await this.dispatch(record, context, guard); }); }
  check(context: MoreActionContext) { return this.operate(context, async guard => { if (this.state.pending) await this.recover(this.state.pending, context, guard); }); }
  retry(context: MoreActionContext) { return this.operate(context, async guard => { const record = this.state.pending; if (!record) return; if (record.phase === 'accepted') return this.recover(record, context, guard); if (!['feedback_close', 'feedback_respond'].includes(record.kind)) throw new Error('This submission cannot be safely repeated. Review its original result; it was not sent again.'); await this.dispatch(record, context, guard, true); }); }
}
