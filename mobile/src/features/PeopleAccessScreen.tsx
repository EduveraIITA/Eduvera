import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import type { Member } from '../../../packages/contracts/src/institution';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../auth/SessionProvider';
import { apiFetch, getApiOrigin } from '../lib/api';
import { useApi } from '../lib/query';
import { useOperationContext } from '../lib/use-operation-context';
import { useNativePendingAction } from '../lib/native-pending-action';
import { acceptedCampusMembership, campusMembershipInput, campusMembershipSource, parsePeopleAccess, peopleAccessEndpoint, peopleAccessRead, resolveCampusMembershipRefresh } from '../lib/people-access';
import { Alert } from '../ui/Alert';
import { ScreenBack, useScreenExitGuard } from '../ui/BackNavigation';
import { ControlButton, Facts, SegmentedControl } from '../ui/DomainControls';
import { Button, Empty, ListGroup, Loading, Notice, Page, Row, SearchField, Section } from '../ui/components';
import { MoreToolBoundary } from './more/MoreToolBoundary';
type Props = { href: string; onNavigate(href: string): void };
const name = (member: Member) => `${member.first_name} ${member.last_name}`.trim() || member.email;
export function PeopleAccessScreen(props: Props) {
  const session = useSession(), q = new URL(props.href, 'https://thatcampus.invalid').searchParams;
  if (!session.schoolId || q.getAll('school').length > 1 || q.has('school') && q.get('school') !== session.schoolId) return <Page title="Account access"><Empty title="Confirm the exact campus before managing access" /></Page>;
  return <MoreToolBoundary itemKey="institution" title="Account access">{({ manifest }) => <AccessWorkspace key={session.scopeKey} {...props} schoolId={manifest.context.institution_id} />}</MoreToolBoundary>;
}
function AccessWorkspace({ href, onNavigate, schoolId }: Props & { schoolId: string }) {
  const session = useSession(), cache = useQueryClient(), capture = useOperationContext(JSON.stringify([href, schoolId])), readPath = peopleAccessRead(schoolId), query = useApi<unknown>(readPath);
  const [selected, setSelected] = useState<Member | null>(null), [active, setActive] = useState(false), [search, setSearch] = useState(''), [page, setPage] = useState(1), [preparing, setPreparing] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState<Member | null>(null), preparingRef = useRef(false);
  let source: ReturnType<typeof parsePeopleAccess> | null = null, malformed = '';
  if (query.data && !query.isError) { try { source = parsePeopleAccess(query.data, schoolId); } catch (cause) { malformed = cause instanceof Error ? cause.message : 'Access records could not be verified.'; } }
  const current = source?.members.find(member => member.id === selected?.id), stale = !!selected && (!current || JSON.stringify(current) !== JSON.stringify(selected)), permitted = session.memberships.some(member => member.school_id === schoolId && member.role === 'admin' && member.access_scope !== 'assigned_work') && !session.publicDemo;
  const writer = useNativePendingAction<unknown>({ domain: 'people', ownerHref: href, refreshPath: readPath, scope: { actorId: session.user!.id, schoolId, mode: session.environment.mode, namespaceId: session.environment.namespace_id ?? null, origin: getApiOrigin() }, captureOperation: capture, resolveRefreshPath: resolveCampusMembershipRefresh,
    accepted: (value, assertCurrent, action) => { const member = acceptedCampusMembership(value, action); assertCurrent(); cache.setQueryData(['campus', session.scopeKey, readPath], value); setSaved(member); setSelected(null); },
  });
  const locked = writer.locked || preparing || !permitted || !source || query.isError, dirty = !!selected && selected.is_active !== active;
  useScreenExitGuard({ blocked: writer.busy || preparing, dirty: dirty && !writer.action, title: 'Leave membership changes?', message: 'The unsaved access change will be discarded. Submitted uncertain changes remain retained for inspection.', onLeave: () => setSelected(null) });
  useEffect(() => { if (writer.busy || writer.action || !saved) return; void cache.invalidateQueries({ queryKey: ['campus', session.scopeKey], refetchType: 'none' }); }, [saved, writer.busy, writer.action]);
  async function save() {
    if (!selected || locked || stale || preparingRef.current) return; preparingRef.current = true; setPreparing(true); setError('');
    try { const assertCurrent = capture(), fresh = parsePeopleAccess(await apiFetch(readPath), schoolId); assertCurrent(); const body = campusMembershipInput(selected, active, fresh.members); await writer.run({ endpoint: peopleAccessEndpoint(schoolId, selected.id), method: 'PATCH', body, serverKey: null, replayPolicy: 'inspect_only', source: campusMembershipSource(selected) }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Membership could not be checked.'); } finally { preparingRef.current = false; setPreparing(false); }
  }
  const close = () => { if (writer.busy || preparing) return; if (dirty && !writer.action) Alert.alert('Discard this unsaved access change?', 'The saved membership remains unchanged.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard change', style: 'destructive', onPress: () => setSelected(null) }]); else setSelected(null); };
  const members = source?.members.filter(member => ['admin', 'staff'].includes(member.role) && `${name(member)} ${member.email}`.toLowerCase().includes(search.trim().toLowerCase())) ?? [], pages = Math.max(1, Math.ceil(members.length / 25)), currentPage = Math.min(page, pages);
  return <Page title={selected ? `Manage ${name(selected)}` : 'Account access'} subtitle={source?.name} refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
    <ScreenBack title={selected ? 'Account access' : 'People setup'} fallbackHref="/more/setup/people" disabled={writer.busy || preparing} onPress={selected ? close : undefined} />
    {error || writer.error ? <Notice tone="warning" message={error || writer.error} /> : null}
    {writer.resumeHref ? <ControlButton title="Open original People action" onPress={() => onNavigate(writer.resumeHref!)} /> : writer.action ? <><Notice message={writer.action.phase === 'accepted' ? 'The exact membership update was acknowledged. Recovery only reads its source and never repeats the access change.' : 'The original membership request is retained. This legacy owner has no replay receipt; matching current access alone cannot prove this request was accepted.'} /><ControlButton title={writer.action.phase === 'accepted' ? 'Confirm saved membership' : 'Inspect current membership records'} busy={writer.busy} disabled={preparing} onPress={() => void writer.recover()} /></> : null}
    {!permitted ? <Notice tone="warning" message="Current institution administrator access is required to change membership. Operational responsibility is managed separately." /> : null}
    {session.environment.mode === 'simulation' ? <Notice message="These are membership records inside the selected isolated campus. No Live account or invitation is changed. Missing isolated coverage remains unavailable." /> : null}
    {saved && !selected ? <Notice tone="success" message={`${name(saved)} membership is confirmed ${saved.is_active ? 'active' : 'inactive'}.`} /> : null}
    {query.isPending ? <Loading /> : !source ? <Empty title="Current membership access could not load" message={query.error?.message || malformed} onRetry={() => void query.refetch()} /> : selected ? <>
      <Facts items={[{ label: 'Account', value: name(selected) }, { label: 'Email', value: selected.email }, { label: 'Campus membership', value: selected.role }]} />
      {stale ? <><Notice tone="warning" message="This membership changed. Your choice is retained; review its current account and active state before saving." />{current ? <ControlButton title="Load current membership" disabled={writer.locked || preparing} onPress={() => { setSelected(current); setActive(current.is_active); }} /> : null}</> : null}
      <SegmentedControl label="Institution membership" value={active ? 'active' : 'inactive'} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} disabled={locked || stale} onChange={value => setActive(value === 'active')} />
      <Notice message="The last active administrator cannot be deactivated. Deactivation ends active temporary access exceptions and may require coverage reconciliation. Other institutions and sign-in credentials are separate." />
      {selected.user_id === session.user?.id && !active ? <Notice tone="warning" message="This is your own membership. You may lose access to this campus and its recovery reads after deactivation." /> : null}
      <Button title="Review membership change" busy={preparing || writer.busy} disabled={locked || stale || !dirty} onPress={() => Alert.alert(active ? 'Activate this campus membership?' : 'Deactivate this campus membership?', `${name(selected)}\n${selected.email}\n${selected.role} · ${active ? 'Active' : 'Inactive'}${session.environment.mode === 'simulation' ? '\nOnly the selected isolated campus is affected.' : ''}`, [{ text: 'Keep reviewing', style: 'cancel' }, { text: active ? 'Activate membership' : 'Deactivate membership', style: active ? 'default' : 'destructive', onPress: () => void save() }])} />
      {selected.role === 'staff' ? <ControlButton title="Manage responsibilities and roles" disabled={locked} onPress={() => onNavigate('/more/setup/responsibilities')} /> : null}
    </> : <>
      <ControlButton title="Invitations" disabled={writer.busy || preparing} onPress={() => onNavigate(`/more/setup/people/invitations?from=settings&school=${schoolId}`)} />
      <Notice message="Administrator and staff membership is managed here. Learner and guardian accounts remain with their connected records. Scoped roles and work are managed in Responsibilities." />
      <SearchField label="Find administrator or staff member" placeholder="Name or email" value={search} onChangeText={value => { setSearch(value); setPage(1); }} onClear={() => { setSearch(''); setPage(1); }} />
      <Section title={`${members.length} memberships`}>{members.length ? <ListGroup>{members.slice((currentPage - 1) * 25, currentPage * 25).map((member, index) => <Row key={member.id} variant="plain" separator={index > 0} title={name(member)} detail={`${member.role} · ${member.email}`} status={member.is_active ? 'Active' : 'Inactive'} onPress={locked ? undefined : () => { setSelected(member); setActive(member.is_active); setError(''); setSaved(null); }} />)}</ListGroup> : <Empty title="No administrator or staff matches" />}</Section>
      {pages > 1 ? <View style={{ flexDirection: 'row', gap: 8 }}><ControlButton title="Previous" disabled={currentPage <= 1} onPress={() => setPage(currentPage - 1)} /><ControlButton title={`More · ${currentPage} of ${pages}`} disabled={currentPage >= pages} onPress={() => setPage(currentPage + 1)} /></View> : null}
    </>}
  </Page>;
}
