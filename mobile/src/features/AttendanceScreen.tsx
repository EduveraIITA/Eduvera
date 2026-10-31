import { ScreenBack, useScreenExitGuard } from '../ui/BackNavigation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Alert } from '../ui/Alert';
import type { ActivityRegisterPage } from '../../../packages/contracts/src/wire/features/activities/api';
import type { ActivityRegisterSummary } from '../../../packages/contracts/src/activity-register';
import { registerCategories, registerCategory, registerGroup, registerKindLabel } from '../../../packages/contracts/src/activity-attendance-queue';
import { assertWorkspaceManifestContext, normalizeWorkspaceManifest } from '../../../packages/contracts/src/workspace-normalizer';
import { attendanceOperationalSurface } from '../lib/attendance-access';
import { academicAttendanceSource } from '../lib/academic-attendance';
import { AcademicAttendanceScreen } from './AcademicAttendanceScreen';
import { AttendanceFollowupInbox } from './AttendanceInsightsScreen';
import { AttendanceContinuityScreen } from './AttendanceContinuityScreen';
import type {WorkspaceAreaSurface} from '../../../packages/contracts/src/workspace';
import { requiresOwningAttendanceSource } from '../lib/attendance-evidence';
import { useSession } from '../auth/SessionProvider';
import { apiFetch, captureApiContext, getApiOrigin } from '../lib/api';
import { attendanceCommandRefused, attendanceResultMatches, prepareGuardedAttendanceCommand, type AttendanceTransportGuard, type RetainedAttendanceCommand } from '../lib/attendance-command-policy';
import { useApi } from '../lib/query';
import { attendanceDraftKey, newAttendanceCommand, readAttendanceDraft, removeAttendanceDraft, writeAttendanceDraft, type AttendanceCommand, type AttendanceDraftScope, type AttendanceMark, type AttendanceStatus } from '../lib/attendance-draft';
import { Button, Empty, Field, LinkButton, Loading, Notice, Page, Row, Section } from '../ui/components';
import { AttendanceChoice, AttendanceDateBar, AttendanceIconButton, AttendanceSearch } from '../ui/AttendanceControls';
import { AttendanceParticipantRow } from '../ui/AttendanceParticipantRow';
import { ControlButton, Disclosure, SegmentedControl } from '../ui/DomainControls';
import { AttendanceSheet } from './attendance/AttendanceSheet';
import { useTheme } from '../ui/theme';
import { themeRadii } from '../ui/theme-tokens';

type Props = { href: string; onNavigate: (href: string) => void };
type Summary = { id: string; occurrence_id: string; title: string; starts_at: string; ends_at: string; time_zone: string; place_label: string | null; state: 'draft' | 'submitted' | 'locked'; revision: number; participant_count: number; recorded_count: number; can_record: boolean; availability_reason: string | null; queue_category?: string; entry_mode?: string; source_kind?: string; source?: { href: string; label: string }; finalization?: { state: string; reason: string; scheduled_at: string | null } };
type Register = { register: Summary; roster: Array<AttendanceMark & { name: string; roles: string[]; requirement: 'required' | 'optional' }>; allowed_statuses: AttendanceStatus[]; availability_reason: string | null; capabilities: { can_record: boolean; can_submit: boolean; can_finalize: boolean; can_reopen: boolean; can_review_evidence: boolean }; counts: { participants: number; recorded: number; unrecorded: number }; pending_evidence: Array<{ id: string; person_id: string; name: string; claimed_status: AttendanceStatus; note: string; observed_at: string }> };
const labels: Record<AttendanceStatus, string> = { present: 'Present', absent: 'Absent', late: 'Late', excused: 'Excused', half_day: 'Half day' };
const paramsOf = (href: string) => new URLSearchParams(href.split('?')[1] ?? '');
const numberOf = (value: string | null) => Math.max(1, Number.parseInt(value ?? '1', 10) || 1);
const dateOf = (value: string | null) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? value : undefined;
function updateHref(href: string, values: Record<string, string>) {
  const query = paramsOf(href);
  for (const [key, value] of Object.entries(values)) { if (value) query.set(key, value); else query.delete(key); }
  return `${href.split('?')[0]}${query.size ? `?${query}` : ''}`;
}
function interval(item: Pick<Summary, 'starts_at' | 'ends_at' | 'time_zone'>) {
  try { const f = new Intl.DateTimeFormat(undefined, { timeZone: item.time_zone, hour: 'numeric', minute: '2-digit' }); return `${f.format(new Date(item.starts_at))} – ${f.format(new Date(item.ends_at))}`; } catch { return 'Time unavailable'; }
}
const err = (cause: unknown) => cause instanceof Error ? cause.message : 'This action could not be confirmed.';

