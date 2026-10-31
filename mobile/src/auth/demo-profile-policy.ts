import type { AuthUser, Environment, PublicDemoRole } from './session-types';

export type DemoProfile = { role: PublicDemoRole; username: string; display_name: string; avatar_url: string | null; current: boolean };
export type DemoProfileSource = { enabled: boolean; profiles: DemoProfile[] };
export type DemoSwitchWire = { user?: AuthUser; execution_environment?: Environment; public_demo?: boolean; redirect_to?: string;
  access_token?: string; token_type?: string; expires_at?: string; session_retained?: boolean };

/** A catalog label does not grant authority; the owning service rechecks eligibility. */
export function confirmedDemoSwitch(response: DemoSwitchWire, profile: Pick<DemoProfile, 'role' | 'username'>, current: AuthUser, publicDemo: boolean) {
  if (!response.user?.id || response.user.username !== profile.username || response.public_demo !== publicDemo
    || response.redirect_to !== '/today' || response.execution_environment?.mode !== 'live'
    || (response.user.id === current.id) !== (response.user.username === current.username))
    throw new Error('The server did not confirm the selected demo profile in Live. Check your session before continuing.');
  return response.user;
}

export function confirmedNativeDemoSwitch(response: DemoSwitchWire, profile: Pick<DemoProfile, 'role' | 'username'>, current: AuthUser, publicDemo: boolean, expiry: string) {
  const user = confirmedDemoSwitch(response, profile, current, publicDemo);
  if (response.token_type !== 'Bearer' || !response.expires_at || !Number.isFinite(Date.parse(response.expires_at)) || Date.parse(response.expires_at) <= Date.now())
    throw new Error('The server did not confirm a usable native demo session.');
  if (response.session_retained === true) {
    if (user.id !== current.id || user.username !== current.username || response.access_token !== undefined || response.expires_at !== expiry)
      throw new Error('The retained demo session does not match the current account.');
  } else if (!/^tc_native_[A-Za-z0-9_-]{43}$/.test(response.access_token ?? '') || user.id === current.id) {
    throw new Error('The server did not issue the selected native demo session.');
  }
  return user;
}
