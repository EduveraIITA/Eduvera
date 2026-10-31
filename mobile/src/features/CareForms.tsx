import { useEffect, useRef, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../auth/SessionProvider';
import { apiFetch } from '../lib/api';
import { careActionBody, careAttentionProof, careAvailableActions, careHref, careIntakeBody, careLabel, careRoot, newCareIntake, parseCareDetail, type CareActionKind, type CareCaseDetail, type CareReceipt } from '../lib/care-native';
import { useCareRead } from '../lib/use-care-native';
import { usePolicyAttention } from '../lib/use-policy-attention';
import { useScreenExitGuard } from '../ui/BackNavigation';
import { Alert } from '../ui/Alert';
import { ChoiceMenu, ControlButton, Disclosure, Facts, InfoDisclosure } from '../ui/DomainControls';
import { Field, Loading, Notice, Section } from '../ui/components';
import { TemporalField } from '../ui/TemporalField';
import { useTheme } from '../ui/theme';
import { CareRecovery, CareText, CareUnavailable, type CarePaneProps } from './CareUI';

const options = (values: readonly string[]) => values.map(value => ({ value, label: careLabel(value) }));
const actionOptions = (values: readonly CareActionKind[]) => values.map(value => ({ value, label: ({ triage: 'Move to triage', active: 'Mark active', closed: 'Close with outcome' } as Partial<Record<CareActionKind, string>>)[value] ?? careLabel(value) }));
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : 'The protected source could not be checked.';
export function CareIntakePane(props: CarePaneProps) {
  const { controller, workspace, available, schoolId, href, refreshWorkspace, onSavedNavigate } = props;
  const [form, setForm] = useState(newCareIntake), [preparing, setPreparing] = useState(false), [error, setError] = useState('');
  const preparingRef = useRef(false);
  const reference = controller.references.find(value => value.slot === 'intake'), review = controller.reviewNeeded.includes('intake');
  const locked = !available || !controller.ready || controller.blocked || controller.busy || !!reference || preparing || review;
  const clearPrivate = () => { setForm(newCareIntake()); controller.journal.dropPrivate('intake'); };
  useScreenExitGuard({ blocked: controller.busy || preparing, dirty: !!form.details.trim() || !!reference && controller.journal.hasPrivate(reference), title: 'Leave this protected draft?', message: 'Unsaved protected text and its callable retry details stay only in this Care session. Leaving discards them. Opaque references remain for checking an unconfirmed save; do not submit a replacement.', onLeave: clearPrivate });
  const accepted = async (receipt: CareReceipt) => { await refreshWorkspace(); setForm(newCareIntake()); setPreparing(false); onSavedNavigate(careHref(href, { section: 'cases', caseId: receipt.id })); };
  const save = async () => {
    if (locked || preparingRef.current) return; preparingRef.current = true; const original = { ...form }; setPreparing(true); setError('');
    try {
      const assertCurrent = controller.capture(), latest = await refreshWorkspace(); assertCurrent();
      const prepared = careIntakeBody(original, latest, schoolId);
      let body = ''; await controller.journal.start({ kind: 'intake', expectedRevision: 0, operation: commandId => { body ||= JSON.stringify({ ...prepared, command_id: commandId }); return apiFetch(`${careRoot(schoolId)}/cases/`, { method: 'POST', body }); } }, controller.context(accepted));
    } catch (cause) { setError(errorText(cause)); } finally { preparingRef.current = false; setPreparing(false); }
  };
  const set = <K extends keyof typeof form>(key: K, value: typeof form[K]) => setForm(previous => ({ ...previous, [key]: value }));
  return <>
    {reference ? <CareRecovery {...{ controller, reference, accepted }} /> : null}
    {!available ? <CareUnavailable retry={() => void refreshWorkspace().catch(() => {})} pending={!!reference} /> : <>
      <Notice message="Record what was seen, heard or disclosed. Do not investigate, confront an alleged person, promise secrecy or delay urgent external help." />
      <Section title="Who and how"><ChoiceMenu label="Child or student · optional" value={form.student_id} disabled={locked} options={[{ value: '', label: 'Not selected / not in my assigned list' }, ...workspace.eligible_students.map(student => ({ value: student.id, label: `${student.name || 'Name unavailable'} · ${student.admission_number}` }))]} onChange={value => set('student_id', value)} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><View style={{ flex: 1 }}><CareText>The ordinary handler may be involved. This forces the protected alternate route.</CareText></View><Switch accessibilityLabel="The ordinary handler may be involved" disabled={locked} value={form.ordinary_handler_involved} onValueChange={value => setForm(previous => ({ ...previous, ordinary_handler_involved: value, ...(value ? { intake_route: 'alternate' } : {}) }))} /></View>
        <ChoiceMenu label="Recipient route" value={form.intake_route} disabled={locked || form.ordinary_handler_involved} options={[{ value: 'primary', label: `Primary route · ${workspace.routes.primary} available` }, { value: 'alternate', label: `Alternate route · ${workspace.routes.alternate} available` }]} onChange={value => set('intake_route', value)} />
        <ChoiceMenu label="How it came to you" value={form.source_kind} options={options(['staff_observation', 'child_disclosure', 'guardian_report', 'student_report', 'anonymous', 'other'])} disabled={locked} onChange={value => set('source_kind', value)} />
        <ChoiceMenu label="Concern category" value={form.concern_category} options={options(['sexual_safety', 'physical_safety', 'emotional_wellbeing', 'neglect', 'bullying', 'cyber_safety', 'other'])} disabled={locked} onChange={value => set('concern_category', value)} />
        <ChoiceMenu label="Operational urgency" value={form.urgency} options={options(['urgent', 'priority', 'routine'])} disabled={locked} onChange={value => set('urgency', value)} />
        <ChoiceMenu label="Immediate safety at the time of recording" value={form.safety_state} options={options(['immediate_action_required', 'actions_underway', 'no_immediate_danger', 'unknown'])} disabled={locked} onChange={value => set('safety_state', value)} />
      </Section>
      <Section title="Protected intake note"><Field label="Factual intake note" value={form.details} onChangeText={value => set('details', value)} editable={!locked} multiline maxLength={6000} autoCorrect={false} spellCheck={false} autoComplete="off" textContentType="none" placeholder="Exact words where possible, what you observed, when it occurred and immediate actions already taken. Avoid assumptions or diagnosis." /><CareText>This draft stays only in this active Care session. No protected note is placed in device recovery storage.</CareText></Section>
      {error ? <Notice tone="warning" message={error} /> : null}
      {review ? <ControlButton title="Review latest routes" onPress={() => { void refreshWorkspace().then(() => controller.journal.reviewed('intake')).catch(cause => setError(errorText(cause))); }} /> : !reference ? <ControlButton title="Record concern" kind="primary" busy={preparing || controller.busy} disabled={locked || form.details.trim().length < 20} onPress={() => void save()} /> : null}
    </>}
  </>;
}

export function CareCasePane(props: CarePaneProps & { caseId: string; expectedRevision: number | null }) {
  const { controller, schoolId, scopeKey, caseId, expectedRevision, available, href, refreshWorkspace, onSavedNavigate, now } = props;
  const session = useSession(), cache = useQueryClient(), { colors } = useTheme(), path = `${careRoot(schoolId)}/cases/${caseId}/`;
  const query = useCareRead(path, value => parseCareDetail(value, caseId, schoolId, session.user!.id), available);
  const [kind, setKind] = useState<CareActionKind>('case_note'), [note, setNote] = useState(''), [owner, setOwner] = useState(''), [authority, setAuthority] = useState('local_police'), [reportedAt, setReportedAt] = useState(() => now()), [draftRevision, setDraftRevision] = useState<number | null>(null);
  const [preparing, setPreparing] = useState(false), [error, setError] = useState(''), [transferred, setTransferred] = useState(false);
  const preparingRef = useRef(false);
  const slot = `case:${caseId}`, reference = controller.references.find(value => value.slot === slot), detail = query.value, review = controller.reviewNeeded.includes(slot);
  const full = !!detail && detail.access.access_level === 'full', actions = detail ? careAvailableActions(detail) : [], changed = !!detail && draftRevision !== null && draftRevision !== detail.case.revision;
  const currentInstant = now(), clockReady = Number.isFinite(Date.parse(currentInstant));
  const proof = available && detail && !query.isError ? careAttentionProof(href, detail) : null; usePolicyAttention(proof, query.dataUpdatedAt);
  const clearDraft = () => { setNote(''); setOwner(''); setDraftRevision(null); controller.journal.dropPrivate(slot); };
  useScreenExitGuard({ blocked: controller.busy || preparing, dirty: !!note.trim() || !!owner || !!reference && controller.journal.hasPrivate(reference), title: 'Leave this protected action?', message: 'Protected text and callable retry details stay only in this Care session. Leaving discards them. Retained opaque references can still check the exact result.', onLeave: clearDraft });
  useEffect(() => { if (detail && detail.access.access_level !== 'full') { setNote(''); setOwner(''); setDraftRevision(null); } }, [detail?.access.access_level]);
  const accepted = async (receipt: CareReceipt) => {
    setNote(''); setOwner(''); setDraftRevision(null);
    if (receipt.action === 'restricted_care.case.reassigned') { setTransferred(true); cache.removeQueries({ queryKey: ['campus', scopeKey, path], exact: true }); await refreshWorkspace(); setPreparing(false); onSavedNavigate(careHref(href, { section: 'cases' })); return; }
    const latest = await query.refresh(); if (latest.case.revision < receipt.revision) throw new Error('The acknowledged protected action is not reflected in the current record yet.'); await refreshWorkspace(); setDraftRevision(receipt.revision);
  };
  const begin = () => setDraftRevision(previous => previous ?? detail?.case.revision ?? null);
  const save = async () => {
    if (!detail || !available || controller.busy || controller.blocked || !controller.ready || reference || preparing || preparingRef.current || review || changed) return;
    preparingRef.current = true;
    const original = { note, owner, authority, reportedAt, revision: draftRevision ?? detail.case.revision }, selectedKind = kind, clock = now(); setPreparing(true); setError('');
    try {
      const assertCurrent = controller.capture(), latest = await query.refresh(); assertCurrent();
      const prepared = careActionBody(latest, selectedKind, original, clock, caseId);
      let body = ''; await controller.journal.start({ kind: 'action', caseId, expectedRevision: original.revision, operation: commandId => { body ||= JSON.stringify({ ...prepared, command_id: commandId }); return apiFetch(`${path}actions/`, { method: 'POST', body }); } }, controller.context(accepted));
    } catch (cause) { setError(errorText(cause)); } finally { preparingRef.current = false; setPreparing(false); }
  };
  const locked = !available || !detail || !full || !controller.ready || controller.blocked || controller.busy || !!reference || preparing || review || changed || !!query.error;
  const reviewLatest = async () => { try { const assertCurrent = controller.capture(), latest = await query.refresh(); assertCurrent(); setDraftRevision(latest.case.revision); controller.journal.reviewed(slot); setError(''); } catch (cause) { setError(errorText(cause)); } };
  if (transferred) return <>{reference ? <CareRecovery {...{ controller, reference, accepted }} /> : null}<Notice message="Confidential responsibility was handed over. Current access controls which records you can open." /></>;
  return <>
    {reference ? <CareRecovery {...{ controller, reference, accepted }} /> : null}
    {!available || !detail ? query.isPending && available ? <Loading /> : <CareUnavailable error={query.error} retry={() => void query.refresh().catch(() => {})} pending={!!reference} /> : <>
      {expectedRevision && expectedRevision !== detail.case.revision && new URLSearchParams(href.split('?')[1] ?? '').has('attention_notification_id') ? <Notice tone="warning" message="This protected-case update changed since the alert was created. It was not marked as opened." /> : null}
      <Section title={detail.case.subject_name || 'Child not selected'}><Facts items={[{ label: 'Status', value: careLabel(detail.case.status) }, { label: 'Urgency', value: careLabel(detail.case.urgency) }, { label: 'Concern', value: careLabel(detail.case.concern_category) }, { label: 'Reporting', value: careLabel(detail.case.reporting_state) }, { label: 'Owner', value: detail.case.owner_name || 'Name unavailable' }]} /></Section>
      {detail.case.reporting_state === 'assessment_required' ? <Notice tone="warning" message="Reporting assessment is still open. The software cannot decide the legal duty. Authorized staff must follow the institution’s immediate statutory reporting process." /> : null}
      {!full ? <Notice message="Reporter receipt: your access is limited to the intake you recorded. Later handling notes are visible only to assigned restricted-care staff." /> : null}
      {detail.source_content_omitted ? <Notice tone="warning" message="Original protected notes and report references were not copied into this Simulation. Only new records made in this run are shown." /> : null}
      <Section title="Protected record">{detail.entries.length ? detail.entries.map(entry => <View key={entry.id} style={{ gap: 5, paddingVertical: 8 }}><CareText>{careLabel(entry.entry_type)} · {new Date(entry.created_at).toLocaleString()}</CareText><Text style={{ color: colors.ink, fontSize: 16, lineHeight: 24 }}>{entry.note}</Text></View>) : <CareText>{detail.source_content_omitted ? 'Captured original text was omitted.' : 'No protected entries are currently available to you.'}</CareText>}</Section>
      {full && detail.external_reports.length ? <Disclosure title="External reporting evidence">{detail.external_reports.map(report => <View key={report.id} style={{ gap: 5, paddingVertical: 8 }}><Text style={{ color: colors.ink, fontSize: 16, fontWeight: '600' }}>{careLabel(report.authority_type)}</Text><Text style={{ color: colors.ink, fontSize: 15, lineHeight: 23 }}>{report.reference}</Text><CareText>Reported {new Date(report.reported_at).toLocaleString()} · Recorded {new Date(report.created_at).toLocaleString()}</CareText></View>)}</Disclosure> : null}
      {full && detail.case.status !== 'closed' ? <Section title="Record next action">
        <ChoiceMenu label="Action" value={kind} options={actionOptions(actions)} disabled={locked} onChange={value => { begin(); setKind(value as CareActionKind); if (value === 'external_report') setReportedAt(now()); }} />
        {kind === 'external_report' ? <><ChoiceMenu label="External authority" value={authority} options={options(['sjpu', 'local_police', 'child_welfare_committee', 'child_helpline', 'other'])} disabled={locked} onChange={value => { begin(); setAuthority(value); }} /><TemporalField label="Reported at" mode="datetime" value={reportedAt} maximumDate={clockReady ? new Date(currentInstant) : undefined} disabled={locked || !clockReady} onChange={value => { begin(); setReportedAt(value); }} /><CareText>{clockReady ? 'Use the actual report time. Recording this evidence is separate from making the external report.' : 'The selected campus clock is unavailable. Refresh the workspace before recording report time.'}</CareText></> : null}
        {kind === 'reassign' ? <><ChoiceMenu label="New care lead" value={owner} options={detail.handover_candidates.map(candidate => ({ value: candidate.id, label: `${candidate.name || 'Name unavailable'} · ${careLabel(candidate.role_kind)}` }))} disabled={locked} onChange={value => { begin(); setOwner(value); }} /><Notice tone="warning" message="This transfers confidential access. You will no longer see handling notes unless independently assigned. If no eligible replacement is configured, ask the care-team administrator to assign one on this protected route." /></> : null}
        <Field label={kind === 'external_report' ? 'Report reference' : kind === 'reassign' ? 'Handover note' : 'Factual note / rationale'} value={note} onChangeText={value => { begin(); setNote(value); }} multiline maxLength={kind === 'external_report' || kind === 'reassign' ? 1000 : 6000} editable={!locked} autoCorrect={false} spellCheck={false} autoComplete="off" textContentType="none" />
        {changed || review ? <><Notice tone="warning" message="This case changed or the prior save was refused. Review the latest record; your note is kept." /><ControlButton title="Review latest protected record" disabled={controller.busy || preparing} onPress={() => void reviewLatest()} /></> : !reference ? <ControlButton title={kind === 'reassign' ? 'Hand over case' : 'Save action'} kind="primary" busy={preparing || controller.busy} disabled={locked || !actions.includes(kind) || note.trim().length < (kind === 'external_report' ? 3 : ['reassign', 'reporting_required', 'not_applicable', 'triage', 'active', 'closed'].includes(kind) ? 20 : 10) || kind === 'external_report' && !clockReady || kind === 'reassign' && !owner || kind === 'closed' && ['assessment_required', 'reporting_required'].includes(detail.case.reporting_state)} onPress={() => kind === 'reassign' ? Alert.alert('Hand over this confidential case?', 'The selected lead will receive responsibility. Your previous owner access to handling notes will end.', [{ text: 'Keep responsibility', style: 'cancel' }, { text: 'Hand over case', onPress: () => void save() }]) : void save()} /> : null}
        {kind === 'closed' && ['assessment_required', 'reporting_required'].includes(detail.case.reporting_state) ? <Notice message="Record the reporting assessment and any required external report before closure." /> : null}
        {error ? <Notice tone="warning" message={error} /> : null}
      </Section> : null}
      <InfoDisclosure title="Confidential access"><CareText>Only explicit active case assignments open this record. Job title or care-team membership alone does not grant access. Closure preserves evidence.</CareText></InfoDisclosure>
    </>}
  </>;
}
