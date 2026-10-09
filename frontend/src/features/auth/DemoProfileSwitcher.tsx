import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, LoaderCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import { useAuth } from './AuthContext';

type DemoRole = 'student' | 'parent' | 'staff' | 'admin';
interface DemoProfile {
  role: DemoRole;
  username: string;
  display_name: string;
  avatar_url: string | null;
  current: boolean;
}
interface DemoProfilesResponse { enabled: true; profiles: DemoProfile[] }
interface SwitchResponse { redirect_to: string }

const roleLabels: Record<DemoRole, string> = {
  student: 'Student',
  parent: 'Parent',
  staff: 'Teacher',
  admin: 'Principal',
};

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

export function DemoProfileSwitcher() {
  const auth = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [switching, setSwitching] = useState<DemoRole | null>(null);
  const [error, setError] = useState('');
  const query = useQuery({
    queryKey: ['account', 'demo-profiles', auth.user?.id],
    queryFn: () => apiFetch<DemoProfilesResponse>('/api/v1/auth/demo-profiles/'),
    enabled: Boolean(auth.user),
    retry: false,
    staleTime: 30_000,
  });

  if (query.isPending || query.isError || !query.data?.enabled) return null;

  async function switchTo(profile: DemoProfile) {
    if (profile.current || switching) return;
    setSwitching(profile.role);
    setError('');
    try {
      const result = await apiFetch<SwitchResponse>('/api/v1/auth/demo-profile-switch/', {
        method: 'POST',
        body: JSON.stringify({ role: profile.role }),
      });
      queryClient.clear();
      await auth.refresh();
      void navigate(result.redirect_to, { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not switch profiles.');
      setSwitching(null);
    }
  }

  return <section className="demo-profile-switcher" aria-labelledby="demo-profile-title">
    <div className="demo-profile-switcher__heading">
      <div><h2 id="demo-profile-title">Demo profiles</h2><small>Development preview · switch without signing out</small></div>
      <span>Temporary</span>
    </div>
    <ul className="demo-profile-switcher__list">
      {query.data.profiles.map((profile) => <li key={profile.role}>
        <span className={`demo-profile-switcher__avatar demo-profile-switcher__avatar--${profile.role}`}>
          {profile.avatar_url ? <img src={profile.avatar_url} alt="" /> : initials(profile.display_name)}
        </span>
        <span className="demo-profile-switcher__identity"><strong>{profile.display_name}</strong><small>{roleLabels[profile.role]}</small></span>
        {profile.current
          ? <span className="demo-profile-switcher__current" aria-current="true"><Check size={15}/> Current</span>
          : <button type="button" disabled={switching !== null} onClick={() => void switchTo(profile)} aria-label={`Switch to ${profile.display_name}, ${roleLabels[profile.role]}`}>
              {switching === profile.role ? <LoaderCircle className="auth-spin" size={17}/> : 'Switch'}
            </button>}
      </li>)}
    </ul>
    {error ? <p className="security-alert demo-profile-switcher__error" role="alert">{error}</p> : null}
  </section>;
}