export function AttendanceScreen(props: Props) {
  const { schoolId, scopeKey, user, environment } = useSession();
  const manifest = useApi<unknown>(schoolId ? '/api/v1/workspace' : null);
  const verified = useMemo(() => {
    if (!schoolId || !user || !manifest.data) return { manifest: null, surface: null, source: null, error: null };
    try {
      const value = normalizeWorkspaceManifest(manifest.data);
      assertWorkspaceManifestContext(value, { actorUserId: user.id, institutionId: schoolId, environment });
      const surface = attendanceOperationalSurface(value, props.href.split('?')[0]!);
      if (!surface) throw new Error('This attendance view is not offered in your current workspace. Open Attendance from Areas to confirm your available work.');
      return { manifest: value, surface, source: academicAttendanceSource(props.href), error: null };
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : 'The attendance workspace response could not be verified.';
      return { manifest: null, surface: null, source: null, error };
    }
  }, [schoolId, user?.id, environment, manifest.data, props.href]);
  if (!schoolId) return <Page title="Attendance"><Empty title="Choose a campus" message="Attendance follows your active campus and responsibilities." /></Page>;
  if (manifest.isPending) return <Page title="Attendance"><Loading /></Page>;
  if (manifest.isError || !verified.surface || !verified.manifest) return <Page title="Attendance"><Empty title="Attendance access could not be confirmed" message={manifest.error?.message ?? verified.error ?? 'Refresh to confirm your current attendance workspace.'} onRetry={() => void manifest.refetch()} /><Button title="Open Attendance" kind="secondary" onPress={() => props.onNavigate('/areas/attendance/registers')} /></Page>;
  if (verified.source) return <AcademicAttendanceScreen key={`${scopeKey}:${props.href}`} {...props} manifest={verified.manifest} source={verified.source} />;
  const query = paramsOf(props.href);
  const selected = query.get('register_id'), occurrence = query.get('occurrence_id');
  if (props.href.split('?')[0] === '/areas/attendance/coordination' && query.has('case_id')) return <AttendanceContinuityScreen {...props} surface={verified.surface} />;
  if (props.href.split('?')[0] === '/areas/attendance/coordination' && query.has('followup')) return <Page title="Attendance questions"><AttendanceFollowupInbox {...props} context="staff" embedded /></Page>;
  return selected || occurrence ? <RegisterDetail key={`${scopeKey}:${selected ?? occurrence}`} {...props} schoolId={schoolId} id={selected} occurrenceId={occurrence} /> : <RegisterQueue key={`${scopeKey}:${props.href}`} {...props} schoolId={schoolId} surface={verified.surface} />;
}

