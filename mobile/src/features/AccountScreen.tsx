import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { Alert } from '../ui/Alert';
import { useSession } from '../auth/SessionProvider';
import { Button, Empty, Field, ListGroup, Notice, Page, Row, Section } from '../ui/components';
import { usePageReveal } from '../ui/use-page-reveal';
import { SegmentedControl } from '../ui/DomainControls';
import { useTheme, type ThemePreference } from '../ui/theme';
import { AccountAssistantMemory, AccountProFeatures } from './AccountPreferences';
import { ScreenBack, useCampusNavigation, useScreenExitGuard } from '../ui/BackNavigation';
import { useCopilotAction, useCopilotActiveAction, useCopilotTakeOver, useCopilotTarget } from '../ui/CopilotProvider';
import { useOperationContext } from '../lib/use-operation-context';
import { safeAccountReturnTarget, accountReturnTitle } from '../auth/account-return';
import { nativeAuthDestination } from '../auth/auth-entry';
import { AccountSecurityScreen } from '../auth/AccountSecurityScreen';
import { accountProfileHref, accountSection } from '../lib/account-profile';
import { ProfileOverview } from './account/ProfileOverview';
import { PersonalDetails } from './account/PersonalDetails';
import { apiFetch, getApiOrigin } from '../lib/api';
import { useApi } from '../lib/query';

