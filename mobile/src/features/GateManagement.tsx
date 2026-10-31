import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, Text, View } from 'react-native';
import { useTheme } from '../ui/theme';
import { useIsFocused } from 'expo-router';
import Svg, { Path, Rect } from 'react-native-svg';
import { assertWorkspaceManifestContext, normalizeWorkspaceManifest } from '../../../packages/contracts/src/workspace-normalizer';
import { useSession } from '../auth/SessionProvider';
import { apiFetch } from '../lib/api';
import { useApi } from '../lib/query';
import { useOperationContext } from '../lib/use-operation-context';
import { useOperationClock } from '../lib/use-operation-clock';
import { useGateCommand } from '../lib/gate-command';
import { useGatePassJournal } from '../lib/use-gate-pass-journal';
import { assertGatePassSource, gateManagementFilter, gateManagementPage, gatePassEndpoint, gatePassQr, gateVisitorFilters, readGateIssuedPass, type GateIssuedPass, type GateManagementStudent as Student, type GateManagementVisitor as Visitor, type GateManagementWorkspace as Workspace, type GatePassKind } from '../lib/gate-management';
import { shareGatePass } from '../lib/gate-pass-share';
import { Alert } from '../ui/Alert';
import { useScreenExitGuard } from '../ui/BackNavigation';
import { ChoiceMenu, ControlButton } from '../ui/DomainControls';
import { Empty, Loading, Notice, Page, Row, SearchField, Section } from '../ui/components';

type Recipient = Student | Visitor;
type VisiblePass = { data: GateIssuedPass; source: Recipient };
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'The current gate action could not be confirmed.';
const when = (instant: string) => new Date(instant).toLocaleString();
function queryHref(href: string, change: Record<string, string>) { const params = new URLSearchParams(href.split('?')[1] ?? ''); for (const [key, value] of Object.entries(change)) value ? params.set(key, value) : params.delete(key); return `${href.split('?')[0]}${params.size ? `?${params}` : ''}`; }

