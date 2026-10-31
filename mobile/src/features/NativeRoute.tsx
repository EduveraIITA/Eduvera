import { iconForDestination } from '../ui/icon-semantics';
import { AssistantRouteActivation } from '../ui/AssistantRouteActivation';
import { Fragment, useMemo } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useSession } from '../auth/SessionProvider';
import { useCampusNavigation } from '../ui/BackNavigation';
import { nativeRouteHref } from '../lib/route-state';
import { resolveNativeAreaDestination } from '../lib/native-area-destination';
import { useApi } from '../lib/query';
import { assertWorkspaceManifestContext, normalizeWorkspaceManifest } from '../../../packages/contracts/src/workspace-normalizer';
import { Button, Empty, Loading, Notice, Page, Row, Section } from '../ui/components';
import { AccountScreen } from './AccountScreen';
import { AccountConnectionsScreen } from './AccountConnectionsScreen';
import { MorePoliciesScreen } from './MorePoliciesScreen';
import { TeachingFeedbackScreen } from './TeachingFeedbackScreen';
import { OrganizationVerificationScreen } from './OrganizationVerificationScreen';
import { AttendanceScreen } from './AttendanceScreen';
import { AttendanceRecordsScreen } from './AttendanceRecordsScreen';
import { AttendanceEvidenceScreen } from './AttendanceEvidenceScreen';
import { AttendanceLeaveScreen } from './AttendanceLeaveScreen';
import { AttendanceInsightsScreen } from './AttendanceInsightsScreen';
import { PeopleScreen } from './PeopleScreen';
import { ScheduleScreen } from './ScheduleScreen';
import { MessagesScreen, MessageReportsScreen } from './MessagesScreen';
import { ResourcesScreen } from './ResourcesScreen';
import { FacilitiesScreen } from './FacilitiesScreen';
import { NotificationsScreen } from './NotificationsScreen';
import { UpdatesScreen } from './UpdatesScreen';
import { OnboardingScreen } from './OnboardingScreen';
import { WorkspaceSetupOverviewScreen } from './WorkspaceSetupOverviewScreen';
import { SimulationScreen } from './SimulationScreen';
import { DiningScreen } from './DiningScreen';
import { AccommodationScreen } from './AccommodationScreen';
import { StaffWorkScreen } from './StaffWorkScreen';
import { GateScreen } from './GateScreen';
import { FeesScreen } from './FeesScreen';
import { AssessmentsScreen } from './AssessmentsScreen';
import { CampusScreen } from './CampusScreen';
import { DepartureScreen } from './DepartureScreen';
import { EventsScreen } from './EventsScreen';
import { LearningScreen } from './LearningScreen';
import { InsightsScreen } from './InsightsScreen';
import { ReportsScreen } from './ReportsScreen';
import { CareScreen } from './CareScreen';
import { GovernanceScreen } from './GovernanceScreen';
import { OrganizationScreen } from './OrganizationScreen';
import { InstitutionSetupScreen } from './InstitutionSetupScreen';
import { PeopleAcademicClasses } from './PeopleAcademicClasses';
import { PeopleAcademicSetup } from './PeopleAcademicSetup';
import { PeopleAcademicImport } from './PeopleAcademicImport';
import { PeopleAcademicRecords } from './PeopleAcademicRecords';
import { PeopleAccessScreen } from './PeopleAccessScreen';
import { PeopleSetupScreen } from './PeopleSetupScreen';
import { InvitationsScreen } from './InvitationsScreen';
import { WholeCampusGuide } from './WholeCampusGuide';
import { CampusTopologyScreen } from './CampusTopologyScreen';

