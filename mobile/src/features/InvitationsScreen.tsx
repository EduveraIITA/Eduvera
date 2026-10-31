import { useEffect, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../auth/SessionProvider';
import { apiFetch, getApiOrigin } from '../lib/api';
import { useApi } from '../lib/query';
import { useOperationContext } from '../lib/use-operation-context';
import { useNativePendingAction } from '../lib/native-pending-action';
import { acceptedCampusInvitation, campusInvitationBody, campusInvitationDeliveryPending, campusInvitationListIdentity, campusInvitationRoles, campusInvitationSource, campusInvitationStatus, campusInvitationStatuses, campusInvitationsRoot, parseCampusInvitation, parseCampusInvitationWorkspace, resolveCampusInvitationRefresh, type CampusInvitation, type CampusInvitationRole, type CampusInvitationWorkspace } from '../lib/campus-invitations';
import { workInvitationDelivery } from '../lib/work-invitation';
import { Alert } from '../ui/Alert';
import { ScreenBack, useCampusNavigation, useScreenExitGuard } from '../ui/BackNavigation';
import { ChoiceMenu, ControlButton, Facts } from '../ui/DomainControls';
import { Button, Empty, Field, ListGroup, Loading, Notice, Page, Row, SearchField, Section } from '../ui/components';

type Props = { href: string; onNavigate(href: string): void };
const route = '/more/setup/people/invitations';
function listHref(href: string) { const q = new URL(href, 'https://thatcampus.invalid').searchParams; q.delete('create'); if (q.has('role') && !q.has('view')) q.set('view', 'history'); return `${route}${q.size ? `?${q}` : ''}`; }
const causeMessage = (cause: unknown) => cause instanceof Error ? cause.message : 'This invitation action could not be checked.';
export function InvitationsScreen(props: Props) {
  const session = useSession(), q = new URL(props.href, 'https://thatcampus.invalid').searchParams;
  if (!session.user || !session.schoolId || session.status !== 'authenticated') return <Page title="Invitations"><Empty title="Confirm your current campus" /></Page>;
  if (session.environment.mode !== 'live') return <Page title="Invitations"><ScreenBack title="Campus setup" fallbackHref="/more/setup/people" /><Notice message="App invitations and real account changes are managed in Live. This Simulation has not sent an email or changed access." /></Page>;
  if (session.publicDemo) return <Page title="Invitations"><Notice message="This sample account is read-only. Sign in with your own account to manage invitations." /></Page>;
  const invalid = ['school', 'create', 'role', 'view', 'from'].some(key => q.getAll(key).length > 1) || q.has('school') && q.get('school') !== session.schoolId || q.has('role') && !campusInvitationRoles.includes(q.get('role') as CampusInvitationRole) || q.has('create') && q.get('create') !== 'invitation' || q.has('view') && q.get('view') !== 'history';
  return invalid ? <Page title="Invitations"><Empty title="This invitation link does not match the current campus or view" message="Select its campus explicitly, then open Invitations again." /></Page> : <LiveInvitations key={session.scopeKey} {...props} schoolId={session.schoolId} />;
}
function LiveInvitations({ href, onNavigate, schoolId }: Props & { schoolId: string }) {
  const session = useSession(), cache = useQueryClient(), navigation = useCampusNavigation(href), focused = useIsFocused();
  const q = new URL(href, 'https://thatcampus.invalid').searchParams, creating = q.get('create') === 'invitation' || !q.has('view') && q.has('role'), root = campusInvitationsRoot(schoolId), readPath = `${root}workspace/`, listPath = listHref(href);
  const [role, setRole] = useState<CampusInvitationRole>((q.get('role') as CampusInvitationRole) || 'staff'), [target, setTarget] = useState(''), [email, setEmail] = useState('');
  const [filter, setFilter] = useState('Pending'), [search, setSearch] = useState(''), [page, setPage] = useState(1), [preparing, setPreparing] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState<CampusInvitation | null>(null), [completion, setCompletion] = useState<string | null>(null);
  const busyRef = useRef(false), [poll, setPoll] = useState<number | false>(false), [now, setNow] = useState(Date.now());
  const capture = useOperationContext(JSON.stringify([href, schoolId])), query = useApi<unknown>(readPath, { refetchInterval: poll });
  let data: CampusInvitationWorkspace | null = null, malformed = '';
  if (query.data && !query.isError) { try { data = parseCampusInvitationWorkspace(query.data, schoolId); } catch (cause) { malformed = causeMessage(cause); } }
  const pendingDelivery = !!data?.invitations.some(item => campusInvitationDeliveryPending(item.delivery)) || campusInvitationDeliveryPending(saved?.delivery);
  useEffect(() => { setPoll(pendingDelivery ? 2000 : false); }, [pendingDelivery]);
  useEffect(() => { if (!focused) return; const timer = setInterval(() => { if (AppState.currentState === 'active') setNow(Date.now()); }, 30_000); return () => clearInterval(timer); }, [focused]);
  const writer = useNativePendingAction<unknown>({ scope: { actorId: session.user!.id, schoolId, mode: 'live', namespaceId: null, origin: getApiOrigin() }, domain: 'people', ownerHref: href, refreshPath: readPath, captureOperation: capture, resolveRefreshPath: resolveCampusInvitationRefresh,
    accepted: async (value, assertCurrent, action) => { const current = acceptedCampusInvitation(value, action); assertCurrent(); const latest = await apiFetch(readPath); parseCampusInvitationWorkspace(latest, schoolId); assertCurrent(); cache.setQueryData(['campus', session.scopeKey, readPath], latest); setSaved(current); if (action.source?.kind === 'campus_invitation_creation') setCompletion(listHref(action.ownerHref)); },
  });
  useEffect(() => { if (!completion || writer.action || writer.busy) return; setEmail(''); setTarget(''); setCompletion(null); navigation.complete(completion); }, [completion, writer.action, writer.busy]);
  const dirty = creating && !saved && !!(target || email.trim());
  useScreenExitGuard({ blocked: writer.busy || preparing, dirty: dirty && !writer.action, title: 'Leave this invitation?', message: 'The unsent recipient details will be discarded. An already submitted exact request remains retained for inspection.', onLeave: () => { setEmail(''); setTarget(''); } });
  const locked = preparing || writer.locked, sourceCurrent = !!data && !query.isError && !malformed;
  const back = q.get('from') === 'staff' ? '/more/setup/responsibilities' : q.get('from') === 'students' ? '/areas/people/records' : q.get('from') === 'settings' ? `/more/setup/people/access?school=${schoolId}` : '/more/setup/people';
  const rows = data?.invitations.filter(item => (filter === 'All' || campusInvitationStatus(item, now) === filter) && `${item.email} ${item.role}`.toLowerCase().includes(search.trim().toLowerCase())) ?? [], pages = Math.max(1, Math.ceil(rows.length / 10)), currentPage = Math.min(page, pages);
  const shownSaved = saved ? data?.invitations.find(item => item.id === saved.id && item.delivery_job_id === saved.delivery_job_id) ?? saved : null;
  const records = role === 'staff' ? data?.staff : role === 'student' ? data?.students : data?.guardians;
  async function send() {
    if (locked || !sourceCurrent || busyRef.current) return; busyRef.current = true; setPreparing(true); setError('');
    try { const assertCurrent = capture(), fresh = parseCampusInvitationWorkspace(await apiFetch(readPath), schoolId); assertCurrent(); const body = campusInvitationBody(role, target, email, fresh); setSaved(null); await writer.run({ endpoint: root, body, serverKey: null, replayPolicy: 'inspect_only', source: { kind: 'campus_invitation_creation', sourceId: schoolId, revision: 0, fingerprint: JSON.stringify(body) } }); }
    catch (cause) { setError(causeMessage(cause)); } finally { busyRef.current = false; setPreparing(false); }
  }
  async function manage(original: CampusInvitation, action: 'resend' | 'revoke') {
    if (locked || !sourceCurrent || busyRef.current) return; busyRef.current = true; setPreparing(true); setError('');
    try { const assertCurrent = capture(), fresh = parseCampusInvitation(await apiFetch(`${root}${original.id}/`), schoolId, original.id, true); assertCurrent();
      if (campusInvitationListIdentity(fresh) !== campusInvitationListIdentity(original) || !['Pending', ...(action === 'resend' ? ['Expired'] : [])].includes(campusInvitationStatus(fresh)) || action === 'resend' && campusInvitationDeliveryPending(fresh.delivery)) throw new Error('The invitation changed. Refresh and review its current recipient and status.');
      setSaved(null); await writer.run({ endpoint: `${root}${fresh.id}/${action}/`, body: {}, serverKey: null, replayPolicy: 'inspect_only', source: campusInvitationSource(fresh) });
    } catch (cause) { setError(causeMessage(cause)); } finally { busyRef.current = false; setPreparing(false); }
  }
  return <Page title={creating ? 'Invite member' : 'Invitations'} subtitle="App access starts only when the recipient accepts." refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
    <ScreenBack fallbackHref={creating ? listPath : back} title={creating ? 'Invitations' : q.get('from') === 'staff' ? 'Responsibilities' : q.get('from') === 'students' ? 'People records' : 'People setup'} disabled={writer.busy || preparing} />
    {error || writer.error ? <Notice tone="warning" message={error || writer.error} /> : null}
    {writer.resumeHref ? <ControlButton title="Open original People action" onPress={() => onNavigate(writer.resumeHref!)} /> : writer.action ? <><Notice message={writer.action.phase === 'accepted' ? 'The invitation action was acknowledged. Recovery only reads its exact saved invitation before releasing the journal.' : 'This original invitation action is retained. Its result cannot safely be repeated. Inspect current records; a matching invitation alone cannot prove acceptance.'} /><ControlButton title={writer.action.phase === 'accepted' ? 'Confirm saved invitation' : 'Inspect current invitations'} busy={writer.busy} disabled={preparing} onPress={() => void writer.recover()} /></> : null}
    {shownSaved ? <Section title="Invitation status"><Facts items={[{ label: 'Recipient', value: shownSaved.email }, { label: 'Access', value: shownSaved.role }, { label: 'Invitation', value: campusInvitationStatus(shownSaved, now) }]} /><Notice message={workInvitationDelivery(shownSaved.delivery)} /><ControlButton title="Dismiss status" onPress={() => setSaved(null)} /></Section> : null}
    {query.isPending ? <Loading /> : !data ? <Empty title="Invitation access could not be confirmed" message={query.error?.message || malformed} onRetry={() => void query.refetch()} /> : creating ? <>
      <ChoiceMenu label="Account type" value={role} options={[...campusInvitationRoles.filter(value => value !== 'admin' || data.can_invite_admin)].map(value => ({ value, label: value === 'admin' ? 'Administrator' : value[0]!.toUpperCase() + value.slice(1) }))} disabled={locked} onChange={value => { setRole(value as CampusInvitationRole); setTarget(''); setEmail(''); setSaved(null); }} />
      {role !== 'admin' ? <ChoiceMenu label={role === 'staff' ? 'Staff person' : role === 'student' ? 'Student record' : 'Guardian record'} value={target} options={[{ value: '', label: role === 'guardian' ? 'Account access only' : `Choose ${role === 'staff' ? 'staff person' : 'student record'}` }, ...(records ?? []).map(record => ({ value: record.id, label: `${record.name}${record.reference ? ` · ${record.reference}` : ''}` }))]} disabled={locked} onChange={value => { setTarget(value); setEmail(records?.find(record => record.id === value)?.email ?? ''); }} /> : null}
      <Field label="Recipient email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" maxLength={254} editable={!locked} />
      <Notice message={role === 'staff' ? 'Choose an existing staff person without app access. Work authority follows actual scoped responsibilities, not this email.' : 'People and student or guardian records can exist without accounts. This invitation adds login access only when accepted.'} />
      <Button title="Send invitation email" busy={preparing || writer.busy} disabled={locked || !sourceCurrent || !email.trim() || ['staff', 'student'].includes(role) && !target || role === 'admin' && !data.can_invite_admin} onPress={() => Alert.alert('Send this invitation?', `Invite ${email.trim()} as ${role === 'admin' ? 'an administrator' : role}? An unaccepted invitation for this email may be replaced.`, [{ text: 'Keep editing', style: 'cancel' }, { text: 'Send invitation', onPress: () => void send() }])} />
      <ControlButton title={role === 'staff' ? 'Open staff onboarding' : 'Open People records'} disabled={locked} onPress={() => onNavigate(role === 'staff' ? `/more/setup/responsibilities?section=directory&school=${schoolId}` : '/areas/people/records')} />
    </> : <>
      <Button title="Invite member" disabled={locked || !sourceCurrent} onPress={() => { setTarget(''); setEmail(''); setSaved(null); const next = new URLSearchParams(q); next.set('create', 'invitation'); onNavigate(`${route}?${next}`); }} />
      <ChoiceMenu label="Invitation status" value={filter} options={campusInvitationStatuses.map(value => ({ value, label: value }))} disabled={locked} onChange={value => { setFilter(value); setPage(1); }} />
      <SearchField label="Find invitation" placeholder="Email or account type" value={search} onChangeText={value => { setSearch(value); setPage(1); }} onClear={() => { setSearch(''); setPage(1); }} />
      <Section title={`${rows.length} invitations`}>{rows.length ? <ListGroup>{rows.slice((currentPage - 1) * 10, currentPage * 10).map((item, index) => { const status = campusInvitationStatus(item, now); return <View key={item.id}><Row variant="plain" separator={index > 0} title={item.email} detail={`${item.role} · expires ${new Date(item.expires_at).toLocaleString()}`} status={status} /><View style={{ paddingHorizontal: 16, paddingBottom: 14, gap: 8 }}><Notice message={workInvitationDelivery(item.delivery)} /><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{['Pending', 'Expired'].includes(status) ? <ControlButton title="Resend email" disabled={locked || !sourceCurrent || campusInvitationDeliveryPending(item.delivery)} onPress={() => Alert.alert('Resend invitation email?', `Send a replacement code to ${item.email}? Check their inbox first when delivery is unconfirmed.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Resend', onPress: () => void manage(item, 'resend') }])} /> : null}{status === 'Pending' ? <ControlButton title="Revoke" kind="danger" disabled={locked || !sourceCurrent} onPress={() => Alert.alert('Revoke invitation?', `${item.email} will no longer be able to accept this invitation. Their other app access is separate.`, [{ text: 'Keep invitation', style: 'cancel' }, { text: 'Revoke', style: 'destructive', onPress: () => void manage(item, 'revoke') }])} /> : null}</View></View></View>; })}</ListGroup> : <Empty title={data.invitations.length ? `No ${filter.toLowerCase()} invitations` : 'No invitations yet'} />}</Section>
      {pages > 1 ? <View style={{ flexDirection: 'row', gap: 8 }}><ControlButton title="Previous" disabled={currentPage <= 1} onPress={() => setPage(currentPage - 1)} /><ControlButton title={`Next · ${currentPage} of ${pages}`} disabled={currentPage >= pages} onPress={() => setPage(currentPage + 1)} /></View> : null}
      <Notice message="The current owner returns the latest 100 invitations. Email-provider acceptance does not prove recipient acceptance. Invitation tokens are never displayed or stored here." />
    </>}
  </Page>;
}
