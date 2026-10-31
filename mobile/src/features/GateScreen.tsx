import { ScreenBack, useCampusNavigation, useScreenExitGuard } from '../ui/BackNavigation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Switch, Text, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { Alert } from '../ui/Alert';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import { assertWorkspaceManifestContext, normalizeWorkspaceManifest } from '../../../packages/contracts/src/workspace-normalizer';
import { useSession } from '../auth/SessionProvider';
import { apiFetch, captureApiContext } from '../lib/api';
import { nativeGateAcceptedResult, useGateCommand } from '../lib/gate-command';
import { useApi } from '../lib/query';
import { canRetainScopedRead } from '../lib/scoped-read-policy';
import { iconForDestination } from '../ui/icon-semantics';
import { useOperationContext } from '../lib/use-operation-context';
import { gateOfficePhoneHref, gateOperatorSection, gateOperatorSectionHref, type GateLanguage } from '../lib/gate-operator-policy';
import { Button, Empty, Field, Loading, Notice, Page, Row, SearchField, Section } from '../ui/components';
import { GateVisitorEntry } from './GateVisitorEntry';
import { GateVisitEditor } from './GateVisitEditor';
import { GateVisitManagement } from './GateVisitManagement';
import { CampusPlacePortal } from './gate/CampusPlacePortal';
import { GateVisitParticipant } from './GateVisitParticipant';
import { GateVisitOnboarding } from './GateVisitOnboarding';
import { readVisitOnboardingState } from '../lib/gate-visit-onboarding';
import { VisitDetailCard, VisitDetailHeader, VisitPlanNotice } from './GateVisitDetails';
import { GateVisitSharing } from './GateVisitSharing';
import { GateSharedVisitChanges } from './GateSharedVisitChanges';
import { GateManagement } from './GateManagement';
import { gateSharedVisitTime } from './GateSharedVisitPolicy';
import type { SharedVisitDetail as SharedDetail, SharedVisit } from '../../../packages/contracts/src/wire/features/gate/visitSharingApi';
import { useQueryClient } from '@tanstack/react-query';
import { readVisitSharing } from '../lib/visit-sharing';
import type { VisitDetail, ArrangedVisit as Visit } from '../../../packages/contracts/src/wire/features/gate/visitApi';
import { ChoiceMenu, ControlButton, Disclosure, SegmentedControl } from '../ui/DomainControls';
import { useTheme } from '../ui/theme';
import { useGateLanguage } from './gate/useGateLanguage';
import { gateOperatorCopy, gateVisitorStatus } from './gate/operator-copy';
import { GateIdentityPhoto } from './gate/GateIdentityPhoto';

type Props = { href: string; onNavigate: (href: string) => void };
type Student = { id: string; name: string; admission_number: string; class_label: string; direction: 'in' | 'out' | null; plan_state: string | null; collector_name?: string | null; avatar_url?: string | null; collector_photo?: string | null };
type Staff = { id: string; name: string; staff_code: string; designation: string; department?: string | null; avatar_url?: string | null; direction: 'in' | 'out' | null; revision: number };
type Visitor = { id: string; name: string; purpose: string; state: string; school_id: string; revision: number; host_name?: string };
type GateWorkspace = { office?: { name: string; phone: string } | null; visitors: Visitor[]; focused_visitor?: Visitor | null; activity: Array<{ id: string; name: string; direction: 'in' | 'out'; occurred_at: string; detail: string }>; visitor_counts?: Record<string, number>; visitor_pagination?: { page: number; total_pages: number } };
const queryOf = (href: string) => new URLSearchParams(href.split('?')[1] ?? '');
function hrefWith(href: string, values: Record<string, string>) { const q = queryOf(href); for (const [key, value] of Object.entries(values)) { if (value) q.set(key, value); else q.delete(key); } return `${href.split('?')[0]}${q.size ? `?${q}` : ''}`; }
const pageOf = (value: string | null) => Math.max(1, Number.parseInt(value ?? '1', 10) || 1);
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The action was not confirmed.';
const when = (value: string) => new Date(value).toLocaleString();

