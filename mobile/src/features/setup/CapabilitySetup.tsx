import { iconForDestination } from '../../ui/icon-semantics';
import { useEffect, useRef, useState } from 'react';
import type { CapabilityReadiness, ProgressiveSetup, ProgressiveWorkspace } from '../../../../packages/contracts/src/onboarding';
import { useSession } from '../../auth/SessionProvider';
import { apiFetch, captureApiContext } from '../../lib/api';
import { useApi } from '../../lib/query';
import { capabilityDestination, currentSetup, setupDestination } from '../../lib/onboarding-policy';
import { ScreenBack, useCampusNavigation, useScreenExitGuard } from '../../ui/BackNavigation';
import { ControlButton, InfoDisclosure } from '../../ui/DomainControls';
import { Button, Empty, Field, Loading, Notice, Page, Row, Section } from '../../ui/components';
import type { OnboardingProps } from '../OnboardingScreen';
import { GateStart } from './GateStart';

export function CapabilitySetup({ href, onNavigate, workspace, onRefresh }: OnboardingProps & { workspace: ProgressiveWorkspace; onRefresh: () => void }) {
  const session = useSession(), { complete } = useCampusNavigation(href), school = session.schoolId;
  const source = useApi<ProgressiveSetup>(school ? `/api/v1/schools/${school}/get-started/` : null);
  const data = !source.isError ? currentSetup(workspace, source.data, school) : null;
  const params = new URL(href, 'https://thatcampus.invalid').searchParams, task = params.get('task'), configure = params.get('configure');
  const all = data ? [...data.working_now, ...data.useful_next, ...data.available_anytime] : [], item = all.find(value => value.capability === task);
  const [nameOpen, setNameOpen] = useState(false), [name, setName] = useState(workspace.workspace?.profile_named ? workspace.workspace.display_name : ''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const didRedirect = useRef('');
  const sourceTarget = item?.capability === 'attendance' && item.status !== 'working' ? '/areas/timetable/planning?create=attendance' : item && ['assignments', 'fees', 'resources', 'facilities', 'accommodation', 'dining'].includes(item.capability) ? capabilityDestination(item) : null;
  useEffect(() => { if (sourceTarget && didRedirect.current !== sourceTarget) { didRedirect.current = sourceTarget; complete(sourceTarget); } }, [sourceTarget, complete]);
  useScreenExitGuard({ blocked: busy, dirty: nameOpen && name !== (workspace.workspace?.profile_named ? workspace.workspace.display_name : '') });
  async function rename() {
    if (busy || session.environment.mode !== 'live' || name.trim().length < 2) return;
    setBusy(true); setError('');
    try { const context = captureApiContext(); await apiFetch('/api/v1/onboarding/workspace-profile/', { method: 'PATCH', body: JSON.stringify({ display_name: name.trim() }) }); context.assertCurrent(); setNameOpen(false); onRefresh(); await session.refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Campus name could not be saved.'); }
    finally { setBusy(false); }
  }
  const refresh = () => { onRefresh(); void source.refetch(); };
  if (source.isPending) return <Page title="Campus setup"><Loading /></Page>;
  if (!data) return <Page title="Campus setup"><Empty title="Your current setup could not be confirmed" message={source.error?.message} onRetry={refresh} /></Page>;
  if (task === 'gate' && item && (item.status !== 'working' || configure === 'gate')) return <GateStart key={school} {...{ href, onNavigate, data }} onSaved={value => complete(setupDestination(value.destination))} />;
  if (task && !item) return <Page title="Setup step unavailable"><ScreenBack fallbackHref="/more/setup/capabilities" title="Campus setup" /><Empty title="Choose a current starting point" message="Your responsibilities or available starting points may have changed." onRetry={refresh} /></Page>;
  if (item) return <Page title={item.label}><ScreenBack fallbackHref="/more/setup/capabilities" title="Campus setup" />{sourceTarget ? <Loading label="Opening the owning workspace…" /> : <><Notice message={item.status === 'working' ? 'Ready to use. Its owner confirms your current access when opened.' : 'Start with the essentials; add detail when it becomes useful.'} />{item.missing.length ? <Section title="What’s needed">{item.missing.map(value => <Row key={value.key} title={value.label} detail={value.reason} onPress={() => onNavigate(setupDestination(value.destination))} />)}</Section> : <Button title={`Open ${item.label.toLowerCase()}`} onPress={() => onNavigate(setupDestination(item.destination))} />}{item.status === 'working' && task === 'gate' ? <ControlButton title="Set up another entry point" onPress={() => onNavigate('/more/setup/capabilities?task=gate&configure=gate')} /> : null}</>}<ControlButton title="Set up later" onPress={() => onNavigate('/today')} /></Page>;
  function group(title: string, values: CapabilityReadiness[]) { return values.length ? <Section title={title}>{values.map(value => <Row key={value.capability} icon={iconForDestination(value.destination, value.capability)} iconDestination={value.destination} title={value.label} detail={value.missing[0]?.reason ?? 'Open your current workspace'} onPress={() => { if (!busy) onNavigate(capabilityDestination(value)); }} />)}</Section> : null; }
  return <Page title={data.working_now.length ? 'Your campus setup' : 'Choose your next step'} subtitle="Start with what you need today. Add more when it becomes useful." refreshing={source.isRefetching} onRefresh={refresh}>
    <Row title="Set up the whole campus" detail="Build a campus view and connect useful places." icon="campus" onPress={() => onNavigate('/more/setup/whole-campus')} />
    {group('Working now', data.working_now)}{group('Useful next', data.useful_next)}
    <InfoDisclosure title="More campus options">{group('Available anytime', data.available_anytime)}<ControlButton title="Change my starting points" onPress={() => onNavigate('/onboarding/start')} /></InfoDisclosure>
    {session.environment.mode === 'live' ? <Section title="Campus details"><ControlButton title={workspace.workspace?.profile_named ? 'Edit campus name' : 'Add your campus name'} disabled={busy} onPress={() => setNameOpen(!nameOpen)} />{nameOpen ? <><Field label="Campus name" value={name} onChangeText={setName} maxLength={180} editable={!busy} autoComplete="organization" /><Button title="Save name" busy={busy} disabled={name.trim().length < 2} onPress={() => { void rename(); }} /></> : null}<Row title="Organisation verification" detail="Not needed for private campus work." icon="verification" onPress={() => onNavigate('/more/verification')} /></Section> : null}
    {error ? <Notice tone="danger" message={error} /> : null}<ControlButton title="Set up later" onPress={() => onNavigate('/today')} />
  </Page>;
}
