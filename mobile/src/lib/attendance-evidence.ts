import { attendanceCommandRefused, attendanceResultMatches } from './attendance-command-policy';
export interface AttendanceEvidenceCommand {
  version: 1; scopeKey: string; registerId: string; key: string; expectedRevision: number;
  evidenceId: string | null; body: string; phase: 'prepared' | 'unknown' | 'accepted';
}
export interface AttendanceEvidenceStorage { read(): Promise<string | null>; write(value: string): Promise<void>; clear(): Promise<void> }
export interface AttendanceEvidenceState { ready: boolean; blocked: boolean; busy: boolean; pending: AttendanceEvidenceCommand | null; error: string }
const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export function validateAttendanceEvidenceCommand(value: unknown, scopeKey: string): value is AttendanceEvidenceCommand {
  if (!value || typeof value !== 'object') return false;
  const command = value as AttendanceEvidenceCommand;
  if (command.version !== 1 || command.scopeKey !== scopeKey || !uuid(command.registerId) || !uuid(command.key) || !Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0 || command.evidenceId !== null && !uuid(command.evidenceId) || !['prepared', 'unknown', 'accepted'].includes(command.phase) || typeof command.body !== 'string' || command.body.length > 12000) return false;
  try {
    const body = JSON.parse(command.body) as Record<string, unknown>;
    if (!body || body.expected_revision !== command.expectedRevision) return false;
    return command.evidenceId ? ['accepted', 'rejected'].includes(String(body.decision)) && typeof body.reason === 'string' && body.reason.trim().length >= 3 && body.reason.length <= 500
      : uuid(body.person_id) && ['present', 'absent', 'late', 'excused', 'half_day'].includes(String(body.claimed_status)) && body.capture_channel === 'offline_paper' && typeof body.observed_at === 'string' && Number.isFinite(Date.parse(body.observed_at)) && typeof body.source_reference === 'string' && body.source_reference.length <= 160 && typeof body.note === 'string' && body.note.trim().length >= 3 && body.note.length <= 500;
  } catch { return false; }
}
export function attendanceEvidencePath(base: string, command: Pick<AttendanceEvidenceCommand, 'registerId' | 'evidenceId'>) {
  return `${base}/${encodeURIComponent(command.registerId)}/evidence${command.evidenceId ? `/${encodeURIComponent(command.evidenceId)}/decision` : ''}`;
}
/** The activity owner persists idempotent responses. No new key is made during recovery. */
export class AttendanceEvidenceJournal {
  private state: AttendanceEvidenceState = { ready: false, blocked: false, busy: false, pending: null, error: '' };
  private listeners = new Set<(value: AttendanceEvidenceState) => void>();
  constructor(private options: { scopeKey: string; storage: AttendanceEvidenceStorage; randomId(): string; send(command: AttendanceEvidenceCommand): Promise<unknown>; read(command: AttendanceEvidenceCommand): Promise<unknown> }) {}
  snapshot() { return this.state; }
  subscribe(listener: (value: AttendanceEvidenceState) => void) { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }
  private update(value: Partial<AttendanceEvidenceState>) { this.state = { ...this.state, ...value }; this.listeners.forEach(listener => listener(this.state)); }
  async hydrate() {
    if (this.state.ready || this.state.busy) return;
    this.update({ busy: true });
    try { const raw = await this.options.storage.read(); if (raw) { const value: unknown = JSON.parse(raw); if (!validateAttendanceEvidenceCommand(value, this.options.scopeKey)) throw new Error('The encrypted attendance report could not be verified. Its data was kept; contact support before repeating it.'); this.update({ pending: value }); } }
    catch (cause) { this.update({ blocked: true, error: cause instanceof Error ? cause.message : 'Encrypted attendance evidence storage is unavailable.' }); }
    finally { this.update({ ready: true, busy: false }); }
  }
  async run(input: { registerId: string; expectedRevision: number; evidenceId?: string; body: Record<string, unknown> }, context: { assertCurrent(): void; accepted(value: unknown): void }) {
    if (!this.state.ready || this.state.blocked || this.state.busy || this.state.pending) return false;
    this.update({ busy: true, error: '' });
    try {
      context.assertCurrent();
      const command: AttendanceEvidenceCommand = { version: 1, scopeKey: this.options.scopeKey, registerId: input.registerId, key: this.options.randomId(), expectedRevision: input.expectedRevision, evidenceId: input.evidenceId ?? null, body: JSON.stringify({ ...input.body, expected_revision: input.expectedRevision }), phase: 'prepared' };
      if (!validateAttendanceEvidenceCommand(command, this.options.scopeKey)) throw new Error('Review the participant, observation time and supporting reason before sending.');
      this.update({ pending: command });
      await this.options.storage.write(JSON.stringify(command)); context.assertCurrent();
      return await this.execute(context, false);
    } catch (cause) { this.update({ error: cause instanceof Error ? cause.message : 'The report was not sent. Its exact details are retained.' }); return false; }
    finally { this.update({ busy: false }); }
  }
  async recover(context: { assertCurrent(): void; accepted(value: unknown): void }) {
    if (!this.state.ready || this.state.blocked || this.state.busy || !this.state.pending) return false;
    this.update({ busy: true, error: '' });
    try { return await this.execute(context, true); } finally { this.update({ busy: false }); }
  }
  private async execute(context: { assertCurrent(): void; accepted(value: unknown): void }, previouslyUncertain: boolean) {
    let command = this.state.pending!;
    try {
      context.assertCurrent();
      if (command.phase !== 'accepted') {
        command = { ...command, phase: 'unknown' }; this.update({ pending: command });
        await this.options.storage.write(JSON.stringify(command)); context.assertCurrent();
        const result = await this.options.send(command); context.assertCurrent();
        if (!attendanceResultMatches(result, command.registerId, command.expectedRevision)) throw new Error('The response did not confirm this exact register revision. Keep the retained report and retry it unchanged.');
        command = { ...command, phase: 'accepted' }; this.update({ pending: command });
        await this.options.storage.write(JSON.stringify(command)); context.assertCurrent();
      }
      const latest = await this.options.read(command); context.assertCurrent();
      if (!attendanceResultMatches(latest, command.registerId, command.expectedRevision, true)) throw new Error('The refreshed register did not match the accepted report.');
      await this.options.storage.clear(); this.update({ pending: null }); context.assertCurrent();
      context.accepted(latest); context.assertCurrent(); this.update({ error: '' }); return true;
    } catch (cause) {
      if (command.phase !== 'accepted' && attendanceCommandRefused(cause, previouslyUncertain)) {
        try { context.assertCurrent(); await this.options.storage.clear(); this.update({ pending: null }); context.assertCurrent(); } catch { /* Keep the retained request if encrypted cleanup could not be confirmed. */ }
      }
      this.update({ error: `${command.phase === 'accepted' ? 'Saved. Recovery only reads the register. ' : ''}${cause instanceof Error ? cause.message : 'This report could not be confirmed.'}${this.state.pending ? ' The exact action remains securely retained.' : ''}` }); return false;
    }
  }
}

/** Register detail exposes source_kind; entry_mode belongs to queue summaries. */
export function requiresOwningAttendanceSource(register: { source_kind?: string; entry_mode?: string }): boolean {
  return register.source_kind === 'event' || register.source_kind === 'examination' || register.entry_mode === 'owning_domain';
}
