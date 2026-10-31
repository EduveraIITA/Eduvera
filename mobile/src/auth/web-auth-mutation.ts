import { ApiError } from '../lib/api-client';
import type { SessionOperation } from './session-lifecycle';

export interface BrowserAuthApi { apiFetch<T>(path: string, init?: RequestInit): Promise<T> }
const retryableBootstrap = (error: unknown) => !(error instanceof ApiError) || error.status === 408 || error.status === 429 || error.status >= 500;

/** Retry only an explicit CSRF refusal, which runs before the account mutation. */
export async function browserAuthMutation<T>(api: BrowserAuthApi, path: string, body: unknown, operation?: SessionOperation, onDispatch?: () => void): Promise<T> {
  if (!/^\/api\/v1\/auth\/(?:login|google|mfa\/login|register|public-demo-session|demo-profile-switch|password-reset\/(?:request|confirm)|visit-onboarding\/(?:preview|proof|account)|active-school|execution-environment)\/$/.test(path)) throw new Error('This account ceremony is unavailable in the browser.');
  const payload = JSON.stringify(body);
  async function csrf() {
    for (let attempt = 0; ; attempt++) {
      operation?.assertCurrent();
      try { await api.apiFetch('/api/v1/auth/csrf/'); operation?.assertCurrent(); return; }
      catch (cause) { operation?.assertCurrent(); if (attempt >= 2 || !retryableBootstrap(cause)) throw cause; await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1))); }
    }
  }
  await csrf();
  operation?.assertCurrent();
  try { onDispatch?.(); return await api.apiFetch<T>(path, { method: 'POST', body: payload }); }
  catch (cause) {
    operation?.assertCurrent();
    if (!(cause instanceof ApiError) || cause.status !== 403 || !/csrf/i.test(cause.message)) throw cause;
    await csrf(); operation?.assertCurrent();
    onDispatch?.(); return api.apiFetch<T>(path, { method: 'POST', body: payload });
  }
}
