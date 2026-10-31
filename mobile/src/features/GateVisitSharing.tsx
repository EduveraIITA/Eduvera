import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { ArrangedVisit, VisitOptions, VisitPerson } from '../../../packages/contracts/src/wire/features/gate/visitApi';
import type { SharedVisitDetail, VisitSharing } from '../../../packages/contracts/src/wire/features/gate/visitSharingApi';
import { diningFold, diningInput, diningInstant } from '../../../packages/contracts/src/dining-time';
import { apiFetch } from '../lib/api';
import type { useGateCommand } from '../lib/gate-command';
import { useApi } from '../lib/query';
import { assertVisitSharingSource, readVisitSharing, visitShareAction, visitShareCommand } from '../lib/visit-sharing';
import { useOperationContext } from '../lib/use-operation-context';
import { useOperationClock } from '../lib/use-operation-clock';
import { Alert } from '../ui/Alert';
import { ScreenBack, useScreenExitGuard } from '../ui/BackNavigation';
import { ControlButton, Disclosure, Facts } from '../ui/DomainControls';
import { Empty, Field, Loading, Notice, Row, Section, usePageScroll } from '../ui/components';
import { DiningCampusTimeField } from './DiningTimeFields';
import { VisitChoicePicker } from './GateVisitEditor';
import { OperationsWorkInvitation } from './OperationsWorkInvitation';