export function GateScreen(props: Props) {
  const { schoolId, scopeKey, user, environment } = useSession();
  const manifestQuery = useApi<unknown>(schoolId ? '/api/v1/workspace' : null);
  const resolved = useMemo(() => { try { if (!manifestQuery.data || !schoolId || !user) return null; const manifest = normalizeWorkspaceManifest(manifestQuery.data); assertWorkspaceManifestContext(manifest, { actorUserId: user.id, institutionId: schoolId, environment }); return manifest; } catch { return null; } }, [manifestQuery.data, schoolId, user?.id, environment]);
  const path = props.href.split('?')[0];
  if (!schoolId) return <Page title="In & Out"><Empty title="Choose a campus" /></Page>;
  if (manifestQuery.isPending) return <Page title="In & Out"><Loading /></Page>;
  const retainedVisitWorkspace = path === '/areas/in-out/visits' && canRetainScopedRead(manifestQuery.data, manifestQuery.error);
  if (manifestQuery.isError && !retainedVisitWorkspace || !resolved) return <Page title="In & Out"><Empty title="Current access could not be confirmed" message={manifestQuery.error?.message} onRetry={() => void manifestQuery.refetch()} /></Page>;
  const surfaces = resolved.areas.flatMap(area => area.surfaces).filter(surface => surface.href.startsWith('/areas/in-out/') || surface.href.startsWith('/work/in-out/'));
  if (path === '/areas/in-out') return <Page title="In & Out" subtitle="Campus visits and boundary records"><Section title="Available to you">{surfaces.length ? surfaces.map(surface => <Row key={surface.key} title={surface.label} detail={surface.description} icon={iconForDestination(surface.href, surface.key)} iconDestination={surface.href} onPress={() => props.onNavigate(surface.href)} />) : <Empty title="No In & Out work is currently assigned" />}</Section></Page>;
  if (!surfaces.some(surface => surface.href.split('?')[0] === path) && path === '/areas/in-out/visits' && queryOf(props.href).get('participant') === '1') return <Page title="Your visits"><Empty title="Your visitor access is unavailable" message="The registration link may have expired or been stopped. Ask your campus contact for a current invitation." onRetry={() => void manifestQuery.refetch()} /></Page>;
  if (!surfaces.some(surface => surface.href.split('?')[0] === path)) return <Page title="In & Out"><Empty title="This workspace is unavailable" message="Refresh your current campus access or return to Areas." onRetry={() => void manifestQuery.refetch()} /><Button title="Open Areas" kind="secondary" onPress={() => props.onNavigate('/areas')} /></Page>;
  const participantQuery = queryOf(props.href), visitSurfaces = surfaces.filter(surface => surface.href.split('?')[0] === '/areas/in-out/visits');
  const onlyRegistered = visitSurfaces.length > 0 && visitSurfaces.every(surface => queryOf(surface.href).get('participant') === '1');
  if (path === '/areas/in-out/visits' && (participantQuery.has('participant') || onlyRegistered)) return <GateVisitParticipant key={`${scopeKey}:${props.href}`} {...props} href={participantQuery.has('participant') ? props.href : hrefWith(props.href, { participant: '1' })} schoolId={schoolId} />;
  return path === '/areas/in-out/manage' ? <GateManagement key={scopeKey} {...props} schoolId={schoolId} /> : path.includes('/visits') ? <Visits key={`${scopeKey}:${props.href}`} {...props} schoolId={schoolId} workspaceReadPaused={manifestQuery.isError} refreshWorkspace={() => manifestQuery.refetch()} timezone={resolved.context.time_zone ?? ''} canViewPeople={resolved.areas.some(area => area.surfaces.some(surface => surface.href.startsWith('/areas/people/participants')))} /> : path.includes('/approvals') ? <Approvals key={scopeKey} {...props} schoolId={schoolId} /> : <Operate key={`${scopeKey}:${props.href}`} {...props} schoolId={schoolId} />;
}

