import { ScreenBack } from '../ui/BackNavigation';
import React, { useMemo, useState } from 'react';
import { Platform, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { assertWorkspaceManifestContext, normalizeWorkspaceManifest } from '../../../packages/contracts/src/workspace-normalizer';
import { useSession } from '../auth/SessionProvider';
import { attendanceOperationalSurface } from '../lib/attendance-access';
import { useAttendanceEvidenceCommand } from '../lib/attendance-evidence-command';
import { requiresOwningAttendanceSource } from '../lib/attendance-evidence';
import type { AttendanceStatus } from '../lib/attendance-draft';
import { useApi } from '../lib/query';
import { Button, Empty, Field, Loading, Notice, Page, Row, Section } from '../ui/components';
import { ChoiceMenu, ControlButton, Facts, InfoDisclosure } from '../ui/DomainControls';
import { useTheme } from '../ui/theme';
import { AttendanceSheet } from './attendance/AttendanceSheet';
import { DomainText } from './ResourcesScreen';
type Props = { href: string; onNavigate: (href: string) => void };
type Register = { register: { id: string; revision: number; title: string; state: string; starts_at: string; ends_at: string; time_zone: string; source_kind?: string; entry_mode?: string; source?: { href: string; label: string } }; roster: Array<{ person_id: string; name: string; status: AttendanceStatus | null }>; allowed_statuses: AttendanceStatus[]; availability_reason: string | null; capabilities: { can_record: boolean; can_review_evidence: boolean }; pending_evidence: Array<{ id: string; person_id: string; name: string; claimed_status: AttendanceStatus; capture_channel: string; observed_at: string; received_at: string; note: string; source_reference: string }> };
const label = (value: string) => value.replaceAll('_', ' ').replace(/^./, value => value.toUpperCase());
export function AttendanceEvidenceScreen(props: Props) {
  const { schoolId, scopeKey, user, environment } = useSession();
  const manifest = useApi<unknown>(schoolId ? '/api/v1/workspace' : null);
  const source = useMemo(() => { try { if (!user || !schoolId || !manifest.data) return null; return assertWorkspaceManifestContext(normalizeWorkspaceManifest(manifest.data), { actorUserId: user.id, institutionId: schoolId, environment }); } catch { return null; } }, [user?.id, schoolId, environment, manifest.data]);
  const query = new URLSearchParams(props.href.split('?')[1] ?? ''), id = query.get('register_id');
  if (manifest.isPending) return <Page title="Attendance reports"><Loading /></Page>;
  if (!source || !schoolId || manifest.isError || !attendanceOperationalSurface(source, '/areas/attendance/evidence')) return <Page title="Attendance reports"><Empty title="Attendance review access could not be confirmed" message={manifest.error?.message} onRetry={() => void manifest.refetch()} /></Page>;
  if (!id || query.getAll('register_id').length !== 1 || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return <Page title="Attendance reports"><Empty title="Choose an attendance register" /><Button title="Open registers" onPress={() => props.onNavigate('/areas/attendance/registers')} /></Page>;
  const operational = attendanceOperationalSurface(source, '/areas/attendance/evidence')!;
  return <EvidenceView key={`${scopeKey}:${id}`} {...props} schoolId={schoolId} registerId={id} scopeKey={scopeKey} backPath={operational.key === 'coordination' ? '/areas/attendance/coordination' : '/areas/attendance/registers'} />;
}
function EvidenceView({ href, onNavigate, schoolId, registerId, scopeKey, backPath }: Props & { schoolId: string; registerId: string; scopeKey: string; backPath: string }) {
  const { environment } = useSession(), { colors, dark } = useTheme();
  const query = useApi<Register>(`/api/v1/schools/${encodeURIComponent(schoolId)}/activities/registers/${encodeURIComponent(registerId)}`);
  const [accepted, setAccepted] = useState<Register | null>(null), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const [report, setReport] = useState(false), [reviewId, setReviewId] = useState(''), [decision, setDecision] = useState<'accepted' | 'rejected'>('accepted');
  const [reason, setReason] = useState(''), [personId, setPersonId] = useState(''), [status, setStatus] = useState<AttendanceStatus>('present'), [observed, setObserved] = useState<Date | null>(null), [reference, setReference] = useState(''), [note, setNote] = useState('');
  const [timeMode, setTimeMode] = useState<'date' | 'time' | null>(null), [evidencePage, setEvidencePage] = useState(1);
  const journal = useAttendanceEvidenceCommand<Register>(scopeKey, schoolId, value => { setAccepted(value); setNotice('The owning attendance service saved this action. Current saved records are shown.'); }, href);
  const data = query.data?.register.id === registerId && (!accepted || query.data.register.revision >= accepted.register.revision) ? query.data : accepted;
  const roster = data?.roster ?? [];
  const evidence = data?.pending_evidence ?? [], evidencePages = Math.max(1, Math.ceil(evidence.length / 12)), ep = Math.min(evidencePage, evidencePages), selectedEvidence = evidence.find(item => item.id === reviewId);
  const owningDomain = !!data && requiresOwningAttendanceSource(data.register), locked = journal.locked || !!environment.unavailable || query.isError || !!owningDomain;
  const save = async () => {
    if (!data || locked) return; setError('');
    if (reviewId) {
      if (!data.capabilities.can_review_evidence || !selectedEvidence || reason.trim().length < 3) { setError('Choose a current pending report and add a review reason of at least three characters.'); return; }
      if (await journal.run({ registerId, expectedRevision: data.register.revision, evidenceId: reviewId, body: { decision, reason: reason.trim() } })) { setReviewId(''); setReason(''); void query.refetch(); }
    } else {
      if (!data.capabilities.can_record || !data.roster.some(row => row.person_id === personId) || !data.allowed_statuses.includes(status)) { setError('Choose a current participant and an allowed reported status.'); return; }
      const now = new Date(environment.virtual_clock?.now ?? Date.now()).getTime();
      if (!observed || observed.getTime() < Date.parse(data.register.starts_at) || observed.getTime() >= Date.parse(data.register.ends_at) || observed.getTime() > now) { setError('Choose the actual observation time within the activity interval. It cannot be in the future.'); return; }
      if (note.trim().length < 3) { setError('Describe what supports this report in at least three characters.'); return; }
      if (await journal.run({ registerId, expectedRevision: data.register.revision, body: { person_id: personId, claimed_status: status, capture_channel: 'offline_paper', observed_at: observed.toISOString(), source_reference: reference.trim(), note: note.trim() } })) { setReport(false); setPersonId(''); setObserved(null); setReference(''); setNote(''); void query.refetch(); }
    }
  };
  return <Page title="Attendance reports" subtitle={data?.register.title} refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
    <ScreenBack title="Back to register" fallbackHref={`${backPath}?register_id=${encodeURIComponent(registerId)}`} />
    {journal.pending ? <><Notice tone="warning" message={journal.pending.phase === 'accepted' ? 'The retained action was saved. Recovery only reads its register.' : 'An earlier action is unconfirmed. Retry its unchanged participant, source revision, body and idempotency key before sending another report.'} />{journal.pending.registerId !== registerId ? <Button title="Open retained report's register" onPress={() => onNavigate(`/areas/attendance/evidence?register_id=${encodeURIComponent(journal.pending!.registerId)}`)} /> : <Button title={journal.pending.phase === 'accepted' ? 'Refresh saved action' : 'Retry exact retained action'} busy={journal.busy} disabled={journal.pending.phase !== 'accepted' && (!data || query.isError || owningDomain)} onPress={() => void journal.recover()} />}</> : null}
    {journal.error ? <Notice tone="danger" message={journal.error} /> : null}{error ? <Notice tone="danger" message={error} /> : null}{notice ? <Notice tone="success" message={notice} /> : null}
    {query.isPending ? <Loading /> : query.isError || !data ? <Empty title="Register could not load" message={query.error?.message} onRetry={() => void query.refetch()} /> : <>
      <DomainText>{new Date(data.register.starts_at).toLocaleString()} – {new Date(data.register.ends_at).toLocaleString()}</DomainText><InfoDisclosure title="Register details"><Facts items={[{ label: 'State', value: label(data.register.state) }, { label: 'Saved revision', value: String(data.register.revision) }, { label: 'Activity timezone', value: data.register.time_zone }]} /></InfoDisclosure>
      {data.availability_reason ? <Notice tone="warning" message={data.availability_reason} /> : null}{owningDomain ? <><Notice message="This evidence belongs to an event or examination. Use the owning attendance workflow to report or decide it." />{data.register.source ? <Button title={data.register.source.label} onPress={() => onNavigate(data.register.source!.href)} /> : <Empty title="The owning attendance link is unavailable" message="Open the event or examination from your current work, or refresh this register." />}</> : null}
      <Notice message="Reports remain pending until the appointed reviewer accepts or rejects them. Reporting does not change accepted attendance or prove campus presence." />
      {!report && !reviewId && data.capabilities.can_record && !owningDomain ? <ControlButton title="Record a paper or late report" disabled={locked} onPress={() => { setReport(true); setError(''); setStatus(data.allowed_statuses[0] ?? 'present'); }} /> : null}
      <AttendanceSheet visible={report || !!reviewId} title={reviewId ? 'Review participation report' : 'Record a paper report'} busy={journal.busy} onClose={() => { setReport(false); setReviewId(''); setError(''); }}>
        {journal.pending ? <><Notice tone="warning" message={journal.pending.phase === 'accepted' ? 'The retained action was saved. Recovery only reads its register.' : 'An earlier action is unconfirmed. Retry its unchanged participant, source revision, body and idempotency key before sending another report.'} />{journal.pending.registerId === registerId ? <Button title={journal.pending.phase === 'accepted' ? 'Refresh saved action' : 'Retry exact retained action'} busy={journal.busy} disabled={journal.pending.phase !== 'accepted' && (!data || query.isError || owningDomain)} onPress={() => void journal.recover()} /> : <ControlButton title="Open retained report’s register" onPress={() => onNavigate(`/areas/attendance/evidence?register_id=${encodeURIComponent(journal.pending!.registerId)}`)} />}</> : null}
        {journal.error || error ? <Notice tone="danger" message={error || journal.error} /> : null}
        <DomainText>{data.register.title}</DomainText>{data.availability_reason ? <Notice tone="warning" message={data.availability_reason} /> : null}
        {reviewId ? <>
        <Row title={selectedEvidence?.name ?? 'Selected reported evidence'} detail={selectedEvidence ? `${label(selectedEvidence.claimed_status)} · observed ${new Date(selectedEvidence.observed_at).toLocaleString()}\n${selectedEvidence.source_reference || 'No source reference'}\n${selectedEvidence.note}` : 'This report is no longer pending.'} />
        <ChoiceMenu label="Decision" value={decision} options={[{ value: 'accepted', label: 'Accept as attendance evidence' }, { value: 'rejected', label: 'Reject this report' }]} disabled={locked} onChange={value => setDecision(value as 'accepted' | 'rejected')} /><Field label="Review reason" value={reason} onChangeText={setReason} maxLength={500} multiline editable={!locked} />
      </> : <>
        <DomainText>Participant</DomainText><ChoiceMenu label="Participant" value={personId} options={[{ value: '', label: 'Choose a participant' }, ...roster.map(person => ({ value: person.person_id, label: person.name }))]} disabled={locked} onChange={setPersonId} />
        <DomainText>Reported attendance</DomainText><ChoiceMenu label="Reported attendance" value={status} options={data.allowed_statuses.map(value => ({ value, label: label(value) }))} disabled={locked} onChange={value => setStatus(value as AttendanceStatus)} />
        <DomainText>Actual observation time</DomainText><View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}><ControlButton title={observed ? observed.toLocaleString() : 'Choose actual source time'} disabled={locked} onPress={() => setTimeMode('date')} />{Platform.OS !== 'ios' ? <ControlButton title="Choose time" disabled={locked} onPress={() => setTimeMode('time')} /> : null}</View>
        {timeMode ? <DateTimePicker accessibilityLabel="Actual observation time" mode={Platform.OS === 'ios' ? 'datetime' : timeMode} display={Platform.OS === 'ios' ? 'compact' : 'default'} value={observed ?? new Date(data.register.starts_at)} themeVariant={dark ? 'dark' : 'light'} accentColor={colors.action} onChange={(event, value) => { if (event.type === 'set' && value) setObserved(value); if (Platform.OS !== 'ios') setTimeMode(null); }} /> : null}
        {Platform.OS === 'ios' && timeMode ? <ControlButton title="Use selected observation time" disabled={locked} onPress={() => { if (!observed) setObserved(new Date(data.register.starts_at)); setTimeMode(null); }} /> : null}
        <DomainText>Enter the actual source time in this device's timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}. Device and camera reports require their registered source adapters.</DomainText><Field label="Paper or source reference · optional" value={reference} onChangeText={setReference} maxLength={160} editable={!locked} /><Field label="What supports this report?" value={note} onChangeText={setNote} maxLength={500} multiline editable={!locked} />
      </>}
        <Notice message="Reports stay pending until the appointed reviewer accepts or rejects them. Reporting does not change accepted attendance or prove campus presence." />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><ControlButton title="Cancel" disabled={journal.busy} onPress={() => { setReport(false); setReviewId(''); setError(''); }} /><ControlButton title={reviewId ? 'Save evidence decision' : 'Submit report for review'} kind="primary" busy={journal.busy} disabled={locked || !!reviewId && !selectedEvidence} onPress={() => void save()} /></View>
      </AttendanceSheet>
      <Section title={`Pending reports · ${evidence.length}`}>{evidence.length ? evidence.slice((ep - 1) * 12, ep * 12).map(item => <Row variant="plain" separator key={item.id} title={`${item.name} · ${label(item.claimed_status)}`} detail={`${label(item.capture_channel)} · observed ${new Date(item.observed_at).toLocaleString()}\nReceived ${new Date(item.received_at).toLocaleString()}${item.source_reference ? `\nSource: ${item.source_reference}` : ''}\n${item.note}`} status="Pending authorized review" onPress={data.capabilities.can_review_evidence && !owningDomain && !locked ? () => { setReviewId(item.id); setReport(false); setReason(''); setDecision('accepted'); setError(''); } : undefined} />) : <Empty title="No pending reports" message="Saved reviews remain in the register's retained history." />}{evidencePages > 1 ? <View style={{ flexDirection: 'row', gap: 8 }}><ControlButton title="Previous" disabled={ep <= 1} onPress={() => setEvidencePage(ep - 1)} /><DomainText>Page {ep} of {evidencePages}</DomainText><ControlButton title="More reports" disabled={ep >= evidencePages} onPress={() => setEvidencePage(ep + 1)} /></View> : null}</Section>
    </>}
  </Page>;
}
