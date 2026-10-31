export interface AccountRequest { path: string; method: 'POST' | 'DELETE' | 'PATCH'; body?: string }
export interface AccountPending { request: Readonly<AccountRequest>; phase: 'unknown' | 'acknowledged'; inspected: boolean }
export interface AccountCommandState { busy: boolean; pending: AccountPending | null; error: string; message: string }
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'The account action could not be confirmed.';
/** Keyless account APIs have no command receipt: never replay an unknown write.
 * This gate is shared across retained screens, not a background or durable queue.
 * It retains request identity only; one-time returned secrets are never kept here.
 */
export class AccountCommandGate {
  private state: AccountCommandState = { busy: false, pending: null, error: '', message: '' };
  private listeners = new Set<(value: AccountCommandState) => void>();
  snapshot() { return this.state; }
  subscribe(listener: (value: AccountCommandState) => void) { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }
  private update(value: Partial<AccountCommandState>) { this.state = { ...this.state, ...value }; for (const listener of this.listeners) listener(this.state); }
  async run<T>(request: AccountRequest, options: { assertCurrent(): void; send(request: Readonly<AccountRequest>): Promise<unknown>; confirm(value: unknown): T; accepted?(value: T): void; refresh(): Promise<unknown> }) {
    if (this.state.busy || this.state.pending) return false;
    const original = Object.freeze({ ...request });
    this.update({ busy: true, error: '', message: '' });
    try {
      options.assertCurrent();
      this.update({ pending: { request: original, phase: 'unknown', inspected: false } });
      const response = await options.send(original); options.assertCurrent();
      const confirmed = options.confirm(response); options.assertCurrent();
      this.update({ pending: { request: original, phase: 'acknowledged', inspected: false } });
      options.accepted?.(confirmed); await options.refresh(); options.assertCurrent();
      this.update({ pending: null, message: 'Saved state refreshed.' }); return true;
    } catch (cause) {
      const status = cause && typeof cause === 'object' ? (cause as { status?: unknown }).status : undefined;
      // An acknowledged write survives any later refresh/storage/context failure.
      if (this.snapshot().pending?.phase !== 'acknowledged' && typeof status === 'number' && status >= 400 && status < 500 && ![408, 409, 429].includes(status)) this.update({ pending: null });
      this.update({ error: message(cause) }); return false;
    } finally { this.update({ busy: false }); }
  }
  async inspect(options: { assertCurrent(): void; refresh(): Promise<unknown>; resolves?(value: unknown, request: Readonly<AccountRequest>): boolean }) {
    const pending = this.state.pending; if (!pending || this.state.busy) return;
    this.update({ busy: true, pending: { ...pending, inspected: false }, error: '', message: '' });
    try {
      options.assertCurrent(); const current = await options.refresh(); options.assertCurrent();
      if (pending.phase === 'acknowledged' || options.resolves?.(current, pending.request)) this.update({ pending: null, message: 'Current saved state confirmed. The earlier request was not repeated.' });
      else this.update({ pending: { ...pending, inspected: true }, message: 'Current state reviewed. The earlier action has no exact receipt and was not repeated.' });
    } catch (cause) { this.update({ error: message(cause) }); }
    finally { this.update({ busy: false }); }
  }
  /** A new explicit intent can follow a fresh review; this never resends the old request. */
  review() { if (!this.state.busy && this.state.pending?.phase === 'unknown' && this.state.pending.inspected) this.update({ pending: null, error: '', message: 'Use the reviewed current state for your next choice.' }); }
}
