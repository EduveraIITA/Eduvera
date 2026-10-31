import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { NoticeChannel, NoticeDetail, NoticeRecipient } from '../../../packages/contracts/src/wire/features/notices/api';
import { useScreenExitGuard } from '../ui/BackNavigation';
import { Alert } from '../ui/Alert';
import { Button, Empty, Field, ListGroup, Notice, Row, SearchField, Section } from '../ui/components';
import { ChoiceMenu, ControlButton, Disclosure, SegmentedControl } from '../ui/DomainControls';
import { useTheme } from '../ui/theme';
import { EventDateField } from './EventFields';
import { DomainPages, DomainText } from './ResourcesScreen';
import { updateObservedAt, updateRecipientNeedsFollowUp, updateRecipientScore, type UpdateCommand, type UpdateCommandResult } from './UpdatesPolicy';

export interface UpdatesCommandController { busy: boolean; blocked: boolean; pending: UpdateCommand | null; run(command: UpdateCommand): Promise<UpdateCommandResult | undefined> }
const label = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
const time = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Not recorded';
const channels: Array<{ value: Exclude<NoticeChannel, 'app'>; label: string }> = [{ value: 'phone', label: 'Phone' }, { value: 'paper', label: 'Paper' }, { value: 'sms', label: 'SMS' }, { value: 'in_person', label: 'In person' }];