function Operate({ href, onNavigate, schoolId }: Props & { schoolId: string }) {
  const root = `/api/v1/gate/schools/${encodeURIComponent(schoolId)}`, q = queryOf(href), page = pageOf(q.get('visitor_page')), section = gateOperatorSection(href);
  const { colors } = useTheme(), { scopeKey } = useSession(), focusedScreen = useIsFocused();
  const { language, setLanguage, preferenceError } = useGateLanguage(schoolId), t = gateOperatorCopy(language);
  const [permission, requestPermission] = useCameraPermissions(), [camera, setCamera] = useState(false), [active, setActive] = useState(AppState.currentState === 'active');
  const [query, setQuery] = useState(''), [search, setSearch] = useState(''), [personKind, setPersonKind] = useState<'students' | 'staff'>('students');
  const [student, setStudent] = useState<Student | null>(null), [staff, setStaff] = useState<Staff | null>(null), [visitor, setVisitor] = useState<Visitor | null>(null);
  const [qr, setQr] = useState(''), [passKind, setPassKind] = useState('student'), [identity, setIdentity] = useState(false), [addingVisitor, setAddingVisitor] = useState(false);
  const [scanBusy, setBusy] = useState(false), [localError, setError] = useState(''), [notice, setNotice] = useState(''), [activityPage, setActivityPage] = useState(1);
  const scanLock = useRef(false), alive = useRef(true), lockedNow = useRef(true);
  const filter = ['all', 'active', 'pending', 'approved', 'inside', 'closed'].includes(q.get('visitor_filter') ?? '') ? q.get('visitor_filter')! : 'active';
  const requestedVisitors = q.getAll('visitor'), requestedVisitor = requestedVisitors.length === 1 ? requestedVisitors[0] : '';
  const workspace = useApi<GateWorkspace>(`${root}/workspace/?${new URLSearchParams({ visitor_page: String(page), visitor_filter: filter, ...(requestedVisitor ? { visitor_id: requestedVisitor } : {}) })}`);
  const approvals = useApi<Visitor[]>(section === 'approvals' ? '/api/v1/gate/visitor-approvals/' : null);
  const matches = useApi<Array<Student | Staff>>(search.length >= 2 ? `${root}/${personKind}/?q=${encodeURIComponent(search)}` : null);
  const selectedVisitor = visitor ?? (requestedVisitor ? workspace.data?.focused_visitor ?? workspace.data?.visitors.find(person => person.id === requestedVisitor) : null);
  const capture = useOperationContext(JSON.stringify([href, student?.id, staff?.id, qr, identity]));
  useEffect(() => { alive.current = true; const subscription = AppState.addEventListener('change', value => { setActive(value === 'active'); if (value !== 'active') setCamera(false); }); return () => { alive.current = false; subscription.remove(); }; }, []);
  useEffect(() => { if (!focusedScreen) setCamera(false); }, [focusedScreen]);
  const reset = () => { setStudent(null); setStaff(null); setVisitor(null); setQr(''); setIdentity(false); setCamera(false); scanLock.current = false; };
  const writer = useGateCommand({ scopeKey, schoolId, captureContext: () => ({ assertCurrent: capture() }), refresh: () => workspace.refetch({ throwOnError: true }), onAccepted: () => { reset(); setNotice(t.saved); } });
  const pending = writer.pending, busy = writer.busy || scanBusy, error = writer.error || localError;
  const locked = writer.locked || scanBusy || workspace.isError || !workspace.data || !focusedScreen || !active;
  lockedNow.current = locked;
  const currentError = (cause: unknown, assertCurrent: () => void) => { try { assertCurrent(); if (alive.current) setError(errorText(cause)); } catch { /* The original screen no longer owns this response. */ } };
  const scan = async (value: string) => {
    if (scanLock.current || pending || locked) return;
    let assertCurrent: () => void;
    try { assertCurrent = capture(); } catch { return; }
    scanLock.current = true; setCamera(false); setBusy(true); setError('');
    try {
      const result = await apiFetch<{ kind: 'student' | 'pickup'; student: Student } | { kind: 'visitor'; visitor: Visitor }>(`${root}/scan/`, { method: 'POST', body: JSON.stringify({ qr: value }) });
      assertCurrent(); if (!alive.current) return;
      reset(); if (result.kind === 'visitor') setVisitor(result.visitor); else { setStudent(result.student); setPassKind(result.kind); setQr(value); }
      setNotice(t.checked);
    } catch (cause) { currentError(cause, assertCurrent); } finally { if (alive.current) setBusy(false); scanLock.current = false; }
  };
  const select = async (person: Student | Staff) => {
    if (locked) return; const assertCurrent = capture(); setBusy(true); setError('');
    try { const latest = await apiFetch<Student | Staff>(`${root}/${personKind}/${encodeURIComponent(person.id)}/`); assertCurrent(); if (!alive.current || latest.id !== person.id) return; reset(); if (personKind === 'students') { setStudent(latest as Student); setPassKind('student'); } else setStaff(latest as Staff); }
    catch (cause) { currentError(cause, assertCurrent); } finally { if (alive.current) setBusy(false); }
  };
  const recordPerson = (direction: 'in' | 'out') => {
    if (!identity || locked || (!student && !staff) || direction === 'out' && (student ? passKind !== 'pickup' || student.plan_state !== 'ready' || student.direction !== 'in' || !qr : staff?.direction !== 'in')) return;
    const assertCurrent = capture();
    Alert.alert(direction === 'out' ? t.confirmExit : t.confirmEntry, student && direction === 'out' ? t.confirmHandover : t.confirmMovement, [{ text: t.cancel, style: 'cancel' }, { text: t.recordMovement, onPress: () => { try { assertCurrent(); if (lockedNow.current) return; void writer.run({ path: `${root}/${student ? 'movements' : 'staff-movements'}/`, body: JSON.stringify({ ...(student ? { student_id: student.id, ...(direction === 'out' ? { qr } : {}) } : { staff_profile_id: staff!.id }), direction, identity_verified: true, command_id: Crypto.randomUUID() }), label: t.movementSaved }); } catch (cause) { currentError(cause, assertCurrent); } } }]);
  };
  const moveVisitor = (person: Visitor, direction: 'in' | 'out') => {
    if (locked) return; const assertCurrent = capture(), reviewedId = person.id, reviewedRevision = person.revision;
    Alert.alert(direction === 'in' ? t.confirmEntry : t.confirmExit, `${person.name} · ${t.confirmMovement}`, [{ text: t.cancel, style: 'cancel' }, { text: t.recordMovement, onPress: () => { try { assertCurrent(); if (!lockedNow.current) void writer.run({ path: `${root}/visitors/${encodeURIComponent(reviewedId)}/${direction}/`, body: JSON.stringify({ expected_revision: reviewedRevision }), label: t.movementSaved }); } catch (cause) { currentError(cause, assertCurrent); } } }]);
  };
  const openSection = (next: 'operate' | 'approvals' | 'records' | 'visitors') => { if (!busy) onNavigate(gateOperatorSectionHref(href, next)); };
  const activityPages = Math.max(1, Math.ceil((workspace.data?.activity.length ?? 0) / 20)), currentActivityPage = Math.min(activityPage, activityPages);
  const phoneHref = gateOfficePhoneHref(workspace.data?.office?.phone);
  const callOffice = () => { try { const assertCurrent = capture(); if (!phoneHref) return; void Linking.openURL(phoneHref).catch(() => { try { assertCurrent(); setError(t.callUnavailable); } catch { /* No feedback into a different view. */ } }); } catch { /* No call from an inactive campus view. */ } };
  useScreenExitGuard({ blocked: busy });
  const visitorRows = <Section title={t.visitors}>
    <ChoiceMenu label={t.visitorFilter} value={filter} options={(['active', 'pending', 'approved', 'inside', 'closed', 'all'] as const).map(value => ({ value, label: t[value] + (workspace.data?.visitor_counts?.[value] !== undefined ? ` · ${workspace.data.visitor_counts[value]}` : '') }))} disabled={busy} onChange={visitor_filter => onNavigate(hrefWith(href, { section: section === 'records' ? 'records' : 'visitors', visitor_filter, visitor_page: '', visitor: '' }))}/>
    {requestedVisitors.length > 1 || requestedVisitor && !selectedVisitor ? <><Empty title={t.visitorUnavailable} message={t.visitorMissing}/><ControlButton title={t.visitorQueue} onPress={() => openSection('visitors')}/></> : selectedVisitor ? <VisitorRow visitor={selectedVisitor} language={language} locked={locked} onMove={moveVisitor}/> : workspace.data?.visitors.length ? workspace.data.visitors.map(person => <VisitorRow key={person.id} visitor={person} language={language} locked={locked} onMove={moveVisitor}/>) : <Empty title={t.noVisitors}/>}
    {workspace.data?.visitor_pagination && workspace.data.visitor_pagination.total_pages > 1 ? <View style={{ flexDirection: 'row', gap: 8 }}><ControlButton title={t.previousVisitors} disabled={busy || page <= 1} onPress={() => onNavigate(hrefWith(href, { visitor_page: String(page - 1) }))}/><ControlButton title={t.nextVisitors} disabled={busy || page >= workspace.data.visitor_pagination.total_pages} onPress={() => onNavigate(hrefWith(href, { visitor_page: String(page + 1) }))}/></View> : null}</Section>;
  const records = (preview: boolean) => <Section title={t.recent}>{workspace.data?.activity.length ? (preview ? workspace.data.activity.slice(0, 5) : workspace.data.activity.slice((currentActivityPage - 1) * 20, currentActivityPage * 20)).map(item => <Row key={item.id} title={item.name} detail={`${item.detail}\n${new Date(item.occurred_at).toLocaleString(language === 'hi' ? 'hi-IN' : undefined)}`} status={item.direction === 'in' ? t.entry : t.exit}/>) : <Empty title={t.noRecent}/>}{preview ? <ControlButton title={t.viewAll} disabled={busy} onPress={() => openSection('records')}/> : <LocalPages page={currentActivityPage} pages={activityPages} onChange={setActivityPage} language={language} label={t.records}/>}</Section>;
  if (addingVisitor) return <Page title={t.visitorEntry}><GateVisitorEntry href={href} schoolId={schoolId} language={language} disabled={writer.locked} onClose={() => setAddingVisitor(false)} onSaved={person => { reset(); setVisitor(person); setAddingVisitor(false); setNotice(person.state === 'inside' ? t.entryRecorded : t.approvalSent); void workspace.refetch(); }}/></Page>;
  return <Page title={t.title} subtitle={t.subtitle} refreshing={section === 'approvals' ? approvals.isRefetching : workspace.isRefetching} onRefresh={() => { if (section === 'approvals') void approvals.refetch(); else void workspace.refetch(); }}>
    <ScreenBack title={language === 'hi' ? 'प्रवेश और निकास पर लौटें' : 'Back to In & Out'} fallbackHref={section && section !== 'operate' ? gateOperatorSectionHref(href, 'operate') : '/areas/in-out'}/>
    {notice ? <Notice message={notice} tone="success"/> : null}{error ? <Notice message={error} tone="danger"/> : null}<GateRecovery writer={writer} language={language}/>
    <SegmentedControl label={t.views} value={section === 'visitors' ? 'operate' : section ?? ''} options={[{ value: 'operate', label: t.operate }, { value: 'approvals', label: t.approvals }, { value: 'records', label: t.records }]} disabled={busy} onChange={value => openSection(value as 'operate' | 'approvals' | 'records')}/>
    {!section ? <><Empty title={t.unavailableView}/><ControlButton title={t.openCheckpoint} onPress={() => openSection('operate')}/></> : section === 'approvals' ? <GateApprovalContent href={href} onNavigate={onNavigate} schoolId={schoolId} language={language} list={approvals} embedded/> : workspace.isPending ? <Loading/> : workspace.isError ? <Empty title={t.workspaceError} message={workspace.error.message} onRetry={() => void workspace.refetch()}/> : section === 'visitors' ? visitorRows : section === 'records' ? <>{records(false)}{visitorRows}</> : <>
      {student || staff ? <Section title={(student ?? staff)!.name}>
        <GateIdentityPhoto reference={(student ?? staff)!.avatar_url} source={JSON.stringify([href, student ? 'student' : 'staff', (student ?? staff)!.id])} label={student ? t.learnerPhoto : t.staffPhoto} language={language} enabled={!workspace.isError && active && focusedScreen}/>
        <Row title={t.identity} detail={student ? `${student.class_label} · ${student.admission_number}` : `${staff!.designation} · ${staff!.staff_code}`}/>{staff ? <Row title={t.department} detail={staff.department || '—'}/> : null}
        <Row title={t.latest} detail={(student ?? staff)!.direction === 'in' ? t.entry : (student ?? staff)!.direction === 'out' ? t.exit : t.noMovement}/>
        {student && passKind === 'pickup' ? <><Row title={t.collector} detail={student.collector_name ?? '—'}/><GateIdentityPhoto reference={student.collector_photo} source={JSON.stringify([href, 'pickup', student.id, qr])} label={t.collectorPhoto} language={language} enabled={!workspace.isError && active && focusedScreen}/><Notice message={t.collectorCheck}/></> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><Switch accessibilityLabel={student && passKind === 'pickup' ? t.verifiedCollector : t.verified} value={identity} onValueChange={setIdentity} disabled={locked}/><Text style={{ flex: 1, color: colors.ink, fontSize: 16 }}>{student && passKind === 'pickup' ? t.verifiedCollector : t.verified}.</Text></View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Button title={t.recordEntry} disabled={locked || !identity || (student ?? staff)!.direction === 'in'} onPress={() => recordPerson('in')}/><Button title={t.recordExit} kind="secondary" disabled={locked || !identity || (student ? passKind !== 'pickup' || student.plan_state !== 'ready' || student.direction !== 'in' || !qr : staff!.direction !== 'in')} onPress={() => recordPerson('out')}/></View>
        {student && passKind !== 'pickup' ? <Notice message={t.pickupRequired}/> : null}<ControlButton title={t.another} disabled={!!pending || busy} onPress={reset}/>
      </Section> : <>
        <Button title={camera ? t.closeCamera : t.scan} disabled={locked} onPress={() => { if (camera) { setCamera(false); return; } if (permission?.granted) setCamera(true); else { const assertCurrent = capture(); void requestPermission().then(result => { assertCurrent(); if (result.granted) setCamera(true); }).catch(cause => currentError(cause, assertCurrent)); } }}/>
        {permission && !permission.granted && !permission.canAskAgain ? <ControlButton title={t.cameraSettings} onPress={() => void Linking.openSettings()}/> : null}
        {camera && active && focusedScreen && permission?.granted ? <View style={{ borderRadius: 24, overflow: 'hidden', height: 300 }}><CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={event => void scan(event.data)} accessibilityLabel={t.qrCamera}/></View> : null}<Notice message={t.scanMeaning}/>
        <SegmentedControl label={t.findPerson} value={personKind} options={[{ value: 'students', label: t.findLearner }, { value: 'staff', label: t.findStaff }]} disabled={locked} onChange={value => { setPersonKind(value as 'students' | 'staff'); setSearch(''); }}/>
        <SearchField label={t.nameIdentifier} placeholder={t.nameIdentifier} submitLabel={t.findPerson} clearLabel={t.clearSearch} value={query} onChangeText={value => setQuery(value.slice(0, 100))} disabled={locked} submitDisabled={query.trim().length < 2} onSubmit={() => setSearch(query.trim())} onClear={() => setSearch('')}/>
        {search ? matches.isPending ? <Loading/> : matches.isError ? <Empty title={t.searchError} message={matches.error.message} onRetry={() => void matches.refetch()}/> : <Section title={t.matching}>{matches.data?.length ? matches.data.map(person => <Row key={person.id} title={person.name} detail={'admission_number' in person ? `${person.class_label} · ${person.admission_number}` : `${person.designation} · ${person.staff_code}`} onPress={locked ? undefined : () => void select(person)}/>) : <Empty title={t.noMatches}/>}</Section> : null}
      </>}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}><ControlButton title={t.visitorEntry} kind="primary" disabled={locked} onPress={() => setAddingVisitor(true)}/><ControlButton title={t.visitorQueue} disabled={busy} onPress={() => openSection('visitors')}/></View>{selectedVisitor ? visitorRows : null}{records(true)}
    </>}
    {workspace.data?.office ? <Row title={workspace.data.office.name} detail={workspace.data.office.phone}><ControlButton title={t.office} disabled={!phoneHref || !focusedScreen || !active} onPress={callOffice}/></Row> : null}
    <GateLanguageControl language={language} onChange={setLanguage}/>{preferenceError ? <Notice tone="warning" message={t.preferenceError}/> : null}
  </Page>;
}
function GateLanguageControl({ language, onChange }: { language: GateLanguage; onChange(language: GateLanguage): void }) { const t = gateOperatorCopy(language); return <View accessibilityLabel={t.language} style={{ alignItems: 'flex-end' }}><ControlButton title={language === 'hi' ? 'English' : 'हिन्दी'} onPress={() => onChange(language === 'hi' ? 'en' : 'hi')}/></View>; }
function VisitorRow({ visitor, locked, onMove, language = 'en' }: { visitor: Visitor; locked: boolean; onMove: (visitor: Visitor, direction: 'in' | 'out') => void; language?: GateLanguage }) { const t = gateOperatorCopy(language); return <Row title={visitor.name} detail={`${visitor.purpose}${visitor.host_name ? ` · ${visitor.host_name}` : ''}`} status={gateVisitorStatus(language, visitor.state)}><View style={{ flexDirection: 'row', gap: 8 }}>{visitor.state === 'approved' ? <Button title={t.recordEntry} disabled={locked} onPress={() => onMove(visitor, 'in')}/> : visitor.state === 'inside' ? <Button title={t.recordExit} disabled={locked} onPress={() => onMove(visitor, 'out')}/> : null}</View></Row>; }
function LocalPages({ page, pages, onChange, label, language = 'en' }: { page: number; pages: number; onChange: (page: number) => void; label: string; language?: GateLanguage }) { const t = gateOperatorCopy(language); return pages > 1 ? <View accessibilityLabel={label} style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}><ControlButton title={t.previous} disabled={page <= 1} onPress={() => onChange(page - 1)}/><ControlButton title={`${t.page} ${page} ${t.of} ${pages}`} disabled onPress={() => {}}/><ControlButton title={t.next} disabled={page >= pages} onPress={() => onChange(page + 1)}/></View> : null; }
function GateRecovery({ writer, language = 'en' }: { writer: ReturnType<typeof useGateCommand>; language?: GateLanguage }) { const t = gateOperatorCopy(language), pending = writer.pending; return pending ? <><Notice message={pending.phase === 'accepted' ? t.accepted : pending.phase === 'obsolete' ? t.obsolete : t.unknown} tone="warning"/><Row title={t.retained} detail={pending.label}/>{pending.phase !== 'unknown' || pending.confirmationPath ? <Button title={pending.phase === 'accepted' ? t.refreshSaved : pending.phase === 'obsolete' ? t.reviewCurrent : t.checkResult} kind="secondary" busy={writer.busy} onPress={() => void writer.check()}/> : <Notice message={t.noReceipt}/>}{pending.phase === 'unknown' && writer.retryAllowed ? <Button title={t.retrySame} busy={writer.busy} onPress={() => void writer.retry()}/> : null}</> : null; }
function Approvals(props: Props & { schoolId: string }) {
  const { language, setLanguage, preferenceError } = useGateLanguage(props.schoolId), t = gateOperatorCopy(language), list = useApi<Visitor[]>('/api/v1/gate/visitor-approvals/');
  return <Page title={t.approvalsTitle} refreshing={list.isRefetching} onRefresh={() => void list.refetch()}><ScreenBack title={language === 'hi' ? 'प्रवेश और निकास पर लौटें' : 'Back to In & Out'} fallbackHref="/areas/in-out"/><GateApprovalContent {...props} language={language} list={list}/><GateLanguageControl language={language} onChange={setLanguage}/>{preferenceError ? <Notice tone="warning" message={t.preferenceError}/> : null}</Page>;
}
function GateApprovalContent({ schoolId, href, language, list, embedded = false }: Props & { schoolId: string; language: GateLanguage; list: ReturnType<typeof useApi<Visitor[]>>; embedded?: boolean }) {
  const { scopeKey } = useSession(), t = gateOperatorCopy(language), focused = useIsFocused();
  // The accepted refresh may advance this list. Keep the operation lease bound
  // to its owner, and compare the displayed visitor again at confirmation time.
  const capture = useOperationContext(JSON.stringify([href, 'visitor-approvals'])), lockedNow = useRef(true), currentVisitors = useRef<Visitor[]>([]);
  const [page, setPage] = useState(1), [reviewError, setReviewError] = useState(''), writer = useGateCommand({ scopeKey, schoolId, captureContext: () => ({ assertCurrent: capture() }), refresh: () => list.refetch({ throwOnError: true }) });
  const visitors = !list.isError ? list.data?.filter(visitor => visitor.school_id === schoolId) ?? [] : [], pages = Math.max(1, Math.ceil(visitors.length / 20)), currentPage = Math.min(page, pages), locked = writer.locked || list.isError || !focused || AppState.currentState !== 'active'; lockedNow.current = locked;
  currentVisitors.current = visitors;
  useScreenExitGuard({ blocked: writer.busy });
  const decide = (visitor: Visitor, action: 'approve' | 'deny') => {
    if (locked || visitor.state !== 'pending') return; setReviewError(''); const assertCurrent = capture(), reviewedId = visitor.id, reviewedRevision = visitor.revision;
    const send = () => { try { assertCurrent(); const current = currentVisitors.current.find(person => person.id === reviewedId); if (lockedNow.current) return; if (!current || current.revision !== reviewedRevision || current.state !== 'pending') { setReviewError(t.reviewChanged); return; } void writer.run({ path: `/api/v1/gate/schools/${encodeURIComponent(schoolId)}/visitors/${encodeURIComponent(reviewedId)}/${action}/`, body: JSON.stringify({ expected_revision: reviewedRevision }), label: action === 'approve' ? t.visitorApproved : t.visitorDenied }); } catch { /* A changed source cannot dispatch its old confirmation. */ } };
    if (action === 'approve') send(); else Alert.alert(t.denyQuestion, visitor.purpose, [{ text: t.cancel, style: 'cancel' }, { text: t.confirmDecision, style: 'destructive', onPress: send }]);
  };
  return <>{!embedded ? <>{writer.error ? <Notice tone="danger" message={writer.error}/> : null}<GateRecovery writer={writer} language={language}/></> : null}{reviewError ? <Notice tone="warning" message={reviewError}/> : null}{list.isPending ? <Loading/> : list.isError ? <Empty title={t.approvalsError} message={list.error.message} onRetry={() => void list.refetch()}/> : visitors.length ? <Section title={t.awaiting}>{visitors.slice((currentPage - 1) * 20, currentPage * 20).map(visitor => <Row key={visitor.id} title={visitor.name} detail={visitor.purpose} status={gateVisitorStatus(language, visitor.state)}><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Button title={t.approve} disabled={locked || visitor.state !== 'pending'} onPress={() => decide(visitor, 'approve')}/><Button title={t.deny} kind="secondary" disabled={locked || visitor.state !== 'pending'} onPress={() => decide(visitor, 'deny')}/></View></Row>)}<LocalPages page={currentPage} pages={pages} onChange={setPage} label={t.approvals} language={language}/></Section> : <Empty title={t.noApprovals}/>}</>;
}

