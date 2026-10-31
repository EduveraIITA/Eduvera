export interface SessionOperation { isCurrent(): boolean; assertCurrent(): void }

/** Order Keychain jobs and invalidate delayed authentication work without exposing tokens. */
export function createSessionLifecycle(getOrigin: () => string) {
  let generation = 0;
  let tail: Promise<unknown> = Promise.resolve();
  function capture(): SessionOperation {
    const started = generation, origin = getOrigin();
    const isCurrent = () => started === generation && origin === getOrigin();
    return Object.freeze({ isCurrent, assertCurrent() { if (!isCurrent()) throw new Error('Your sign-in context changed. Please try again.'); } });
  }
  return {
    capture,
    begin() { generation++; return capture(); },
    serialize<T>(job: () => Promise<T>): Promise<T> {
      const result = tail.then(job);
      tail = result.catch(() => {});
      return result;
    },
  };
}