export function UpdatesFollowUp({ notice, command, now, canAssist, focusAttention }: { notice: NoticeDetail; command: UpdatesCommandController; now: number; canAssist: boolean; focusAttention: boolean }) {
  const [filter, setFilter] = useState(focusAttention ? 'attention' : 'all'), [search, setSearch] = useState(''), [page, setPage] = useState(1), [selectedId, setSelectedId] = useState<string | null>(null), [dirty, setDirty] = useState(false);
  const recipients = [...(notice.recipients ?? [])].sort((left, right) => updateRecipientScore(notice, left, now) - updateRecipientScore(notice, right, now) || left.recipient_name.localeCompare(right.recipient_name));
  const attention = recipients.filter(person => updateRecipientNeedsFollowUp(notice, person));
  const shown = (filter === 'attention' ? attention : recipients).filter(person => `${person.recipient_name} ${person.student_name ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const currentPage = Math.min(page, Math.max(1, Math.ceil(shown.length / 10))), selected = recipients.find(person => person.id === selectedId);
  const choose = (id: string) => { if (id === selectedId || command.blocked) return; const select = () => { setSelectedId(id); setDirty(false); }; if (dirty) Alert.alert('Change recipient?', 'Unsaved contact details for the current recipient will be cleared.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Change recipient', onPress: select }]); else select(); };
  return <>
    {recipients.length ? <Section title="Recipient follow-up">
      <SegmentedControl label="Recipient view" value={filter} options={[{ value: 'attention', label: `Needs follow-up (${attention.length})` }, { value: 'all', label: `All (${recipients.length})` }]} onChange={value => { setFilter(value); setPage(1); }} />
      <SearchField label="Find a recipient" placeholder="Recipient or learner name" value={search} onChangeText={value => { setSearch(value); setPage(1); }} />
      <ListGroup>{shown.slice((currentPage - 1) * 10, currentPage * 10).map(person => <Row key={person.id} title={person.recipient_name} detail={[person.student_name, person.responded_at ? person.response_value || 'Acknowledged' : person.deliveries[0]?.status === 'failed' ? 'Delivery failed · follow up' : notice.response_mode !== 'information' ? notice.due_at && Date.parse(notice.due_at) < now ? 'Response overdue' : 'Awaiting response' : person.opened_at ? 'Opened' : 'Not opened'].filter(Boolean).join(' · ')} status={selectedId === person.id ? 'Selected' : undefined} onPress={() => choose(person.id)} />)}</ListGroup>
      {!shown.length ? <Empty title="No recipients in this view" /> : null}
      {shown.length > 10 ? <DomainPages page={currentPage} hasMore={currentPage * 10 < shown.length} onChange={setPage} /> : null}
      {selected ? <UpdatesRecipient key={selected.id} notice={notice} recipient={selected} command={command} now={now} canAssist={canAssist} onDirty={setDirty} /> : null}
    </Section> : null}
    {notice.audits?.length ? <Disclosure title="Update audit history"><ListGroup>{notice.audits.map(item => <Row key={item.id} title={label(item.action)} detail={`${item.actor_name} · ${time(item.created_at)}${item.recipient_id ? `\n${recipients.find(person => person.id === item.recipient_id)?.recipient_name ?? 'Recipient record'}` : ''}`} status={label(item.to_status)} />)}</ListGroup></Disclosure> : null}
  </>;
}
function UpdatesRecipient({ notice, recipient, command, now, canAssist, onDirty }: { notice: NoticeDetail; recipient: NoticeRecipient; command: UpdatesCommandController; now: number; canAssist: boolean; onDirty(value: boolean): void }) {
  const { colors } = useTheme(), [source, setSource] = useState(recipient), [channel, setChannel] = useState<Exclude<NoticeChannel, 'app'>>('phone'), [choice, setChoice] = useState(''), [note, setNote] = useState(''), [observedAt, setObservedAt] = useState(() => Number.isFinite(now) ? new Date(now).toISOString() : ''), [timeEdited, setTimeEdited] = useState(false), [error, setError] = useState('');
  const dirty = !!choice || !!note || channel !== 'phone' || timeEdited, changed = source.revision !== recipient.revision;
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  useScreenExitGuard({ dirty: dirty && !command.pending, blocked: command.busy, title: 'Leave recipient follow-up?', message: 'Unsaved response and delivery details will be lost.' });
  const responseOpen = notice.status === 'published' && notice.response_mode !== 'information' && !recipient.responded_at && Number.isFinite(now) && (!notice.due_at || Date.parse(notice.due_at) >= now);
  async function record(kind: 'delivery' | 'assisted') {
    setError('');
    try {
      if (command.blocked || changed) return;
      const observed = updateObservedAt(observedAt, notice, now);
      if (kind === 'assisted' && (!canAssist || !responseOpen || notice.response_mode === 'choice' && !notice.response_options.includes(choice))) throw new Error('Choose one current response while this recipient’s response period is open.');
      const body = kind === 'delivery' ? { recipient_id: source.id, channel, status: 'delivered', note: note.trim(), attempted_at: observed, idempotency_key: Crypto.randomUUID() }
        : { recipient_id: source.id, expected_revision: source.revision, ...(notice.response_mode === 'choice' ? { response_value: choice } : {}), response_note: note.trim(), channel, observed_at: observed, idempotency_key: Crypto.randomUUID() };
      Alert.alert(kind === 'delivery' ? 'Record this completed delivery?' : 'Record this recipient’s response?', `${recipient.recipient_name}${recipient.student_name ? ` · ${recipient.student_name}` : ''}\n${label(channel)} · ${time(observed)}${kind === 'assisted' ? `\n${notice.response_mode === 'choice' ? choice : 'Acknowledged'}` : ''}`, [{ text: 'Keep reviewing', style: 'cancel' }, { text: 'Record evidence', onPress: () => { void command.run({ path: `/api/v1/notices/${encodeURIComponent(notice.id)}/${kind === 'delivery' ? 'deliveries' : 'assisted-responses'}`, method: 'POST', kind, body }).then(saved => { if (saved) { setNote(''); setChoice(''); setTimeEdited(false); } }); } }]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The recipient record could not be prepared.'); }
  }
  return <Section title={recipient.recipient_name}>
    <DomainText>{recipient.student_name ?? label(recipient.recipient_role)}</DomainText>
    <Text selectable style={{ color: colors.ink }}>{[recipient.contact_phone, recipient.contact_email].filter(Boolean).join(' · ') || 'No contact details on file.'}</Text>
    {recipient.responded_at ? <Row title={recipient.response_value || 'Acknowledged'} detail={`${label(recipient.response_channel ?? 'app')} · Observed ${time(recipient.response_observed_at)}\nRecorded ${time(recipient.responded_at)}${recipient.response_note ? `\n${recipient.response_note}` : ''}`} /> : null}
    {changed ? <><Notice tone="warning" message="This recipient’s response changed. Your entries are retained; review the current response before another action." /><ControlButton title="Use current recipient revision" disabled={command.blocked} onPress={() => setSource(recipient)} /></> : null}
    {notice.status !== 'draft' ? <>
      <ChoiceMenu label="Contact channel" value={channel} options={channels} disabled={command.blocked} onChange={value => setChannel(value as Exclude<NoticeChannel, 'app'>)} />
      <EventDateField label="Actual contact time" value={observedAt || null} now={Number.isFinite(now) ? now : 0} disabled={command.blocked || !Number.isFinite(now)} onChange={value => { setObservedAt(value); setTimeEdited(true); }} />
      {responseOpen && canAssist && notice.response_mode === 'choice' ? <ChoiceMenu label="Recipient’s response" value={choice} options={notice.response_options.map(value => ({ value, label: value }))} disabled={command.blocked} onChange={setChoice} /> : null}
      <Field label="Contact or response note (optional)" value={note} maxLength={500} multiline editable={!command.blocked} onChangeText={setNote} />
      {error ? <Notice tone="danger" message={error} /> : null}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}><Button title="Record completed delivery" kind="secondary" disabled={command.blocked || changed || !Number.isFinite(now)} onPress={() => { void record('delivery'); }} />{responseOpen && canAssist ? <Button title={notice.response_mode === 'choice' ? 'Record assisted response' : 'Record assisted acknowledgement'} disabled={command.blocked || changed || notice.response_mode === 'choice' && !choice} onPress={() => { void record('assisted'); }} /> : null}</View>
    </> : null}
    <Disclosure title={`Delivery history (${recipient.deliveries.length})`}><ListGroup>{recipient.deliveries.map(item => <Row key={item.id} title={`${label(item.channel)} · ${label(item.status)}`} detail={`${time(item.attempted_at)}${item.note ? `\n${item.note}` : ''}${item.provider_reference ? `\nReference: ${item.provider_reference}` : ''}`} />)}</ListGroup>{!recipient.deliveries.length ? <Empty title="No delivery attempts recorded" /> : null}</Disclosure>
  </Section>;
}
export function UpdatesCancellation({ notice, command }: { notice: NoticeDetail; command: UpdatesCommandController }) {
  const [reason, setReason] = useState('');
  useScreenExitGuard({ dirty: !!reason.trim() && !command.pending && notice.status === 'published', blocked: command.busy, title: 'Leave update cancellation?', message: 'The unsaved cancellation reason will be lost.' });
  if (notice.status !== 'published') return null;
  return <Disclosure title="Cancel published update"><Notice message="Cancellation retains recipient responses and delivery evidence, and cancels queued delivery attempts." /><Field label="Cancellation reason" value={reason} onChangeText={setReason} multiline maxLength={500} editable={!command.blocked} /><Button title="Review cancellation" kind="danger" disabled={command.blocked || reason.trim().length < 3} onPress={() => Alert.alert('Cancel this published update?', `${notice.title}\n${reason.trim()}`, [{ text: 'Keep published', style: 'cancel' }, { text: 'Cancel update', style: 'destructive', onPress: () => { void command.run({ path: `/api/v1/notices/${encodeURIComponent(notice.id)}/cancel`, method: 'POST', kind: 'cancel', body: { expected_revision: notice.revision, reason: reason.trim(), idempotency_key: Crypto.randomUUID() } }).then(saved => { if (saved) setReason(''); }); } }])} /></Disclosure>;
}
