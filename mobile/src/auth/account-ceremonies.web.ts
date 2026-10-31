import { apiFetch } from '../lib/api.web';
import { browserAuthMutation } from './web-auth-mutation';
import { guardedAccountRecoveryApi, type AccountRecoveryOperation } from './account-recovery';

export function requestPasswordReset(email: string, operation?: AccountRecoveryOperation) { return browserAuthMutation(guardedAccountRecoveryApi({ apiFetch }, operation), '/api/v1/auth/password-reset/request/', { email: email.trim() }); }
export function confirmPasswordReset(token: string, password: string, operation?: AccountRecoveryOperation) { return browserAuthMutation(guardedAccountRecoveryApi({ apiFetch }, operation), '/api/v1/auth/password-reset/confirm/', { token, password }); }
