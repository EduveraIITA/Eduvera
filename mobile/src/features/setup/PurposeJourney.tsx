import { iconForDestination } from '../../ui/icon-semantics';
import { useState } from 'react';
import { Text } from 'react-native';
import { useRouter } from 'expo-router';
import type { ProgressiveWorkspace } from '../../../../packages/contracts/src/onboarding';
import { useSession } from '../../auth/SessionProvider';
import { apiFetch, captureApiContext } from '../../lib/api';
import { ApiError } from '../../lib/api-client';
import { selectedStartingGoals, startingGoalsRequest } from '../../lib/onboarding-policy';
import { ScreenBack, useScreenExitGuard } from '../../ui/BackNavigation';
import { ChoiceMenu, ControlButton } from '../../ui/DomainControls';
import { Button, Notice, Page, Row, Section } from '../../ui/components';
import { useTheme } from '../../ui/theme';
import type { OnboardingProps } from '../OnboardingScreen';

export function PurposeJourney({ href, onNavigate, data }: OnboardingProps & { data: ProgressiveWorkspace }) {
  const session = useSession(), { colors } = useTheme(), router = useRouter(), params = new URL(href, 'https://thatcampus.invalid').searchParams;
  const [selected, setSelected] = useState(() => selectedStartingGoals(params.get('goals')?.split(',') ?? data.goals.selected, data));
  const [primary, setPrimary] = useState<string>(data.goals.primary ?? ''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [unknown, setUnknown] = useState(false);
  const connected = params.get('step') === 'connect' && selected.length > 0, first = selected.includes(primary) ? primary : selected[0] ?? '';
  const live = session.environment.mode === 'live' && session.user?.email_verified !== false;
  useScreenExitGuard({ blocked: busy, dirty: selected.join(',') !== data.goals.selected.join(',') });
  const back = connected ? `${href.split('?')[0]}?goals=${encodeURIComponent(selected.join(','))}` : data.workspace ? '/more/setup/capabilities' : undefined;
  function choose(key: string) { if (busy || unknown) return; const value = selected.includes(key) ? selected.filter(item => item !== key) : [...selected, key]; setSelected(value); router.setParams({ goals: value.join(',') }); }
  async function start(whole = false) {
    if (!live || busy || unknown) return;
    setBusy(true); setError(''); let sent = false;
    try {
      const context = captureApiContext();
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const request = whole ? { path: '/api/v1/onboarding/workspace/', method: 'POST', body: { guidance: 'whole_campus', timezone } }
        : startingGoalsRequest(selected, first, data, timezone);
      sent = true;
      await apiFetch(request.path, { method: request.method, body: JSON.stringify(request.body) });
      context.assertCurrent();
      const target = whole ? '/more/setup/whole-campus' : `/more/setup/capabilities?task=${encodeURIComponent(first)}`;
      await session.refresh(); router.replace(target as never);
    } catch (cause) { if (sent && (!(cause instanceof ApiError) || cause.status >= 500 || [408, 409, 429].includes(cause.status))) setUnknown(true); setError(cause instanceof Error ? cause.message : 'Your starting point could not be confirmed.'); }
    finally { setBusy(false); }
  }
  return <Page title={connected ? 'Your campus starts here' : 'What would you like to run?'} subtitle={connected ? 'Choose your first activity. The rest stays ready to add.' : 'Choose one or several. Every capability stays available as your campus grows.'}>
    {back ? <ScreenBack fallbackHref={back} title={connected ? 'Starting points' : 'Campus setup'} disabled={busy} /> : null}
    {!live ? <><Notice message="Confirm your email before creating or changing your campus." /><ControlButton title="Open account security" onPress={() => onNavigate('/more/account/security')} /></> : null}
    {error ? <Notice tone="danger" message={error} /> : null}
    {unknown ? <><Notice tone="warning" message="The result is unconfirmed. Check your current workspace before making another setup request; this action has not been repeated." /><ControlButton title="Check current workspace" onPress={() => { void session.refresh(); }} /></> : null}
    {connected ? <><Section title="Start with"><ChoiceMenu label="First activity" value={first} options={selected.map(key => ({ value: key, label: data.catalogue.find(item => item.key === key)?.label ?? key }))} onChange={setPrimary} disabled={busy || unknown} /></Section><Button title={`Start with ${data.catalogue.find(item => item.key === first)?.label.toLowerCase() ?? 'this activity'}`} busy={busy} disabled={!live || unknown} onPress={() => { void start(); }} /></> : <>
      <Section title="Starting points">{data.catalogue.filter(item => item.selection_kind === 'goal').map(item => <Row key={item.key} icon={iconForDestination(item.destination, item.key)} iconDestination={item.destination} title={item.label} detail={item.description} status={selected.includes(item.key) ? 'Selected' : undefined} onPress={() => choose(item.key)} />)}</Section>
      <Button title={`Continue${selected.length ? ` · ${selected.length} selected` : ''}`} disabled={!selected.length || busy || unknown} onPress={() => onNavigate(`${href.split('?')[0]}?step=connect&goals=${encodeURIComponent(selected.join(','))}`)} />
      <ControlButton title="Set up the whole campus" disabled={!live || busy || unknown} onPress={() => { void start(true); }} />
      <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 23 }}>One shared campus, with people and records reused across your work.</Text>
      <ControlButton title="Joining someone else’s campus? Use your invitation" disabled={busy} onPress={() => router.push('/join' as never)} />
      <ControlButton title="Explore the demo" disabled={busy} onPress={() => router.push('/demo' as never)} />
    </>}
  </Page>;
}