function Visits({ href, onNavigate, schoolId, timezone = '', canViewPeople = false, workspaceReadPaused = false, refreshWorkspace }: Props & { schoolId: string; timezone?: string; canViewPeople?: boolean; workspaceReadPaused?: boolean; refreshWorkspace?(): Promise<unknown> }) {
  const { scopeKey } = useSession(), client=useQueryClient();
  const root = `/api/v1/gate/schools/${encodeURIComponent(schoolId)}/visit-arrangements`, q = queryOf(href), id = q.get('visit'), page = pageOf(q.get('page'));
  const directShared = q.get('shared') === '1';
  const discovery = useApi<{ can_manage: boolean; has_shared: boolean; has_questions: boolean }>(!directShared ? `${root}/shared/discovery/` : null);
  const shared = directShared || canRetainScopedRead(discovery.data, discovery.error) && discovery.data?.can_manage === false;
  const ready = directShared || canRetainScopedRead(discovery.data, discovery.error);
  const [search, setSearch] = useState(q.get('search') ?? ''), [observation, setObservation] = useState({ source: '', count: '' }), [note, setNote] = useState('');
  const [notice, setNotice] = useState(''),[editor,setEditor]=useState<'new'|'edit'|null>(null),[completedId,setCompletedId]=useState(''),[sharingEditing,setSharingEditing]=useState(false),[acceptedKey,setAcceptedKey]=useState(''),[placePreview,setPlacePreview]=useState(false);const {complete}=useCampusNavigation(href);
  const list = useApi<{ visits: Array<Visit | SharedVisit>; timezone: string; pagination: { page: number; total_pages: number; total: number } }>(ready && !id ? shared ? `${root}/shared/?page=${page}` : `${root}/?${new URLSearchParams({ view: q.get('view') ?? 'upcoming', search: q.get('search') ?? '', page: String(page) })}` : null);
  const detail = useApi<VisitDetail | SharedDetail>(ready && id ? `${root}/${encodeURIComponent(id)}/${shared ? 'shared/' : ''}` : null);
  const data = !ready || !canRetainScopedRead(detail.data, detail.error) || detail.data?.visit.id !== id ? undefined : detail.data, visit = data?.visit;
  const sharedDetail = data && 'share' in data ? data : null, managerDetail = data && 'can_cancel' in data ? data : null;
  const observationSource = JSON.stringify([scopeKey, id, visit?.revision]), count = observation.source === observationSource ? observation.count : '';
  const setCount = (value: string) => setObservation({ source: observationSource, count: value });
  const onboarding = useApi<unknown>(managerDetail ? `${root}/${encodeURIComponent(managerDetail.visit.id)}/onboarding-link/` : null);
  let onboardingState: ReturnType<typeof readVisitOnboardingState> | null = null;
  if (managerDetail && onboarding.data && !onboarding.error) try { onboardingState = readVisitOnboardingState(onboarding.data, managerDetail.visit.id); } catch { /* Never expose an unverified invitation action. */ }
  const campusTimezone = sharedDetail?.timezone ?? timezone;
  const visitWhen = (value: string) => campusTimezone ? gateSharedVisitTime(value, campusTimezone) : 'Campus time unavailable';
  const reload = async () => { if (id) await detail.refetch({ throwOnError: true }); else await list.refetch({ throwOnError: true }); };
  const writer = useGateCommand({ scopeKey, schoolId, captureContext: captureApiContext, refresh: async command=>{if(command?.kind==='visit'&&command.phase!=='obsolete'){const receipt=await apiFetch<{state:string;result?:unknown}>(command.confirmationPath!);if(receipt.state!=='accepted'||!nativeGateAcceptedResult(command,receipt.result,true))throw new Error('The exact visit command is not confirmed.');const current=await apiFetch<VisitDetail>(command.reviewPath!);if(current.visit.id!==command.sourceId)throw new Error('The current exact visit is unavailable.');}if(command?.kind==='visit-sharing'){if(command.phase!=='obsolete'){const receipt=await apiFetch<{state:string;result?:unknown}>(command.confirmationPath!);if(receipt.state!=='accepted'||!nativeGateAcceptedResult(command,receipt.result,true))throw new Error('The exact sharing command is not confirmed.');}readVisitSharing(await apiFetch(command.reviewPath!));}await reload();await client.invalidateQueries({queryKey:['campus',scopeKey],predicate:query=>typeof query.queryKey[2]==='string'&&query.queryKey[2].startsWith(`${root}/${id}/`)});}, onAccepted: command => { setAcceptedKey(command?.key??'');setNote(''); setNotice(command?.label ?? 'Visit updated.');if(command?.kind==='visit'&&['arranged','changed'].includes(command.action)){setEditor(null);setCompletedId(command.sourceId);} } });
  const pending = writer.pending, error = writer.error;
  const send = (path: string, body: Record<string, unknown>, label: string, isShared = false) => { if (!id || isShared && !sharedDetail) return; const commandId = Crypto.randomUUID(); void writer.run({ path, body: JSON.stringify({ ...body, command_id: commandId }), label, commandId, visitId: id, shared: isShared, ...(isShared && sharedDetail ? { sharing: { shareId: sharedDetail.share.id, shareRootId: sharedDetail.share.root_id, questionId: sharedDetail.question?.id ?? null } } : {}) }); };
  const paused = workspaceReadPaused || !directShared && discovery.isError || detail.isError;
  const readLocked = writer.locked || !ready || paused, locked = readLocked || sharingEditing, sourceWriter = { ...writer, locked: readLocked };
  useScreenExitGuard({blocked:writer.busy});useEffect(()=>{if(completedId&&!writer.busy&&!writer.pending){setCompletedId('');complete(hrefWith(href,{visit:completedId}));}},[completedId,writer.busy,writer.pending,complete]);
  useEffect(()=>{setPlacePreview(false);},[id,visit?.revision,locked,editor,scopeKey]);
  const visitorInvitation = managerDetail && onboardingState?.can_manage && !editor && !sharingEditing ? <GateVisitOnboarding href={href} schoolId={schoolId} visit={managerDetail.visit} state={onboardingState} timezone={campusTimezone} disabled={locked || onboardingState.visit_revision !== managerDetail.visit.revision} onNavigate={onNavigate} refresh={async () => (await onboarding.refetch({ throwOnError: true })).data} /> : undefined;
  return <Page footer={visitorInvitation} footerKeyboardBehavior="hide" footerSeparator={false} title={editor ? editor === 'edit' ? 'Edit visit' : 'Arrange visit' : visit?.guest_label ?? 'Visits'} header={visit && !editor ? <VisitDetailHeader visit={visit} /> : undefined} maxWidth={visit && !editor ? 700 : 920} subtitle={shared ? 'Shared with you' : 'Campus visit arrangements'} refreshing={list.isRefetching || detail.isRefetching} onRefresh={() => void reload()}>
    {error ? <Notice tone="danger" message={error} /> : null}{notice ? <Notice tone="success" message={notice} /> : null}<GateRecovery writer={writer} />
    {paused && ready ? <Empty title="Visit access could not refresh" message="Your entries are kept. Refresh current access before saving or sharing." onRetry={() => void (workspaceReadPaused ? refreshWorkspace?.() : discovery.isError ? discovery.refetch() : detail.refetch())} /> : null}{!ready || editor==='edit' && !managerDetail ? discovery.isError || detail.isError ? <Empty title="Visit access could not load" message={discovery.error?.message || detail.error?.message} onRetry={() => void (discovery.isError ? discovery.refetch() : detail.refetch())} /> : <Loading /> : editor?<GateVisitEditor root={root} initial={editor==='edit'?managerDetail?.visit:undefined} write={sourceWriter} onClose={()=>setEditor(null)}/>: id ? <><ScreenBack title="Back to visits" disabled={!!pending} fallbackHref={hrefWith(href, { visit: '' })} />{detail.isPending ? <Loading /> : !visit ? <Empty title="Visit unavailable" message={detail.error?.message} onRetry={() => void detail.refetch()} /> : <><VisitDetailCard visit={visit} timezone={campusTimezone} onPlacePress={managerDetail && !locked ? () => setPlacePreview(true) : undefined} onContactPress={canViewPeople && managerDetail && !locked ? () => onNavigate(`/areas/people/participants/${encodeURIComponent(managerDetail.visit.contact.id)}`) : undefined} /><VisitPlanNotice />{managerDetail && !editor && !onboardingState ? <Section title="Visitor invitations">{onboarding.isPending ? <Loading label="Checking visitor invitations…" /> : <Empty title="Visitor invitations could not load" message="The visit is still available. Refresh invitation access before creating or sharing a link." onRetry={() => void onboarding.refetch()} />}</Section> : null}{sharedDetail ? <><GateSharedVisitChanges detail={sharedDetail}/><Row title="Shared until" detail={`${visitWhen(sharedDetail.share.ends_at)} · ${sharedDetail.timezone}`} /><Row title="Directions" detail={sharedDetail.share.directions || 'No additional directions provided'} /><Row title="Questions go to" detail={sharedDetail.share.owner.label} status={sharedDetail.share.owner.available ? 'Available' : 'Currently unavailable'} />{sharedDetail.question ? <Section title="Questions & replies">{sharedDetail.question.entries.map(entry => <Row key={entry.id} title={entry.author_label} detail={`${entry.note}\n${visitWhen(entry.recorded_at)}`} status={entry.kind === 'reply' ? 'Campus reply' : 'Question'} />)}{sharedDetail.question.entries_has_more?<Notice message="Showing the latest 50 question and reply entries available in this shared view."/>:null}</Section> : null}{sharedDetail.share.can_ask || sharedDetail.share.can_reply ? <><Field label={sharedDetail.share.can_reply ? 'Reply to the organiser' : 'Question for the campus'} value={note} onChangeText={setNote} multiline editable={!locked} maxLength={2000} /><Button title={sharedDetail.share.can_reply ? 'Send reply' : 'Ask campus'} disabled={locked || note.trim().length < 3} onPress={() => sharedDetail.share.can_reply && sharedDetail.question ? send(`${root}/${encodeURIComponent(id)}/shared/questions/${encodeURIComponent(sharedDetail.question.id)}/replies/`, { expected_revision: sharedDetail.question.revision, note: note.trim() }, 'Reply sent.', true) : send(`${root}/${encodeURIComponent(id)}/shared/questions/`, { expected_revision: sharedDetail.question?.revision ?? 0, share_id: sharedDetail.share.id, note: note.trim() }, 'Question sent to the campus owner.', true)} /></> : null}</> : null}{managerDetail ? <><GateVisitManagement key={managerDetail.visit.id} href={href} detail={managerDetail} locked={locked} count={count} onCount={setCount} when={visitWhen} timezone={campusTimezone} onEdit={() => setEditor('edit')} onRecord={(direction, observedCount) => send(`${root}/${encodeURIComponent(id)}/movements/`, { expected_revision: visit.revision, direction, observed_count: observedCount }, 'Observed visit movement recorded.')} onCancel={() => send(`${root}/${encodeURIComponent(id)}/cancel/`, { expected_revision: visit.revision }, 'Visit cancelled.')} /><Disclosure title="Organiser coordination"><GateVisitSharing href={href} root={root} schoolId={schoolId} visit={managerDetail.visit} timezone={campusTimezone} write={sourceWriter} acceptedKey={acceptedKey} onEditing={setSharingEditing} onNavigate={onNavigate}/></Disclosure></> : null}</>}</> : <>
      {discovery.data?.can_manage && (discovery.data.has_shared || discovery.data.has_questions) ? <View style={{ flexDirection: 'row', gap: 8 }}><Button title="Campus visits" kind={shared ? 'secondary' : 'primary'} onPress={() => onNavigate(hrefWith(href, { shared: '', page: '' }))} /><Button title="Shared with me" kind={shared ? 'primary' : 'secondary'} onPress={() => onNavigate(hrefWith(href, { shared: '1', page: '' }))} /></View> : null}
      {!shared ? <>
        {discovery.data?.can_manage ? <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}><ControlButton title="Arrange visit" kind="primary" disabled={locked} onPress={() => setEditor('new')} /></View> : null}
        <SearchField label="Find a visit" placeholder="Find a visit" submitLabel="Search visits" value={search} onChangeText={value => setSearch(value.slice(0, 80))} onSubmit={() => onNavigate(hrefWith(href, { search: search.trim(), page: '' }))} onClear={() => onNavigate(hrefWith(href, { search: '', page: '' }))} />
        <SegmentedControl label="Visit period" value={q.get('view') ?? 'upcoming'} options={['upcoming', 'past', 'cancelled', 'all'].map(value => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }))} onChange={view => onNavigate(hrefWith(href, { view, page: '' }))} />
      </> : null}
      {list.isPending ? <Loading /> : list.isError ? <Empty title="Visits could not load" message={list.error.message} onRetry={() => void list.refetch()} /> : !list.data?.visits.length ? <Empty title="No visits in this view" /> : <View style={{ gap: 10 }}>{list.data.visits.map(item => <Row key={item.id} title={item.guest_label} icon="visits" detail={`${item.title} · ${item.party_size} ${item.party_size === 1 ? 'person' : 'people'}\n${gateSharedVisitTime(item.starts_at, list.data!.timezone)} – ${gateSharedVisitTime(item.ends_at, list.data!.timezone)}\n${item.place.label}`} status={item.state === 'cancelled' ? 'Cancelled' : 'Confirmed'} statusTone={item.state === 'cancelled' ? 'danger' : 'positive'} onPress={() => onNavigate(hrefWith(href, { visit: item.id, ...(shared ? { shared: '1' } : {}) }))} />)}</View>}
      {list.data && list.data.pagination.total_pages > 1 ? <View style={{ flexDirection: 'row', gap: 8 }}><Button title="Previous visits" kind="secondary" disabled={page <= 1} onPress={() => onNavigate(hrefWith(href, { page: String(page - 1) }))} /><Button title="Next visits" kind="secondary" disabled={page >= list.data.pagination.total_pages} onPress={() => onNavigate(hrefWith(href, { page: String(page + 1) }))} /></View> : null}
    </>}
    {placePreview && managerDetail && !locked && !editor ? <CampusPlacePortal key={`${scopeKey}:${managerDetail.visit.id}:${managerDetail.visit.revision}`} schoolId={schoolId} destination={managerDetail.visit.place} window={{startsAt:managerDetail.visit.starts_at,endsAt:managerDetail.visit.ends_at,timezone:campusTimezone}} onClose={()=>setPlacePreview(false)}/> : null}
  </Page>;
}
