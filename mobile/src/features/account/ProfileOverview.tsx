import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../../auth/SessionProvider';
import { getApiOrigin } from '../../lib/api';
import { useAccountQuery } from '../../lib/account-query';
import { parsePersonalProfile } from '../../lib/personal-profile';
import { accountName, accountProfileHref } from '../../lib/account-profile';
import { ControlButton } from '../../ui/DomainControls';
import { ListGroup, Notice, Row, Section } from '../../ui/components';
import { useTheme } from '../../ui/theme';
import { DemoProfileSwitcher } from '../../auth/DemoProfileSwitcher';

type Props = { href: string; onNavigate(href: string): void };
export function ProfileOverview({ href, onNavigate }: Props) {
  const session = useSession(), { colors, preference } = useTheme(), [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const profile=useAccountQuery('/api/v1/auth/profile/details/',parsePersonalProfile);
  const user = session.user, details=profile.value?.user_id===user?.id?profile.value:undefined, label = details?accountName(details)||user?.username||'Your account':user?.display_name||user?.username||'Your account', avatar = details?.photo_override?details.photo_data_url:user?.avatar_url;
  const parts = label.trim().split(/\s+/), initials = [parts[0], parts.length > 1 ? parts.at(-1) : undefined].filter(Boolean).map(part => Array.from(part!)[0]).join('').toUpperCase();
  const current = session.memberships.find(item => item.school_id === session.schoolId);
  const go = (section: Parameters<typeof accountProfileHref>[0]) => onNavigate(accountProfileHref(section, href));
  const security = '/more/account/security?' + new URLSearchParams({ from: accountProfileHref('profile', href) });
  const needsName = user && !accountName(user), needsEmail = user?.email_verified !== true;
  return <>
    <View style={styles.identity}>
      {avatar && failedAvatar !== avatar ? <Image source={{ uri: avatar.startsWith('/') ? getApiOrigin() + avatar : avatar }} onError={() => setFailedAvatar(avatar)} accessible={false} accessibilityIgnoresInvertColors style={styles.avatar} /> : <View accessible={false} style={[styles.avatar, styles.initials, { backgroundColor: colors.positiveSoft }]}><Text style={{ fontSize: 26, fontWeight: '600', color: colors.positive }}>{initials}</Text></View>}
      <View style={styles.identityText}><Text style={[styles.name, { color: colors.ink }]}>{label}</Text><Text selectable style={[styles.body, { color: colors.muted }]}>{user?.email}</Text>{!session.publicDemo ? <View style={{ alignSelf: 'flex-start' }}><ControlButton title="Edit profile" onPress={() => go('details')} /></View> : null}</View>
    </View>
    {session.publicDemo ? <Notice message="This public demo is read-only. Your own account has personal profile and security controls." /> : needsName || needsEmail || session.setupRequired ? <Section title="Finish setting up"><ListGroup inset>
      {needsName ? <Row variant="plain" title="Add your name" detail="Make your account recognizable." icon="profile" onPress={() => go('details')} /> : null}
      {needsEmail ? <Row variant="plain" separator={!!needsName} title="Confirm your email" detail="Secure your sign-in and account recovery." icon="verification" onPress={() => onNavigate(security)} /> : null}
      {session.setupRequired ? <Row variant="plain" separator={!!needsName || needsEmail} title="Set up your campus" detail="Choose the first work you want to run." icon="building" onPress={() => onNavigate('/onboarding/start')} /> : null}
    </ListGroup></Section> : null}
    <Section title="Your account"><ListGroup inset>
      <Row variant="plain" title="Personal details" detail="Photo, name, contact details and background" icon="profile" onPress={() => go('details')} />
      <Row variant="plain" separator title="Sign-in & security" detail={user?.email_verified ? 'Email verified · Manage account protection' : 'Confirm email and manage account protection'} icon="security" onPress={() => onNavigate(security)} />
      <Row variant="plain" separator title="Connections" detail="Calendar and supported messaging apps" icon="connections" onPress={() => onNavigate('/more/connections')} />
    </ListGroup></Section>
    <Section title="Preferences"><ListGroup inset>
      <Row variant="plain" title="Appearance" detail={preference === 'system' ? 'Follow device settings' : preference === 'dark' ? 'Dark' : 'Light'} icon="settings" onPress={() => go('appearance')} />
      <Row variant="plain" separator title="Assistant" detail="Pro features and remembered preferences" icon="assistant" onPress={() => go('assistant')} />
    </ListGroup></Section>
    <Section title="Campus"><ListGroup inset><Row variant="plain" title={current?.school_name ?? (session.memberships.length ? 'Your campuses' : 'No campus selected')} detail={session.memberships.length > 1 ? `${session.memberships.length} campuses · View or switch campus` : current ? 'Current campus · View membership' : 'View available memberships'} icon="building" onPress={() => go('campuses')} /></ListGroup></Section>
    <DemoProfileSwitcher />
  </>;
}
const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingTop: 4, paddingBottom: 4 },
  avatar: { width: 72, height: 72, borderRadius: 36 }, initials: { alignItems: 'center', justifyContent: 'center' },
  identityText: { flex: 1, minWidth: 0, gap: 4 }, name: { fontSize: 24, lineHeight: 31, fontWeight: '700' }, body: { fontSize: 15, lineHeight: 22 },
});
