import { safeAccountReturnTarget } from './account-return';

export interface AccountRecoveryOperation { assertCurrent(): void; onDispatch?(): void }
export interface AccountRecoveryApi { apiFetch<T>(path: string, init?: RequestInit): Promise<T> }

/** Keep account proofs only in the current form. Duplicate incoming values are
 * ambiguous and must not select a token or a return destination implicitly. */
export function accountSecurityEntryHref(params: Record<string, unknown>): string | null {
  const query = new URLSearchParams();
  if (params.continue !== undefined) {
    if (typeof params.continue !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.continue) || params.token !== undefined) return null;
    query.set('continue', params.continue);
  }
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

export function passwordResetRequestFeedback(value: unknown): { message: string; tone: 'success' | 'warning' } {
  if (!value || typeof value !== 'object' || (value as { accepted?: unknown }).accepted !== true) throw new Error('The reset request could not be confirmed. Please try again.');
  if ((value as { recovery_available?: unknown }).recovery_available === false) return { tone: 'warning', message: 'Email recovery is currently unavailable. No reset email was requested. Try again later or contact ThatCampus support.' };
  return { tone: 'success', message: 'Reset request received. If this email has an account, check your inbox for instructions. If nothing arrives, try again later.' };
}

export function verificationEmailFeedback(value: { delivery: string; development_token?: string }): { message: string; tone: 'success' | 'warning'; developmentToken?: string } {
  if (value.delivery === 'queued' || value.delivery === 'sending') return { tone: 'success', message: 'Verification email is queued. Check your inbox shortly. Another request within a minute keeps the same link.' };
  if (value.delivery === 'not_required') return { tone: 'success', message: 'Your email is already verified. Refresh your account to continue.' };
  if (value.delivery === 'email_accepted') return { tone: 'success', message: 'Verification email accepted by the mail server. Check your inbox.' };
  if (value.delivery === 'manual' && typeof value.development_token === 'string' && accountActionToken(value.development_token)) return { tone: 'warning', message: 'Development verification token is ready below.', developmentToken: value.development_token };
  if (value.delivery === 'unavailable' || value.delivery === 'manual') return { tone: 'warning', message: 'Verification email is currently unavailable. No email was sent. You can enter a verification token you already received, or contact ThatCampus support.' };
  return { tone: 'warning', message: 'Email delivery could not be confirmed. Check your inbox and wait before requesting another verification email.' };
}
