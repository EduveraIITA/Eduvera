import { executionEnvironmentFromWire } from '../../../packages/contracts/src/execution-environment';
import type { AuthUser, Environment, Membership, SessionState } from './session-types';

export interface BrowserSessionWire { authenticated: boolean; user: AuthUser | null; execution_environment: unknown; public_demo?: boolean }
export interface BrowserProfileWire { user: AuthUser; memberships: Membership[]; execution_environment: unknown; company_operator?: boolean; institution_setup_required?: boolean; onboarding?: { status: string; resume?: { path: string } } }
export const EXPLICIT_WEB_LOGOUT_KEY = 'omnischool:explicitly-logged-out';
export const WEB_SESSION_SIGNAL_KEY = 'thatcampus:execution-environment-changed';
export interface BrowserSessionSignal { version: 1; kind: 'session-environment-changed'; senderId: string; nonce: string }
export const initialWebSession: SessionState = { status: 'loading', user: null, memberships: [], environment: { mode: 'live' }, error: null, setupRequired: false };

/** The signed cookie, rather than the unsigned response secret, is the CSRF proof. */
export function browserCsrfToken(cookie: string): string | null {
  const values = cookie.split(';').map(item => item.trim()).filter(item => item.startsWith('csrftoken='));
  if (values.length !== 1) return null;
  try { const value = decodeURIComponent(values[0]!.slice('csrftoken='.length)); return value && !/[\r\n\u0000]/.test(value) ? value : null; } catch { return null; }
}

export function confirmedBrowserEnvironment(value: unknown): Environment {
  const normalized = executionEnvironmentFromWire(value);
  const environment: Environment = { mode: normalized.mode, namespace_id: normalized.namespaceId ?? null, institution_id: normalized.institutionId ?? null };
  if (normalized.mode === 'simulation') {
    environment.run_id = normalized.runId;
    if (normalized.unavailable === true) { environment.unavailable = true; environment.unavailable_reason = normalized.unavailableReason; }
    else environment.virtual_clock = { now: normalized.virtualClock.now, time_zone: normalized.virtualClock.timeZone };
    if (normalized.expiresAt) environment.expires_at = normalized.expiresAt;
  }
  return environment;
}

function identity(environment: Environment) { return JSON.stringify([environment.mode, environment.namespace_id ?? null, environment.institution_id ?? null, environment.run_id ?? null]); }

/** Neither a response to login nor a storage signal is a confirmed cookie session. */
export function verifiedBrowserProfile(session: BrowserSessionWire, profile: BrowserProfileWire, expectedActor?: string): SessionState {
  if (session.authenticated !== true || !session.user?.id || !profile.user?.id || session.user.id !== profile.user.id || expectedActor && profile.user.id !== expectedActor) throw new Error('Your account context changed. Confirm your session before continuing.');
  const before = confirmedBrowserEnvironment(session.execution_environment), environment = confirmedBrowserEnvironment(profile.execution_environment);
  if (identity(before) !== identity(environment) || (session.user.active_school_id ?? null) !== (profile.user.active_school_id ?? null)) throw new Error('Your campus environment changed while opening your account. Refresh to confirm it.');
  if (profile.user.active_school_id && environment.institution_id !== profile.user.active_school_id) throw new Error('The server did not confirm your active campus.');
  if (!Array.isArray(profile.memberships) || profile.memberships.some(member => !member || typeof member.id !== 'string' || typeof member.school_id !== 'string')) throw new Error('Your current campus memberships could not be confirmed.');
  return { status: 'authenticated', user: profile.user, memberships: profile.memberships, environment, error: null, setupRequired: profile.institution_setup_required === true || profile.onboarding?.status === 'workspace_required', companyOperator: profile.company_operator === true, publicDemo: session.public_demo === true, onboarding: profile.onboarding };
}

export function isBrowserSessionSignal(value: unknown): value is BrowserSessionSignal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const signal = value as Partial<BrowserSessionSignal>;
  return signal.version === 1 && signal.kind === 'session-environment-changed' && typeof signal.senderId === 'string' && signal.senderId.length > 0 && typeof signal.nonce === 'string' && signal.nonce.length > 0;
}
