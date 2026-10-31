import { useRef, useState } from 'react';
import type { DiningIssueDetail, DiningRef, DiningSessionDetail } from '../../../packages/contracts/src/wire/features/dining/diningApi';
import { apiFetch } from '../lib/api';
import { useOperationContext } from '../lib/use-operation-context';
import { diningRecoveryBody, reviewedDiningSource } from '../lib/dining-session-operations';
import { useScreenExitGuard } from '../ui/BackNavigation';
import { Alert } from '../ui/Alert';
import { ControlButton } from '../ui/DomainControls';
import { Field, Notice, Section } from '../ui/components';
import { DiningChoices } from './DiningChoices';
import { LabeledSwitch, type RecordedWrite } from './ResourcesScreen';
/** Recovery receives only source/revision/capability metadata, never a menu or report. */
export function DiningResponsibility({ root, source, kind, write, readError, onClose }: { root: string; source: DiningSessionDetail | DiningIssueDetail; kind: 'session' | 'issue'; write: RecordedWrite; readError?: string; onClose?(): void }) {
  const [basis, setBasis] = useState(source), [operator, setOperator] = useState<DiningRef | null>(null), [coordinator, setCoordinator] = useState<DiningRef | null>(null), [picking, setPicking] = useState<'operator' | 'coordinator' | null>(null), [note, setNote] = useState(''), [confirmed, setConfirmed] = useState(false), [preparing, setPreparing] = useState(false), [error, setError] = useState('');
  const recovery = 'recovery_only' in source && source.recovery_only === true;
  const pending = useRef(false), capture = useOperationContext(`${root}/${kind}s/${source.id}:${readError ?? ''}`), stale = basis.id !== source.id || basis.revision !== source.revision || ('recovery_only' in basis && basis.recovery_only === true) !== recovery, locked = write.locked || preparing || !!readError;
  useScreenExitGuard({ blocked: write.busy || preparing, dirty: !write.pending && !!(operator || coordinator || note.trim()), title: 'Leave responsibility recovery?', message: 'The unsaved next-person choices and reason will be discarded.' });
  const save = async () => { if (locked || stale || pending.current || !confirmed) return; pending.current = true; setPreparing(true); setError(''); try { const assertCurrent = capture(), fresh = await apiFetch<DiningSessionDetail | DiningIssueDetail>(`${root}/${kind === 'issue' ? 'issues' : 'sessions'}/${source.id}`); assertCurrent(); reviewedDiningSource(basis, fresh, 'reassign'); const body = diningRecoveryBody(fresh, kind, { note, operator, coordinator }); await write.run({ kind, sourceId: source.id, path: `${root}/${kind === 'issue' ? 'issues' : 'sessions'}/${source.id}/actions`, body }); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Responsibility could not be checked.'); } finally { pending.current = false; setPreparing(false); } };
  return <Section title={kind === 'issue' ? 'Restore shortage responsibility' : 'Restore dining responsibility'}>
    <Notice tone={recovery ? 'warning' : 'info'} message={recovery ? 'Only responsibility recovery is available. Private menu/report details are withheld; no replacement person is assumed.' : 'Only this dated record’s responsibility changes. No campus-wide access is granted.'} />
    {stale ? <><Notice message="The source changed. Your choices and reason are retained; review its current revision before saving." /><ControlButton title="Review current responsibility source" disabled={locked} onPress={() => { setBasis(source); setConfirmed(false); }} /></> : null}
    {kind === 'session' ? <><ControlButton title={`Next coordinator · ${coordinator?.label ?? 'Change only if needed'}`} disabled={locked} onPress={() => setPicking('coordinator')} />{coordinator ? <ControlButton title="Keep current coordinator" disabled={locked} onPress={() => { setCoordinator(null); setConfirmed(false); }} /> : null}</> : null}
    <ControlButton title={`Next ${kind === 'issue' ? 'handler' : 'operator'} · ${operator?.label ?? 'Choose a person'}`} disabled={locked} onPress={() => setPicking('operator')} />
    {picking ? <DiningChoices root={root} kind="people" context={{ [`${kind}_id`]: source.id }} write={write} onClose={() => setPicking(null)} onSelected={person => { if (picking === 'coordinator') setCoordinator(person); else setOperator(person); setPicking(null); setConfirmed(false); }} /> : null}
    <Field label="Reason" value={note} onChangeText={value => { setNote(value); setConfirmed(false); }} maxLength={1000} multiline editable={!locked} />
    <LabeledSwitch label="I reviewed the people receiving this responsibility." value={confirmed} onChange={setConfirmed} disabled={locked} />
    {error || readError ? <Notice tone="warning" message={error || readError!} /> : null}
    <ControlButton title="Change responsibility" kind="primary" busy={preparing || write.busy} disabled={locked || stale || !source.allowed_actions.includes('reassign') || !confirmed || note.trim().length < 3 || (kind === 'issue' ? !operator : !operator && !coordinator)} onPress={() => void save()} />
    {onClose ? <ControlButton title="Close responsibility review" disabled={write.busy || preparing} onPress={() => operator || coordinator || note.trim() ? Alert.alert('Discard unsaved responsibility choices?', 'Saved responsibility remains unchanged.', [{ text: 'Keep reviewing', style: 'cancel' }, { text: 'Discard choices', style: 'destructive', onPress: onClose }]) : onClose()} /> : null}
  </Section>;
}
