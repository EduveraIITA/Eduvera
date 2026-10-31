import { canRetainScopedRead } from '../lib/scoped-read-policy';
import { clearStaffResponseDraft, editStaffResponseDraft, hasStaffResponseDrafts, type StaffResponseDraft, type StaffResponseDrafts } from '../lib/staff-response-drafts';
import { CommandStatus, useStaffAttention, staffStatusLabel as statusLabel } from './StaffCommands';
import { ScreenBack, useCampusNavigation, useScreenExitGuard } from '../ui/BackNavigation';
import React, { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { Alert } from '../ui/Alert';
import DateTimePicker from '@react-native-community/datetimepicker';
import { TemporalField } from '../ui/TemporalField';
import * as Crypto from 'expo-crypto';
import type { CoverageTask, ResponsibilityAssignment, StaffLeaveImpact, StaffLeaveRequest, StaffWorkspace, TeacherStaffWorkspace } from '../../../packages/contracts/src/wire/features/staff-operations/api';
import { useSession } from '../auth/SessionProvider';
import { apiFetch } from '../lib/api';
import { useApi } from '../lib/query';
import { Button, Empty, Field, Loading, Notice, Page, Row, Section } from '../ui/components';
import { ChoiceMenu, ControlButton, Disclosure, Facts, SegmentedControl } from '../ui/DomainControls';
import { useTheme } from '../ui/theme';

type Props = { readPaused?: boolean; readError?: string; href: string; onNavigate: (href: string) => void };
import { StaffAdminWorkspace, StaffLeaveRouting, StaffReadNotice, useStaffSourceCommands } from './StaffManagement';

type Draft = { policy_id: string; starts_on: string; ends_on: string; portion: 'full_day' | 'first_half' | 'second_half'; reason: string; handover_note: string };
const emptyDraft: Draft = { policy_id: '', starts_on: '', ends_on: '', portion: 'full_day', reason: '', handover_note: '' };

const paramsOf = (href: string) => new URLSearchParams(href.split('?')[1] ?? '');

type StaffResponseNoteProps = { draft: StaffResponseDraft; onNote(note: string): void; onDiscard(): void; onSaved(): void };
function useStaffResponseNotes(busy: boolean) {
  const [drafts, setDrafts] = useState<StaffResponseDrafts>({});
  useScreenExitGuard({ dirty: hasStaffResponseDrafts(drafts), blocked: busy, message: 'Discard your unsent staff response notes?' });
  return { drafts, count: Object.values(drafts).filter(draft => draft.note.trim()).length, discard: () => setDrafts({}), bind: (id: string, revision: number): StaffResponseNoteProps => {
    const draft = drafts[id] ?? { note: '', revision };
    return { draft, onNote: note => setDrafts(current => editStaffResponseDraft(current, id, revision, note)), onDiscard: () => setDrafts(current => clearStaffResponseDraft(current, id)), onSaved: () => setDrafts(current => clearStaffResponseDraft(current, id, draft)) };
  } };
}
function StaffResponseNotesNotice({ drafts, count, discard, busy }: { drafts: StaffResponseDrafts; count: number; discard(): void; busy: boolean }) {
  return count ? <Disclosure title={`Unsent response notes (${count})`}><Notice message="These notes stay available when changing pages or filters. Return to the record to continue editing." />{Object.entries(drafts).filter(([, draft]) => draft.note.trim()).map(([id, draft]) => <Notice key={id} message={draft.note} />)}<ControlButton title="Discard all unsent response notes" disabled={busy} onPress={discard} /></Disclosure> : null;
}

function dateLabel(value: string) { const date = new Date(`${value}T12:00:00Z`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date); }

export function StaffWorkScreen(props: Props) {
  const { schoolId, scopeKey, environment } = useSession();
  if (!schoolId) return <Page title="My work"><Empty title="Choose a campus" /></Page>;
  if (environment.unavailable) return <Page title="My work"><Empty title="Simulation is unavailable" message="Recover this world or return to Live." /></Page>;
  return <StaffWorkspaceScreen key={scopeKey} {...props} schoolId={schoolId} />;
}
function StaffWorkspaceScreen(props: Props & { schoolId: string }) {
  const params = paramsOf(props.href);
  const query = useApi<StaffWorkspace>(`/api/v1/schools/${encodeURIComponent(props.schoolId)}/staff/workspace/${params.get('request') ? `?request_id=${encodeURIComponent(params.get('request')!)}` : ''}`);
  if (query.isPending) return <Page title="My work"><Loading /></Page>;
  if (!query.data || !canRetainScopedRead(query.data, query.error)) return <Page title="My work"><Empty title="Work profile is unavailable" message={query.error?.message} onRetry={() => void query.refetch()} /></Page>;
  const path = props.href.split('?')[0], currentProps = { ...props, readPaused: query.isError, readError: query.error?.message };
  if (path === '/areas/responsibilities/mine' || params.get('view') === 'assignments') return <MyAssignments {...currentProps} data={query.data} refreshing={query.isRefetching} refresh={query.refetch} />;
  if (path === '/work/staff-leave' || params.get('view') === 'review') return query.data.can_review_staff_leave === true
    ? <LeaveReviewer {...currentProps} data={query.data} refreshing={query.isRefetching} refresh={query.refetch} />
    : <Page title="Staff leave"><Empty title="Leave review is unavailable" message={query.data.leave_review_readiness?.reason || 'Your current responsibilities do not include reviewing staff leave.'} /><WorkLinks href={props.href} onNavigate={props.onNavigate} review={false} /></Page>;
  if (query.data.mode === 'admin') return <StaffAdminWorkspace {...currentProps} data={query.data} refresh={query.refetch} refreshing={query.isRefetching} />;
  return <PersonalStaffWork {...currentProps} data={query.data} refreshing={query.isRefetching} refresh={query.refetch} />;
}

function PersonalStaffWork({ href, onNavigate, schoolId, data, refreshing, refresh, readPaused, readError }: Props & { schoolId: string; data: TeacherStaffWorkspace; refreshing: boolean; refresh: () => Promise<unknown> }) {
  const { user } = useSession();
  const base = `/api/v1/schools/${encodeURIComponent(schoolId)}/staff`;
  const params = paramsOf(href), coverView = href.includes('/coverage') || params.get('view') === 'cover';
  const formOpen = params.get('create') === 'leave', [draft, setDraft] = useState<Draft>(emptyDraft);
  const { complete } = useCampusNavigation(href);
  const formHref = (open: boolean) => { const next = new URLSearchParams(params); if (open) next.set('create', 'leave'); else next.delete('create'); return `${href.split('?')[0]}${next.size ? `?${next}` : ''}`; };
  const [requestPage, setRequestPage] = useState(1), [coverPage, setCoverPage] = useState(1);
  const commands = useStaffSourceCommands(base, refresh, href, readPaused);
  const { busy, pending, journal, run, setError } = commands;
  const notes = useStaffResponseNotes(busy);
  useScreenExitGuard({ dirty: formOpen && !pending && JSON.stringify(draft) !== JSON.stringify(emptyDraft), blocked: busy, title: 'Leave this leave request?', message: 'Your unsaved leave dates, reason and handover note will be lost.' });
  const [impact, setImpact] = useState<StaffLeaveImpact | null>(null), [previewing, setPreviewing] = useState(false), [impactBasis, setImpactBasis] = useState('');

  const ownRequests = data.requests.filter(request => request.staff_profile_id === data.profile.id);
  const ownCover = data.coverage_tasks.filter(task => task.replacement_staff_profile_id === data.profile.id && (!task.replacement_user_id || task.replacement_user_id === user?.id));
  const requestPages = Math.max(1, Math.ceil(ownRequests.length / 10)), coverPages = Math.max(1, Math.ceil(ownCover.length / 10));
  const currentRequestPage = Math.min(requestPages, requestPage), currentCoverPage = Math.min(coverPages, coverPage);
  const selectedRequest = ownRequests.find(request => request.id === params.get('request'));
  const selectedCover = ownCover.find(task => task.id === params.get('coverage'));
  const visibleRequests = selectedRequest ? [selectedRequest] : ownRequests.slice((currentRequestPage - 1) * 10, currentRequestPage * 10);
  const visibleCover = selectedCover ? [selectedCover] : ownCover.slice((currentCoverPage - 1) * 10, currentCoverPage * 10);
  const exactAttention = !!params.get('attention_notification_id') && (coverView
    ? !!selectedCover && selectedCover.status === 'offered' && String(selectedCover.revision) === params.get('coverage_revision')
    : !formOpen && !!selectedRequest && ['approved', 'rejected'].includes(selectedRequest.status) && String(selectedRequest.revision) === params.get('request_revision'));
  useStaffAttention(href, exactAttention);

  const update = (values: Partial<Draft>) => { if (!pending && !busy) { setDraft(current => ({ ...current, ...values })); setImpact(null); } };
  const selectedPolicy = draft.policy_id || data.balances[0]?.policy_id || '';
  const material = { policy_id: selectedPolicy, starts_on: draft.starts_on, ends_on: draft.ends_on, portion: draft.portion };
  const materialKey = JSON.stringify(material);
  const datesValid = /^\d{4}-\d{2}-\d{2}$/.test(draft.starts_on) && /^\d{4}-\d{2}-\d{2}$/.test(draft.ends_on) && draft.ends_on >= draft.starts_on && (draft.portion === 'full_day' || draft.starts_on === draft.ends_on);
  const canApply = data.profile.status === 'active' && data.leave_review_readiness?.state === 'ready' && !!selectedPolicy;
  function submit() { if (commands.blocked || !canApply || !datesValid || draft.reason.trim().length < 8 || pending) return;
    void run({ path: `${base}/leave-requests/`, operation: 'submit', label: 'Submit leave request', body: { ...material, reason: draft.reason.trim(), handover_note: draft.handover_note.trim(), command_id: Crypto.randomUUID() } }).then(accepted => { if (accepted) { setDraft(emptyDraft); setImpact(null); complete(formHref(false)); } }); }
  function withdraw(request: StaffLeaveRequest) { if (pending || busy) return;
    Alert.alert('Withdraw this request?', `${request.policy_name} · ${dateLabel(request.starts_on)} to ${dateLabel(request.ends_on)}`, [{ text: 'Keep request', style: 'cancel' }, { text: 'Withdraw', style: 'destructive', onPress: () => void run({ path: `${base}/leave-requests/${encodeURIComponent(request.id)}/withdraw/`, operation: 'withdraw', label: 'Withdraw leave request', body: { expected_revision: request.revision, command_id: Crypto.randomUUID() } }) }]); }
  async function preview() { if (commands.blocked || !datesValid || !selectedPolicy || previewing || pending) return; setPreviewing(true); setError(''); try {
    const result = await apiFetch<StaffLeaveImpact>(`${base}/leave-impact/`, { method: 'POST', body: JSON.stringify(material) }); setImpact(result); setImpactBasis(materialKey);
  } catch (cause) { setError(cause instanceof Error ? cause.message : 'Affected work could not be loaded.'); } finally { setPreviewing(false); } }
  const blocked = commands.blocked;
  return <Page title={coverView ? 'Cover work' : formOpen ? 'Apply for leave' : 'My leave'} subtitle={data.academic_year || 'Your current work profile'} refreshing={refreshing} onRefresh={() => void refresh()}>
    <WorkLinks href={href} onNavigate={onNavigate} review={data.can_review_staff_leave === true} />
    <CommandStatus commands={commands} /><StaffReadNotice error={readError} retry={refresh} /><StaffResponseNotesNotice {...notes} busy={busy} />
    {params.get('attention_notification_id') && !exactAttention ? <Notice tone="warning" message="The alert’s exact record or revision is no longer current. It was not marked as opened." /> : null}
    {coverView ? <Section title={selectedCover ? 'Selected cover offer' : 'Your cover work'}>{!ownCover.length ? <Empty title="No cover work assigned" message="Cover offers and accepted duties will appear when assigned to your current profile." /> : visibleCover.map(task => <CoverReply key={task.id} {...notes.bind(`coverage:${task.id}`, task.revision)} task={task} blocked={blocked} busy={busy} onAnswer={(decision, note) => run({ path: `${base}/coverage-tasks/${encodeURIComponent(task.id)}/response/`, operation: 'cover', label: `${decision === 'accepted' ? 'Accept' : 'Decline'} cover offer`, body: { decision, note, expected_revision: task.revision, command_id: Crypto.randomUUID() } })} />)}{selectedCover ? <Button title="All cover work" kind="secondary" onPress={() => onNavigate('/areas/responsibilities/coverage')} /> : <Pages page={currentCoverPage} total={coverPages} onPage={setCoverPage} />}</Section> : <>
      {formOpen ? <Section title="Your request">
        {data.leave_review_readiness?.state !== 'ready' ? <Notice tone="warning" message={data.leave_review_readiness?.reason || 'A current leave reviewer must be configured before requests can be submitted.'} /> : data.leave_review_readiness.reviewer ? <Notice message={`Review goes to ${data.leave_review_readiness.reviewer.name}.`} /> : null}
        {!data.balances.length ? <Empty title="No active leave policy" message="Ask the campus office to configure the policy for this academic year." /> : <>
          <ChoiceMenu label="Leave type" value={selectedPolicy} options={data.balances.map(balance => { const available = Number(balance.annual_allowance) + Number(balance.adjustments) - Number(balance.used) - Number(balance.pending); return { value: balance.policy_id, label: `${balance.name}${Number.isFinite(available) ? ` · ${available} days available` : ''}` }; })} disabled={blocked} onChange={policy_id => update({ policy_id })} />
          <DateField label="From" value={draft.starts_on} disabled={blocked} onChange={value => update({ starts_on: value, ends_on: draft.ends_on < value ? value : draft.ends_on })} /><DateField label="To" value={draft.ends_on} disabled={blocked} onChange={value => update({ ends_on: value })} />
          <SegmentedControl label="Leave day portion" value={draft.portion} options={[{ value: 'full_day', label: 'Full day' }, { value: 'first_half', label: 'First half' }, { value: 'second_half', label: 'Second half' }]} disabled={blocked} onChange={portion => update({ portion: portion as Draft['portion'] })} />
          {draft.starts_on && draft.ends_on && !datesValid ? <Notice tone="warning" message="End date must be on or after the start. Half-day leave uses a single date." /> : null}
          <Field label="Reason" value={draft.reason} onChangeText={reason => update({ reason })} editable={!blocked} multiline maxLength={1000} placeholder="Briefly explain your request (at least 8 characters)" /><Field label="Handover note (optional)" value={draft.handover_note} onChangeText={handover_note => update({ handover_note })} editable={!blocked} multiline maxLength={1000} placeholder="What should your colleague know?" />
          <Button title="Preview affected work" kind="secondary" busy={previewing} disabled={blocked || !datesValid || !selectedPolicy} onPress={() => void preview()} />
          {impact && impactBasis === materialKey ? <Section title="Affected published work">{impact.items.length ? impact.items.map(item => <Row key={`${item.kind}:${item.id}`} title={item.title} detail={[dateLabel(item.date), item.starts_at && item.ends_at ? `${item.starts_at}–${item.ends_at}` : null, item.location].filter(Boolean).join(' · ')} />) : <Notice message="No published classes or dated duties were found in this preview." />}{impact.truncated ? <Notice tone="warning" message="This preview is bounded. More affected work exists." /> : null}{impact.limitations.map(item => <Notice key={item} message={item} />)}</Section> : null}
          <Button title="Submit for review" busy={busy} disabled={blocked || !canApply || !datesValid || draft.reason.trim().length < 8} onPress={submit} />
        </>}
        <ScreenBack title="Back to my leave" disabled={busy} fallbackHref={formHref(false)} />
      </Section> : <>
        <Button title="Apply for leave" disabled={blocked || data.profile.status !== 'active'} onPress={() => onNavigate(formHref(true))} />
        <Section title="Leave balances">{data.balances.length ? <Facts items={data.balances.map(balance => ({ label: balance.name, value: `${balance.used} approved days · ${balance.pending} pending · ${balance.annual_allowance} annual allowance` }))} /> : <Empty title="No active leave policy" />}</Section>
        <Section title={selectedRequest ? 'Selected request' : 'Your requests'}>{!ownRequests.length ? <Empty title="No leave requests yet" /> : visibleRequests.map(request => <View key={request.id} style={{ gap: 8 }}><Row title={request.policy_name} detail={`${dateLabel(request.starts_on)} – ${dateLabel(request.ends_on)} · ${request.requested_days} days\n${request.reason}${request.decision_note ? `\nDecision note: ${request.decision_note}` : ''}`} status={statusLabel(request.status)} />{request.status === 'submitted' ? <Button title="Withdraw request" kind="danger" disabled={blocked} onPress={() => withdraw(request)} /> : null}</View>)}{selectedRequest ? <Button title="All requests" kind="secondary" onPress={() => onNavigate('/areas/responsibilities/leave')} /> : <Pages page={currentRequestPage} total={requestPages} onPage={setRequestPage} />}</Section>
      </>}
    </>}
  </Page>;
}

function WorkLinks({ href, onNavigate, review }: { href: string; onNavigate: Props['onNavigate']; review: boolean }) {
  const path = href.split('?')[0], view = paramsOf(href).get('view');
  const selected = path === '/areas/responsibilities/mine' || view === 'assignments' ? '/areas/responsibilities/mine' : path === '/work/staff-leave' || view === 'review' ? '/work/staff-leave' : path?.endsWith('/coverage') || view === 'cover' ? '/areas/responsibilities/coverage' : '/areas/responsibilities/leave';
  return <ChoiceMenu label="Staff work" value={selected} options={[{ value: '/areas/responsibilities/mine', label: 'My assignments' }, { value: '/areas/responsibilities/leave', label: 'My leave' }, { value: '/areas/responsibilities/coverage', label: 'Cover work' }, ...(review ? [{ value: '/work/staff-leave', label: 'Review staff leave' }] : [])]} onChange={next => { if (next !== selected) onNavigate(next); }} />;
}

function MyAssignments({ href, onNavigate, schoolId, data, refreshing, refresh, readPaused, readError }: Props & { schoolId: string; data: StaffWorkspace; refreshing: boolean; refresh: () => Promise<unknown> }) {
  const { user } = useSession(), [page, setPage] = useState(1);
  const base = `/api/v1/schools/${encodeURIComponent(schoolId)}/staff`, commands = useStaffSourceCommands(base, refresh, href, readPaused), params = paramsOf(href);
  const notes = useStaffResponseNotes(commands.busy);
  const ownProfiles = data.mode === 'staff' ? [data.profile].filter(profile => profile.user_id === user?.id) : data.profiles.filter(profile => profile.user_id === user?.id);
  const ownIds = new Set(ownProfiles.map(profile => profile.id));
  const assignments = data.assignments.filter(item => item.user_id === user?.id || (!item.user_id && ownIds.has(item.staff_profile_id)));
  const roles = (data.role_assignments ?? []).filter(item => item.user_id === user?.id);
  const projected = new Set(roles.filter(item => item.source_kind === 'assignment').map(item => item.source_id));
  const focused = assignments.find(item => item.id === params.get('assignment'));
  const all = focused ? [focused] : assignments.filter(item => item.status === 'offered' || !projected.has(item.id));
  const pages = Math.max(1, Math.ceil(all.length / 10)), current = Math.min(page, pages);
  const exact = !!focused && ['offered', 'revoked'].includes(focused.status) && String(focused.revision) === params.get('assignment_revision');
  useStaffAttention(href, exact);
  return <Page title="My assignments" subtitle="Your current responsibilities and work offers" refreshing={refreshing} onRefresh={() => void refresh()}>
    <WorkLinks href={href} onNavigate={onNavigate} review={data.can_review_staff_leave === true} /><CommandStatus commands={commands} /><StaffReadNotice error={readError} retry={refresh} /><StaffResponseNotesNotice {...notes} busy={commands.busy} />
    {params.get('attention_notification_id') && !exact ? <Notice tone="warning" message="The alert’s exact assignment or revision is unavailable. It was not marked as opened." /> : null}
    {params.get('assignment') && !focused ? <Empty title="Assignment is unavailable" message="It does not belong to your current linked profile." /> : null}
    <Section title={focused ? 'Selected assignment' : 'Work assignments'}>{all.length ? all.slice((current - 1) * 10, current * 10).map(item => <AssignmentReply key={item.id} {...notes.bind(`assignment:${item.id}`, item.revision)} item={item} busy={commands.busy} blocked={commands.blocked || !ownProfiles.some(profile => profile.id === item.staff_profile_id && profile.status === 'active')} onAnswer={(decision, note) => commands.run({ path: `${base}/responsibilities/${encodeURIComponent(item.id)}/response/`, operation: 'assignment', label: `${decision === 'accepted' ? 'Accept' : 'Decline'} assignment`, body: { decision, note, expected_revision: item.revision } })} />) : <Empty title="No work offers or assignments" />}</Section>
    <Pages page={current} total={pages} onPage={setPage} />
    {focused ? <Button title="All assignments" kind="secondary" onPress={() => onNavigate('/areas/responsibilities/mine')} /> : null}
    {roles.length ? <Section title="Assigned access and scope">{roles.slice(0, 30).map(item => <Row key={`${item.source_kind}:${item.source_id}`} title={item.role_name} detail={[item.scope_label, item.subject_name, `${dateLabel(item.starts_on)}${item.ends_on ? ` – ${dateLabel(item.ends_on)}` : ''}`].filter(Boolean).join('\n')} status={statusLabel(item.display_status)} />)}{roles.length > 30 ? <Notice message="The first 30 access assignments are shown. Open the owning area for its current work." /> : null}</Section> : null}
  </Page>;
}
function AssignmentReply({ item, blocked, busy, onAnswer, draft, onNote, onDiscard, onSaved }: StaffResponseNoteProps & { item: ResponsibilityAssignment; blocked: boolean; busy?: boolean; onAnswer: (decision: 'accepted' | 'declined', note: string) => Promise<boolean> }) {
  const note = draft.note, stale = !!note && draft.revision !== item.revision;
  const respond = async (decision: 'accepted' | 'declined') => { if (!blocked && !stale && await onAnswer(decision, note.trim())) onSaved(); };
  return <View style={{ gap: 8 }}><Row title={item.type_name} detail={[item.class_name, item.subject_name, item.event_title, item.scope_label, `${dateLabel(item.starts_on)}${item.ends_on ? ` – ${dateLabel(item.ends_on)}` : ''}`, item.location, item.notes, item.access_summary].filter(Boolean).join('\n')} status={statusLabel(item.status)} />
    {stale ? <><Notice tone="warning" message={`This work response changed. Your unsent note is kept: ${note}`} /><ControlButton title="Discard note and review current response" disabled={!!busy} onPress={onDiscard} /></> : null}
    {item.status === 'offered' ? <><Field label={`Response note for ${item.type_name}`} value={note} onChangeText={onNote} editable={!blocked && !stale} multiline maxLength={500} placeholder="Optional to accept; at least 4 characters to decline" /><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Button title="Accept assignment" disabled={blocked || stale} onPress={() => void respond('accepted')} /><Button title="Decline assignment" kind="danger" disabled={blocked || stale || note.trim().length < 4} onPress={() => void respond('declined')} /></View></> : item.revocation_reason || item.response_note ? <Notice message={item.revocation_reason || item.response_note} /> : null}
  </View>;
}
function LeaveReviewer({ href, onNavigate, schoolId, data, refreshing, refresh, readPaused, readError }: Props & { schoolId: string; data: StaffWorkspace; refreshing: boolean; refresh: () => Promise<unknown> }) {
  const { user } = useSession(), [page, setPage] = useState(1), [history, setHistory] = useState(paramsOf(href).get('history') === '1');
  const base = `/api/v1/schools/${encodeURIComponent(schoolId)}/staff`, commands = useStaffSourceCommands(base, refresh, href, readPaused), params = paramsOf(href);
  const notes = useStaffResponseNotes(commands.busy);
  const focused = data.requests.find(item => item.id === params.get('request'));
  const requests = focused ? [focused] : data.requests.filter(item => history ? item.status !== 'submitted' : item.status === 'submitted');
  const pages = Math.max(1, Math.ceil(requests.length / 10)), current = Math.min(page, pages);
  const exact = !!focused && focused.status === 'submitted' && String(focused.revision) === params.get('request_revision');
  useStaffAttention(href, exact);
  return <Page title="Staff leave" subtitle="Review requests within your current responsibility" refreshing={refreshing} onRefresh={() => void refresh()}>
    <WorkLinks href={href} onNavigate={onNavigate} review /><CommandStatus commands={commands} /><StaffReadNotice error={readError} retry={refresh} /><StaffResponseNotesNotice {...notes} busy={commands.busy} />
    {data.leave_review_readiness ? <StaffLeaveRouting readiness={data.leave_review_readiness} base={base} commands={commands} /> : null}
    {params.get('attention_notification_id') && !exact ? <Notice tone="warning" message="The alert’s exact request or revision is no longer current. It was not marked as opened." /> : null}
    {params.get('request') && !focused ? <Empty title="Request is unavailable" message="Refresh to confirm your current review scope." /> : null}
    <SegmentedControl label="Staff leave review views" value={history ? 'past' : 'pending'} options={[{ value: 'pending', label: 'Pending review' }, { value: 'past', label: 'Past requests' }]} onChange={value => { setHistory(value === 'past'); setPage(1); if (focused) onNavigate(value === 'past' ? '/work/staff-leave?history=1' : '/work/staff-leave'); }} />
    <Section title={focused ? 'Selected request' : history ? 'Past requests' : 'Pending review'}>{requests.length ? requests.slice((current - 1) * 10, current * 10).map(request => <LeaveReviewCard key={request.id} {...notes.bind(`leave:${request.id}`, request.revision)} request={request} data={data} schoolId={schoolId} actorId={user?.id ?? ''} blocked={commands.blocked} busy={commands.busy} onDecision={(decision, note, onSaved) => {
      Alert.alert(decision === 'approved' ? 'Approve this leave?' : 'Decline this leave?', `${request.first_name} ${request.last_name} · ${dateLabel(request.starts_on)} – ${dateLabel(request.ends_on)}${decision === 'approved' ? '\nPublished work and coverage rules are checked again when the decision is recorded.' : ''}`, [{ text: 'Cancel', style: 'cancel' }, { text: decision === 'approved' ? 'Approve' : 'Decline', style: decision === 'approved' ? 'default' : 'destructive', onPress: () => void commands.run({ path: `${base}/leave-requests/${encodeURIComponent(request.id)}/decision/`, operation: 'decision', label: decision === 'approved' ? 'Approve leave' : 'Decline leave', body: { decision, note, expected_revision: request.revision, command_id: Crypto.randomUUID() } }).then(saved => { if (saved) onSaved(); }) }]);
    }} onReroute={() => void commands.run({ path: `${base}/leave-requests/${encodeURIComponent(request.id)}/reroute/`, operation: 'reroute', label: 'Update leave reviewer', body: { expected_revision: request.revision, command_id: Crypto.randomUUID() } })} />) : <Empty title={history ? 'No past requests' : 'No requests waiting for review'} />}</Section>
    <Pages page={current} total={pages} onPage={setPage} />{focused ? <Button title="All staff leave" kind="secondary" onPress={() => onNavigate('/work/staff-leave')} /> : null}
  </Page>;
}
function LeaveReviewCard({ request, data, schoolId, actorId, blocked, busy, onDecision, onReroute, draft, onNote, onDiscard, onSaved }: StaffResponseNoteProps & { request: StaffLeaveRequest; data: StaffWorkspace; schoolId: string; actorId: string; blocked: boolean; busy?: boolean; onDecision: (decision: 'approved' | 'rejected', note: string, onSaved: () => void) => void; onReroute: () => void }) {
  const [showImpact, setShowImpact] = useState(false), note = draft.note, staleNote = !!note && draft.revision !== request.revision;
  const detail = useApi<StaffWorkspace>(showImpact ? `/api/v1/schools/${encodeURIComponent(schoolId)}/staff/workspace/?request_id=${encodeURIComponent(request.id)}` : null);
  const latest = detail.data?.requests.find(item => item.id === request.id);
  const currentPreview = !showImpact || (!!latest && latest.revision === request.revision && latest.status === request.status);
  const route = request.review_route, ready = !data.leave_review_readiness || data.leave_review_readiness.state === 'ready';
  const mayDecide = request.status === 'submitted' && data.can_review_staff_leave === true && ready && (!route || route.state === 'current' && route.reviewer?.user_id === actorId);
  const balance = data.balances.find(item => item.staff_profile_id === request.staff_profile_id && item.policy_id === request.policy_id);
  const available = balance ? Number(balance.annual_allowance) + Number(balance.adjustments) - Number(balance.used) : null;
  return <View style={{ gap: 8 }}><Row title={`${request.first_name} ${request.last_name}`} detail={[request.policy_name, `${dateLabel(request.starts_on)} – ${dateLabel(request.ends_on)} · ${request.requested_days} days`, request.reason, request.handover_note ? `Handover: ${request.handover_note}` : null].filter(Boolean).join('\n')} status={statusLabel(request.status)} />
    {staleNote ? <><Notice tone="warning" message={`This leave request changed. Your unsent decision note is kept: ${note}`} /><ControlButton title="Discard note and review current request" disabled={!!busy} onPress={onDiscard} /></> : null}
    <Notice message={`${request.affected_periods} affected classes or shifts${available !== null && Number.isFinite(available) ? ` · ${available} days available before decision` : ''}${request.status === 'approved' ? ` · ${request.coverage_open ?? 0} still need cover` : ''}.`} />
    {route ? <Notice tone={route.state === 'current' ? 'info' : 'warning'} message={route.state === 'current' ? `Review assigned to ${route.reviewer?.name || 'the current reviewer'}.` : `Review routing needs attention.${route.current_reviewer ? ` Current reviewer: ${route.current_reviewer.name}.` : ''}`} /> : null}
    <Button title={showImpact ? 'Hide affected work' : 'Preview affected work'} kind="secondary" onPress={() => setShowImpact(value => !value)} />
    {showImpact ? detail.isPending ? <Loading /> : detail.isError ? <Empty title="Affected work could not load" message={detail.error.message} onRetry={() => void detail.refetch()} /> : !currentPreview ? <Notice tone="warning" message="This request changed. Refresh the leave workspace before deciding." /> : latest?.affected_work ? <LeaveImpact impact={latest.affected_work} /> : <Notice message="Detailed affected work is unavailable. The server checks current published work when approving." /> : null}
    {request.status === 'submitted' && route?.can_reroute && route.state !== 'current' ? <Button title={route.current_reviewer?.user_id === actorId ? 'Take over review' : 'Send to current reviewer'} kind="secondary" disabled={blocked} onPress={onReroute} /> : null}
    {mayDecide ? <><Field label={`Decision note for ${request.first_name} ${request.last_name}`} value={note} onChangeText={onNote} multiline maxLength={1000} editable={!blocked && !staleNote} placeholder="At least 4 characters when declining" /><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Button title="Approve leave" disabled={blocked || staleNote || !currentPreview || showImpact && detail.isPending} onPress={() => onDecision('approved', note.trim(), onSaved)} /><Button title="Decline leave" kind="danger" disabled={blocked || staleNote || !currentPreview || note.trim().length < 4} onPress={() => onDecision('rejected', note.trim(), onSaved)} /></View></> : request.decision_note ? <Notice message={`Decision: ${request.decision_note}`} /> : null}
  </View>;
}
function LeaveImpact({ impact }: { impact: StaffLeaveImpact }) {
  return <Section title="Affected published work">{impact.items.length ? impact.items.slice(0, 30).map(item => <Row key={`${item.kind}:${item.id}`} title={item.title} detail={[dateLabel(item.date), item.starts_at && item.ends_at ? `${item.starts_at}–${item.ends_at}` : null, item.location, item.class_label].filter(Boolean).join(' · ')} />) : <Notice message="No published classes or dated duties were found." />}{impact.truncated || impact.items.length > 30 ? <Notice tone="warning" message="This preview is bounded. More affected work exists." /> : null}{impact.limitations.map(item => <Notice key={item} message={item} />)}<Notice message={`Checked ${new Date(impact.as_of).toLocaleString()} · ${impact.time_zone}. Current work is checked again when approving.`} /></Section>;
}

function Pages({ page, total, onPage }: { page: number; total: number; onPage: (value: number) => void }) { const { colors } = useTheme(); return total > 1 ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}><ControlButton title="Previous" disabled={page <= 1} onPress={() => onPage(page - 1)} /><Text style={{ fontSize: 14, lineHeight: 21, color: colors.muted }}>Page {page} of {total}</Text><ControlButton title="Next" disabled={page >= total} onPress={() => onPage(page + 1)} /></View> : null; }