const states = { active: 'Shared', expired: 'Sharing expired', revoked: 'Sharing stopped', party_changed: 'Guest details changed' };
type Write = ReturnType<typeof useGateCommand>;
export function GateVisitSharing({ href, root, schoolId, visit, timezone, write, acceptedKey, onEditing, onNavigate }: { href: string; root: string; schoolId: string; visit: ArrangedVisit; timezone?: string; write: Write; acceptedKey: string; onEditing(value: boolean): void; onNavigate(href: string): void }) {
  const options=useApi<VisitOptions>(`${root}/options/`),campusTimezone=options.data?.timezone??timezone??'';
  const path = `${root}/${visit.id}`, metadata = useApi<unknown>(`${path}/sharing/`), capture = useOperationContext(`${path}/sharing`);
  let data: VisitSharing | null = null, malformed = '';
  if (metadata.data && !metadata.error) try { data = readVisitSharing(metadata.data); } catch (cause) { malformed = cause instanceof Error ? cause.message : 'Sharing is unavailable.'; }
  const shared = useApi<SharedVisitDetail>(data?.can_open_shared ? `${path}/shared/` : null), current = data?.current;
  const [editing, setEditing] = useState(false), [invitation, setInvitation] = useState(false), [note, setNote] = useState(''), [error, setError] = useState(''), [preparing, setPreparing] = useState(false);
  const pending = useRef(false), previousAccepted = useRef(acceptedKey);
  const childSource = JSON.stringify([visit.id, visit.revision, data, campusTimezone]), childAttempt = useRef(0);
  const childState = useRef({ note, editing, invitation, source: childSource, locked: write.locked || preparing, epoch: 0 });
  if (childState.current.note !== note || childState.current.editing !== editing || childState.current.invitation !== invitation || childState.current.source !== childSource || childState.current.locked !== (write.locked || preparing)) childState.current = { note, editing, invitation, source: childSource, locked: write.locked || preparing, epoch: childState.current.epoch + 1 };
  useEffect(() => { if (acceptedKey !== previousAccepted.current && !write.busy && !write.pending) { previousAccepted.current = acceptedKey; setEditing(false); setNote(''); } }, [acceptedKey, write.busy, write.pending]);
  useEffect(() => { onEditing(editing || invitation); return () => onEditing(false); }, [editing, invitation, onEditing]);
  useScreenExitGuard({ blocked: preparing || write.busy, dirty: !editing && !invitation && !!note.trim() && !write.pending, onLeave: () => setNote('') });
  const openChild = (kind: 'editor' | 'invitation') => {
    const selected = childState.current; if (selected.locked || selected.editing || selected.invitation) return;
    const attempt = ++childAttempt.current;
    let assertCurrent: () => void; try { assertCurrent = capture(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Return to this original visit to continue.'); return; }
    const open = () => {
      try {
        assertCurrent(); const current = childState.current;
        if (childAttempt.current !== attempt || current.epoch !== selected.epoch || current.note !== selected.note || current.source !== selected.source || current.editing !== selected.editing || current.invitation !== selected.invitation || current.locked) return;
        childAttempt.current++; setNote(''); if (kind === 'editor') setEditing(true); else setInvitation(true);
      } catch { /* A stale note handoff cannot clear text or open another context. */ }
    };
    if (!selected.note.trim()) { open(); return; }
    Alert.alert('Continue without this note?', 'Your unsent note will be discarded. Saved questions and replies stay with this visit.', [
      { text: 'Keep writing', style: 'cancel', onPress: () => { if (childAttempt.current === attempt) childAttempt.current++; } },
      { text: 'Discard note and continue', style: 'destructive', onPress: open },
    ]);
  };
  const fresh = async () => { const assertCurrent = capture(); const result = readVisitSharing(await apiFetch(`${path}/sharing/`)); assertCurrent(); return { result, assertCurrent }; };
  const manage = async (action: 'revoke' | 'takeover') => {
    if (!data || write.locked || pending.current) return; pending.current = true; setPreparing(true); setError('');
    try { const { result, assertCurrent } = await fresh(); assertVisitSharingSource(data, result, visit); const input = visitShareAction(root, visit.id, result, action, Crypto.randomUUID()); assertCurrent(); await write.run(input); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The sharing action could not be prepared.'); } finally { pending.current = false; setPreparing(false); }
  };
  const sendQuestion = async () => {
    const selected = shared.data; if (!selected || write.locked || pending.current || selected.visit.id !== visit.id || selected.share.id !== current?.id) return;
    pending.current = true; setPreparing(true); setError('');
    try { const assertCurrent = capture(), latest = await apiFetch<SharedVisitDetail>(`${path}/shared/`); assertCurrent(); if (latest.visit.id !== visit.id || latest.share.id !== selected.share.id || latest.share.root_id !== selected.share.root_id || latest.question?.id !== selected.question?.id || latest.question?.revision !== selected.question?.revision) throw new Error('The private thread changed. Your note is kept; review the current thread.');
      const replying = latest.share.can_reply && latest.question, key = Crypto.randomUUID(); if (!replying && !latest.share.can_ask) throw new Error('Your current access cannot send a question or reply.');
      await write.run({ path: `${path}/shared/questions/${replying ? `${latest.question!.id}/replies/` : ''}`, commandId: key, visitId: visit.id, shared: true, sharing: { shareId: latest.share.id, shareRootId: latest.share.root_id, questionId: latest.question?.id ?? null }, label: replying ? 'Visit reply confirmed.' : 'Visit question confirmed.', body: JSON.stringify({ command_id: key, expected_revision: latest.question?.revision ?? 0, ...replying ? {} : { share_id: latest.share.id }, note: note.trim() }) });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The private thread could not be checked.'); } finally { pending.current = false; setPreparing(false); }
  };
  const locked = write.locked || preparing;
  if (metadata.isPending) return <Section title="Visit sharing"><Loading /></Section>;
  if (metadata.error || malformed || !data) return <Section title="Visit sharing"><Empty title="Sharing could not load" message={metadata.error?.message || malformed} onRetry={() => void metadata.refetch()} /></Section>;
  if (invitation && current) return <OperationsWorkInvitation href={href} schoolId={schoolId} person={current.organiser} context={{ kind: 'visit_arrangement', source_id: visit.id, access_id: current.id }} sourceRevision={current.revision} invitationId={current.invitation?.id} disabled={locked} onClose={() => setInvitation(false)} onNavigate={onNavigate} refreshSource={async () => { const { result } = await fresh(); const latest = result.current; if (!result.can_share || latest?.id !== current.id || latest.root_id !== current.root_id || latest.organiser.id !== current.organiser.id || !latest.owner.available || latest.state !== 'active') throw new Error('The original active sharing context changed. Review the current visit before inviting.'); await metadata.refetch({ throwOnError: true }); }} />;
  if (editing) return <VisitShareEditor href={href} root={root} visit={visit} timezone={campusTimezone} initial={data} write={write} onClose={() => setEditing(false)} />;
  const questionDetail = !shared.error && shared.data?.visit.id === visit.id && shared.data.share.id === current?.id && shared.data.share.root_id === current.root_id ? shared.data : null;
  return <Section title={current ? `${states[current.state]} with ${current.organiser.label}` : 'Share with the organiser'}>
    {current ? <Facts items={[{ label: 'Available until', value: new Date(current.ends_at).toLocaleString() }, { label: 'Questions go to', value: `${current.owner.label}${current.owner.available ? '' : ' · Unavailable'}` }]} /> : <Notice message="Share the visit’s time, place, directions and a private question thread. Sharing grants no entry or room access." />}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
    {data.can_share && (!current || current.can_renew) ? <ControlButton title={current ? 'Update sharing' : 'Share visit'} disabled={locked||!campusTimezone} onPress={() => openChild('editor')} /> : null}
    {current?.can_takeover ? <ControlButton title="Take over questions" disabled={locked} onPress={() => Alert.alert('Take over visit questions?', 'New and pending questions will come to you. Earlier conversation stays with this visit.' + (note.trim() ? ' Your unsent note will be discarded if this change is confirmed.' : ''), [{ text: 'Cancel', style: 'cancel' }, { text: 'Take over', onPress: () => void manage('takeover') }])} /> : null}
    {current?.state === 'active' && current.owner.available && (current.invitation || !current.organiser.has_app_access && data.can_open_shared) ? <ControlButton title={current.invitation ? 'Manage app invitation' : 'Invite organiser to the app'} disabled={locked} onPress={() => openChild('invitation')} /> : null}
    {current?.can_revoke ? <ControlButton title="Stop sharing" kind="danger" disabled={locked} onPress={() => Alert.alert('Stop sharing this visit?', 'The organiser will lose this shared visit. Their account and other work remain separate.' + (note.trim() ? ' Your unsent note will be discarded if this change is confirmed.' : ''), [{ text: 'Keep sharing', style: 'cancel' }, { text: 'Stop sharing', style: 'destructive', onPress: () => void manage('revoke') }])} /> : null}
    </View>
    {data.can_open_shared ? shared.isPending ? <Loading /> : shared.error || !questionDetail ? <Empty title="Private questions unavailable" message={shared.error?.message} onRetry={() => void shared.refetch()} /> : <><Disclosure title="Questions & replies" defaultOpen>{questionDetail.question?.entries.map(entry => <Row key={entry.id} title={entry.author_label} detail={`${entry.note}\n${new Date(entry.recorded_at).toLocaleString()}`} status={entry.kind === 'reply' ? 'Campus reply' : 'Question'} />)}{!questionDetail.question ? <Notice message="No questions have been asked." /> : questionDetail.question.entries_has_more ? <Notice message="Earlier entries are retained by the visit; this view shows the current page." /> : null}</Disclosure>{questionDetail.share.can_ask || questionDetail.share.can_reply ? <><Field label={questionDetail.share.can_reply ? 'Reply to organiser' : 'Question for campus'} value={note} onChangeText={setNote} multiline maxLength={2000} editable={!locked} /><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><ControlButton title={questionDetail.share.can_reply ? 'Send reply' : 'Ask campus'} kind="primary" disabled={locked || note.trim().length < 3} busy={preparing || write.busy} onPress={() => void sendQuestion()} /></View></> : null}</> : null}
    {error ? <Notice tone="warning" message={error} /> : null}
  </Section>;
}
function VisitShareEditor({ href, root, visit, timezone, initial, write, onClose }: { href: string; root: string; visit: ArrangedVisit; timezone: string; initial: VisitSharing; write: Write; onClose(): void }) {
  const [source, setSource] = useState(initial), [person, setPerson] = useState<VisitPerson | null>(initial.current?.organiser ?? visit.person), [until, setUntil] = useState(() => diningInput(initial.current?.ends_at ?? visit.ends_at, timezone)), [fold, setFold] = useState(() => diningFold(initial.current?.ends_at ?? visit.ends_at, timezone)), [directions, setDirections] = useState(initial.current?.directions ?? ''), [choosing, setChoosing] = useState(false), [error, setError] = useState(''), [preparing, setPreparing] = useState(false);
  const pending = useRef(false), clock = useOperationClock(`${root}/${visit.id}/sharing`), capture = useOperationContext(`${root}/${visit.id}/share-editor`);
  const dirty = person?.id !== (initial.current?.organiser.id ?? visit.person?.id) || directions !== (initial.current?.directions ?? '') || until !== diningInput(initial.current?.ends_at ?? visit.ends_at, timezone) || fold !== diningFold(initial.current?.ends_at ?? visit.ends_at, timezone);
  useScreenExitGuard({ blocked: write.busy || preparing, dirty: dirty && !write.pending, onLeave: onClose });
  const save = async (review = false) => {
    if (write.locked || pending.current || !person) return; pending.current = true; setPreparing(true); setError('');
    try { const assertCurrent = capture(), current = readVisitSharing(await apiFetch(`${root}/${visit.id}/sharing/`)); assertCurrent(); if (review) { if (!current.can_share || current.visit_revision !== visit.revision) throw new Error('The visit plan changed. Close this editor and review the current visit; your saved sharing is separate.'); setSource(current); return; } assertVisitSharingSource(source, current, visit); const options = await apiFetch<VisitOptions>(`${root}/options/?${new URLSearchParams({ person_id: person.id })}`); assertCurrent(); if (options.timezone !== timezone) throw new Error('The campus timezone changed. Review these hours.'); const now = await clock.read(); assertCurrent(); const command = visitShareCommand(root, visit, current, person, options, diningInstant(until, timezone, fold), directions, Crypto.randomUUID(), now); assertCurrent(); await write.run(command); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Sharing could not be prepared.'); } finally { pending.current = false; setPreparing(false); }
  };
  const locked = write.locked || preparing;
  const scrollToTop = usePageScroll();
  useEffect(() => { if (choosing) scrollToTop(); }, [choosing, scrollToTop]);
  // Keep the sharing draft mounted while its organiser picker owns the visible body.
  if (choosing) return <VisitChoicePicker root={root} href={href} allowAdd kind="people" disabled={locked} onClose={() => setChoosing(false)} onSelected={value => { setPerson(value as VisitPerson); setChoosing(false); }} />;
  return <Section title="Share visit"><ScreenBack title="Back to visit sharing" priority={10} onPress={onClose} /><Row title="Organiser" detail={person?.label ?? 'Choose a person'} onPress={locked ? undefined : () => setChoosing(true)} /><Field label="Directions · optional" value={directions} onChangeText={setDirections} multiline maxLength={1000} editable={!locked} /><DiningCampusTimeField label="Available until" value={until} onChange={setUntil} timezone={timezone} fold={fold} onFold={setFold} disabled={locked} /><Notice message={source.current && source.current.organiser.id === person?.id && source.current.state !== 'party_changed' ? `Questions stay with ${source.current.owner.label}.` : 'Questions come to you. Sharing with a different organiser starts a separate private thread.'} /><Notice message="Save sharing first. An organiser without app access can then receive a separate Live app invitation." />{error || clock.error ? <><Notice tone="warning" message={error || clock.error} /><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><ControlButton title="Review current sharing with these entries" disabled={locked} onPress={() => void save(true)} /></View></> : null}<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><ControlButton title="Save sharing" kind="primary" busy={preparing || write.busy} disabled={locked || !person || !until} onPress={() => void save()} /></View></Section>;
}
