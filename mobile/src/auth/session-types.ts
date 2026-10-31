import type { AuthEntryState } from '../../../packages/contracts/src/auth-entry';
import type { GoogleLoginOptions } from './google-auth-policy';
import type { VisitPublicAction } from './visit-join-policy';
export interface AuthUser { id: string; username: string; email: string; first_name: string; last_name: string; display_name: string; role?: string; active_school_id?: string | null; email_verified?: boolean; avatar_url?: string | null }
export interface Membership { id: string; school_id: string; school_name: string; role: string; permissions?: string[]; access_scope?: string }
export interface Environment { mode: 'live' | 'simulation'; namespace_id?: string | null; institution_id?: string | null; run_id?: string; unavailable?: boolean; unavailable_reason?: string; virtual_clock?: { now: string; time_zone: string }; expires_at?: string }
export type PublicDemoRole = 'student' | 'parent' | 'staff' | 'admin';
export interface SessionState { status: 'loading' | 'anonymous' | 'authenticated' | 'error'; user: AuthUser | null; memberships: Membership[]; environment: Environment; error: string | null; setupRequired: boolean; companyOperator?: boolean; publicDemo?: boolean; onboarding?: AuthEntryState['onboarding'] }
export interface SessionContext extends SessionState {
  ready: boolean; schoolId: string | null; scopeKey: string;
  login: (identifier: string, password: string) => Promise<string | null>;
  googleLogin: (credential?: string,options?: GoogleLoginOptions) => Promise<string | null>;
  completeMfa: (challenge: string, code: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  requestVisitOnboarding: (action: VisitPublicAction, body: unknown, assertCurrent: () => void, onDispatch?: () => void) => Promise<unknown>;
  enterPublicDemo: (role: PublicDemoRole) => Promise<void>;
  switchDemoProfile: (profile: { role: PublicDemoRole; username: string }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  selectSchool: (schoolId: string) => Promise<void>;
  selectEnvironment: (selection: { mode: 'live' } | { mode: 'simulation'; run_id: string }) => Promise<void>;
}
