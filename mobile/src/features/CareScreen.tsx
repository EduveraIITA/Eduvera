import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { assertWorkspaceManifestContext, normalizeWorkspaceManifest } from '../../../packages/contracts/src/workspace-normalizer';
import { useSession } from '../auth/SessionProvider';
import { careCurrentInstant, careHref, careLabel, careRoot, careRoute, parseCareWorkspace } from '../lib/care-native';
import { useCareJournal, useCareRead } from '../lib/use-care-native';
import { nativeCalendarDay } from '../lib/native-calendar';
import { useApi } from '../lib/query';
import { ScreenBack, useCampusNavigation, useScreenExitGuard } from '../ui/BackNavigation';
import { ControlButton, Facts, SegmentedControl } from '../ui/DomainControls';
import { Empty, ListGroup, Loading, Notice, Page, Row, Section } from '../ui/components';
import { CareRecovery, CareSafety, CareText, CareUnavailable, type CarePaneProps } from './CareUI';
import { CareIntakePane, CareCasePane } from './CareForms';
import { CareTeamPane } from './CareTeam';

type Props = { href: string; onNavigate(href: string): void };
export function CareScreen(props: Props) {
  const session = useSession(), route = careRoute(props.href), query = useApi<unknown>(session.schoolId ? '/api/v1/workspace' : null);
  const manifest = useMemo(() => { try { if (!query.data || !session.user || !session.schoolId) return null; const manifest = normalizeWorkspaceManifest(query.data); assertWorkspaceManifestContext(manifest, { actorUserId: session.user.id, institutionId: session.schoolId, environment: session.environment }); return manifest; } catch { return null; } }, [query.data, session.user?.id, session.schoolId, session.environment]);
  if (!route) return <Page title="Student care"><Empty title="This protected care link is incomplete" message="Open the exact current concern from your private Care workspace or notification." /></Page>;
  if (!session.schoolId || !session.user) return <Page title="Student care"><Empty title="Choose a campus" /></Page>;
  if (query.isPending) return <Page title="Student care"><Loading /></Page>;
  if (!manifest) return <Page title="Student care"><Empty title="Care access could not be confirmed" message={query.error?.message} onRetry={() => void query.refetch()} /></Page>;
  const concerns = manifest.areas.find(area => area.key === 'care')?.surfaces.find(surface => surface.key === 'concerns' && surface.href.split('?')[0] === '/areas/care/concerns');
  if (!concerns) return <Page title="Student care"><Empty title="Protected care is unavailable in this workspace" /></Page>;
  const canReviewReports = concerns.capabilities.some(capability => capability === 'safeguarding.review' || capability === 'safeguarding.manage');
  return <CareWorkspaceScope key={session.scopeKey} {...props} schoolId={session.schoolId} scopeKey={session.scopeKey} campusName={manifest.context.institution_label ?? undefined} timeZone={manifest.context.time_zone ?? ''} virtualNow={manifest.context.environment.virtual_now} capabilityAvailable={!query.isError} canReviewReports={canReviewReports} retryCapability={() => void query.refetch()} />;
}
function CareWorkspaceScope({ href, onNavigate, schoolId, scopeKey, campusName, timeZone, virtualNow, capabilityAvailable, canReviewReports, retryCapability }: Props & { schoolId: string; scopeKey: string; campusName?: string; timeZone: string; virtualNow?: string; capabilityAvailable: boolean; canReviewReports: boolean; retryCapability(): void }) {
  const session = useSession(), cache = useQueryClient(), route = careRoute(href)!, root = careRoot(schoolId);
  const { complete } = useCampusNavigation(href);
  const controller = useCareJournal(schoolId, scopeKey), workspace = useCareRead(`${root}/workspace/`, parseCareWorkspace, capabilityAvailable);
  const [savedHref, setSavedHref] = useState(''), [teamDirty, setTeamDirty] = useState(false);
  useScreenExitGuard({ blocked: controller.busy });
  useEffect(() => { if (savedHref && !controller.busy) { setSavedHref(''); complete(savedHref); } }, [savedHref, controller.busy, complete]);
  const now = () => careCurrentInstant(session.environment.mode, virtualNow);
  let today = ''; try { today = nativeCalendarDay(now(), timeZone); } catch { /* A missing clock blocks time-bearing commands. */ }
  const refreshWorkspace = async () => { const assertCurrent = controller.capture(), data = await workspace.refresh(); assertCurrent(); await cache.invalidateQueries({ queryKey: ['campus', scopeKey, '/api/v1/workspace'] }); assertCurrent(); return data; };
  const title = route.creating ? 'Record a concern' : route.caseId ? 'Concern details' : 'Student care';
  const listHref = careHref(href, { section: 'cases' });
  const data = workspace.value ?? workspace.data, available = capabilityAvailable && !!workspace.value && !workspace.isError;
  const shared = data ? { schoolId, scopeKey, href, controller, workspace: data, available, refreshWorkspace, onNavigate, onSavedNavigate: setSavedHref, now, today } satisfies CarePaneProps : null;
  const confirmed = async () => { await refreshWorkspace(); };
  const selectSection = (section: string) => {
    if (!available || controller.busy || teamDirty) return;
    if (section === 'message_reports') {
      if (!canReviewReports) return;
      const destination = new URL(careHref(href, { section: 'cases', page: 1 }), 'https://thatcampus.invalid');
      destination.searchParams.set('section', 'message_reports');
      destination.searchParams.delete('report_revision');
      onNavigate(destination.pathname + destination.search);
    } else if (section === 'cases' || section === 'team' && data?.can_manage_team) onNavigate(careHref(href, { section }));
  };
  return <Page title={title} subtitle={campusName} refreshing={workspace.isRefetching} onRefresh={() => void workspace.refresh().catch(() => {})}>
    <ScreenBack fallbackHref={route.caseId || route.creating ? listHref : '/areas'} title={route.caseId || route.creating ? 'Back to care' : 'Back to Areas'} />
    <CareSafety />
    {!capabilityAvailable ? <Empty title="Care access could not be confirmed" message="Protected sources and new actions are hidden until the current workspace is confirmed. Your active-session draft is kept." onRetry={retryCapability} /> : null}
    {!controller.ready ? <Loading /> : controller.blocked ? <Notice tone="warning" message="Secure protected-receipt storage is unavailable. New saves are blocked; retained references have been kept." /> : null}
    {controller.blocked && !controller.references.length ? <ControlButton title="Retry receipt storage" onPress={() => void controller.journal.retryStorage()} /> : null}
    {controller.error ? <Notice tone="warning" message={controller.error} /> : null}
    {!data ? <>{controller.references.map(reference => <CareRecovery key={reference.commandId} {...{ controller, reference }} accepted={confirmed} />)}{workspace.isPending ? <Loading /> : <CareUnavailable error={workspace.error} retry={() => void workspace.refresh().catch(() => {})} pending={!!controller.references.length} />}</> : shared ? route.creating ? <CareIntakePane {...shared} /> : route.caseId ? <CareCasePane key={route.caseId} {...shared} caseId={route.caseId} expectedRevision={route.revision} /> : <>
      {controller.references.map(reference => <CareRecovery key={reference.commandId} {...{ controller, reference }} accepted={confirmed} resume={() => onNavigate(careHref(href, reference.kind === 'intake' ? { section: 'cases', creating: true } : reference.kind === 'recovery' ? { section: 'team' } : { section: 'cases', caseId: reference.caseId }))} />)}
      {available ? <SegmentedControl label="Restricted care sections" value={route.section} options={[{ value: 'cases', label: 'Cases' }, ...(canReviewReports ? [{ value: 'message_reports', label: 'Message reports' }] : []), ...(data.can_manage_team ? [{ value: 'team', label: 'Care team' }] : [])]} disabled={controller.busy || teamDirty} onChange={selectSection} /> : null}
        {route.section === 'team' ? data.can_manage_team ? <CareTeamPane {...shared} onDirty={setTeamDirty} /> : <Empty title="Care-team settings are unavailable with your current access" /> : available ? <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}><CareText>{data.cases.filter(item => item.status !== 'closed').length} open · {data.cases.filter(item => ['assessment_required', 'reporting_required'].includes(item.reporting_state)).length} need reporting decisions</CareText><ControlButton title="Record a concern" kind="primary" disabled={!controller.ready || controller.blocked || controller.busy || controller.references.some(reference => reference.slot === 'intake')} onPress={() => onNavigate(careHref(href, { section: 'cases', creating: true }))} /></View>
          <Facts items={[{ label: 'Primary route', value: `${data.routes.primary} available` }, { label: 'Alternate route', value: `${data.routes.alternate} available` }]} />
          <CareQueue {...shared} />
        </> : <CareUnavailable error={workspace.error} retry={() => void workspace.refresh().catch(() => {})} pending={!!controller.references.length} />}
    </> : null}
    {data && available ? <Section title="Protected record"><CareText>{data.legal_notice} Case closure does not delete evidence or prove statutory compliance.</CareText></Section> : null}
  </Page>;
}
function CareQueue({ href, workspace, onNavigate }: CarePaneProps) {
  const route = careRoute(href)!, pages = Math.max(1, Math.ceil(workspace.cases.length / 20)), page = Math.min(pages, route.page);
  return <Section title="Assigned cases">{workspace.cases.length ? <ListGroup><View style={{ paddingHorizontal: 16 }}>{workspace.cases.slice((page - 1) * 20, page * 20).map((item, index) => <Row key={item.id} variant="plain" separator={index > 0} title={item.subject_name || 'Child not selected'} detail={`${careLabel(item.concern_category)} · ${careLabel(item.urgency)}\nOwner: ${item.owner_name || 'Name unavailable'}\n${careLabel(item.reporting_state)}`} status={careLabel(item.status)} icon="security" onPress={() => onNavigate(careHref(href, { section: 'cases', caseId: item.id }))} />)}</View></ListGroup> : <Empty title="No assigned cases" message="This does not mean the institution has no concerns. You only see cases explicitly assigned to you." />}{pages > 1 ? <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}><ControlButton title="Previous" disabled={page <= 1} onPress={() => onNavigate(careHref(href, { page: page - 1 }))} /><CareText>Page {page} of {pages}</CareText><ControlButton title="Next" disabled={page >= pages} onPress={() => onNavigate(careHref(href, { page: page + 1 }))} /></View> : null}</Section>;
}
