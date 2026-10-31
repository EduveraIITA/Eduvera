import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from './SessionProvider';
import { getApiOrigin } from '../lib/api';
import { useApi } from '../lib/query';
import { useScreenExitGuard } from '../ui/BackNavigation';
import { ControlButton } from '../ui/DomainControls';
import { Notice, Section } from '../ui/components';
import { useTheme } from '../ui/theme';
import type { DemoProfile, DemoProfileSource } from './demo-profile-policy';

const labels = { admin: 'Principal', staff: 'Teacher', parent: 'Parent', student: 'Student' };
export function DemoProfileSwitcher({ disabled = false }: { disabled?: boolean }) {
  const session = useSession(), source = useApi<DemoProfileSource>('/api/v1/auth/demo-profiles/', { staleTime: 0 }), router = useRouter(), { colors } = useTheme();
  const [pending, setPending] = useState<string | null>(null), [error, setError] = useState('');
  useScreenExitGuard({ blocked: !!pending });
  // Match the web owner: eligibility and synthetic profiles stay invisible to
  // ordinary accounts, including while that eligibility is being checked.
  if (source.isPending || source.isError || source.data?.enabled !== true) return null;
  async function choose(profile: DemoProfile) {
    if (pending || disabled || session.status !== 'authenticated') return;
    setPending(profile.username); setError('');
    try { await session.switchDemoProfile(profile); router.replace('/today'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The demo profile switch could not be confirmed.'); }
    finally { setPending(null); }
  }
  return <Section title="Demo profiles">
    <>
      <Notice message={session.publicDemo ? 'Synthetic campus data · read-only. Switching views keeps this public preview read-only.' : 'Synthetic Cambridge campus profiles. Each profile uses its existing account permissions.'} />
      {source.data.profiles.map(profile => <View key={profile.username} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}>
        {profile.avatar_url ? <Image source={{ uri: profile.avatar_url.startsWith('/') ? getApiOrigin() + profile.avatar_url : profile.avatar_url }} accessible={false} style={{ width: 40, height: 40, borderRadius: 20 }} /> : null}
        <View style={{ flex: 1, gap: 3 }}><Text style={{ color: colors.ink, fontSize: 16, fontWeight: '600' }}>{profile.display_name}</Text><Text style={{ color: colors.muted, fontSize: 14 }}>{labels[profile.role]}{profile.current ? ' · Current profile' : ''}</Text></View>
        {profile.current ? <Text style={{ color: colors.muted, fontSize: 14 }}>Current</Text> : <ControlButton title={`Switch to ${labels[profile.role].toLowerCase()}`} busy={pending === profile.username} disabled={disabled || !!pending} onPress={() => { void choose(profile); }} />}
      </View>)}
    </>{error ? <Notice tone="danger" message={error} /> : null}
  </Section>;
}