function RegisterQueue({ href, onNavigate, schoolId,surface }: Props & { schoolId: string;surface: WorkspaceAreaSurface }) {
  const query = paramsOf(href), page = numberOf(query.get('page')), requestedDate = dateOf(query.get('date'));
  const selectedDate = requestedDate && new Date(`${requestedDate}T12:00:00Z`).toISOString().slice(0, 10) === requestedDate ? requestedDate : undefined;
  const view = registerCategory(query.get('attendance_view')), kind = (query.get('activity_kind') ?? '').slice(0, 60);
  const [search, setSearch] = useState((query.get('search') ?? '').slice(0, 120));
  const [filtersOpen, setFiltersOpen] = useState(false), [typesOpen, setTypesOpen] = useState(false);
  const { colors } = useTheme(), { environment } = useSession();
  const request = new URLSearchParams({ page: String(page), page_size: '8', ...(selectedDate ? { date: selectedDate } : {}), ...(query.get('search') ? { search: query.get('search')!.slice(0, 120) } : {}), ...(view !== 'all' ? { view } : {}), ...(kind ? { kind } : {}) });
  const list = useApi<ActivityRegisterPage>(`/api/v1/schools/${encodeURIComponent(schoolId)}/activities/registers?${request}`);
  const date = selectedDate ?? list.data?.date, counts = list.data?.counts;
  const change = (values: Record<string, string>) => onNavigate(updateHref(href, { page: '', ...values }));
  const filtered = Boolean(query.get('search') || kind || view !== 'all'), showFilters = filtersOpen || Boolean(query.get('search') || kind);
  const clear = () => { setSearch(''); change({ search: '', attendance_view: '', activity_kind: '' }); };
  const stateLabel = (item: ActivityRegisterSummary) => item.occurrence_state === 'cancelled' ? 'Cancelled · history retained'
    : item.state === 'locked' ? 'Final' : item.state === 'submitted'
      ? item.finalization?.state === 'automatic_pending' ? 'Automatic finalization scheduled' : item.finalization?.reason === 'overdue' ? 'Automatic finalization overdue · review needed' : 'Awaiting review'
      : item.participant_count > 0 && item.recorded_count === item.participant_count ? 'Ready to submit' : item.recorded_count ? 'In progress' : 'Not recorded';
  const open = (item: ActivityRegisterSummary) => {
    if (item.entry_mode !== 'participation' && item.source_kind && item.source_kind !== 'activity' && item.source?.href) { onNavigate(item.source.href); return; }
    onNavigate(updateHref(href, { date: date ?? '', register_id: item.id }));
  };
  return <Page title="Attendance" refreshing={list.isRefetching} onRefresh={() => void list.refetch()}>
    {date ? <AttendanceDateBar date={date} onChange={next => change({ date: next })} onToday={() => change({ date: '' })}><AttendanceIconButton label={showFilters ? 'Close register filters' : 'Find or filter registers'} icon={showFilters ? 'close' : 'search'} expanded={showFilters} onPress={() => { setFiltersOpen(!showFilters); if (showFilters) { setSearch(''); change({ search: '', activity_kind: '' }); } }} /></AttendanceDateBar> : null}
    {showFilters ? <View style={attendanceStyles.tools}><AttendanceSearch label="All registers on this date" placeholder="Find an activity or place" value={search} onChangeText={value => { setSearch(value); if (!value && query.get('search')) change({ search: '' }); }} onSubmit={() => change({ search: search.trim() })} autoFocus={filtersOpen} />{(list.data?.available_kinds?.length ?? 0) > 1 || kind ? <><LinkButton title={`Activity type · ${kind ? registerKindLabel(kind) : 'All activities'}`} expanded={typesOpen} onPress={() => setTypesOpen(value => !value)} />{typesOpen ? <View style={attendanceStyles.choices}><AttendanceChoice label="All activities" selected={!kind} onPress={() => change({ activity_kind: '' })} />{list.data?.available_kinds?.map(item => <AttendanceChoice key={item.kind} label={`${registerKindLabel(item.kind)} · ${item.count}`} selected={kind === item.kind} onPress={() => change({ activity_kind: item.kind })} />)}{kind && !list.data?.available_kinds?.some(item => item.kind === kind) ? <AttendanceChoice label={registerKindLabel(kind)} selected onPress={() => {}} /> : null}</View> : null}</> : null}</View> : null}
    {counts && (counts.all > 8 || view !== 'all' || registerCategories.filter(item => (counts[item.value as keyof typeof counts] ?? 0) > 0).length > 1) ? <View accessibilityRole="summary" accessibilityLabel="Register views" style={attendanceStyles.choices}>{[{ value: 'all' as const, label: 'All' }, ...registerCategories.filter(item => (counts[item.value as keyof typeof counts] ?? 0) > 0 || view === item.value)].map(item => <AttendanceChoice key={item.value} label={`${item.label} · ${counts[item.value as keyof typeof counts] ?? 0}`} selected={view === item.value} onPress={() => change({ attendance_view: item.value === 'all' ? '' : item.value })} />)}</View> : null}
    {list.data ? <View style={attendanceStyles.summary}><Text style={[attendanceStyles.caption, { color: colors.muted }]}>{list.data.total} {filtered ? 'matching ' : ''}{list.data.total === 1 ? 'register' : 'registers'}{counts && view === 'all' ? ` · ${counts.needs_recording} to record${counts.awaiting_review ? ` · ${counts.awaiting_review} awaiting review` : ''}` : ''}</Text>{filtered ? <LinkButton title="Clear filters" onPress={clear} /> : null}</View> : null}
    {list.isPending ? <Loading label="Loading registers…" /> : list.isError ? <Empty title="Registers could not load" message={list.error.message} onRetry={() => void list.refetch()} /> : !list.data?.registers.length ? <><Empty title={filtered ? 'No matching registers' : 'No registers on this date'} message={filtered ? 'Try another search or clear the filters to see all available registers.' : 'Scheduled activities that need attendance appear here within your responsibility.'} />{filtered ? <LinkButton title="Show all registers" onPress={clear} /> : null}</> : <View style={attendanceStyles.groups}>{registerCategories.map(group => { const items = list.data!.registers.filter(item => registerGroup(item, new Date(environment.virtual_clock?.now ?? Date.now())) === group.value); return items.length ? <View key={group.value} style={attendanceStyles.group}><Text accessibilityRole="header" style={[attendanceStyles.groupTitle, { color: colors.ink }]}>{group.label}</Text>{items.map(item => <Row key={`${item.source_kind}:${item.id}`} icon="attendance" title={item.title} detail={`${item.source_kind === 'daily_class' ? 'Daily register' : interval(item)}${item.place_label ? ` · ${item.place_label}` : ''}\n${item.recorded_count} of ${item.participant_count} recorded${!item.can_record && item.state === 'draft' ? ' · Read only' : ''}${item.availability_reason ? `\n${item.availability_reason}` : ''}`} status={stateLabel(item)} onPress={() => open(item)} />)}</View> : null; })}</View>}
    {(list.data?.total_pages ?? 1) > 1 || page > 1 ? <View style={attendanceStyles.pagination}><AttendanceChoice label="Previous" selected={false} disabled={page <= 1} onPress={() => onNavigate(updateHref(href, { page: String(page - 1) }))} /><Text style={[attendanceStyles.caption, { color: colors.muted }]}>Page {list.data?.page ?? page} of {list.data?.total_pages ?? '…'}</Text><AttendanceChoice label="Next" selected={false} disabled={page >= (list.data?.total_pages ?? 1)} onPress={() => onNavigate(updateHref(href, { page: String(page + 1) }))} /></View> : null}
    {href.split('?')[0] === '/areas/attendance/coordination' ? <AttendanceFollowupInbox href={href} onNavigate={onNavigate} context="staff" embedded /> : null}
    {href.split('?')[0] === '/areas/attendance/coordination' ? <AttendanceContinuityScreen href={href} onNavigate={onNavigate} surface={surface} embedded date={date} /> : null}
  </Page>;
}

