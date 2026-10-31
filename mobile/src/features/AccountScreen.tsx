import { useState } from 'react';
import { Text, View } from 'react-native';
import { Alert } from '../ui/Alert';
import { useSession } from '../auth/SessionProvider';
import { Button, Empty, ListGroup, Notice, Page, Row, Section } from '../ui/components';
import { SegmentedControl } from '../ui/DomainControls';
import { useTheme, type ThemePreference } from '../ui/theme';
import { AccountAssistantMemory, AccountProFeatures } from './AccountPreferences';
import { ScreenBack, useScreenExitGuard } from '../ui/BackNavigation';
import { safeAccountReturnTarget, accountReturnTitle } from '../auth/account-return';
import { nativeAuthDestination } from '../auth/auth-entry';
import { AccountSecurityScreen } from '../auth/AccountSecurityScreen';
import { accountProfileHref, accountSection } from '../lib/account-profile';
import { ProfileOverview } from './account/ProfileOverview';
import { PersonalDetails } from './account/PersonalDetails';

type Props = { href: string; onNavigate: (href: string) => void };
export function AccountScreen(props: Props) {
  if (props.href.split('?')[0]?.endsWith('/security')) return <AccountSecurityScreen href={props.href} />;
  return <AccountPage {...props} />;
}
function AccountPage({ href, onNavigate }: Props) {
  const session = useSession(), section = accountSection(href);
  const back = section === 'profile' ? safeAccountReturnTarget(new URL(href, 'https://thatcampus.invalid').searchParams.get('from')) ?? nativeAuthDestination(session) : accountProfileHref('profile', href);
  const title = { profile: 'Profile', details: 'Personal details', appearance: 'Appearance', assistant: 'Assistant preferences', campuses: 'Your campuses' }[section];
  return <Page title={title}>
    <ScreenBack fallbackHref={back} title={accountReturnTitle(back)} />
    {section === 'profile' ? <><ProfileOverview href={href} onNavigate={onNavigate} /><Button title="Sign out" kind="danger" onPress={() => Alert.alert('Sign out of ThatCampus?', 'Your account will be signed out on this device.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => { void session.logout().catch(() => {}); } }])} /></> : null}
    {section === 'details' ? <PersonalDetails key={session.user?.id} href={href} onNavigate={onNavigate} /> : null}
    {section === 'appearance' ? <AppearancePreferences /> : null}
    {section === 'assistant' ? <><AccountProFeatures /><AccountAssistantMemory /></> : null}
    {section === 'campuses' ? <CampusMemberships onNavigate={onNavigate} /> : null}
  </Page>;
}
function AppearancePreferences() {
  const { colors, preference, setPreference, persistenceError } = useTheme();
  return <>{persistenceError ? <Notice tone="warning" message={persistenceError} /> : null}<Section title="Choose your appearance"><SegmentedControl label="Appearance" value={preference} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }]} onChange={value => setPreference(value as ThemePreference)} /><Text style={{ color: colors.muted, fontSize: 15, lineHeight: 23 }}>System follows your device’s Light or Dark appearance. This preference is saved on this device.</Text></Section></>;
}
function CampusMemberships({ onNavigate }: Pick<Props, 'onNavigate'>) {
  const session = useSession(), { colors } = useTheme(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useScreenExitGuard({ blocked: busy });
  const select = async (id: string) => { if (busy) return; setBusy(true); setError(''); try { await session.selectSchool(id); onNavigate('/today'); } catch (cause) { setError(cause instanceof Error ? cause.message : 'The campus could not be selected.'); } finally { setBusy(false); } };
  return <>{error ? <Notice tone="danger" message={error} /> : null}<Text style={{ color: colors.muted, fontSize: 15, lineHeight: 23 }}>Your profile is shared across these memberships. Campus responsibilities and official person records are managed by each campus.</Text>{session.memberships.length ? <Section title="Memberships"><ListGroup inset>{session.memberships.map((membership, index) => <Row key={membership.id} variant="plain" separator={index > 0} icon="building" title={membership.school_name} status={membership.school_id === session.schoolId ? 'Current campus' : busy ? 'Switching campus…' : undefined} onPress={membership.school_id === session.schoolId || busy ? undefined : () => void select(membership.school_id)} />)}</ListGroup></Section> : <Empty title="No campus membership yet" message="Accept a campus invitation, or continue setting up your own campus." />}{session.setupRequired ? <Button title="Continue campus setup" onPress={() => onNavigate('/onboarding/start')} /> : null}</>;
}
