import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { AccountCommandGate } from '../lib/account-command';
import { apiFetch } from '../lib/api';
import { careLabel, careRecoveryBody, careRoleAcknowledgement as roleAck, careRoot, careTeamBody, careTeamRoles, parseCareOrphans, type CareReceipt, type CareRoleAssignment, type OrphanedCareCase } from '../lib/care-native';
import { useCareRead } from '../lib/use-care-native';
import { useScreenExitGuard } from '../ui/BackNavigation';
import { Alert } from '../ui/Alert';
import { ChoiceMenu, ControlButton, Disclosure } from '../ui/DomainControls';
import { Empty, Field, ListGroup, Loading, Notice, Row, Section } from '../ui/components';
import { CareRecovery, CareText, CareUnavailable, type CarePaneProps } from './CareUI';
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : 'The care-team source could not be checked.';
export function CareTeamPane(props: CarePaneProps & { onDirty(value: boolean): void }) {
  const { controller, workspace, available, refreshWorkspace, schoolId, today, onDirty } = props, root = careRoot(schoolId);
  const gate = useMemo(() => new AccountCommandGate(), []), [state, setState] = useState(gate.snapshot());
  useEffect(() => gate.subscribe(setState), [gate]);
  const [member, setMember] = useState(''), [role, setRole] = useState<string>('designated_lead'), [route, setRoute] = useState('primary'), [revokeId, setRevokeId] = useState(''), [reason, setReason] = useState(''), [preparing, setPreparing] = useState(false), [error, setError] = useState(''), [recoveryDirty, setRecoveryDirty] = useState(false);
  const preparingRef = useRef(false), dirty = !!reason.trim() || !!state.pending || recoveryDirty;
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  useScreenExitGuard({ blocked: state.busy || preparing, dirty: !!reason.trim() || !!state.pending, title: 'Leave care-team changes?', message: 'The entered reason stays in session memory only. An unconfirmed team action has no exact receipt and will not be repeated automatically.', onLeave: () => { setReason(''); setRevokeId(''); } });
  const locked = !available || controller.busy || state.busy || !!state.pending || preparing;
  const change = async (assignment?: CareRoleAssignment) => {
    if (locked || preparingRef.current) return; preparingRef.current = true; setPreparing(true); setError('');
    try {
      const assertCurrent = controller.capture(), latest = await refreshWorkspace(); assertCurrent(); if (!latest.can_manage_team) throw new Error('Current access does not allow care-team changes.');
      let path: string, body: string, expected: Parameters<typeof roleAck>[1];
      if (assignment) {
        const current = latest.team.find(item => item.id === assignment.id); if (!current || current.revision !== assignment.revision || current.status !== 'active' || reason.trim().length < 12 || reason.trim().length > 1000) throw new Error('Review the current assignment and enter a reason of 12–1000 characters.');
        path = `${root}/team-assignments/${assignment.id}/revoke/`; body = JSON.stringify({ expected_revision: assignment.revision, reason: reason.trim() }); expected = { id: assignment.id, userId: assignment.user_id, revision: assignment.revision, role: assignment.role_kind, route: assignment.route_kind, status: 'revoked' };
      } else {
        path = `${root}/team-assignments/`; body = JSON.stringify(careTeamBody(latest, member, role, route, today)); expected = { userId: member, role, route, status: 'active' };
      }
      // The keyless gate keeps only the opaque path/method. The protected reason
      // is captured by this active call only, never a retry closure or journal.
      await gate.run({ path, method: 'POST' }, { assertCurrent, send: request => apiFetch(request.path, { method: request.method, body }), confirm: value => { roleAck(value, expected); return true; }, accepted: () => { setRevokeId(''); setReason(''); }, refresh: refreshWorkspace });
    } catch (cause) { setError(errorText(cause)); } finally { preparingRef.current = false; setPreparing(false); }
  };
  const inspect = async () => { try { const assertCurrent = controller.capture(); await gate.inspect({ assertCurrent, refresh: refreshWorkspace }); } catch (cause) { setError(errorText(cause)); } };
  const revoking = workspace.team.find(item => item.id === revokeId);
  return <>
    {!available ? <CareUnavailable retry={() => void refreshWorkspace().catch(() => {})} /> : null}
    <View style={{ display: available ? 'flex' : 'none', gap: 20 }} accessibilityElementsHidden={!available} importantForAccessibility={available ? 'auto' : 'no-hide-descendants'}>
      <CareText>Team assignments set intake recipients. Each case still needs explicit access; a job title does not open confidential records.</CareText>
      <Disclosure title="Add care-team member"><ChoiceMenu label="Staff member" value={member} disabled={locked} options={workspace.candidates.map(candidate => ({ value: candidate.id, label: `${candidate.name || candidate.email} · ${candidate.role}` }))} onChange={setMember} /><ChoiceMenu label="Care role" value={role} disabled={locked} options={careTeamRoles.map(value => ({ value, label: careLabel(value) }))} onChange={setRole} /><ChoiceMenu label="Intake route" value={route} disabled={locked} options={[{ value: 'primary', label: 'Primary route' }, { value: 'alternate', label: 'Alternate route' }]} onChange={setRoute} /><CareText>Effective from {today || 'Campus date unavailable'} · No end date</CareText><ControlButton title="Add assignment" kind="primary" disabled={locked || !member || !today} busy={preparing || state.busy} onPress={() => void change()} /></Disclosure>
      <Section title="Care-team assignments"><ListGroup><View style={{ paddingHorizontal: 16 }}>{workspace.team.map((assignment, index) => <Row key={assignment.id} variant="plain" separator={index > 0} title={assignment.member_name || assignment.email} detail={`${careLabel(assignment.role_kind)} · ${careLabel(assignment.route_kind)}\nFrom ${assignment.valid_from}${assignment.valid_until ? ` to ${assignment.valid_until}` : ''}`} status={careLabel(assignment.status)}>{assignment.status === 'active' ? <ControlButton title="Revoke assignment" kind="danger" disabled={locked || !!revokeId} onPress={() => { setRevokeId(assignment.id); setReason(''); }} /> : null}</Row>)}</View></ListGroup>{!workspace.team.length ? <Empty title="No care-team assignments" /> : null}</Section>
      {revokeId ? <Section title="Revoke care-team assignment">{!revoking ? <Notice tone="warning" message="The selected assignment changed or disappeared. Review the current team." /> : <CareText>{revoking.member_name || revoking.email} · {careLabel(revoking.role_kind)} · {careLabel(revoking.route_kind)}</CareText>}<Field label="Reason for revocation" value={reason} onChangeText={setReason} editable={!locked} multiline maxLength={1000} autoCorrect={false} spellCheck={false} autoComplete="off" textContentType="none" /><CareText>Revoking this intake-team assignment does not revoke independent case assignments.</CareText><View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}><ControlButton title="Cancel change" disabled={state.busy || preparing} onPress={() => { setRevokeId(''); setReason(''); }} /><ControlButton title="Confirm revocation" kind="danger" disabled={locked || !revoking || reason.trim().length < 12} onPress={() => revoking && Alert.alert('Revoke this intake-team assignment?', 'This removes its intake routing role. Independent case access is unchanged.', [{ text: 'Keep assignment', style: 'cancel' }, { text: 'Revoke assignment', style: 'destructive', onPress: () => void change(revoking) }])} /></View></Section> : null}
      {error || state.error ? <Notice tone="warning" message={error || state.error} /> : null}
      {state.pending ? <><Notice tone="warning" message={state.pending.phase === 'acknowledged' ? 'The team change was acknowledged. Refresh checks current state without repeating it.' : 'This team change is unconfirmed. Its API has no command receipt. Inspect current assignments before a new choice; the original request is not repeated.'} /><ControlButton title="Inspect current team" busy={state.busy || preparing} onPress={() => void inspect()} />{state.pending.phase === 'unknown' && state.pending.inspected ? <ControlButton title="Use reviewed team for a new choice" onPress={() => gate.review()} /> : null}</> : null}
    </View>
    <View style={{ display: available ? 'flex' : 'none' }} accessibilityElementsHidden={!available} importantForAccessibility={available ? 'auto' : 'no-hide-descendants'}><CareOwnerRecovery {...props} onDirty={setRecoveryDirty} disabled={!available || !!state.pending || state.busy || preparing} /></View>
  </>;
}
function CareOwnerRecovery(props: CarePaneProps & { onDirty(value: boolean): void; disabled: boolean }) {
  const { schoolId, controller, available, onDirty, disabled, refreshWorkspace } = props;
  const [open, setOpen] = useState(false), [page, setPage] = useState(1), [selected, setSelected] = useState<OrphanedCareCase | null>(null);
  const query = useCareRead(`${careRoot(schoolId)}/orphaned-cases/?page=${page}`, value => { const data = parseCareOrphans(value); if (data.page !== page) throw new Error('The recovery queue returned a different page.'); return data; }, open && available);
  const data = query.value ?? query.data;
  const refresh = async () => { const assertCurrent = controller.capture(); const value = await query.refresh(); assertCurrent(); await refreshWorkspace(); assertCurrent(); return value; };
  return <Section title="Restore unassigned responsibility"><ControlButton title={open ? 'Hide recovery queue' : 'Check owner recovery'} disabled={controller.busy} onPress={() => setOpen(value => !value)} />
    <View style={{ display: open ? 'flex' : 'none', gap: 12 }} accessibilityElementsHidden={!open} importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}><CareText>Only open cases without an active owner appear. Assigning a lead does not open confidential case content for you.</CareText>
      {!query.value ? query.isPending && available && open ? <Loading /> : <CareUnavailable error={query.error} retry={() => void query.refresh().catch(() => {})} /> : data ? <>{!data.total ? <CareText>Every open case has an active owner.</CareText> : <><CareText>{data.total} {data.total === 1 ? 'case needs' : 'cases need'} responsibility restored</CareText><ListGroup><View style={{ paddingHorizontal: 16 }}>{data.cases.map((item, index) => <Row key={item.id} variant="plain" separator={index > 0} title={`Protected case · ${item.id.slice(-6)}`} detail={`${item.owner_name || 'Name unavailable'} · ${careLabel(item.intake_route)}`} onPress={selected || disabled ? undefined : () => setSelected(item)} />)}</View></ListGroup>{data.pages > 1 ? <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}><ControlButton title="Previous" disabled={disabled || !!selected || page <= 1} onPress={() => setPage(value => value - 1)} /><CareText>Page {data.page} of {data.pages}</CareText><ControlButton title="Next" disabled={disabled || !!selected || page >= data.pages} onPress={() => setPage(value => value + 1)} /></View> : null}</>}</> : null}
      {selected ? <CareRecoveryEditor {...props} key={selected.id} selected={selected} refresh={refresh} onClose={() => setSelected(null)} /> : null}
    </View>
  </Section>;
}
function CareRecoveryEditor(props: CarePaneProps & { selected: OrphanedCareCase; disabled: boolean; onDirty(value: boolean): void; refresh(): Promise<ReturnType<typeof parseCareOrphans>>; onClose(): void }) {
  const { controller, selected, disabled, available, schoolId, onDirty, refresh, onClose } = props;
  const [owner, setOwner] = useState(''), [note, setNote] = useState(''), [revision, setRevision] = useState(selected.revision), [candidates, setCandidates] = useState(selected.candidates), [preparing, setPreparing] = useState(false), [error, setError] = useState('');
  const preparingRef = useRef(false);
  const slot = `recovery:${selected.id}`, reference = controller.references.find(value => value.slot === slot), review = controller.reviewNeeded.includes(slot), dirty = !!note.trim() || !!owner || !!reference && controller.journal.hasPrivate(reference);
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  const clear = () => { setNote(''); setOwner(''); controller.journal.dropPrivate(slot); };
  useScreenExitGuard({ blocked: controller.busy || preparing, dirty, title: 'Leave this protected recovery?', message: 'The entered recovery reason and callable retry remain only in this Care session. Leaving discards them; opaque command references remain for exact confirmation.', onLeave: clear });
  const accepted = async (_receipt: CareReceipt) => { await refresh(); clear(); onClose(); };
  const save = async () => {
    if (disabled || controller.busy || controller.blocked || !controller.ready || reference || preparing || preparingRef.current || review || !available) return;
    preparingRef.current = true;
    const original = { owner, note: note.trim(), revision }; setPreparing(true); setError('');
    try {
      const assertCurrent = controller.capture(), queue = await refresh(); assertCurrent(); const current = queue.cases.find(item => item.id === selected.id);
      if (!current) throw new Error('This case no longer appears in the current recovery queue.'); const prepared = careRecoveryBody(current, original.owner, original.note, original.revision, selected.id);
      let body = ''; await controller.journal.start({ kind: 'recovery', caseId: selected.id, expectedRevision: original.revision, operation: commandId => { body ||= JSON.stringify({ ...prepared, command_id: commandId }); return apiFetch(`${careRoot(schoolId)}/orphaned-cases/${selected.id}/reassign/`, { method: 'POST', body }); } }, controller.context(accepted));
    } catch (cause) { setError(errorText(cause)); } finally { preparingRef.current = false; setPreparing(false); }
  };
  const locked = disabled || controller.busy || controller.blocked || !controller.ready || !!reference || preparing || review || !available;
  return <Section title={`Restore case responsibility · ${selected.id.slice(-6)}`}>
    <ChoiceMenu label="New care lead" value={owner} options={candidates.map(candidate => ({ value: candidate.id, label: `${candidate.name || 'Name unavailable'} · ${careLabel(candidate.role_kind)}` }))} disabled={locked} onChange={setOwner} />{!candidates.length ? <CareText>Assign an eligible lead on this protected route first.</CareText> : null}
    <Field label="Reason for recovery" value={note} onChangeText={setNote} multiline editable={!locked} maxLength={1000} autoCorrect={false} spellCheck={false} autoComplete="off" textContentType="none" />
    {reference ? <CareRecovery {...{ controller, reference, accepted }} /> : review ? <ControlButton title="Review current recovery queue" onPress={() => { void refresh().then(queue => { const latest = queue.cases.find(item => item.id === selected.id); if (!latest) throw new Error('This case no longer needs owner recovery.'); setRevision(latest.revision); setCandidates(latest.candidates); controller.journal.reviewed(slot); }).catch(cause => setError(errorText(cause))); }} /> : <ControlButton title="Assign responsibility" kind="primary" disabled={locked || !owner || note.trim().length < 20} busy={preparing} onPress={() => Alert.alert('Restore confidential responsibility?', 'The selected eligible lead will receive ownership. This does not grant you access to the protected case narrative.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Assign responsibility', onPress: () => void save() }])} />}
    {error ? <Notice tone="warning" message={error} /> : null}<ControlButton title="Close recovery form" disabled={controller.busy || preparing || !!reference} onPress={() => { if (!dirty) onClose(); else Alert.alert('Discard this recovery draft?', 'The entered protected reason stays only in this session and will be discarded.', [{ text: 'Keep draft', style: 'cancel' }, { text: 'Discard draft', style: 'destructive', onPress: () => { clear(); onClose(); } }]); }} />
  </Section>;
}
