import { useEffect, useMemo, useRef, useState } from 'react';
import { isInternalHref } from './api-policy';
import { nativeAuthoringActionAllowed } from './native-authoring-policy';
import { pendingFileUriAllowed } from './private-file-policy';
import { privateUploadForm } from './upload-form';
import { academicCatalogueCommandObsolete, nativePeopleAcademicCatalogueAllowed } from './people-academic-catalogue';
import { definitiveExamScheduleRefusal } from './assessment-schedule-amendments';
import { assignmentHandoverObsolete } from './assignment-handover-policy';
import { nativePeopleAcademicImportAllowed } from './people-academic-import';
import { attendanceReconciliationActionAllowed } from './attendance-continuity';
import { campusMembershipActionAllowed } from './people-access';
import { campusSceneActionAllowed, definitiveCampusImportFailure } from './campus-scene-policy';
import { attendancePhotoActionAllowed } from './attendance-photo';

export type NativePendingDomain = 'campus' | 'gate' | 'departure' | 'events' | 'learning' | 'assessments' | 'people' | 'messages' | 'simulation' | 'resources' | 'facilities' | 'calendar' | 'schedule' | 'attendance';
export interface NativePendingScope { actorId: string; schoolId: string; mode: 'live' | 'simulation'; namespaceId: string | null; origin: string }
export interface NativePendingFile { uri: string; name: string; type: string; size: number; hash: string }
export type NativePendingPayload = { kind: 'json'; body: string } | { kind: 'multipart'; fields: Record<string, string>; file: NativePendingFile };
export interface NativePendingSource { kind: string; sourceId: string; revision: number; fingerprint?: string }
export interface NativePendingAction {
  version: 1; domain: NativePendingDomain; scope: NativePendingScope; clientId: string;
  ownerHref: string; endpoint: string; refreshPath: string; method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  payload: NativePendingPayload; source?: NativePendingSource;
  phase: 'prepared' | 'unknown' | 'accepted'; replayPolicy: 'same_request' | 'inspect_only';
  createdAt: string;
  /** Only the campus adapter retains a bounded owning-service receipt. */
  receipt?: unknown;
  continuation?: unknown;
}
export interface NativePendingInput {
  endpoint: string; method?: NativePendingAction['method']; body?: Record<string, unknown>;
  multipart?: { fields: Record<string, string | number | boolean>; file: NativePendingFile };
  continuation?: unknown;
  serverKey?: 'request_id' | 'command_id' | 'idempotency_key' | 'client_id' | 'command' | 'review_id' | null;
  replayPolicy?: NativePendingAction['replayPolicy']; source?: NativePendingSource;
}
export interface NativePendingStorage { read(): Promise<string | null>; write(value: string): Promise<void>; clear(): Promise<void> }
export interface NativePendingState { ready: boolean; blocked: boolean; busy: boolean; action: NativePendingAction | null; error: string; obsolete: boolean }
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const assessmentEvidencePath = (path: string) => /^\/api\/v1\/schools\/[^/]+\/assessments\/[0-9a-f-]{36}\/results\/[0-9a-f-]{36}\/evidence\/$/i.test(path);
const assessmentResultsPath = (path: string) => /^\/api\/v1\/schools\/[^/]+\/assessments\/[0-9a-f-]{36}\/results\/$/i.test(path);
const attendancePhotoPath = (path: string) => /^\/api\/v1\/photo-attendance\/(?:classes\/[0-9a-f-]{36}\/analyze|students\/[0-9a-f-]{36}\/samples)\/$/i.test(path);
const peopleReviewCommit = /^\/api\/v1\/people\/(enrollment-reviews|enrollment-change-reviews)\/([0-9a-f-]{36})\/commit$/i;
const peopleGuardianAuthority = /^\/api\/v1\/people\/guardian-relationships\/[0-9a-f-]{36}\/leave-authority$/i;
function peopleScopedPath(path: string, schoolId: string) {
  const root = `/api/v1/schools/${encodeURIComponent(schoolId)}/`;
  return path.startsWith(`${root}people/`) || path.startsWith(`${root}invitations/`) || /^staff\/profiles\/(?:[^/?]+\/onboarding\/?)?$/.test(path.slice(root.length)) && path.startsWith(root);
}
function peopleReadPath(path: string, scope: NativePendingScope, endpoint: string) {
  if (peopleScopedPath(path, scope.schoolId)) return true;
  if (path === `/api/v1/schools/${encodeURIComponent(scope.schoolId)}/staff/workspace/`) return true;
  const url = new URL(path, 'https://thatcampus.invalid');
  return peopleGuardianAuthority.test(url.pathname) && url.pathname === endpoint && url.searchParams.getAll('school_id').length === 1 && url.searchParams.get('school_id') === scope.schoolId && [...url.searchParams.keys()].every(key => key === 'school_id');
}
function isReviewedPeopleCommit(record: NativePendingAction, body: Record<string, unknown>) {
  const match = peopleReviewCommit.exec(record.endpoint);
  return !!match && uuid(match[2]) && record.method === 'POST' && Object.keys(body).length === 0 && record.source?.sourceId === match[2] && record.source.revision === 0 && record.source.kind === (match[1] === 'enrollment-reviews' ? 'enrollment_review' : 'enrollment_change_review') && /^[a-f0-9]{64}$/.test(record.source.fingerprint ?? '');
}
const message = (value: unknown) => value instanceof Error ? value.message : 'The retained action could not be confirmed.';
export function nativePendingScopeKey(scope: NativePendingScope) {
  const origin = new URL(scope.origin);
  if (!scope.actorId || !scope.schoolId || !['live', 'simulation'].includes(scope.mode) || scope.mode === 'simulation' && !scope.namespaceId || origin.origin !== scope.origin || !['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password) throw new Error('Confirm the exact account, campus, environment and server before continuing.');
  return JSON.stringify([scope.actorId, scope.schoolId, scope.mode, scope.namespaceId, scope.origin]);
}
function domainEndpoint(domain: NativePendingDomain, path: string) {
  if (!isInternalHref(path) || path.includes('#')) return false;
  if (domain === 'campus') return /^\/api\/v1\/schools\/[^/]+\/campus-scenes\//.test(path);
  if (domain === 'gate') return /^\/api\/v1\/gate\/schools\/[^/]+\/(?:visitors|workspace)\//.test(path) || /^\/api\/v1\/gate\/schools\/[^/]+\/visit-arrangements\/[0-9a-f-]{36}\/onboarding-link\/$/i.test(path);
  if (domain === 'calendar') return /^\/api\/v1\/schools\/[^/]+\/campus-dates(?:\/|\?|$)/.test(path);
  if (domain === 'schedule') return /^\/api\/v1\/(?:schedule-planning|day-plans)(?:\/|\?|$)/.test(path) || /^\/api\/v1\/schools\/[^/]+\/activities\/(?:plans|catalogue)(?:\/|\?|$)/.test(path) || /^\/api\/v1\/principal\/(?:timetable\/targets\/|calendar\/closures\/(?:\d{4}-\d{2}-\d{2}\/)?)(?:\?|$)/.test(path);
  if (domain === 'attendance') return /^\/api\/v1\/coordination\/follow-ups(?:\/|\?|$)/.test(path) || /^\/api\/v1\/attendance-continuity\/cases\/[0-9a-f-]{36}\/decision\/$/i.test(path) || /^\/api\/v1\/attendance\/workspace\?/.test(path) || /^\/api\/v1\/photo-attendance\/(?:classes|students|sessions)\//.test(path);
  if (domain === 'people') return /^\/api\/v1\/schools\/[^/]+\/(?:people|members|invitations|staff\/profiles|catalog\/(?:terms|classes|subjects))\//.test(path) || /^\/api\/v1\/people\/imports(?:\/|$)/.test(path) || path === '/api/v1/people/guardian-links' || peopleGuardianAuthority.test(path) || peopleReviewCommit.test(path);
  if (domain === 'messages') return path.startsWith('/api/v1/chat/');
  if (domain === 'simulation') return /^\/api\/v1\/schools\/[^/]+\/simulation\/(?:runs)(?:\/|\?|$)/.test(path);
  if (domain === 'resources') return /^\/api\/v1\/schools\/[^/]+\/institution-setup\//.test(path);
  if (domain === 'facilities') return /^\/api\/v1\/schools\/[^/]+\/facilities\//.test(path);
  return domain === 'departure' ? path.startsWith('/api/v1/departure/') : domain === 'events' ? /^\/api\/v1\/campus-events(?:\/|$)/.test(path) : domain === 'assessments' ? /^\/api\/v1\/schools\/[^/]+\/assessments\//.test(path) : /^\/api\/v1\/(?:learning\/(?:sessions|assignments|offerings|practice)\/|diary\/|homework\/)/.test(path);
}
export function validateNativePendingAction(value: unknown, scope: NativePendingScope, domain: NativePendingDomain, allowPickedFile = false): value is NativePendingAction {
  const record = value as NativePendingAction;
  try {
    const campus = domain === 'campus' && campusSceneActionAllowed(record, scope);
    if (domain === 'campus' && !campus || domain !== 'campus' && (record?.receipt !== undefined || record?.continuation !== undefined)) return false;
    const academicImport = domain === 'people' && nativePeopleAcademicImportAllowed(record, scope);
    const academicCatalogue = domain === 'people' && nativePeopleAcademicCatalogueAllowed(record, scope);
    const academicPeople = academicCatalogue || academicImport || domain === 'people' && campusMembershipActionAllowed(record,scope);
    const reconciliation = domain === 'attendance' && attendanceReconciliationActionAllowed(record, scope);
    if (!record || record.version !== 1 || record.domain !== domain || nativePendingScopeKey(record.scope) !== nativePendingScopeKey(scope) || !uuid(record.clientId) || !isInternalHref(record.ownerHref) || !/^\/(?:areas|work|more)(?:\/|\?|$)/.test(record.ownerHref) || !domainEndpoint(domain, record.endpoint) || !isInternalHref(record.refreshPath) || !record.refreshPath.startsWith('/api/v1/') || record.refreshPath.startsWith('/api/v1/auth/') || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(record.method) || !['prepared', 'unknown', 'accepted'].includes(record.phase) || !['same_request', 'inspect_only'].includes(record.replayPolicy) || !Number.isFinite(Date.parse(record.createdAt))) return false;
    if (domain === 'assessments' && !record.endpoint.startsWith(`/api/v1/schools/${encodeURIComponent(scope.schoolId)}/assessments/`)) return false;
    if (domain === 'people' && !academicPeople && record.endpoint !== '/api/v1/people/guardian-links' && !peopleGuardianAuthority.test(record.endpoint) && !peopleReviewCommit.test(record.endpoint) && !peopleScopedPath(record.endpoint, scope.schoolId)) return false;
    if (domain === 'simulation' && !record.endpoint.startsWith(`/api/v1/schools/${encodeURIComponent(scope.schoolId)}/simulation/`)) return false;
    if (domain === 'people' && !academicPeople && !peopleReadPath(record.refreshPath, scope, record.endpoint)) return false;
    if (domain === 'people' && scope.mode === 'simulation' && record.endpoint.startsWith(`/api/v1/schools/${encodeURIComponent(scope.schoolId)}/invitations/`)) return false;
    if (domain === 'messages' && !record.refreshPath.startsWith('/api/v1/chat/')) return false;
    if (domain === 'learning' && !domainEndpoint('learning', record.refreshPath)) return false;
    if (['calendar','schedule','attendance'].includes(domain) && !domainEndpoint(domain, record.refreshPath)) return false;
    if (domain === 'calendar' && (!record.endpoint.startsWith(`/api/v1/schools/${encodeURIComponent(scope.schoolId)}/campus-dates`) || !record.refreshPath.startsWith(`/api/v1/schools/${encodeURIComponent(scope.schoolId)}/campus-dates`))) return false;
    if (domain === 'schedule' && [record.endpoint,record.refreshPath].some(path => path.startsWith('/api/v1/schools/') && !path.startsWith(`/api/v1/schools/${encodeURIComponent(scope.schoolId)}/activities/`))) return false;
    if (domain === 'simulation' && !record.refreshPath.startsWith(`/api/v1/schools/${encodeURIComponent(scope.schoolId)}/simulation/`)) return false;
    if (record.source && (!record.source.sourceId || !record.source.kind || !Number.isSafeInteger(record.source.revision) || record.source.revision < 0)) return false;
    const payload = record.payload;
    if (payload.kind === 'json') {
      if (typeof payload.body !== 'string' || payload.body.length > (campus ? 8 * 1024 * 1024 : academicImport && record.endpoint === '/api/v1/people/imports' ? 1060000 : 128000) || !object(JSON.parse(payload.body))) return false;
      const body = JSON.parse(payload.body) as Record<string, unknown>;
      if (domain === 'people' && (record.endpoint === '/api/v1/people/guardian-links' || peopleGuardianAuthority.test(record.endpoint)) && body.school_id !== scope.schoolId) return false;
      if (domain === 'people' && peopleReviewCommit.test(record.endpoint) && !isReviewedPeopleCommit(record, body)) return false;
      if (record.replayPolicy === 'same_request' && body.command_id !== record.clientId && body.idempotency_key !== record.clientId && body.client_id !== record.clientId && object(body.command)?.command_id !== record.clientId && !(domain === 'gate' && body.request_id === record.clientId) && !(domain === 'people' && isReviewedPeopleCommit(record, body)) && !academicImport && !(domain === 'assessments' && assessmentResultsPath(record.endpoint))) return false;
      if (domain === 'events' && body.school_id !== scope.schoolId) return false;
      if (domain === 'schedule' && /^\/api\/v1\/(?:schedule-planning|day-plans)(?:\/|$)/.test(record.endpoint) && body.school_id !== scope.schoolId) return false;
      const legacySchedule = domain === 'schedule' && /^\/api\/v1\/principal\/(?:timetable\/targets\/|calendar\/closures\/(?:\d{4}-\d{2}-\d{2}\/)?)(?:\?|$)/.test(record.endpoint);
      if (legacySchedule && (record.replayPolicy !== 'inspect_only' || !record.refreshPath.startsWith('/api/v1/schedule-planning?') || !record.source || !['POST','DELETE'].includes(record.method))) return false;
      if (['calendar','schedule','attendance'].includes(domain) && !legacySchedule && !reconciliation && (record.replayPolicy !== 'same_request' || body.idempotency_key !== record.clientId)) return false;
    } else if (payload.kind === 'multipart') {
      const assessmentEvidence = domain === 'assessments' && assessmentEvidencePath(record.endpoint);
      const campusImage = campus && /\/images\/$/.test(record.endpoint);
      const attendancePhoto = domain === 'attendance' && attendancePhotoActionAllowed(record, scope);
      if ((!['learning', 'messages', 'facilities', 'gate'].includes(domain) && !assessmentEvidence && !attendancePhoto && !campusImage) || !object(payload.fields) || (!assessmentEvidence && !attendancePhoto && !campusImage && payload.fields[domain === 'messages' ? 'client_id' : domain === 'gate' ? 'request_id' : 'command_id'] !== record.clientId) || (assessmentEvidence && (Object.keys(payload.fields).length !== 1 || typeof payload.fields.reason !== 'string' || !payload.fields.reason.trim())) || Object.entries(payload.fields).length > 40 || Object.values(payload.fields).some(field => typeof field !== 'string' || field.length > 24000)) return false;
      const file = payload.file;
      if (!file || !pendingFileUriAllowed(file.uri, nativePendingScopeKey(scope), allowPickedFile) || !file.name || !file.type || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > (attendancePhoto ? 24 : domain === 'messages' || assessmentEvidence ? 10 : 5) * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(file.hash)) return false;
    } else return false;
    return nativeAuthoringActionAllowed(record, scope);
  } catch { return false; }
}
/** Domain proofs are evaluated for the retained action, independent of which screen first mounted the shared journal. */
function nativePendingObsoleteProof(error: unknown, action: NativePendingAction): boolean {
  try {
    if (action.domain === 'people') return academicCatalogueCommandObsolete(error, action);
    if (action.domain === 'assessments') return definitiveExamScheduleRefusal(error, action);
    if (action.domain === 'learning') return assignmentHandoverObsolete(error, action);
    return false;
  } catch { return false; }
}
export function definitiveNativeRefusal(error: unknown, alreadyUncertain: boolean, action?: Pick<NativePendingAction, 'domain'> & Partial<NativePendingAction>) {
  const status = object(error)?.status;
  if (action?.scope && nativePendingObsoleteProof(error, action as NativePendingAction)) return true;
  if (!alreadyUncertain && action?.domain === 'simulation' && status === 429) {
    const refusal = object(object(object(error)?.details)?.error);
    if (refusal?.status === 429 && refusal.code === 'simulation_institution_capacity'
      && ['worlds','running_runs','storage','pinned_runs'].includes(String(refusal.resource))
      && Number.isSafeInteger(refusal.limit) && Number(refusal.limit) > 0) return true;
  }
  return !alreadyUncertain && typeof status === 'number' && status >= 400 && status < 500 && ![408, 409, 429].includes(status);
}
export function nativePendingUploadMatches(file: NativePendingFile, size: number, hash: string) { return file.size === size && file.hash === hash && /^[a-f0-9]{64}$/.test(hash); }

/** Expo fetch accepts File-compatible byte parts, not React Native URI objects. */
export function nativePendingUploadForm(payload: Extract<NativePendingPayload, { kind: 'multipart' }>, bytes: Uint8Array, createForm: () => FormData = () => new FormData(), partName = 'file'): FormData {
  return privateUploadForm(payload, bytes, createForm, partName);
}

/** A committed manifest points to immutable, small encrypted Keychain chunks.
 * A failed chunk write never replaces the last committed pending request. */
export function createChunkedNativePendingStorage(adapter: { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; remove(key: string): Promise<void>; randomId(): string; digest(value: string): Promise<string> }, prefix: string, limits: { maxCharacters?: number } = {}): NativePendingStorage {
  const maxCharacters = limits.maxCharacters ?? 128000;
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 128000 || maxCharacters > 2120000) throw new Error('Invalid secure journal size limit.');
  const maxParts = maxCharacters === 128000 ? 512 : Math.ceil(maxCharacters / 256);
  type Manifest = { version: 1; commit: string; parts: number; hash: string };
  const slot = `${prefix}.manifest`;
  const parse = (raw: string): Manifest => { const manifest = JSON.parse(raw) as Manifest; if (manifest.version !== 1 || !uuid(manifest.commit) || !Number.isSafeInteger(manifest.parts) || manifest.parts < 1 || manifest.parts > maxParts || !/^[a-f0-9]{64}$/.test(manifest.hash)) throw new Error('The secure pending-action manifest is unreadable. Its data was kept.'); return manifest; };
  const drop = async (manifest: Manifest) => { for (let index = 0; index < manifest.parts; index++) await adapter.remove(`${prefix}.${manifest.commit}.${index}`); };
  return {
    async read() { const raw = await adapter.get(slot); if (!raw) return null; const manifest = parse(raw); const parts: string[] = []; for (let index = 0; index < manifest.parts; index++) { const part = await adapter.get(`${prefix}.${manifest.commit}.${index}`); if (part === null) throw new Error('A secure pending-action part is missing. New actions are blocked.'); parts.push(part); } const joined = parts.join(''); if (await adapter.digest(joined) !== manifest.hash) throw new Error('The secure pending action failed its integrity check. New actions are blocked.'); return joined; },
    async write(value) { const characters = Array.from(value); if (characters.length > maxCharacters) throw new Error('This action exceeds the secure local journal limit. Nothing was sent.'); const commit = adapter.randomId(), parts: string[] = []; for (let index = 0; index < characters.length; index += 256) parts.push(characters.slice(index, index + 256).join('')); if (!parts.length) parts.push(''); const next: Manifest = { version: 1, commit, parts: parts.length, hash: await adapter.digest(value) }; const oldRaw = await adapter.get(slot); let written = 0, committed = false; try { for (; written < parts.length; written++) await adapter.set(`${prefix}.${commit}.${written}`, parts[written]!); await adapter.set(slot, JSON.stringify(next)); committed = true; } finally { if (!committed) for (let index = 0; index < written; index++) await adapter.remove(`${prefix}.${commit}.${index}`).catch(() => {}); } if (oldRaw) { try { await drop(parse(oldRaw)); } catch { /* New committed data remains authoritative. */ } } },
    async clear() { const raw = await adapter.get(slot); if (!raw) return; const manifest = parse(raw); await adapter.remove(slot); await drop(manifest).catch(() => {}); },
  };
}

export class NativePendingActionJournal {
  private state: NativePendingState = { ready: false, blocked: false, busy: false, action: null, error: '', obsolete: false };
  private subscribers = new Set<(state: NativePendingState) => void>();
  private hydrating?: Promise<void>;
  constructor(private options: { scope: NativePendingScope; domain: NativePendingDomain; storage: NativePendingStorage; randomId(): string; captureContext?(): Readonly<{ assertCurrent(): void }>; send(action: NativePendingAction, assertActive: () => void): Promise<unknown>; read(action: NativePendingAction, assertActive: () => void): Promise<unknown>; obsolete?(error: unknown, action: NativePendingAction): boolean; stageFile?(file: NativePendingFile): Promise<NativePendingFile>; discardStagedFile?(file: NativePendingFile): Promise<void>; cleanup?(action: NativePendingAction): Promise<void> }) {}
  snapshot() { return this.state; }
  subscribe(callback: (state: NativePendingState) => void) { this.subscribers.add(callback); callback(this.state); return () => { this.subscribers.delete(callback); }; }
  private update(changes: Partial<NativePendingState>) { this.state = { ...this.state, ...changes }; for (const callback of this.subscribers) callback(this.state); }
  private guardedContext<T extends { assertActive(): void }>(context: T): T { const transport = this.options.captureContext?.(); return { ...context, assertActive: () => { context.assertActive(); transport?.assertCurrent(); } }; }
  hydrate() { if (!this.hydrating) this.hydrating = (async () => { try { const raw = await this.options.storage.read(); const value: unknown = raw ? JSON.parse(raw) : null; if (raw && !validateNativePendingAction(value, this.options.scope, this.options.domain)) throw new Error('A retained action does not match this account, campus, environment or server. New actions are blocked.'); this.update({ ready: true, action: value as NativePendingAction | null, error: value ? 'An earlier action is retained. Review its original screen before continuing.' : '' }); } catch (cause) { this.update({ ready: true, blocked: true, error: message(cause) }); } })(); return this.hydrating; }
  async run(input: NativePendingInput, context: { ownerHref: string; refreshPath: string; assertActive(): void; resolveRefreshPath?(value: unknown, action: NativePendingAction): string; accepted?(value: unknown, assertActive: () => void, action: NativePendingAction): Promise<void> | void }) {
    if (!this.state.ready || this.state.blocked || this.state.busy || this.state.action || this.state.obsolete) return false;
    this.update({ busy: true, error: '' });
    let stagedFile: NativePendingFile | null = null, preparationWriteStarted = false;
    try {
      context = this.guardedContext(context);
      context.assertActive(); const clientId = this.options.randomId();
      const values = { ...(input.body ?? {}) };
      if (input.serverKey === 'command') values.command = { ...(object(values.command) ?? {}), command_id: clientId };
      else if (input.serverKey && input.serverKey !== 'review_id') values[input.serverKey] = clientId;
      const payload: NativePendingPayload = input.multipart ? { kind: 'multipart', fields: Object.fromEntries(Object.entries({ ...input.multipart.fields, ...((this.options.domain === 'assessments' && assessmentEvidencePath(input.endpoint) || this.options.domain === 'attendance' && attendancePhotoPath(input.endpoint)) ? {} : { [this.options.domain === 'messages' ? 'client_id' : this.options.domain === 'gate' ? 'request_id' : this.options.domain === 'campus' ? 'idempotency_key' : 'command_id']: clientId }) }).map(([key, value]) => [key, String(value)])), file: { ...input.multipart.file } } : { kind: 'json', body: JSON.stringify(values) };
      let action: NativePendingAction = { version: 1, domain: this.options.domain, scope: this.options.scope, clientId, ownerHref: context.ownerHref, endpoint: input.endpoint, refreshPath: context.refreshPath, method: input.method ?? 'POST', payload, ...(input.continuation === undefined ? {} : {continuation:input.continuation}), source: input.source ? { ...input.source } : undefined, phase: 'prepared', replayPolicy: input.replayPolicy ?? (input.serverKey || input.multipart ? 'same_request' : 'inspect_only'), createdAt: new Date().toISOString() };
      if (!validateNativePendingAction(action, this.options.scope, this.options.domain, !!this.options.stageFile)) throw new Error('This action could not be safely retained. Nothing was sent.');
      if (input.multipart && this.options.stageFile) {
        const staged = await this.options.stageFile(input.multipart.file);
        if (staged.uri !== input.multipart.file.uri) stagedFile = staged;
        context.assertActive();
        action = { ...action, payload: { ...(action.payload as Extract<NativePendingPayload, { kind: 'multipart' }>), file: { ...staged } } };
        if (!validateNativePendingAction(action, this.options.scope, this.options.domain)) throw new Error('The private upload could not be safely retained. Nothing was sent.');
      }
      const serialized = JSON.stringify(action); context.assertActive();
      preparationWriteStarted = true;
      try { await this.options.storage.write(serialized); } catch (cause) { this.update({ blocked: true }); throw cause; } this.update({ action });
      return await this.execute(context, false);
    } catch (cause) {
      // Before the first persistence attempt no retained command can reference this new copy.
      // After it starts, a rejected acknowledgement may still hide a committed manifest.
      if (stagedFile && !preparationWriteStarted) await this.options.discardStagedFile?.(stagedFile).catch(() => {});
      this.update({ error: message(cause) }); return false;
    } finally { this.update({ busy: false }); }
  }
  async recover(context: { ownerHref: string; assertActive(): void; resolveRefreshPath?(value: unknown, action: NativePendingAction): string; accepted?(value: unknown, assertActive: () => void, action: NativePendingAction): Promise<void> | void }) {
    if (!this.state.ready || this.state.blocked || this.state.busy || !this.state.action) return false;
    if (this.state.action.ownerHref !== context.ownerHref) { this.update({ error: 'Return to the retained action’s original screen before recovering it.' }); return false; }
    this.update({ busy: true, error: '' }); try { return await this.execute(this.guardedContext(context), this.state.action.phase === 'unknown'); } catch (cause) { this.update({ error: message(cause) }); return false; } finally { this.update({ busy: false }); }
  }
  private async execute(context: { assertActive(): void; resolveRefreshPath?(value: unknown, action: NativePendingAction): string; accepted?(value: unknown, assertActive: () => void, action: NativePendingAction): Promise<void> | void }, alreadyUncertain: boolean) {
    let action = this.state.action!, cleared = false;
    try {
      context.assertActive();
      if (action.phase === 'unknown' && action.replayPolicy === 'inspect_only' && alreadyUncertain) { await this.options.read(action, context.assertActive); context.assertActive(); this.update({ error: 'Current saved records were read. This legacy endpoint has no exact command receipt, so the earlier action remains unconfirmed and new actions stay blocked. Contact campus support before repeating it.' }); return false; }
      if (action.phase !== 'accepted') {
        const unknown: NativePendingAction = { ...action, phase: 'unknown' }; await this.options.storage.write(JSON.stringify(unknown)); action = unknown; this.update({ action }); context.assertActive();
        const result = await this.options.send(action, context.assertActive);
        context.assertActive();
        const refreshPath = context.resolveRefreshPath?.(result, action) ?? action.refreshPath;
        const accepted: NativePendingAction = { ...action, phase: 'accepted', refreshPath, ...(action.domain === 'campus' ? { receipt: result } : {}) };
        if (!validateNativePendingAction(accepted, this.options.scope, this.options.domain)) throw new Error('The saved source could not be verified. The original action remains retained.');
        action = accepted; this.update({ action }); await this.options.storage.write(JSON.stringify(action));
      }
      context.assertActive(); const latest = await this.options.read(action, context.assertActive); context.assertActive(); await context.accepted?.(latest, context.assertActive, action); context.assertActive();
      await this.options.storage.clear(); cleared = true; this.update({ action: null, error: '', obsolete: false }); await this.options.cleanup?.(action).catch(() => {}); context.assertActive(); return true;
    } catch (cause) {
      // The acknowledged command is already cleared. A late focus/context loss
      // suppresses follow-up work without resurrecting that completed intent.
      if (cleared) { this.update({ error: message(cause) }); return false; }
      const obsolete = action.phase !== 'accepted' && (!!this.options.obsolete?.(cause, action) || nativePendingObsoleteProof(cause, action));
      if (action.phase !== 'accepted' && (obsolete || definitiveCampusImportFailure(cause, action) || definitiveNativeRefusal(cause, alreadyUncertain, action))) { context.assertActive(); await this.options.storage.clear(); this.update({ action: null, obsolete, error: obsolete ? 'The owning service proved this exact command permanently inapplicable. Review the current saved source before continuing.' : message(cause) }); await this.options.cleanup?.(action).catch(() => {}); return false; }
      this.update({ action, error: action.phase === 'accepted' ? `Saved. Recovery performs only a read: ${message(cause)}` : `${message(cause)} The exact action remains securely retained.` }); return false;
    }
  }
  reviewed() { if (!this.state.busy && this.state.obsolete && !this.state.action) this.update({ obsolete: false, error: '' }); }
}

async function secureStorage(scope: NativePendingScope, domain: NativePendingDomain) {
  const [SecureStore, Crypto] = await Promise.all([import('./device-storage'), import('expo-crypto')]);
  const prefix = `thatcampus.pending.v1.${domain}.${await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nativePendingScopeKey(scope))}`;
  if (domain === 'campus') { const { createLargeActionStorage } = await import('./large-action-store'); return createLargeActionStorage(prefix); }
  return createChunkedNativePendingStorage({ get: SecureStore.getItemAsync, set: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }), remove: SecureStore.deleteItemAsync, randomId: Crypto.randomUUID, digest: value => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value) }, prefix, domain === 'people' ? { maxCharacters: 2120000 } : {});
}
export async function sendNativePendingAction(action: NativePendingAction, assertActive: () => void) {
  const { apiFetch, getApiOrigin } = await import('./api');
  assertActive();
  if (getApiOrigin() !== action.scope.origin) throw new Error('The API server changed. This retained action was not sent.');
  if (action.payload.kind === 'json') { assertActive(); return apiFetch(action.endpoint, { method: action.method, body: action.payload.body }); }
  const [Files, Crypto] = await Promise.all([import('./private-file'), import('expo-crypto')]);
  assertActive();
  const file = action.payload.file, saved = await Files.readPrivateFile(file.uri, action.domain === 'attendance' && attendancePhotoPath(action.endpoint) ? 24 * 1024 * 1024 : 10 * 1024 * 1024);
  if (saved.size !== file.size) throw new Error('The retained upload bytes are unavailable or changed. A different file was not substituted.');
  const bytes = saved.bytes;
  assertActive();
  const digest = Array.from(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes)), value => value.toString(16).padStart(2, '0')).join('');
  assertActive();
  if (!nativePendingUploadMatches(file, bytes.byteLength, digest)) throw new Error('The retained upload bytes are unavailable or changed. A different file was not substituted.');
  if (action.domain === 'campus' && /\/images\/$/.test(action.endpoint)) {
    let binary = ''; for (let i=0;i<bytes.length;i+=0x8000) binary += String.fromCharCode(...bytes.subarray(i,i+0x8000));
    assertActive(); return apiFetch(action.endpoint,{method:action.method,body:JSON.stringify({...action.payload.fields,rights_confirmed:true,data_url:`data:${file.type};base64,${btoa(binary)}`})});
  }
  const form = nativePendingUploadForm(action.payload, bytes, () => new FormData(), action.domain === 'gate' ? 'photo' : 'file');
  if (getApiOrigin() !== action.scope.origin) throw new Error('The API server changed. This retained upload was not sent.');
  assertActive();
  return apiFetch(action.endpoint, { method: action.method, body: form });
}
export async function stageNativePendingFile(file: NativePendingFile, scopeKey = ''): Promise<NativePendingFile> {
  const { stagePrivateFile } = await import('./private-file');
  return stagePrivateFile(file, scopeKey, 'pending');
}
async function discardNativePendingFile(value: NativePendingFile) {
  const { removePrivateFile } = await import('./private-file'); await removePrivateFile(value.uri);
}

