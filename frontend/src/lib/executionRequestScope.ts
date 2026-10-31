/** Request safety follows a confirmed server session, never a storage signal. */
export const EXECUTION_ENVIRONMENT_VERIFY_EVENT = "thatcampus:verify-execution-environment";
let namespace: string | null = null;
let blocked = false;
let generation = 0;
const pending = new Set<AbortController>();

/** Opaque session/world epoch for pending command retries. This never grants
 * authority; executionRequest still verifies the server-confirmed scope. */
export function executionRequestIdentity() {
  return `${generation}:${namespace ?? "unbound"}`;
}

export function isExecutionDomainRequest(path: string) {
  const pathname = path.split("?", 1)[0]!;
  return pathname.startsWith("/api/") && !pathname.startsWith("/api/v1/auth/")
    && !/^\/api\/v1\/schools\/[^/]+\/simulation(?:\/|$)/u.test(pathname)
    && !pathname.startsWith("/api/v1/development/campus-simulator/");
}

export function blockExecutionRequests() {
  blocked = true;
  generation += 1;
  for (const controller of pending) controller.abort();
  pending.clear();
}

export function confirmExecutionRequestScope(confirmedNamespace: string | null) {
  namespace = confirmedNamespace;
  blocked = false;
  generation += 1;
}

export function executionRequest(path: string, upstream?: AbortSignal | null) {
  if (!isExecutionDomainRequest(path)) return { namespace: null, signal: upstream, assertCurrent() {}, finish() {} };
  if (blocked) throw new Error("Confirm the active campus environment before continuing.");
  const started = generation, expected = namespace;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (upstream?.aborted) controller.abort();
  else upstream?.addEventListener("abort", abort, { once: true });
  pending.add(controller);
  return { namespace: expected, signal: controller.signal,
    assertCurrent() {
      if (blocked || started !== generation || expected !== namespace || controller.signal.aborted) {
        throw new DOMException("The active campus environment changed while this request was pending.", "AbortError");
      }
    },
    finish() { pending.delete(controller); upstream?.removeEventListener("abort", abort); },
  };
}
