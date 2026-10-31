import { safeAccountReturnTarget } from './account-return';

export interface AccountRecoveryOperation { assertCurrent(): void; onDispatch?(): void }
export interface AccountRecoveryApi { apiFetch<T>(path: string, init?: RequestInit): Promise<T> }

/** Keep account proofs only in the current form. Duplicate incoming values are
 * ambiguous and must not select a token or a return destination implicitly. */
export function accountSecurityEntryHref(params: Record<string, unknown>): string | null {
  const query = new URLSearchParams();
  if (params.token !== undefined) {
    if (typeof params.token !== 'string' || !accountActionToken(params.token)) return null;
    query.set('token', params.token.trim());
  }
  for (const key of ['from', 'next'] as const) {
    if (params[key] === undefined) continue;
    if (typeof params[key] !== 'string') return null;
    const target = safeAccountReturnTarget(params[key]);
    if (target && !target.includes('#') && !target.split('?')[0]?.endsWith('/account/security')) query.set(key, target);
  }
  return `/more/account/security${query.size ? `?${query}` : ''}`;
}

export function accountActionToken(value: string): boolean {
  const token = value.trim();
  return token.length >= 32 && token.length <= 256 && !/[\s\p{Cc}]/u.test(token);
}

export function passwordResetInput(token: string, password: string, confirmation: string) {
  if (!accountActionToken(token)) throw new Error('Enter the complete reset token from your email, or request a new reset link.');
  if (password.length < 12 || password.length > 128) throw new Error('Use a password with 12–128 characters.');
  if (password !== confirmation) throw new Error('The passwords do not match.');
  return { token: token.trim(), password };
}

/** Every CSRF retry and actual dispatch still belongs to the initiating form,
 * actor/world and API origin. The adapter never records the proof or password. */
export function guardedAccountRecoveryApi(api: AccountRecoveryApi, operation?: AccountRecoveryOperation): AccountRecoveryApi {
  return { async apiFetch<T>(path: string, init?: RequestInit) {
    operation?.assertCurrent();
    if (init?.method === 'POST') operation?.onDispatch?.();
    const result = await api.apiFetch<T>(path, init);
    operation?.assertCurrent();
    return result;
  } };
}

export function confirmedPasswordReset(value: unknown): void {
  if (!value || typeof value !== 'object' || (value as { reset?: unknown }).reset !== true) throw new Error('The password reset could not be confirmed. Try signing in with the new password or request a fresh link.');
}