function CoverReply({ task, blocked, busy, onAnswer, draft, onNote, onDiscard, onSaved }: StaffResponseNoteProps & { task: CoverageTask; blocked: boolean; busy?: boolean; onAnswer: (decision: 'accepted' | 'declined', note: string) => Promise<boolean> }) {
  const note = draft.note, stale = !!note && draft.revision !== task.revision;
  const respond = async (decision: 'accepted' | 'declined') => { if (!blocked && !stale && await onAnswer(decision, note.trim())) onSaved(); };
  return <View style={{ gap: 8 }}><Row title={task.title || task.subject_name || 'Cover duty'} detail={[`${dateLabel(task.duty_date)}${task.starts_at && task.ends_at ? ` · ${task.starts_at}–${task.ends_at}` : ''}`, task.class_name, task.location, task.handover_note].filter(Boolean).join('\n')} status={statusLabel(task.status)} />
    {stale ? <><Notice tone="warning" message={`This work response changed. Your unsent note is kept: ${note}`} /><ControlButton title="Discard note and review current response" disabled={!!busy} onPress={onDiscard} /></> : null}
    {task.status === 'offered' ? <><Field label={`Response note for ${task.title || 'cover duty'}`} value={note} onChangeText={onNote} editable={!blocked && !stale} multiline maxLength={500} placeholder="Optional for acceptance; at least 4 characters to decline" /><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Button title="Accept cover" disabled={blocked || stale} onPress={() => void respond('accepted')} /><Button title="Decline" kind="danger" disabled={blocked || stale || note.trim().length < 4} onPress={() => void respond('declined')} /></View></> : task.response_note ? <Notice message={task.response_note} /> : null}
  </View>;
}
function DateField({ label, value, disabled, onChange }: { label: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false), { dark, colors } = useTheme();
  const date = value ? new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)), 12) : new Date();
  if (Platform.OS === 'web') return <TemporalField label={`${label} date`} mode="date" value={value} disabled={disabled} onChange={onChange} />;
  return <View style={{ gap: 8 }}><Button title={`${label} · ${value ? dateLabel(value) : 'Choose date'}`} kind="secondary" disabled={disabled} onPress={() => setOpen(true)} />{open ? <DateTimePicker mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'} value={date} themeVariant={dark ? 'dark' : 'light'} accentColor={colors.action} accessibilityLabel={`${label} date`} onChange={(_event, selected) => { setOpen(false); if (selected) onChange(`${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, '0')}-${String(selected.getDate()).padStart(2, '0')}`); }} /> : null}</View>;
}