function RegisterDetail({ href, onNavigate, schoolId, id, occurrenceId }: Props & { schoolId: string; id: string | null; occurrenceId: string | null }) {
  const base = `/api/v1/schools/${encodeURIComponent(schoolId)}/activities/registers`;
  const query = useApi<Register>(id ? `${base}/${encodeURIComponent(id)}` : `${base}/for-occurrence/${encodeURIComponent(occurrenceId!)}`);
  const backHref = updateHref(href, { register_id: '', occurrence_id: '' });
  if (query.isPending) return <Page title="Attendance"><Loading /></Page>;
  if (query.isError || !query.data) return <Page title="Attendance"><ScreenBack title="Back to registers" fallbackHref={backHref} /><Empty title="Register unavailable" message={query.error?.message} onRetry={() => void query.refetch()} /></Page>;
  if (requiresOwningAttendanceSource(query.data.register)) return <Page title={query.data.register.title}><ScreenBack title="Back to registers" fallbackHref={backHref} /><Notice message="This register is managed by its event or examination. Open the owning workflow to record attendance or review evidence." />{query.data.register.source ? <Button title={query.data.register.source.label} onPress={() => onNavigate(query.data!.register.source!.href)} /> : <Empty title="The owning attendance link is unavailable" message="Refresh this register or open its event or examination from your current work." onRetry={() => void query.refetch()} />}</Page>;
  return <RegisterEditor key={query.data.register.id} initial={query.data} schoolId={schoolId} backHref={backHref} onEvidence={() => onNavigate(`/areas/attendance/evidence?register_id=${encodeURIComponent(query.data!.register.id)}`)} refresh={() => void query.refetch()} refreshing={query.isRefetching} />;
}