export function GateManagement({ href, onNavigate, schoolId }: { href: string; onNavigate(href: string): void; schoolId: string }) {
  const session = useSession(), focused = useIsFocused(), query = new URLSearchParams(href.split('?')[1] ?? ''), { colors } = useTheme();
  const root = `/api/v1/gate/schools/${encodeURIComponent(schoolId)}`, filter = gateManagementFilter(query.get('visitor_filter')), page = gateManagementPage(query.get('visitor_page'));
  const member = session.memberships.find(item => item.school_id === schoolId), permitted = session.status === 'authenticated' && session.schoolId === schoolId && member?.role === 'admin' && !session.environment.unavailable;
  const workspace = useApi<Workspace>(permitted ? `${root}/workspace/?${new URLSearchParams({ visitor_filter: filter, visitor_page: String(page) })}` : null, { refetchInterval: 10_000 });
  const [input, setInput] = useState(''), [search, setSearch] = useState(''), [pass, setPass] = useState<VisiblePass | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [preparing, setPreparing] = useState(false), [activityPage, setActivityPage] = useState(1);
  const matches = useApi<Student[]>(permitted && search.length >= 2 ? `${root}/students/?q=${encodeURIComponent(search)}` : null);
  const capture = useOperationContext(`${href}:management`), clock = useOperationClock(`${href}:management`), passWriter = useGatePassJournal(session.scopeKey, schoolId), lock = useRef(false), currentPass = useRef(pass); currentPass.current = pass;
  const writer = useGateCommand({ scopeKey: session.scopeKey, schoolId, captureContext: () => ({ assertCurrent: capture() }), refresh: () => workspace.refetch({ throwOnError: true }), onAccepted: () => setNotice('The visitor decision was confirmed. Entry and exit remain separate.') });
  const pending = passWriter.journal.pending, locked = !permitted || preparing || writer.locked || !passWriter.journal.ready || passWriter.journal.blocked || passWriter.journal.busy || !!pending || workspace.isError || !workspace.data;
  const currentLocked = useRef(locked); currentLocked.current = locked;
  useScreenExitGuard({ blocked: preparing || writer.busy || passWriter.journal.busy });
  useEffect(() => { if (!focused || !permitted || workspace.isError) setPass(null); }, [focused, permitted, workspace.isError]);
  useEffect(() => { setPass(null); }, [href, session.scopeKey]);
  useEffect(() => { const subscription = AppState.addEventListener('change', state => { if (state !== 'active') setPass(null); }); return () => subscription.remove(); }, []);
  useEffect(() => {
    if (!pass || !focused) return;
    let active = true;
    const check = () => void (async () => { const assertCurrent = capture(), now = await clock.read(); assertCurrent(); await freshPerson(pass.source, pass.data.kind, assertCurrent); if (active && Date.parse(pass.data.expires_at) <= Date.parse(now)) { setPass(null); setNotice('This pass expired. Review the current arrangement before issuing another.'); } })().catch(() => { if (active) setPass(null); });
    const timer = setInterval(check, 15_000); check(); return () => { active = false; clearInterval(timer); };
  }, [pass, focused, clock.read]);
  // Every external effect rechecks the exact selected world, membership and capability.
  const freshAccess = async (assertCurrent: () => void) => {
    assertCurrent();
    if (!permitted) throw new Error('Current campus management access is required.');
    const manifest = normalizeWorkspaceManifest(await apiFetch('/api/v1/workspace')); assertCurrent();
    assertWorkspaceManifestContext(manifest, { actorUserId: session.user!.id, institutionId: schoolId, environment: session.environment });
    if (!manifest.areas.flatMap(area => area.surfaces).some(surface => surface.href.split('?')[0] === '/areas/in-out/manage')) throw new Error('Gate management is no longer available to this account.');
    return manifest;
  };
  const freshPerson = async (person: Recipient, kind: GatePassKind, assertCurrent: () => void) => {
    const latest = kind === 'visitor'
      ? (await apiFetch<Workspace & { focused_visitor?: Visitor }>(`${root}/workspace/?${new URLSearchParams({ visitor_id: person.id, visitor_filter: 'all' })}`)).focused_visitor
      : await apiFetch<Student>(`${root}/students/${encodeURIComponent(person.id)}/`);
    assertCurrent(); if (!latest) throw new Error('This exact person is no longer available.');
    assertGatePassSource(person, latest, kind, schoolId); return latest;
  };
  const prepare = async (action: (assertCurrent: () => void) => Promise<void>) => {
    if (lock.current) return; lock.current = true; setPreparing(true); setError(''); setNotice('');
    try { const assertCurrent = capture(); await freshAccess(assertCurrent); await action(assertCurrent); }
    catch (cause) { setError(message(cause)); }
    finally { lock.current = false; setPreparing(false); }
  };
  const issue = (person: Recipient, kind: GatePassKind, reviewed = false) => {
    if (currentLocked.current) return;
    void prepare(async assertCurrent => {
      const source = await freshPerson(person, kind, assertCurrent);
      if (kind === 'pickup' && !reviewed) {
        const pickup = source as Student;
        Alert.alert('Issue this pickup QR?', `${pickup.name} · ${pickup.mode === 'independent_departure' ? 'Approved independent departure' : `Approved collection${pickup.collector_name?.trim() ? ` by ${pickup.collector_name.trim()}` : ''}`}. The pass expires in 15 minutes and can be used once.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Issue pickup QR', onPress: () => { try { assertCurrent(); issue(source, 'pickup', true); } catch (cause) { setError(message(cause)); } } }]);
        return;
      }
      const now = await clock.read(); assertCurrent(); setPass(null);
      const result = await passWriter.issue({ kind, subjectId: person.id, name: source.name, now, assertCurrent,
        send: () => apiFetch(gatePassEndpoint(schoolId, person.id, kind), { method: 'POST', body: JSON.stringify(kind === 'visitor' ? {} : { student_id: person.id, kind }) }), accepted: () => {} });
      const latestNow = await clock.read(); assertCurrent(); readGateIssuedPass(result, kind, source.name, latestNow);
      setPass({ data: result, source });
    });
  };
  const visitorQr = (visitor: Visitor) => {
    if (currentLocked.current) return; const assertCurrent = capture();
    Alert.alert('Issue visitor QR?', 'This replaces any previous QR for this visitor. Share it only with the intended visitor.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Issue QR', onPress: () => { try { assertCurrent(); issue(visitor, 'visitor'); } catch (cause) { setError(message(cause)); } } }]);
  };
  const decide = (visitor: Visitor, action: 'approve' | 'deny') => {
    if (currentLocked.current) return; const confirmation = capture();
    Alert.alert(action === 'approve' ? 'Approve this visitor?' : 'Decline this visitor?', `${visitor.name} · ${visitor.purpose}. This records a decision; it does not record a boundary movement.`, [{ text: 'Cancel', style: 'cancel' }, { text: action === 'approve' ? 'Approve' : 'Decline', style: action === 'deny' ? 'destructive' : 'default', onPress: () => {
      try { confirmation(); void prepare(async assertCurrent => {
        const current = (await apiFetch<Workspace & { focused_visitor?: Visitor }>(`${root}/workspace/?${new URLSearchParams({ visitor_id: visitor.id, visitor_filter: 'all' })}`)).focused_visitor; assertCurrent();
        if (!current || current.id !== visitor.id || current.school_id !== schoolId || current.revision !== visitor.revision || current.state !== 'pending') throw new Error('This visitor request changed. Refresh and review its current state.');
        await writer.run({ path: `${root}/visitors/${visitor.id}/${action}/`, body: JSON.stringify({ expected_revision: visitor.revision }), label: action === 'approve' ? 'Visitor approval confirmed.' : 'Visitor decline confirmed.' });
      }); } catch (cause) { setError(message(cause)); }
    } }]);
  };
  const share = () => {
    const selected = pass; if (!selected || currentLocked.current) return;
    void prepare(async assertCurrent => {
      try {
        await freshPerson(selected.source, selected.data.kind, assertCurrent);
        const now = await clock.read(); assertCurrent(); readGateIssuedPass(selected.data, selected.data.kind, selected.source.name, now);
        await shareGatePass(selected.data.qr, selected.data.kind, () => { assertCurrent(); if (currentPass.current !== selected) throw new Error('Reopen the current private pass before sharing.'); });
      } catch (cause) { setPass(null); throw cause; }
    });
  };
  const inspect = () => void prepare(async assertCurrent => {
    if (!pending) return;
    if (pending.kind === 'visitor') await apiFetch(`${root}/workspace/?${new URLSearchParams({ visitor_id: pending.subjectId, visitor_filter: 'all' })}`); else await apiFetch(`${root}/students/${pending.subjectId}/`);
    assertCurrent(); await workspace.refetch({ throwOnError: true }); assertCurrent();
    if (pending.phase === 'accepted') { await passWriter.finishAccepted(assertCurrent); setNotice('The accepted request marker was cleared. Its private QR was not stored and cannot be recovered here.'); }
    else setNotice('Current records were refreshed. They do not prove whether this exact QR issuance completed; the original request remains locked.');
  });
  const activityPages = Math.max(1, Math.ceil((workspace.data?.activity.length ?? 0) / 20)), currentActivityPage = Math.min(activityPage, activityPages);
  if (!permitted) return <Page title="In & Out management"><Empty title="Current campus management access is required" /></Page>;
  return <Page title="In & Out management" subtitle="Passes, visitor decisions and operating records" refreshing={workspace.isRefetching} onRefresh={() => void workspace.refetch()}>
    {session.environment.mode === 'simulation' ? <Notice tone="warning" message="These passes and decisions belong to the selected Simulation. They do not grant Live campus entry." /> : null}
    {error || passWriter.error || writer.error ? <Notice tone="danger" message={error || passWriter.error || writer.error} /> : null}{notice ? <Notice tone={pending?.phase === 'unknown' ? 'warning' : 'success'} message={notice} /> : null}
    {passWriter.journal.blocked ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><ControlButton title="Reload private journal" disabled={preparing || writer.busy} onPress={() => void prepare(async assertCurrent => { await passWriter.reload(); assertCurrent(); })} /></View> : null}
    {pending ? <Section title={pending.phase === 'accepted' ? 'Pass issuance was accepted' : 'Pass result unconfirmed'}><Notice tone="warning" message={pending.phase === 'accepted' ? 'The private QR is not retained across interruptions. Refresh the current records to finish this accepted request without sending it again.' : 'The owner cannot retrieve a generated QR or confirm a timed-out issuance. This request is kept for support review. Refreshing a person’s state does not prove this result; no automatic retry is available.'} /><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><ControlButton title={pending.phase === 'accepted' ? 'Finish accepted request' : 'Inspect current records'} disabled={preparing || writer.busy || passWriter.journal.busy} onPress={inspect} /></View></Section> : null}
    {writer.pending ? <Section title="Retained visitor action"><Notice tone="warning" message={writer.pending.phase === 'accepted' ? 'The visitor decision was saved. Refresh its result to finish.' : 'This exact visitor decision remains unconfirmed. Check its original result or retry the identical decision.'} /><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><ControlButton title="Check saved result" disabled={writer.busy || preparing} onPress={() => void writer.check()} />{writer.retryAllowed ? <ControlButton title="Retry identical decision" disabled={writer.busy || preparing} onPress={() => void writer.retry()} /> : null}</View></Section> : null}
    <View style={{ gap: 8 }}><Row title="Open checkpoint" detail="Scan passes and record observed movements" icon="movements" onPress={() => onNavigate('/areas/in-out/operate')} /><Row title="Assign responsibility" detail="Scope who may operate a checkpoint" icon="responsibilities" onPress={() => onNavigate('/more/setup/responsibilities')} /></View>
    {workspace.isPending ? <Loading /> : workspace.isError ? <Empty title="Gate management could not load" message={workspace.error.message} onRetry={() => void workspace.refetch()} /> : <>
      <Section title="Student and pickup passes"><Notice message="Pickup passes require a current approved departure plan, expire after 15 minutes and can be used once. A student QR does not authorize pickup." /><SearchField label="Find student" placeholder="Name or campus identifier" value={input} disabled={locked} onChangeText={setInput} onClear={() => setSearch('')} onSubmit={() => { if (!locked && input.trim().length >= 2 && input.trim().length <= 100) { setPass(null); setSearch(input.trim()); } }} />{input.trim().length > 100 ? <Notice tone="warning" message="Use no more than 100 characters." /> : null}
        {search ? matches.isPending ? <Loading label="Finding students…" /> : matches.isError ? <Empty title="Students could not load" message={matches.error.message} onRetry={() => void matches.refetch()} /> : matches.data?.length ? matches.data.map(student => <Row key={student.id} title={student.name} detail={`${student.class_label} · ${student.admission_number}`}><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}><ControlButton title="Student QR" disabled={locked} onPress={() => issue(student, 'student')} /><ControlButton title="Pickup QR" disabled={locked || student.plan_state !== 'ready'} onPress={() => issue(student, 'pickup')} /></View></Row>) : <Empty title="No matching students" /> : null}
      </Section>
      {pass ? <Section title={`${pass.source.name} · ${pass.data.kind === 'student' ? 'Student' : pass.data.kind === 'pickup' ? 'Pickup' : 'Visitor'} QR`}><PrivateQr pass={pass.data} /><Row title="Expires" detail={when(pass.data.expires_at)} /><Notice message="This private QR is a bearer credential. Share it only with its intended recipient. Closing hides this copy; it does not revoke the pass." /><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><ControlButton title={Platform.OS === 'web' ? 'Download QR' : 'Share QR'} disabled={locked} onPress={share} /><ControlButton title="Close pass" disabled={preparing} onPress={() => setPass(null)} /></View></Section> : null}
      <Section title="Visitor decisions and passes"><Notice message="Approval records remain separate from physical entry and exit evidence." /><ChoiceMenu label="Visitor filter" value={filter} disabled={preparing || writer.busy || workspace.isFetching} options={gateVisitorFilters.map(value => ({ value, label: `${value[0]!.toUpperCase()}${value.slice(1)}${workspace.data?.visitor_counts?.[value] !== undefined ? ` · ${workspace.data.visitor_counts[value]}` : ''}` }))} onChange={value => onNavigate(queryHref(href, { visitor_filter: value, visitor_page: '' }))} />
        {workspace.data?.visitors.length ? workspace.data.visitors.map(visitor => <Row key={visitor.id} title={visitor.name} detail={`${visitor.purpose}${visitor.host_name ? ` · ${visitor.host_name}` : ''}`} status={visitor.state} statusTone="muted"><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>{['approved', 'inside'].includes(visitor.state) ? <ControlButton title="Visitor QR" disabled={locked} onPress={() => visitorQr(visitor)} /> : null}{visitor.state === 'pending' ? <><ControlButton title="Approve" disabled={locked} onPress={() => decide(visitor, 'approve')} /><ControlButton title="Decline" kind="danger" disabled={locked} onPress={() => decide(visitor, 'deny')} /></> : null}</View></Row>) : <Empty title="No visitors in this view" />}
        {(workspace.data?.visitor_pagination?.total_pages ?? 1) > 1 ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><ControlButton title="Previous visitors" disabled={preparing || page <= 1 || workspace.isFetching} onPress={() => onNavigate(queryHref(href, { visitor_page: String(page - 1) }))} /><View style={{ minHeight: 44, maxWidth: '100%', justifyContent: 'center' }}><Text accessibilityLiveRegion="polite" style={{ fontSize: 14, lineHeight: 20, color: colors.muted }}>Page {workspace.data!.visitor_pagination!.page} of {workspace.data!.visitor_pagination!.total_pages}</Text></View><ControlButton title="Next visitors" disabled={preparing || page >= workspace.data!.visitor_pagination!.total_pages || workspace.isFetching} onPress={() => onNavigate(queryHref(href, { visitor_page: String(page + 1) }))} /></View> : null}
      </Section>
      <Section title="Recent operating records"><Notice message="Accepted boundary events are entry or exit evidence, not classroom attendance. The owner returns the latest operating records." />{workspace.data?.activity.length ? workspace.data.activity.slice((currentActivityPage - 1) * 20, currentActivityPage * 20).map(item => <Row key={item.id} title={item.name} detail={`${item.detail} · ${when(item.occurred_at)}`} status={item.direction === 'in' ? 'Entry recorded' : 'Exit recorded'} statusTone="muted" />) : <Empty title="No recent operating records" />}{activityPages > 1 ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><ControlButton title="Previous records" disabled={currentActivityPage <= 1} onPress={() => setActivityPage(currentActivityPage - 1)} /><View style={{ minHeight: 44, maxWidth: '100%', justifyContent: 'center' }}><Text accessibilityLiveRegion="polite" style={{ fontSize: 14, lineHeight: 20, color: colors.muted }}>Page {currentActivityPage} of {activityPages}</Text></View><ControlButton title="Next records" disabled={currentActivityPage >= activityPages} onPress={() => setActivityPage(currentActivityPage + 1)} /></View> : null}<Notice message="Accepted records stay in the audit trail. A dedicated correction action is not yet available in this workspace." /></Section>
    </>}
  </Page>;
}
function PrivateQr({ pass }: { pass: GateIssuedPass }) { const qr = gatePassQr(pass.qr); return <View style={{ width: '100%', maxWidth: 320, alignSelf: 'center', aspectRatio: 1 }} accessibilityLabel={`${pass.kind} QR pass for ${pass.name}`} accessible><Svg width="100%" height="100%" viewBox={`0 0 ${qr.size} ${qr.size}`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Rect width={qr.size} height={qr.size} fill="#fff" /><Path d={qr.path} fill="#000" /></Svg></View>; }
