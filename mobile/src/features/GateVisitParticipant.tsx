import { Text, View } from 'react-native';
import { CheckCircleIcon } from 'phosphor-react-native/src/icons/CheckCircle';
import { XCircleIcon } from 'phosphor-react-native/src/icons/XCircle';
import { useApi } from '../lib/query';
import { participantVisitHref, readVisitParticipant, readVisitParticipantList } from '../lib/visit-participant';
import { ScreenBack } from '../ui/BackNavigation';
import { ControlButton } from '../ui/DomainControls';
import { Empty, Loading, Notice, Page, Row } from '../ui/components';
import { useTheme } from '../ui/theme';
import { VisitDetailCard, VisitPlanNotice } from './GateVisitDetails';
import { gateSharedVisitTime } from './GateSharedVisitPolicy';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const baseHref = '/areas/in-out/visits?participant=1';
export function GateVisitParticipant({ href, schoolId, onNavigate }: { href: string; schoolId: string; onNavigate(href: string): void }) {
  const { colors } = useTheme(), query = new URLSearchParams(href.split('?')[1] ?? ''), visits = query.getAll('visit'), pages = query.getAll('page'), id = visits[0] ?? '';
  const page = pages.length ? Number(pages[0]) : 1;
  const valid = query.getAll('participant').length === 1 && query.get('participant') === '1' && visits.length <= 1 && (!visits.length || uuid.test(id))
    && pages.length <= 1 && Number.isSafeInteger(page) && page >= 1 && page <= 2147483647;
  const root = `/api/v1/gate/schools/${encodeURIComponent(schoolId)}/visit-arrangements`, data = useApi<unknown>(valid ? id ? `${root}/${encodeURIComponent(id)}/participant/` : `${root}/registered/?page=${page}` : null);
  let detail: ReturnType<typeof readVisitParticipant> | null = null, list: ReturnType<typeof readVisitParticipantList> | null = null, invalid = '';
  if (valid && data.data && !data.error) try { if (id) detail = readVisitParticipant(data.data, id); else list = readVisitParticipantList(data.data, page); }
  catch (cause) { invalid = cause instanceof Error ? cause.message : 'Your visit could not be confirmed.'; }
  const header = detail ? <View style={{ gap: 12, marginTop: 8, marginBottom: 12 }}>
    <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 18, letterSpacing: 1, fontWeight: '600' }}>YOUR VISIT</Text>
    <Text accessibilityRole="header" aria-level={1} style={{ color: colors.ink, fontSize: 36, lineHeight: 44, fontWeight: '700', letterSpacing: -1 }}>{detail.visit.title}</Text>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{detail.visit.state === 'cancelled' ? <XCircleIcon size={24} weight="fill" color={colors.danger} /> : <CheckCircleIcon size={24} weight="fill" color={colors.positive} />}</View><Text style={{ color: detail.visit.state === 'cancelled' ? colors.danger : colors.positive, fontSize: 16, lineHeight: 24, flex: 1, fontWeight: '600' }}>{detail.visit.state === 'cancelled' ? 'Visit cancelled' : 'Registration confirmed'}</Text></View>
    <Text style={{ color: colors.muted, fontSize: 16, lineHeight: 24 }}>{detail.registration.person_label}</Text>
  </View> : undefined;
  return <Page title={detail?.visit.title ?? 'Your visits'} subtitle={id ? undefined : 'Visits you have registered for'} header={header} maxWidth={700} refreshing={data.isRefetching} onRefresh={() => { void data.refetch(); }}>
    <ScreenBack title={id ? 'Back to your visits' : 'Back to In & Out'} fallbackHref={id ? baseHref : '/areas/in-out'} />
    {!valid ? <Empty title="This visitor link is unavailable" message="Open the original visit from your registered visits." /> : data.isPending ? <Loading /> : data.error || invalid ? <Empty title="Visitor access could not be confirmed" message={data.error?.message || invalid} onRetry={() => { void data.refetch(); }} /> : detail ? <>
      <VisitDetailCard visit={detail.visit} timezone={detail.timezone} /><VisitPlanNotice />
      <Notice message={`Your registration was saved on ${gateSharedVisitTime(detail.registration.registered_at, detail.timezone)}. Registration is separate from entry permission and recorded arrival.`} />
      <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}>Available until {gateSharedVisitTime(detail.available_until, detail.timezone)}</Text>
    </> : list ? <>
      {!list.visits.length ? <Empty title="No registered visits" message="Use the invitation shared by your campus contact to register for a visit." /> : list.visits.map(visit => <Row key={visit.id} title={visit.title} detail={`${gateSharedVisitTime(visit.starts_at, list.timezone)} – ${gateSharedVisitTime(visit.ends_at, list.timezone)}`} status={visit.state === 'cancelled' ? 'Cancelled' : 'Registered'} icon="visits" onPress={() => onNavigate(participantVisitHref(visit.id))} />)}
      {page > 1 || page < list.pagination.total_pages ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}><ControlButton title="Previous" disabled={page <= 1} onPress={() => onNavigate(`${baseHref}&page=${page - 1}`)} /><Text style={{ color: colors.muted }}>Page {page}</Text><ControlButton title="Next" disabled={page >= list.pagination.total_pages} onPress={() => onNavigate(`${baseHref}&page=${page + 1}`)} /></View> : null}
    </> : null}
  </Page>;
}