export function NativeRoute({ section }: { section: 'areas' | 'work' | 'more' }) {
  const params = useLocalSearchParams<{ path: string[] }>(); const session = useSession();
  const { path, href } = nativeRouteHref(section, params);
  const { onNavigate } = useCampusNavigation(href);
  const props = { href, onNavigate };
  if (session.environment.unavailable && !path.startsWith('/more/simulation') && !path.startsWith('/more/account')) return <Page title="Your simulation is unavailable"><Notice tone="warning" message="The selected simulation could not be confirmed. Return to Live or recover it before continuing." /><Button title="Open Simulation" onPress={() => onNavigate('/more/simulation')} /></Page>;
  const body = path === '/areas/assistant/conversation' ? <AssistantRouteActivation href={href} />
    : path.startsWith('/more/account') ? <AccountScreen {...props} />
    : path === '/more/connections' ? <AccountConnectionsScreen {...props} />
    : path === '/more/policies' ? <MorePoliciesScreen {...props} />
    : path === '/more/feedback' ? <TeachingFeedbackScreen {...props} />
    : path === '/more/verification' ? <OrganizationVerificationScreen {...props} />
    : path === '/more/governance' ? <GovernanceScreen {...props} />
    : path === '/more/notifications' ? <NotificationsScreen {...props} />
    : /^\/more\/setup\/responsibilities\/[^/]+$/.test(path) && new URLSearchParams(href.split('?')[1] ?? '').get('context') === 'work' ? <PeopleScreen {...props} />
    : path === '/more/setup/responsibilities' || /^\/more\/setup\/responsibilities\/[^/]+$/.test(path) ? <StaffWorkScreen {...props} />
    : path === '/more/setup' ? <WorkspaceSetupOverviewScreen {...props} />
    : path === '/more/setup/capabilities' ? <OnboardingScreen {...props} />
    : path === '/more/setup/people' ? <PeopleSetupScreen {...props} />
    : path === '/more/setup/people/access' ? <PeopleAccessScreen {...props} />
    : path === '/more/setup/people/invitations' ? <InvitationsScreen {...props} />
    : path === '/more/setup/whole-campus' ? <WholeCampusGuide {...props} />
    : path === '/more/setup/organization' ? <OrganizationScreen {...props} />
    : path === '/more/setup/institution/campus' ? <CampusTopologyScreen {...props} />
    : path === '/more/setup/institution/academics' ? <PeopleAcademicSetup {...props} />
    : /^\/more\/setup\/institution(?:\/(?:history|promotion|operating-rules))?$/.test(path) ? <InstitutionSetupScreen {...props} />
    : path.startsWith('/more/simulation') ? <SimulationScreen {...props} />
    : path.startsWith('/more/virtual-campus') || path.startsWith('/areas/campus-view') ? <CampusScreen {...props} />
    : path.startsWith('/areas/attendance/registers') || path === '/areas/attendance/coordination' ? <AttendanceScreen {...props} />
    : path === '/areas/attendance/records' && !['eligibility', 'copilot'].includes(new URLSearchParams(href.split('?')[1] ?? '').get('view') ?? '') ? <AttendanceRecordsScreen {...props} />
    : path === '/areas/attendance/thresholds' || path === '/areas/attendance/follow-ups' || path === '/areas/attendance/records' ? <AttendanceInsightsScreen {...props} />
    : path === '/areas/attendance/evidence' ? <AttendanceEvidenceScreen {...props} />
    : path === '/areas/attendance/leave' || path === '/areas/attendance/leave/review' ? <AttendanceLeaveScreen {...props} />
    : path === '/areas/people/import' ? <PeopleAcademicImport {...props} />
    : path === '/areas/people/records' && !new URLSearchParams(href.split('?')[1] ?? '').get('student') ? <PeopleAcademicRecords {...props} />
    : /^\/areas\/people\/(participants|groups)(\/|$)/.test(path) || path === '/areas/people/records' ? <PeopleScreen {...props} />
    : /^\/areas\/people\/classes(?:\/|$)/.test(path) ? <PeopleAcademicClasses {...props} />
    : path === '/areas/calendar' || path === '/areas/timetable/schedule' || path.startsWith('/areas/timetable/planning') ? <ScheduleScreen {...props} />
    : path.startsWith('/areas/messages/conversations') ? <MessagesScreen {...props} />
    : path === '/areas/care/concerns' && new URLSearchParams(href.split('?')[1] ?? '').get('section') === 'message_reports' ? <MessageReportsScreen {...props} />
    : path === '/areas/care/concerns' ? <CareScreen {...props} />
    : path.startsWith('/areas/messages/updates') ? <UpdatesScreen {...props} />
    : path.startsWith('/areas/resources') ? <ResourcesScreen {...props} />
    : path.startsWith('/areas/facilities') ? <FacilitiesScreen {...props} />
    : path.startsWith('/areas/dining') ? <DiningScreen {...props} />
    : path.startsWith('/areas/accommodation') ? <AccommodationScreen {...props} />
    : path.startsWith('/areas/responsibilities') || path === '/work/staff-leave' ? <StaffWorkScreen {...props} />
    : path.startsWith('/areas/in-out') || path === '/work/in-out/approvals' ? <GateScreen {...props} />
    : path.startsWith('/areas/fees') || path.startsWith('/work/fee-reviews') ? <FeesScreen {...props} />
    : path === '/areas/reports' || path === '/areas/reports/progress' || path === '/areas/reports/remarks' ? <ReportsScreen {...props} />
    : path.startsWith('/areas/assessments') || path.startsWith('/areas/results') ? <AssessmentsScreen {...props} />
    : (path === '/areas/insights' || path.startsWith('/areas/insights/')) ? <InsightsScreen {...props} />
    : path.startsWith('/areas/departure') ? <DepartureScreen {...props} />
    : path.startsWith('/areas/events') ? <EventsScreen {...props} />
    : path.startsWith('/areas/messages/assignments') || path.startsWith('/areas/messages/diary') || path.startsWith('/areas/timetable/session') || path.startsWith('/areas/learning') ? <LearningScreen {...props} />
    : <AreaDestination {...props} />;
  return <Fragment key={`${session.scopeKey}:${path}`}>{body}</Fragment>;
}
function AreaDestination({ href, onNavigate }: { href: string; onNavigate: (href: string) => void }) {
  const { user, schoolId, environment } = useSession();
  const query = useApi<unknown>(schoolId ? '/api/v1/workspace' : null);
  const path = href.split('?')[0]!;
  const resolved = useMemo(() => {
    if (!query.data) return null;
    try { const value = normalizeWorkspaceManifest(query.data); assertWorkspaceManifestContext(value, { actorUserId: user?.id ?? '', institutionId: schoolId ?? '', environment }); return value; } catch { return null; }
  }, [query.data, user?.id, schoolId, environment]);
  if (query.isPending) return <Page title="Your workspace"><Loading /></Page>;
  if (query.error || !resolved) return <Page title="Your workspace"><Empty title="This workspace could not be confirmed" message={query.error?.message} onRetry={() => { void query.refetch(); }} /></Page>;
  const destination = resolveNativeAreaDestination(resolved, href);
  const area = destination.state === 'unavailable' ? undefined : destination.area;
  const surface = destination.state === 'selected' ? destination.surface : undefined;
  const more = resolved.more.groups?.flatMap(group => group.items).find(item => item.href.split('?')[0] === path);
  const surfaces = destination.state === 'landing' ? destination.surfaces : [];
  if (path.startsWith('/areas/') && destination.state === 'unavailable') return <Page title="Campus workspace"><Empty title="This workspace is unavailable" message="The selected destination is not part of your current workspace." /></Page>;
  return <Page title={surface?.label ?? area?.label ?? more?.label ?? 'Campus workspace'} subtitle={surface?.description ?? area?.description ?? more?.description ?? undefined}>
    {surfaces.length ? <Section title="Choose your work">{surfaces.map(item => <Row key={`${item.key}:${item.href}`} icon={iconForDestination(item.href, area?.icon ?? item.key)} iconDestination={item.href} title={item.label} detail={item.description} onPress={() => onNavigate(item.href)} />)}</Section>
      : <Empty title={destination.state === 'landing' ? 'No available work' : 'This screen is not available yet'} message={destination.state === 'landing' ? 'There is no work available here through your current responsibilities.' : 'This destination has no current app screen.'} />}
  </Page>;
}