const journals = new Map<string, NativePendingActionJournal>();
let activeScopeKey = '';
export function useNativePendingAction<T>({ scope, domain, ownerHref, refreshPath, accepted, resolveRefreshPath, obsolete, captureOperation }: { scope: NativePendingScope; domain: NativePendingDomain; ownerHref: string; refreshPath: string; accepted?: (value: T, assertActive: () => void, action: NativePendingAction) => Promise<void> | void; resolveRefreshPath?: (value: unknown, action: NativePendingAction) => string; obsolete?: (error: unknown, action: NativePendingAction) => boolean; captureOperation: () => () => void }) {
  const scopeKey = nativePendingScopeKey(scope); activeScopeKey = scopeKey;
  const journal = useMemo(() => {
    const registryKey = `${scopeKey}:${domain}`; const existing = journals.get(registryKey); if (existing) return existing;
    let createId: (() => string) | undefined, captureContext: (() => Readonly<{ assertCurrent(): void }>) | undefined;
    const storagePromise = Promise.all([import('expo-crypto'), import('./api')]).then(([Crypto, Api]) => { createId = Crypto.randomUUID; captureContext = Api.captureApiContext; return secureStorage(scope, domain); });
    const instance = new NativePendingActionJournal({ scope, domain, storage: { read: async () => (await storagePromise).read(), write: async value => (await storagePromise).write(value), clear: async () => (await storagePromise).clear() }, randomId: () => { if (!createId) throw new Error('Secure command identity is not ready.'); return createId(); }, captureContext: () => { if (!captureContext) throw new Error('The transport context is not ready. Nothing was sent.'); return captureContext(); }, send: sendNativePendingAction, stageFile: file => stageNativePendingFile(file, scopeKey), discardStagedFile: discardNativePendingFile, cleanup: async action => { if (action.payload.kind === 'multipart') await discardNativePendingFile(action.payload.file); }, read: async (action, assertActive) => { const { apiFetch, getApiOrigin } = await import('./api'); if (getApiOrigin() !== action.scope.origin) throw new Error('The server changed before recovery.'); assertActive(); return apiFetch(action.refreshPath); }, obsolete });
    journals.set(registryKey, instance); return instance;
  }, [scopeKey, domain]);
  const [operationError, setOperationError] = useState('');
  const [state, setState] = useState(journal.snapshot()), active = useRef(true), acceptedRef = useRef(accepted); acceptedRef.current = accepted;
  useEffect(() => { active.current = true; const unsubscribe = journal.subscribe(setState); void journal.hydrate(); return () => { active.current = false; unsubscribe(); }; }, [journal]);
  const assertActive = () => { if (!active.current || activeScopeKey !== scopeKey) throw new Error('The account, campus or environment changed. The action remains retained in its original scope.'); };
  const context = { ownerHref, refreshPath, assertActive, resolveRefreshPath, accepted: async (value: unknown, assertCurrent: () => void, action: NativePendingAction) => acceptedRef.current?.(value as T, assertCurrent, action) };
  const operationContext = () => { const assertOperation = captureOperation(); return { ...context, assertActive: () => { assertActive(); assertOperation(); } }; };
  const perform = async (input?: NativePendingInput) => { setOperationError(''); try { const captured = operationContext(); return input ? await journal.run(input, captured) : await journal.recover(captured); } catch (cause) { setOperationError(message(cause)); return false; } };
  return { ...state, error: operationError || state.error, locked: !state.ready || state.blocked || state.busy || !!state.action || state.obsolete, resumeHref: state.action && state.action.ownerHref !== ownerHref ? state.action.ownerHref : null,
    run: (input: NativePendingInput) => perform(input), recover: () => perform(), reviewed: () => journal.reviewed() };
}
