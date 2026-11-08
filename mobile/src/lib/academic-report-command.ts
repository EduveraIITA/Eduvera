export interface ReportCommandScope { actorId: string; schoolId: string; mode: 'live' | 'simulation'; namespaceId: string | null; origin: string }
export interface ReportCommandStorage { read(): Promise<string | null>; write(value: string): Promise<void>; clear(): Promise<void> }
export interface ReportCommand {
  version: 1; scope: ReportCommandScope; key: string; ownerHref: string; endpoint: string; method: 'POST' | 'PUT'; body: string;
  phase: 'prepared' | 'unknown' | 'accepted'; result?: unknown;
}
export interface ReportCommandState { ready: boolean; busy: boolean; blocked: boolean; pending: ReportCommand | null; error: string }
export interface ReportCommandOperation { assertCurrent(): void; accepted?(command: ReportCommand): Promise<void> }
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const orderedJson = (value: unknown): unknown => Array.isArray(value) ? value.map(orderedJson) : object(value) ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, orderedJson(item)])) : value;
const sameJson = (left: unknown, right: unknown) => JSON.stringify(orderedJson(left)) === JSON.stringify(orderedJson(right));
const text = (cause: unknown) => cause instanceof Error ? cause.message : 'The grading action was not confirmed.';
export function reportCommandScopeKey(scope: ReportCommandScope): string {
  const origin = new URL(scope.origin);
  if (!scope.actorId || !scope.schoolId || !['live', 'simulation'].includes(scope.mode) || scope.mode === 'simulation' && !scope.namespaceId || origin.origin !== scope.origin || !['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) throw new Error('Confirm the exact account, campus, world and server before continuing.');
  return JSON.stringify([scope.actorId, scope.schoolId, scope.mode, scope.namespaceId, scope.origin]);
}
export function reportCommandKind(command: Pick<ReportCommand, 'endpoint' | 'method' | 'scope'>): { kind: 'policy' | 'scheme' | 'batch' | 'comments'; target?: string; studentId?: string; learnerId?: string; action: string } | null {
  const root = `/api/v1/schools/${encodeURIComponent(command.scope.schoolId)}/academic-reports/`;
  if (!command.endpoint.startsWith(root)) return null;
  const path = command.endpoint.slice(root.length);
  if (command.method === 'POST' && path === 'policies/') return { kind: 'policy', action: 'create' };
  if (command.method === 'POST' && path === 'schemes/') return { kind: 'scheme', action: 'create' };
  let match = /^(policies|schemes)\/([^/]+)\/(activate|generate)\/$/.exec(path);
  if (match && command.method === 'POST' && uuid(match[2]) && !(match[1] === 'policies' && match[3] === 'generate')) return { kind: match[3] === 'generate' ? 'batch' : match[1] === 'policies' ? 'policy' : 'scheme', target: match[2], action: match[3]! };
  match = /^schemes\/([^/]+)\/subjects\/$/.exec(path);
  if (match && uuid(match[1]) && command.method === 'PUT') return { kind: 'scheme', target: match[1], action: 'subject' };
  match = /^batches\/([^/]+)\/actions\/(review|publish|cancel)\/$/.exec(path);
  if (match && uuid(match[1]) && command.method === 'POST') return { kind: 'batch', target: match[1], action: match[2]! };
  match = /^batches\/([^/]+)\/(students|learners)\/([^/]+)\/comments\/$/.exec(path);
  if (match && uuid(match[1]) && uuid(match[3]) && command.method === 'PUT') return { kind: 'comments', target: match[1], ...(match[2] === 'learners' ? { learnerId: match[3] } : { studentId: match[3] }), action: 'comments' };
  return null;
}
function reportSchemeRequestContextMatches(body: Record<string, unknown>, result: Record<string, unknown>): boolean {
  const kind = body.context_kind ?? 'class_term';
  if ((result.context_kind ?? 'class_term') !== kind || result.class_section_id !== body.class_section_id) return false;
  if (kind === 'class_term') return uuid(body.class_section_id) && (!body.offering_ids || Array.isArray(body.offering_ids) && body.offering_ids.length === 0) && (!result.offering_ids || Array.isArray(result.offering_ids) && result.offering_ids.length === 0);
  const ids = body.offering_ids, returned = result.offering_ids;
  return kind === 'learning_offering' && body.class_section_id === null && Array.isArray(ids) && ids.length > 0 && ids.length <= 100 && ids.every(uuid) && new Set(ids).size === ids.length
    && Array.isArray(returned) && returned.every(uuid) && new Set(returned).size === returned.length && sameJson([...ids].sort(), [...returned].sort());
}
export function reportCommandResultMatches(command: ReportCommand, value: unknown): boolean {
  const kind = reportCommandKind(command), result = object(value), body = object(JSON.parse(command.body));
  if (!kind || !result || !body || !uuid(result.id) || Object.prototype.hasOwnProperty.call(result, 'school_id') && result.school_id !== command.scope.schoolId) return false;
  if (kind.kind === 'comments') return (kind.learnerId ? result.learner_id === kind.learnerId && (result.student_id === null || uuid(result.student_id)) : result.student_id === kind.studentId) && revision(result.comment_revision) && result.comment_revision === Number(body.expected_revision) + 1 && revision(result.batch_revision) && result.batch_revision === Number(body.expected_batch_revision) + 1 && typeof body.class_teacher_comment === 'string' && typeof body.principal_comment === 'string' && result.class_teacher_comment === body.class_teacher_comment.trim() && result.principal_comment === body.principal_comment.trim();
  if (!revision(result.revision)) return false;
  if (kind.action === 'generate') return result.scheme_id === kind.target && result.status === 'draft' && revision(result.sequence);
  if (kind.target && result.id !== kind.target) return false;
  if (kind.target && result.revision !== Number(body.expected_revision) + 1) return false;
  if (kind.action === 'create') {
    if (result.status !== 'draft' || result.revision !== 1 || typeof body.name !== 'string' || typeof body.code !== 'string' || result.name !== body.name.trim() || result.code !== body.code.trim().toUpperCase()) return false;
    if (kind.kind === 'policy') return revision(result.version) && !!object(body.configuration) && sameJson(result.configuration, body.configuration);
    if (kind.kind === 'scheme') return result.term_id === body.term_id && reportSchemeRequestContextMatches(body, result) && result.grading_policy_id === body.grading_policy_id && result.review_mode === body.review_mode && result.absence_treatment === body.absence_treatment && result.programme_key === (typeof body.programme_key === 'string' ? body.programme_key.trim().toUpperCase() : null) && result.term_index === (body.term_index ?? null);
    return false;
  }
  if (kind.kind === 'policy') return ['draft', 'active'].includes(String(result.status)) && (kind.action !== 'activate' || result.status === 'active');
  if (kind.kind === 'scheme' && kind.action === 'subject' && body.offering_id !== undefined && (!uuid(body.offering_id) || !uuid(body.subject_id) || result.status !== 'draft' || result.offering_id !== body.offering_id || result.subject_id !== body.subject_id || typeof body.course_code !== 'string' || result.course_code !== body.course_code.trim().toUpperCase() || !Number.isFinite(Number(result.credits)) || Number(result.credits) !== body.credits)) return false;
  if (kind.kind === 'scheme') return ['draft', 'active', 'archived'].includes(String(result.status)) && (kind.action !== 'activate' || result.status === 'active');
  return result.status === ({ review: 'reviewed', publish: 'published', cancel: 'cancelled' } as Record<string, string>)[kind.action];
}
export function validateReportCommand(value: unknown, scope: ReportCommandScope): value is ReportCommand {
  try {
    const command = value as ReportCommand;
    if (!command || command.version !== 1 || reportCommandScopeKey(command.scope) !== reportCommandScopeKey(scope) || !uuid(command.key) || !/^\/areas\/reports\/remarks(?:\?|$)/.test(command.ownerHref) || command.ownerHref.includes('#') || !['prepared', 'unknown', 'accepted'].includes(command.phase) || !reportCommandKind(command) || typeof command.body !== 'string' || command.body.length > 100000 || object(JSON.parse(command.body))?.idempotency_key !== command.key) return false;
    return command.phase !== 'accepted' || reportCommandResultMatches(command, command.result);
  } catch { return false; }
}
/** One exact encrypted request per actor/campus/world. Accepted recovery never dispatches. */
export class AcademicReportJournal {
  private state: ReportCommandState = { ready: false, busy: false, blocked: false, pending: null, error: '' };
  private listeners = new Set<(state: ReportCommandState) => void>();
  private hydration?: Promise<void>;
  constructor(private readonly options: { scope: ReportCommandScope; storage: ReportCommandStorage; randomId(): string; capture(): { assertCurrent(): void }; send(command: ReportCommand): Promise<unknown>; refresh(command: ReportCommand, assertCurrent: () => void): Promise<void> }) {}
  snapshot() { return this.state; }
  subscribe(listener: (state: ReportCommandState) => void) { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }
  private update(changes: Partial<ReportCommandState>) { this.state = { ...this.state, ...changes }; for (const listener of this.listeners) listener(this.state); }
  hydrate() { return this.hydration ??= (async () => { try { const raw = await this.options.storage.read(); const value: unknown = raw ? JSON.parse(raw) : null; if (value && !validateReportCommand(value, this.options.scope)) throw new Error('The retained grading action cannot be verified in this exact account, campus and world. Nothing was sent.'); this.update({ ready: true, pending: value as ReportCommand | null, error: value ? 'An earlier grading action needs confirmation before another action.' : '' }); } catch (cause) { this.update({ ready: true, blocked: true, error: text(cause) }); } })(); }
  private capture(operation?: ReportCommandOperation): ReportCommandOperation { const transport = this.options.capture(); return { accepted: operation?.accepted, assertCurrent: () => { transport.assertCurrent(); operation?.assertCurrent(); } }; }
  async run(input: { ownerHref: string; endpoint: string; method?: 'POST' | 'PUT'; body: Record<string, unknown> }, operation?: ReportCommandOperation): Promise<boolean> {
    if (!this.state.ready || this.state.busy || this.state.blocked || this.state.pending) return false;
    this.update({ busy: true, error: '' });
    try {
      const context = this.capture(operation); context.assertCurrent(); const key = this.options.randomId();
      const command: ReportCommand = { version: 1, scope: this.options.scope, key, ownerHref: input.ownerHref, endpoint: input.endpoint, method: input.method ?? 'POST', body: JSON.stringify({ ...input.body, idempotency_key: key }), phase: 'prepared' };
      if (!validateReportCommand(command, this.options.scope)) throw new Error('The exact grading action could not be safely retained. Nothing was sent.');
      try { await this.options.storage.write(JSON.stringify(command)); } catch (cause) { this.update({ blocked: true }); throw cause; }
      this.update({ pending: command }); context.assertCurrent(); return await this.execute(context, false);
    } catch (cause) { this.update({ error: text(cause) }); return false; } finally { this.update({ busy: false }); }
  }
  async recover(ownerHref: string, operation?: ReportCommandOperation): Promise<boolean> {
    if (!this.state.ready || this.state.busy || this.state.blocked || !this.state.pending) return false;
    if (this.state.pending.ownerHref !== ownerHref) { this.update({ error: 'Open the original grading action before confirming it.' }); return false; }
    this.update({ busy: true, error: '' });
    try { const context = this.capture(operation); context.assertCurrent(); return await this.execute(context, this.state.pending.phase === 'unknown'); } catch (cause) { this.update({ error: text(cause) }); return false; } finally { this.update({ busy: false }); }
  }
  private async execute(context: ReportCommandOperation, uncertain: boolean): Promise<boolean> {
    let command = this.state.pending!, cleared = false;
    try {
      context.assertCurrent();
      if (command.phase !== 'accepted') {
        command = { ...command, phase: 'unknown' }; await this.options.storage.write(JSON.stringify(command)); this.update({ pending: command }); context.assertCurrent();
        const result = await this.options.send(command); context.assertCurrent();
        if (!reportCommandResultMatches(command, result)) throw new Error('The grading service returned a different source or revision. The original action remains retained.');
        command = { ...command, phase: 'accepted', result }; this.update({ pending: command }); await this.options.storage.write(JSON.stringify(command));
      }
      context.assertCurrent(); await this.options.refresh(command, context.assertCurrent); context.assertCurrent(); await context.accepted?.(command); context.assertCurrent(); await this.options.storage.clear(); cleared = true; this.update({ pending: null, error: '' }); context.assertCurrent(); return true;
    } catch (cause) {
      if (cleared) { this.update({ error: text(cause) }); return false; }
      const status = object(cause)?.status;
      if (command.phase !== 'accepted' && !uncertain && typeof status === 'number' && status >= 400 && status < 500 && ![408, 409, 429].includes(status)) { context.assertCurrent(); await this.options.storage.clear(); this.update({ pending: null, error: text(cause) }); return false; }
      this.update({ pending: command, error: command.phase === 'accepted' ? `Saved. Retry refresh reads the accepted source only. ${text(cause)}` : `${text(cause)} Keep this exact action for confirmation; a new release or remark was not substituted.` }); return false;
    }
  }
}
