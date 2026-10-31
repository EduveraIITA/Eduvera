import { create } from 'qrcode/lib/core/qrcode';

export type GatePassKind = 'student' | 'pickup' | 'visitor';
export interface GateManagementStudent { id: string; name: string; admission_number: string; class_label: string; plan_state: string | null; direction: 'in' | 'out' | null; plan_id?: string | null; plan_revision?: number | null; mode?: string | null; authority_id?: string | null; collector_name?: string | null }
export interface GateManagementVisitor { id: string; school_id: string; name: string; purpose: string; state: string; revision: number; host_name?: string; expires_at?: string }
export interface GateManagementWorkspace {
  visitors: GateManagementVisitor[];
  activity: Array<{ id: string; name: string; detail: string; direction: 'in' | 'out'; occurred_at: string }>;
  visitor_counts?: Record<string, number>;
  visitor_pagination?: { page: number; total_pages: number; total: number };
}
export interface GateIssuedPass { qr: string; expires_at: string; kind: GatePassKind; name: string }
export interface GatePassIntent { version: 1; scope: string; schoolId: string; subjectId: string; kind: GatePassKind; phase: 'unknown' | 'accepted' }
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function gatePassStorageIdentity(scope: string, schoolId: string) { return JSON.stringify({ journal: 'gate-pass-issuance-v1', scope, schoolId }); }
export async function gatePassStorageKey(scope: string, schoolId: string, digest: (value: string) => Promise<string>) {
  if (!scope || !uuid.test(schoolId)) throw new Error('Confirm the exact account, campus and world before retaining this pass request.');
  const hash = await digest(gatePassStorageIdentity(scope, schoolId));
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('The private journal key could not be verified.');
  // Existing bounded Gate browser namespace, with a distinct issuance identity.
  return `thatcampus.pending.v1.gate.${hash}`;
}
export const gateVisitorFilters = ['all', 'active', 'pending', 'approved', 'inside', 'closed'] as const;
export function gateManagementFilter(value: string | null) { return gateVisitorFilters.find(item => item === value) ?? 'all'; }
export function gateManagementPage(value: string | null) { return value && /^[1-9]\d*$/.test(value) && Number(value) <= 2_147_483_647 ? Number(value) : 1; }
export function gatePassEndpoint(schoolId: string, subjectId: string, kind: GatePassKind) {
  if (!uuid.test(schoolId) || !uuid.test(subjectId) || !['student', 'pickup', 'visitor'].includes(kind)) throw new Error('The exact campus and pass recipient must be confirmed.');
  const root = `/api/v1/gate/schools/${schoolId}`;
  return kind === 'visitor' ? `${root}/visitors/${subjectId}/pass/` : `${root}/passes/`;
}
export function readGateIssuedPass(value: unknown, kind: GatePassKind, name: string, now: string): GateIssuedPass {
  const data = object(value), instant = Date.parse(now);
  if (!Number.isFinite(instant) || data.kind !== kind || data.name !== name || typeof data.qr !== 'string' || !/^eduera-gate:[A-Za-z0-9_-]{43}$/.test(data.qr)
    || typeof data.expires_at !== 'string' || !Number.isFinite(Date.parse(data.expires_at)) || Date.parse(data.expires_at) <= instant) throw new Error('The server did not confirm this recipient’s current pass. Do not issue another pass until its result is reviewed.');
  return { qr: data.qr, expires_at: data.expires_at, kind, name };
}
export function readGatePassIntent(value: unknown, scope: string, schoolId: string): GatePassIntent {
  const data = object(value);
  if (data.version !== 1 || data.scope !== scope || data.schoolId !== schoolId || !uuid.test(String(data.subjectId)) || !['student', 'pickup', 'visitor'].includes(String(data.kind)) || !['unknown', 'accepted'].includes(String(data.phase))
    || Object.keys(data).some(key => !['version', 'scope', 'schoolId', 'subjectId', 'kind', 'phase'].includes(key))) throw new Error('The retained pass request could not be verified. Keep it for support review before issuing another pass.');
  return data as unknown as GatePassIntent;
}
export function gatePassQr(token: string) {
  if (!/^eduera-gate:[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('The pass QR is invalid.');
  const { modules } = create(token, { errorCorrectionLevel: 'M' }), margin = 4, parts: string[] = [];
  for (let y = 0; y < modules.size; y++) for (let x = 0; x < modules.size; x++) if (modules.data[y * modules.size + x]) parts.push(`M${x + margin},${y + margin}h1v1h-1z`);
  const size = modules.size + margin * 2, path = parts.join('');
  return { size, path, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>` };
}
export function assertGatePassSource(selected: { id: string; name: string; revision?: number; plan_id?: string | null; plan_revision?: number | null; mode?: string | null; authority_id?: string | null }, current: { id: string; name: string; revision?: number; plan_state?: string | null; state?: string; school_id?: string; plan_id?: string | null; plan_revision?: number | null; mode?: string | null; authority_id?: string | null }, kind: GatePassKind, schoolId: string) {
  if (selected.id !== current.id || selected.name !== current.name || kind === 'visitor' && (current.school_id !== schoolId || current.revision !== selected.revision || !['approved', 'inside'].includes(current.state ?? ''))
    || kind === 'pickup' && (current.plan_state !== 'ready' || !uuid.test(current.plan_id ?? '') || !Number.isSafeInteger(current.plan_revision) || Number(current.plan_revision) < 1
      || !['guardian_pickup', 'authorized_collector', 'independent_departure'].includes(current.mode ?? '')
      || current.mode !== 'independent_departure' && !uuid.test(current.authority_id ?? '')
      || (['plan_id', 'plan_revision', 'mode', 'authority_id'] as const).some(key => selected[key] !== undefined && selected[key] !== current[key]))) throw new Error('This person, approval or pickup arrangement changed. Refresh and review before issuing a pass.');
}

/** Pass creation has neither an idempotency key nor a receipt endpoint. Retain
 * only nonsecret intent before POST; recovery never dispatches it again. */
export class GatePassIssueJournal {
  pending: GatePassIntent | null = null;
  ready = false;
  blocked = false;
  busy = false;
  constructor(readonly scope: string, readonly schoolId: string, private storage: { read(): Promise<string | null>; write(value: string): Promise<void>; clear(): Promise<void> }) {}
  async hydrate() {
    if (this.busy) throw new Error('Wait for the current pass request to finish.');
    this.ready = false;
    try { const raw = await this.storage.read(); this.pending = raw ? readGatePassIntent(JSON.parse(raw), this.scope, this.schoolId) : null; this.blocked = false; }
    catch (cause) { this.blocked = true; throw cause; }
    finally { this.ready = true; }
  }
  async issue(input: { kind: GatePassKind; subjectId: string; name: string; now: string; assertCurrent(): void; send(): Promise<unknown>; accepted(pass: GateIssuedPass): void }) {
    if (!this.ready || this.blocked || this.busy || this.pending) throw new Error('Review the retained pass request before issuing another pass.');
    gatePassEndpoint(this.schoolId, input.subjectId, input.kind); input.assertCurrent(); this.busy = true;
    let dispatched = false, accepted = false;
    try {
      const intent: GatePassIntent = { version: 1, scope: this.scope, schoolId: this.schoolId, subjectId: input.subjectId, kind: input.kind, phase: 'unknown' };
      this.pending = intent; await this.storage.write(JSON.stringify(intent)); input.assertCurrent();
      dispatched = true;
      const result = await input.send();
      // Do not persist, log or attach this response: the QR is a private bearer credential.
      const pass = readGateIssuedPass(result, input.kind, input.name, input.now); accepted = true;
      this.pending = { ...intent, phase: 'accepted' }; await this.storage.write(JSON.stringify(this.pending)); input.assertCurrent();
      input.accepted(pass); await this.storage.clear(); this.pending = null; input.assertCurrent();
      return pass;
    } catch (cause) {
      const status = object(cause).status;
      if (!dispatched || !accepted && typeof status === 'number' && [400, 401, 403, 404, 422].includes(status)) {
        await this.storage.clear(); this.pending = null;
      }
      throw cause;
    } finally { this.busy = false; }
  }
  async finishAccepted(assertCurrent: () => void) {
    if (!this.ready || this.blocked || this.busy || this.pending?.phase !== 'accepted') return;
    assertCurrent(); this.busy = true;
    try { await this.storage.clear(); this.pending = null; assertCurrent(); } finally { this.busy = false; }
  }
}
