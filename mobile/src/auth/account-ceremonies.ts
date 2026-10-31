import { apiFetch } from '../lib/api';
import { guardedAccountRecoveryApi, type AccountRecoveryOperation } from './account-recovery';

export function requestPasswordReset(email: string, operation?: AccountRecoveryOperation) { return guardedAccountRecoveryApi({ apiFetch }, operation).apiFetch('/api/v1/auth/native/password-reset/request/', { method: 'POST', body: JSON.stringify({ email: email.trim() }) }); }
export function confirmPasswordReset(token: string, password: string, operation?: AccountRecoveryOperation) { return guardedAccountRecoveryApi({ apiFetch }, operation).apiFetch('/api/v1/auth/native/password-reset/confirm/', { method: 'POST', body: JSON.stringify({ token, password }) }); }