function RegisterEditor({ initial, schoolId, backHref, onEvidence, refresh, refreshing }: { initial: Register; schoolId: string; backHref: string; onEvidence: () => void; refresh: () => void; refreshing: boolean }) {
  const { user, environment } = useSession();
  const { colors } = useTheme();
  const scope = useMemo<AttendanceDraftScope>(() => ({ actorId: user?.id ?? '', schoolId, mode: environment.mode, namespaceId: environment.namespace_id ?? null, origin: getApiOrigin() }), [user?.id, schoolId, environment.mode, environment.namespace_id]);
  const scopeId = attendanceDraftKey(scope, initial.register.id);
  const [baseline, setBaseline] = useState(initial);
  const [records, setRecords] = useState<AttendanceMark[]>(initial.roster.map(({ person_id, status, remarks }) => ({ person_id, status, remarks })));
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState<RetainedAttendanceCommand | null>(null);
  const [busy, setBusy] = useState(false), [hydrated, setHydrated] = useState(false), [storageBlocked, setStorageBlocked] = useState(false), [draftLoad, setDraftLoad] = useState(0);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [storageNotice, setStorageNotice] = useState('');
  const [search, setSearch] = useState(''), [rosterPage, setRosterPage] = useState(1), [unrecordedOnly, setUnrecordedOnly] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [historyPage, setHistoryPage] = useState(0);
  const base = `/api/v1/schools/${encodeURIComponent(schoolId)}/activities/registers/${encodeURIComponent(initial.register.id)}`;
  const history = useApi<{ history: Array<{ id: string; action: string; name: string | null; status: string | null; actor_name: string; reason: string | null; recorded_at: string }>; total_pages: number }>(historyPage ? `${base}/history?page=${historyPage}&page_size=20` : null);
  const changed = records.filter(mark => { const old = baseline.roster.find(row => row.person_id === mark.person_id); return old && (old.status !== mark.status || old.remarks !== mark.remarks); });
  const dirty = changed.length > 0 || !!reason.trim();
  useScreenExitGuard({ dirty: dirty && !!storageNotice, blocked: busy, title: 'Leave unsaved marks?', message: 'Local persistence is unavailable. Leaving this register may lose your edits.' });
  const conflict = initial.register.revision > baseline.register.revision && dirty;
  const locked = busy || !hydrated || storageBlocked || !!pending || conflict || !!environment.unavailable;
  const alive = useRef(true), running = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true; setHydrated(false); setStorageBlocked(true);
    void readAttendanceDraft(scope, initial.register.id).then(draft => {
      if (!active) return;
      setStorageBlocked(false); setStorageNotice('');
      if (!draft) return;
      const valid = draft.records.every(mark => initial.roster.some(row => row.person_id === mark.person_id) && (mark.status === null || initial.allowed_statuses.includes(mark.status)));
      if (draft.revision === initial.register.revision && valid) { setRecords(initial.roster.map(row => draft.records.find(mark => mark.person_id === row.person_id) ?? { person_id: row.person_id, status: row.status, remarks: row.remarks })); setReason(draft.reason); setPending(draft.pending); setNotice(draft.pending ? 'A previous action was not confirmed. Retry that exact action to recover its result.' : 'Your encrypted local draft has been restored. These marks are not accepted until saved.'); }
      else if (draft.pending) { setPending(draft.pending); setNotice('A previous action needs confirmation. Retry it with the same request before continuing.'); }
      else setStorageNotice('An older local draft exists, but this register has changed. Current saved attendance is shown; the old draft was not applied.');
    }).catch(cause => { if (active) { setStorageBlocked(true); setStorageNotice(err(cause)); } }).finally(() => { if (active) setHydrated(true); });
    return () => { active = false; };
  }, [scopeId, draftLoad]);
  useEffect(() => {
    if (!hydrated || busy || pending || dirty || initial.register.revision < baseline.register.revision) return;
    setBaseline(initial); setRecords(initial.roster.map(({ person_id, status, remarks }) => ({ person_id, status, remarks })));
  }, [initial, hydrated, busy, pending, dirty]);
  useEffect(() => {
    if (!hydrated || storageBlocked || busy || (!dirty && !pending)) return;
    const timer = setTimeout(() => { void writeAttendanceDraft({ version: 1, scope, registerId: baseline.register.id, revision: pending?.expectedRevision ?? baseline.register.revision, records, reason, pending, updatedAt: new Date().toISOString() }).catch(cause => { if (alive.current) setStorageNotice(err(cause)); }); }, 350);
    return () => clearTimeout(timer);
  }, [scopeId, hydrated, storageBlocked, busy, records, reason, pending, dirty, baseline.register.revision]);
  const discard = () => { if (pending || storageBlocked) return; Alert.alert('Load saved register?', 'This replaces your local edits with the latest saved register.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Load saved', style: 'destructive', onPress: () => { void removeAttendanceDraft(scope, baseline.register.id).catch(cause => setStorageNotice(err(cause))); setPending(null); setReason(''); setBaseline(initial); setRecords(initial.roster.map(({ person_id, status, remarks }) => ({ person_id, status, remarks }))); setError(''); setNotice('Saved attendance loaded.'); refresh(); } }]); };
  const perform = async (command: RetainedAttendanceCommand, previouslyUncertain = true, reserved = false, captured?: AttendanceTransportGuard) => {
    if (running.current && !reserved) return;
    running.current = true;
    setBusy(true); setError('');
    let context = captured;
    const assertActive = () => { if (!context) throw new Error('The attendance transport context is unavailable. Nothing was sent.'); context.assertCurrent(); if (!alive.current) throw new Error('This register was closed. The exact action remains retained.'); };
    let retained = command;
    const persist = async (value: RetainedAttendanceCommand) => {
      assertActive();
      await writeAttendanceDraft({ version: 1, scope, registerId: baseline.register.id, revision: value.expectedRevision, records, reason, pending: value, updatedAt: new Date().toISOString() });
      assertActive();
    };
    try {
      context ??= captureApiContext(); assertActive();
      let next: Register;
      if (retained.phase === 'accepted') {
        assertActive(); next = await apiFetch<Register>(base); assertActive();
        if (!attendanceResultMatches(next, baseline.register.id, retained.expectedRevision, true)) throw new Error('The saved register did not match this accepted action. Keep it retained and refresh again.');
      } else {
        // Durable encrypted intent is required before dispatch. A failed write
        // stops here, without sending a request or substituting a new key.
        await persist(retained);
        retained = { ...retained, phase: 'unknown' }; setPending(retained);
        await persist(retained); assertActive();
        next = await apiFetch<Register>(`${base}/${command.action === 'save' ? 'marks' : command.action}`, { method: command.action === 'save' ? 'PUT' : 'POST', headers: { 'Idempotency-Key': command.key }, body: command.body }); assertActive();
        if (!attendanceResultMatches(next, baseline.register.id, command.expectedRevision)) throw new Error('The response did not confirm this exact register revision. Retry the retained request to recover it.');
        retained = { ...retained, phase: 'accepted' }; setPending(retained);
        await persist(retained);
      }
      assertActive();
      setBaseline(next); setRecords(next.roster.map(({ person_id, status, remarks }) => ({ person_id, status, remarks }))); setReason('');
      await removeAttendanceDraft(scope, next.register.id); assertActive();
      setPending(null); setStorageNotice(''); setNotice(command.action === 'save' ? 'Attendance saved on the server.' : command.action === 'submit' ? 'Register submitted.' : command.action === 'finalize' ? 'Register finalized. Its history is retained.' : 'Register reopened. Previous decisions remain in history.'); refresh();
    } catch (cause) {
      if (!alive.current) return;
      setError(retained.phase === 'accepted' ? `Saved. Recovery only reads the register: ${err(cause)}` : err(cause));
      if (retained.phase !== 'accepted' && attendanceCommandRefused(cause, previouslyUncertain)) {
        try {
          assertActive();
          await writeAttendanceDraft({ version: 1, scope, registerId: baseline.register.id, revision: baseline.register.revision, records, reason, pending: null, updatedAt: new Date().toISOString() }); assertActive(); setPending(null);
        } catch (storageError) { setStorageNotice(err(storageError)); }
      }
    } finally { running.current = false; if (alive.current) setBusy(false); }
  };
  const commit = async (action: AttendanceCommand['action']) => {
    if (locked || running.current) return;
    const correcting = changed.some(mark => baseline.roster.find(row => row.person_id === mark.person_id)?.status !== null);
    if ((correcting || action === 'reopen') && !reason.trim()) { setError('Add a reason for this correction or reopening.'); return; }
    if ((action === 'finalize' || action === 'reopen') && changed.length) { setError('Save or discard your marks before changing the register state.'); return; }
    running.current = true; setBusy(true);
    try {
      const prepared = await prepareGuardedAttendanceCommand(captureApiContext,
        () => newAttendanceCommand(action, baseline.register.revision, changed, reason),
        () => { if (!alive.current) throw new Error('The register closed before this action was prepared. Nothing was sent.'); });
      setPending(prepared.command); await perform(prepared.command, false, true, prepared.context);
    } catch (cause) { if (alive.current) setError(err(cause)); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  };
  const mark = (personId: string, updates: Partial<AttendanceMark>) => setRecords(current => current.map(row => row.person_id === personId ? { ...row, ...updates } : row));
  const filtered = baseline.roster.filter(row => row.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) && (!unrecordedOnly || records.find(mark => mark.person_id === row.person_id)?.status === null));
  const pages = Math.max(1, Math.ceil(filtered.length / 20)), page = Math.min(rosterPage, pages);
  const visible = filtered.slice((page - 1) * 20, page * 20);
  const unrecorded = records.filter(row => row.status === null).length;
  const correction = changed.some(mark => baseline.roster.find(row => row.person_id === mark.person_id)?.status !== null);
  const registerDate = (() => { try { return new Intl.DateTimeFormat(undefined, { timeZone: baseline.register.time_zone, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(baseline.register.starts_at)); } catch { return ''; } })();
  const saveState = !hydrated ? 'Opening encrypted draft…' : storageBlocked ? 'Draft storage unavailable' : pending ? pending.phase === 'accepted' ? 'Saved action · refresh needed' : 'Action awaiting confirmation' : changed.length ? `${changed.length} unsaved ${changed.length === 1 ? 'change' : 'changes'}` : reason.trim() ? 'Unsaved reason' : 'Saved';
  const actionBar = baseline.capabilities.can_record || baseline.capabilities.can_submit || baseline.capabilities.can_finalize || baseline.capabilities.can_reopen ? <View style={[attendanceStyles.actionBar, { backgroundColor: colors.row }]}><Text accessibilityLiveRegion="polite" style={[attendanceStyles.caption, { color: colors.muted }]}>{saveState}</Text><View style={attendanceStyles.choices}>{baseline.capabilities.can_record && changed.length ? <Button title={correction ? 'Save correction' : 'Save draft'} kind="secondary" busy={busy} disabled={locked} onPress={() => void commit('save')} /> : null}{baseline.register.state === 'draft' && (baseline.capabilities.can_submit || baseline.capabilities.can_record) ? <Button title="Submit register" busy={busy} disabled={locked || records.some(mark => mark.status === null && baseline.roster.find(row => row.person_id === mark.person_id)?.requirement === 'required')} onPress={() => void commit('submit')} /> : null}{baseline.capabilities.can_finalize ? <Button title="Finalize register" busy={busy} disabled={locked || !!changed.length} onPress={() => Alert.alert('Finalize this register?', 'The accepted register will become final. Corrections require an authorized reopening.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Finalize', onPress: () => void commit('finalize') }])} /> : null}{baseline.capabilities.can_reopen ? <Button title="Reopen for correction" kind="secondary" busy={busy} disabled={locked || !!changed.length || !reason.trim()} onPress={() => void commit('reopen')} /> : null}</View></View> : null;
  const evidence = <Disclosure title={baseline.pending_evidence?.length ? `Reported evidence · ${baseline.pending_evidence.length}` : 'Paper reports & register help'} defaultOpen={!!baseline.pending_evidence?.length}>
    <Text style={[attendanceStyles.caption, { color: colors.muted }]}>Not recorded means no decision yet. Planned participation and accepted attendance remain separate.</Text>
    {baseline.pending_evidence?.map(item => <Row variant="plain" separator key={item.id} title={item.name} detail={`${labels[item.claimed_status]} · ${new Date(item.observed_at).toLocaleString()}${item.note ? `\n${item.note}` : ''}`} status="Awaiting authorized review" />)}
    {baseline.capabilities.can_record || baseline.capabilities.can_review_evidence || baseline.pending_evidence?.length ? <ControlButton title="Paper reports and evidence review" disabled={locked || dirty} onPress={onEvidence} /> : null}
  </Disclosure>;
  return <Page title="Attendance" refreshing={refreshing} onRefresh={refresh}>
    <View style={attendanceStyles.registerHeader}><View style={attendanceStyles.registerHeading}><Text accessibilityRole="header" style={[attendanceStyles.registerTitle, { color: colors.ink }]}>{baseline.register.title}</Text><ControlButton title="History" onPress={() => setHistoryPage(1)} /></View><Text style={[attendanceStyles.caption, { color: colors.muted }]}>{baseline.register.state === 'locked' ? 'Final' : baseline.register.state === 'submitted' ? 'Submitted' : 'Draft'}</Text><Text style={[attendanceStyles.caption, { color: colors.muted }]}>{registerDate}{registerDate ? ' · ' : ''}{interval(baseline.register)}{baseline.register.place_label ? ` · ${baseline.register.place_label}` : ''}</Text></View>
    {baseline.register.state === 'submitted' && baseline.register.finalization?.state === 'automatic_pending' ? <Notice message="Automatic finalization scheduled." /> : baseline.register.state === 'submitted' && baseline.register.finalization?.reason === 'overdue' ? <Notice tone="warning" message="Automatic finalization is overdue. Review this register." /> : null}
    {baseline.availability_reason ? <Notice message={baseline.availability_reason} tone="warning" /> : null}
    {storageNotice ? <Notice message={storageNotice} tone="warning" /> : null}
    {notice ? <Notice message={notice} tone="info" /> : null}
    {error ? <Notice message={error} tone="danger" /> : null}
    {conflict ? <Notice message="This register changed elsewhere. Your local edits are preserved. Load the saved register before making a new decision." tone="warning" /> : null}
    {pending ? <><Notice message={pending.phase === 'accepted' ? 'The last action was saved. Recovery only refreshes its saved record.' : 'The last action is not yet confirmed. Retry uses its original request and key.'} tone="warning" /><Button title={pending.phase === 'accepted' ? 'Refresh saved action' : 'Retry the same action'} busy={busy} onPress={() => void perform(pending)} /></> : null}
    {storageBlocked ? <Button title="Retry encrypted draft load" kind="secondary" disabled={busy || !hydrated} onPress={() => setDraftLoad(value => value + 1)} /> : null}
    {!storageBlocked && !pending && (dirty || conflict || storageNotice) ? <Button title="Load saved register" kind="secondary" disabled={busy} onPress={discard} /> : null}
    {correction || baseline.capabilities.can_reopen || reason.trim() ? <Field label={correction ? 'Correction reason' : 'Reason for reopening'} value={reason} onChangeText={setReason} editable={!locked} placeholder="Explain what changed and why" multiline maxLength={2000} /> : null}
    <View style={attendanceStyles.summary}><Text style={[attendanceStyles.caption, { color: colors.muted }]}>{records.length - unrecorded} of {records.length} recorded</Text>{baseline.roster.length > 1 && baseline.roster.length <= 8 ? <LinkButton title={findOpen ? 'Hide filters' : 'Find & filter'} expanded={findOpen} onPress={() => { setFindOpen(value => !value); if (findOpen) { setSearch(''); setUnrecordedOnly(false); setRosterPage(1); } }} /> : null}{baseline.capabilities.can_record && baseline.allowed_statuses.includes('present') && unrecorded > 0 ? <LinkButton title="Mark present" disabled={locked} onPress={() => Alert.alert('Mark remaining people present?', `This marks ${unrecorded} not-recorded participants in the entire register. Existing decisions stay as recorded.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Mark present', onPress: () => setRecords(current => current.map(row => row.status === null ? { ...row, status: 'present' } : row)) }])} /> : null}</View>
    {baseline.roster.length > 8 || findOpen || search || unrecordedOnly ? <View style={attendanceStyles.tools}><AttendanceSearch label="Find a participant" value={search} onChangeText={value => { setSearch(value); setRosterPage(1); }} placeholder="Find a participant" autoFocus={findOpen} /><SegmentedControl label="Participant view" value={unrecordedOnly ? 'unrecorded' : 'all'} options={[{ value: 'all', label: 'All', count: baseline.roster.length }, { value: 'unrecorded', label: 'Not recorded', count: unrecorded }]} onChange={value => { setUnrecordedOnly(value === 'unrecorded'); setRosterPage(1); }} /></View> : null}
    {baseline.pending_evidence?.length ? evidence : null}
    <View accessibilityRole="list" accessibilityLabel="Participants" style={attendanceStyles.roster}>{visible.length ? visible.map(person => {
      const current = records.find(row => row.person_id === person.person_id)!;
      return <AttendanceParticipantRow key={person.person_id} participant={{ id: person.person_id, name: person.name }} status={current.status} remarks={current.remarks} context={[...person.roles, person.requirement === 'optional' ? 'Optional participant' : ''].filter(Boolean).join(' · ')} statusOptions={baseline.allowed_statuses.map(status => ({ value: status, label: labels[status] }))} disabled={locked} readOnly={!baseline.capabilities.can_record} onChange={updates => mark(person.person_id, updates)} noteMaxLength={2000} />;
    }) : <Empty title="No matching participants" message="Clear the name or show everyone." />}</View>
    {pages > 1 ? <View style={attendanceStyles.pagination}><AttendanceChoice label="Previous people" selected={false} disabled={page <= 1} onPress={() => setRosterPage(page - 1)} /><Text style={[attendanceStyles.caption, { color: colors.muted }]}>Page {page} of {pages}</Text><AttendanceChoice label="Next people" selected={false} disabled={page >= pages} onPress={() => setRosterPage(page + 1)} /></View> : null}
    {actionBar}
    {unrecorded > 0 ? <Notice message={`${unrecorded} participants remain not recorded. Missing evidence does not mean absence.`} /> : null}
    {!baseline.pending_evidence?.length ? evidence : null}
    <ScreenBack title="Back to registers" disabled={busy} fallbackHref={backHref} />
    <AttendanceSheet visible={historyPage > 0} title="Attendance change history" onClose={() => setHistoryPage(0)}>{historyPage ? <>{history.isPending ? <Loading /> : history.isError ? <Empty title="History could not load" message={history.error.message} onRetry={() => void history.refetch()} /> : !history.data?.history.length ? <Empty title="No saved history yet" /> : history.data.history.map(item => <Row variant="plain" separator key={item.id} title={`${item.name ?? 'Register'} · ${item.action.replaceAll('_', ' ')}`} detail={`${item.actor_name} · ${new Date(item.recorded_at).toLocaleString()}${item.reason ? `\n${item.reason}` : ''}`} status={item.status ? labels[item.status as AttendanceStatus] ?? item.status : undefined} />)}<View style={{ flexDirection: 'row', gap: 8 }}><ControlButton title="Previous" disabled={historyPage <= 1} onPress={() => setHistoryPage(historyPage - 1)} /><Text style={[attendanceStyles.caption, { color: colors.muted }]}>Page {historyPage} of {history.data?.total_pages ?? '…'}</Text><ControlButton title="Older history" disabled={historyPage >= (history.data?.total_pages ?? 1)} onPress={() => setHistoryPage(historyPage + 1)} /></View></> : null}</AttendanceSheet>
  </Page>;
}

const attendanceStyles = StyleSheet.create({
  tools: { gap: 8 }, choices: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  summary: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 12, rowGap: 0 },
  caption: { fontSize: 14, lineHeight: 21 }, groups: { gap: 24 }, group: { gap: 12 }, groupTitle: { fontSize: 18, lineHeight: 25, fontWeight: '600' },
  pagination: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  actionBar: { borderRadius: themeRadii.radiusCard, paddingHorizontal: 16, paddingVertical: 8, gap: 4 },
  registerHeader: { gap: 4 }, registerHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 }, registerTitle: { flex: 1, minWidth: 0, fontSize: 22, lineHeight: 29, fontWeight: '600', letterSpacing: -0.4 }, roster: { gap: 12 },
});
