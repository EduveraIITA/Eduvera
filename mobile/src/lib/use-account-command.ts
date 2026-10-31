import { useEffect, useMemo, useRef, useState } from 'react';
import { useIsFocused } from 'expo-router';
import { useSession } from '../auth/SessionProvider';
import { apiFetch, captureApiContext, getApiOrigin } from './api';
import { AccountCommandGate, type AccountRequest } from './account-command';
const gates = new Map<string, AccountCommandGate>();
export function useAccountCommand(scopeKey: string, name: string) {
  const session = useSession(), focused = useIsFocused(), mounted = useRef(true);
  const current = useRef({ scopeKey, sessionScope: session.scopeKey, actor: session.user?.id, origin: getApiOrigin(), focused });
  current.current = { scopeKey, sessionScope: session.scopeKey, actor: session.user?.id, origin: getApiOrigin(), focused };
  const gate = useMemo(() => { const key = JSON.stringify([scopeKey, name]); let value = gates.get(key); if (!value) { value = new AccountCommandGate(); gates.set(key, value); } return value; }, [scopeKey, name]);
  const [state, setState] = useState(gate.snapshot());
  useEffect(() => { mounted.current = true; const unsubscribe = gate.subscribe(setState); return () => { mounted.current = false; unsubscribe(); }; }, [gate]);
  const guard = (request?: AccountRequest) => {
    const captured = { ...current.current };
    // Account preference requests remain control-plane operations in Simulation.
    // The API itself still captures and checks its transport epoch for all paths.
    const transport = request?.path.startsWith('/api/v1/auth/') ? null : captureApiContext();
    return () => { const next = current.current; if (!mounted.current || !next.focused || captured.scopeKey !== next.scopeKey || captured.sessionScope !== next.sessionScope || captured.actor !== next.actor || captured.origin !== next.origin) throw new Error('The account, campus or environment changed. Return to the original view and review its current state.'); transport?.assertCurrent(); };
  };
  return { ...state, locked: state.busy || !!state.pending,
    capture: (request?: AccountRequest) => { const assertCurrent = guard(request); assertCurrent(); return assertCurrent; },
    run: <T,>(request: AccountRequest, options: { confirm(value: unknown): T; accepted?(value: T): void; refresh(): Promise<unknown> }) => {
      let assertCurrent: () => void; try { assertCurrent = guard(request); } catch { return Promise.resolve(false); }
      return gate.run(request, { ...options, assertCurrent, send: original => apiFetch(original.path, { method: original.method, ...(original.body === undefined ? {} : { body: original.body }) }) });
    },
    inspect: (refresh: () => Promise<unknown>, resolves?: (value: unknown, request: Readonly<AccountRequest>) => boolean) => { try { return gate.inspect({ refresh, resolves, assertCurrent: guard(state.pending?.request) }); } catch { return Promise.resolve(); } },
    review: () => gate.review(),
  };
}
