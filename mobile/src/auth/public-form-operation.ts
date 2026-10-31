export interface PublicFormState { identity: string; mounted: boolean; focused: boolean; foreground: boolean }
export class PublicFormContextChanged extends Error {
  constructor() { super('Return to the original invitation, account and screen before continuing.'); }
}

/** Anonymous forms cannot capture an authenticated API lease. Invalidate a
 * callable preparation when any part of its original presentation changes. The
 * identity remains volatile and must never be logged or written to storage. */
export function createPublicFormLease(initial: PublicFormState) {
  let state = { ...initial }, generation = 0;
  return {
    update(next: PublicFormState) {
      if (state.identity !== next.identity || state.mounted !== next.mounted || state.focused !== next.focused || state.foreground !== next.foreground) generation++;
      state = { ...next };
    },
    capture() {
      const started = generation;
      const assertCurrent = () => {
        if (started !== generation || !state.mounted || !state.focused || !state.foreground) throw new PublicFormContextChanged();
      };
      assertCurrent(); return assertCurrent;
    },
  };
}

/** Security bootstrap is not permission to dispatch from a departed form. */
export async function publicFormRequest<T>(options: { assertCurrent(): void; bootstrap?: () => Promise<unknown>; submit: () => Promise<T> }): Promise<T> {
  options.assertCurrent();
  if (options.bootstrap) { await options.bootstrap(); options.assertCurrent(); }
  options.assertCurrent();
  const result = await options.submit();
  options.assertCurrent();
  return result;
}
