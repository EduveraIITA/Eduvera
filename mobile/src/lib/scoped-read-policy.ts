/** A transient read failure may preserve a reviewed source. Lost authority or
 * a removed source must never keep a cached record actionable. */
export function canRetainScopedRead(data: unknown, error: unknown): boolean {
  if (data === null || data === undefined) return false;
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? error.status : undefined;
  return status !== 401 && status !== 403 && status !== 404 && status !== 410;
}

/** Confirmation callbacks consult the current read and writer when invoked,
 * rather than retaining the authority that existed when a dialog opened. */
export async function runFromScopedRead<TInput, TResult>(
  current: () => { paused: boolean; run(input: TInput): Promise<TResult> },
  input: TInput,
  refused: TResult,
): Promise<TResult> {
  const latest = current();
  return latest.paused ? refused : latest.run(input);
}