type Props = { href: string; onNavigate: (href: string) => void };
type CampusSetupHandoff = { actorId: string; schoolId: string; origin: string; expires: number };
let campusSetupHandoff: CampusSetupHandoff | undefined;
export function AccountScreen(props: Props) {
  if (props.href.split('?')[0]?.endsWith('/security')) return <AccountSecurityScreen href={props.href} />;
  return <AccountPage {...props} />;
}
function AccountPage({ href, onNavigate }: Props) {
  const session = useSession(), section = accountSection(href);
  const { scrollRef, reveal } = usePageReveal();
  const focused = useIsFocused(), { tabSelectionBlocked } = useCampusNavigation(href);
  const accountArrival = useCopilotTarget('open_campus_create', { enabled: section === 'campuses', stage: 'after', reveal });
  useEffect(() => {
    const handoff = campusSetupHandoff;
    if (!handoff || session.status !== 'authenticated') return;
    if (handoff.expires <= Date.now() || handoff.actorId !== session.user?.id || handoff.origin !== getApiOrigin()) {
      campusSetupHandoff = undefined;
      return;
    }
    // Campus selection deliberately retires the old navigation tree. Only
    // the confirmed destination account screen can continue its setup.
    if (section !== 'campuses' || !focused || tabSelectionBlocked || session.schoolId !== handoff.schoolId
      || session.environment.mode !== 'live' || session.environment.unavailable || !session.setupRequired) return;
    campusSetupHandoff = undefined;
    onNavigate('/onboarding/start');
  }, [section, focused, tabSelectionBlocked, session.status, session.user?.id, session.schoolId,
    session.environment.mode, session.environment.unavailable, session.setupRequired, onNavigate]);
  const back = section === 'profile' ? safeAccountReturnTarget(new URL(href, 'https://thatcampus.invalid').searchParams.get('from')) ?? nativeAuthDestination(session) : accountProfileHref('profile', href);
  const title = { profile: 'Profile', details: 'Personal details', appearance: 'Appearance', assistant: 'Assistant preferences', campuses: 'Your campuses' }[section];
  return <Page title={title} scrollRef={section === 'campuses' ? scrollRef : undefined} titleTarget={section === 'campuses' ? accountArrival : undefined}>
    <ScreenBack fallbackHref={back} title={accountReturnTitle(back)} />
    {section === 'profile' ? <><ProfileOverview href={href} onNavigate={onNavigate} /><Button title="Sign out" kind="danger" onPress={() => Alert.alert('Sign out of ThatCampus?', 'Your account will be signed out on this device.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => { void session.logout().catch(() => {}); } }])} /></> : null}
    {section === 'details' ? <PersonalDetails key={session.user?.id} href={href} onNavigate={onNavigate} /> : null}
    {section === 'appearance' ? <AppearancePreferences /> : null}
    {section === 'assistant' ? <><AccountProFeatures /><AccountAssistantMemory /></> : null}
    {section === 'campuses' ? <CampusMemberships key={session.scopeKey} onNavigate={onNavigate} reveal={reveal} /> : null}
  </Page>;
}
function AppearancePreferences() {
  const { colors, preference, setPreference, persistenceError } = useTheme();
  return <>{persistenceError ? <Notice tone="warning" message={persistenceError} /> : null}<Section title="Choose your appearance"><SegmentedControl label="Appearance" value={preference} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }]} onChange={value => setPreference(value as ThemePreference)} /><Text style={{ color: colors.muted, fontSize: 15, lineHeight: 23 }}>System follows your device’s Light or Dark appearance. This preference is saved on this device.</Text></Section></>;
}
function CampusMemberships({ onNavigate, reveal }: Pick<Props, 'onNavigate'> & { reveal: ReturnType<typeof usePageReveal>['reveal'] }) {
  const session = useSession(), { colors } = useTheme();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [adding, setAdding] = useState(false), [name, setName] = useState('');
  const [assistantPrepared, setAssistantPrepared] = useState(false);
  const confirming = useRef(false), creating = useRef(false), takeOver = useCopilotTakeOver();
  const highlighted = useCopilotActiveAction('prepare_campus_create');
  const attempt = useRef<{ id: string; name: string; schoolId?: string } | null>(null);
  const endpoint = '/api/v1/onboarding/workspaces/';
  const live = session.environment.mode === 'live' && !session.environment.unavailable && !session.publicDemo;
  const capacity = useApi<{ count: number; limit: number }>(live ? endpoint : null);
  const roomAvailable = live && capacity.isSuccess && !capacity.error && !!capacity.data && capacity.data.count < capacity.data.limit;
  const capture = useOperationContext(JSON.stringify([session.scopeKey, adding, name.trim(), roomAvailable]));
  const canPrepare = roomAvailable && !busy && !attempt.current && !confirming.current && (!name.trim() || assistantPrepared);
  const createCampusTarget = useCopilotTarget('prepare_campus_create', { enabled: canPrepare && !adding, reveal });
  const campusNameBefore = useCopilotTarget('prepare_campus_create', { enabled: canPrepare && adding, reveal });
  const campusNameAfter = useCopilotTarget('prepare_campus_create', { enabled: adding && !busy, stage: 'after', reveal });
  const campusNameTarget = useCallback<typeof campusNameBefore>(node => {
    campusNameBefore(node);
    campusNameAfter(node);
  }, [campusNameBefore, campusNameAfter]);
  useCopilotAction({
    name: 'prepare_campus_create', label: 'Prepare the new campus form',
    sourceKey: JSON.stringify([session.scopeKey, capacity.data?.count, capacity.data?.limit]), available: canPrepare,
    run(args, signal) {
      if (signal.aborted || !canPrepare || Object.keys(args).some(key => key !== 'name')) return false;
      const proposed = args.name;
      if (proposed !== undefined && (typeof proposed !== 'string' || proposed !== proposed.trim() ||
        proposed.length < 2 || proposed.length > 180 || /[<>\p{Cc}]/u.test(proposed))) return false;
      if (name.trim() && name.trim() !== proposed) return false;
      if (typeof proposed === 'string' && !name.trim()) setName(proposed);
      setAssistantPrepared(true);
      setAdding(true);
      setError('');
      return true;
    },
  });
  useScreenExitGuard({ blocked: busy });

  const select = async (id: string) => {
    if (busy) return;
    takeOver();
    setBusy(true); setError('');
    try { await session.selectSchool(id); onNavigate('/today'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The campus could not be selected.'); }
    finally { setBusy(false); }
  };
  const create = async () => {
    if (!live || busy || creating.current || name.trim().length < 2) return;
    creating.current = true;
    const request = attempt.current ?? { id: randomUUID(), name: name.trim() };
    attempt.current = request;
    setBusy(true); setError('');
    let handoff: CampusSetupHandoff | undefined;
    try {
      if (!request.schoolId) {
        const result = await apiFetch<{ school_id: string }>(endpoint, {
          method: 'POST', body: JSON.stringify({ request_id: request.id, name: request.name }),
        });
        request.schoolId = result.school_id;
      }
      if (session.user?.id) {
        handoff = { actorId: session.user.id, schoolId: request.schoolId, origin: getApiOrigin(), expires: Date.now() + 60_000 };
        campusSetupHandoff = handoff;
      }
      await session.selectSchool(request.schoolId);
      attempt.current = null;
    } catch (cause) {
      if (handoff && campusSetupHandoff === handoff) campusSetupHandoff = undefined;
      setError(cause instanceof Error ? cause.message : 'The campus could not be created.');
      void capacity.refetch();
    } finally { creating.current = false; setBusy(false); }
  };

  const submit = () => {
    takeOver();
    if (!assistantPrepared || attempt.current) { void create(); return; }
    const proposed = name.trim();
    if (!roomAvailable || busy || confirming.current || proposed.length < 2) return;
    let check: () => void;
    try { check = capture(); } catch { return; }
    confirming.current = true;
    const dismiss = () => { confirming.current = false; };
    Alert.alert('Create this campus?', `Create “${proposed}” as a private campus workspace and start its setup.`, [
      { text: 'Keep editing', style: 'cancel', onPress: dismiss },
      { text: 'Create campus', onPress: () => {
        dismiss();
        try { check(); } catch { return; }
        void create();
      } },
    ], { cancelable: true, onDismiss: dismiss });
  };

  return <>
    {error ? <Notice tone="danger" message={error} /> : null}
    <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 23 }}>Your profile is shared across these memberships. Campus responsibilities and official person records are managed by each campus.</Text>
    {session.memberships.length ? <Section title="Memberships"><ListGroup inset>{session.memberships.map((membership, index) =>
      <Row key={membership.id} variant="plain" separator={index > 0} icon="building" title={membership.school_name}
        status={membership.school_id === session.schoolId ? 'Current campus' : undefined}
        onPress={membership.school_id === session.schoolId || busy ? undefined : () => void select(membership.school_id)} />)}</ListGroup></Section>
      : <Empty title="No campus membership yet" message="Accept a campus invitation, or continue setting up your own campus." />}
    {session.setupRequired ? <Button title="Continue campus setup" onPress={() => onNavigate('/onboarding/start')} /> : null}
    {live && capacity.data ? <Section title="Your campus workspaces">
      <Text style={{ color: colors.muted }}>{capacity.data.count} of {capacity.data.limit} created</Text>
      {adding ? <>
        <View ref={campusNameTarget} collapsable={false} style={highlighted ? { borderWidth: 1, borderColor: colors.action, borderRadius: 16, padding: 4 } : undefined}>
          <Field label="Campus name" value={name} onChangeText={value => { takeOver(); setName(value); }} maxLength={180} editable={!busy && !attempt.current} />
        </View>
        <Button title={attempt.current ? 'Retry campus setup' : 'Create campus'} busy={busy}
          disabled={name.trim().length < 2 || assistantPrepared && !attempt.current && !roomAvailable} onPress={submit} />
        {!attempt.current ? <Button title="Cancel" kind="secondary" disabled={busy} onPress={() => { takeOver(); setAdding(false); setAssistantPrepared(false); setName(''); }} /> : null}
      </> : capacity.data.count < capacity.data.limit ? <View ref={createCampusTarget} collapsable={false}><Button title="Create a campus" disabled={busy} onPress={() => { takeOver(); setAdding(true); }} /></View> : null}
    </Section> : live && capacity.error ? <Empty title="Campus limit could not be checked" onRetry={() => void capacity.refetch()} /> : null}
  </>;

}
