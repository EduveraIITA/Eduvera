import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import type { AssignmentHandoverDetail, AssignmentHandoverList } from '../../../packages/contracts/src/wire/features/learning/assignmentApi';
import { useSession } from '../auth/SessionProvider';
import { getApiOrigin } from '../lib/api';
import { useApi } from '../lib/query';
import { useNativePendingAction } from '../lib/native-pending-action';
import { useOperationContext } from '../lib/use-operation-context';
import { assignmentHandoverObsolete, assignmentHandoverRefreshPath } from '../lib/assignment-handover-policy';
import { ScreenBack, useScreenExitGuard } from '../ui/BackNavigation';
import { Button, Empty, Field, ListGroup, Loading, Notice, Page, Row, Section } from '../ui/components';
import { Alert } from '../ui/Alert';
import { ChoiceMenu, ControlButton, Disclosure, Facts } from '../ui/DomainControls';
const root = '/api/v1/learning/assignments/review-handovers/';
const baseHref = '/areas/messages/assignments?scope=review_handover';
type Props = { href: string; onNavigate: (href: string) => void };
export function LearningAssignmentHandovers({ href, onNavigate }: Props) {
  const q = new URLSearchParams(href.split('?')[1] ?? ''), id = q.get('assignment'), page = Math.max(1, Number.parseInt(q.get('page') ?? '1', 10) || 1);
  const list = useApi<AssignmentHandoverList>(!id ? `${root}?page=${page}` : null), detail = useApi<AssignmentHandoverDetail>(id ? `${root}${encodeURIComponent(id)}/` : null);
  if (id) return detail.isPending ? <Page title="Review handover"><Loading /></Page> : detail.isError || !detail.data ? <Page title="Review handover"><ScreenBack fallbackHref={baseHref} title="Review handovers" /><Empty title="This handover could not load" message={detail.error?.message} onRetry={() => void detail.refetch()} /></Page>
    : <Handover key={id} {...{ href, onNavigate }} initial={detail.data} refresh={async () => { const next = await detail.refetch({ throwOnError: true }); if (!next.data || next.data.id !== id) throw new Error('The handover source changed.'); return next.data; }} />;
  return <Page title="Review handovers" subtitle="Repair assignment review responsibility" refreshing={list.isRefetching} onRefresh={() => void list.refetch()}><ScreenBack fallbackHref="/areas/messages/assignments" title="Assignments" /><Notice message="Choose a published assignment and its next reviewer. Submitted answers and private drafts are not shown here." />
    {list.isPending ? <Loading /> : list.isError || !list.data ? <Empty title="Review handovers could not load" message={list.error?.message} onRetry={() => void list.refetch()} /> : <>
      {list.data.items.length ? <Section title="Published assignments"><ListGroup>{list.data.items.map((item, index) => <Row key={item.id} variant="plain" separator={index > 0} title={item.title} detail={`${item.pending_reviews} awaiting review · ${item.requested_revisions} revisions requested`} status={item.reviewer.current ? item.reviewer.name : 'Reviewer unavailable'} statusTone={item.reviewer.current ? 'muted' : 'warning'} onPress={() => onNavigate(`${baseHref}&assignment=${encodeURIComponent(item.id)}`)} />)}</ListGroup></Section> : <Empty title="No published assignments yet" />}
      {page > 1 || list.data.has_more ? <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}><ControlButton title="Previous" disabled={page <= 1} onPress={() => onNavigate(`${baseHref}&page=${page - 1}`)} /><ControlButton title="Next" disabled={!list.data.has_more} onPress={() => onNavigate(`${baseHref}&page=${page + 1}`)} /></View> : null}
    </>}
  </Page>;
}
function Handover({ href, onNavigate, initial, refresh }: Props & { initial: AssignmentHandoverDetail; refresh: () => Promise<AssignmentHandoverDetail> }) {
  const { user, schoolId, environment } = useSession(), [source, setSource] = useState(initial), [reviewer, setReviewer] = useState(''), [reason, setReason] = useState(''), [error, setError] = useState('');
  const path = `${root}${encodeURIComponent(source.id)}/`, captureOperation = useOperationContext(href);
  const write = useNativePendingAction<AssignmentHandoverDetail>({ scope: { actorId: user!.id, schoolId: schoolId!, origin: getApiOrigin(), mode: environment.mode, namespaceId: environment.namespace_id ?? null },
    domain: 'learning', ownerHref: href, refreshPath: path, captureOperation, resolveRefreshPath: assignmentHandoverRefreshPath, obsolete: assignmentHandoverObsolete,
    accepted: (next, assertCurrent) => { assertCurrent(); if (next.id !== source.id) throw new Error('The saved handover did not match this assignment.'); setSource(next); setReviewer(''); setReason(''); } });
  useEffect(() => { if (write.action?.ownerHref === href && write.action.endpoint === path && write.action.payload.kind === 'json') { try { const body = JSON.parse(write.action.payload.body); setReviewer(typeof body.reviewer_id === 'string' ? body.reviewer_id : ''); setReason(typeof body.reason === 'string' ? body.reason : ''); } catch {} } }, [write.action, href, path]);
  useEffect(() => { if (!reviewer && !reason && !write.locked && initial.revision >= source.revision) setSource(initial); }, [initial, reviewer, reason, write.locked]);
  const conflict = initial.revision > source.revision || initial.revision === source.revision && initial.preview_hash !== source.preview_hash;
  const disabled = write.locked || conflict || environment.unavailable;
  const mounted = useRef(false), choice = JSON.stringify([source.revision, source.preview_hash, initial.revision, initial.preview_hash, reviewer, reason, !!disabled]);
  const currentChoice = useRef(choice); currentChoice.current = choice;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useScreenExitGuard({ dirty: !!(reviewer || reason) && !write.action, blocked: write.busy, title: 'Leave review handover?', message: 'Unconfirmed reviewer choices will be lost. Submitted assignment work remains saved.' });
  const reviewCurrent = async () => { try { const next = await refresh(); setSource(next); if (!next.reviewers.some(item => item.id === reviewer)) setReviewer(''); write.reviewed(); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Current responsibility could not be checked.'); } };
  const submit = () => {
    const selected = source.reviewers.find(item => item.id === reviewer); if (disabled || !selected || reason.trim().length < 3) return;
    let assertCurrent: () => void;
    try { assertCurrent = captureOperation(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Return to this handover before confirming.'); return; }
    const captured = choice; let consumed = false;
    Alert.alert('Change assignment reviewer?', `${source.title}\n${source.reviewer.name} → ${selected.name}\n${source.pending_reviews} submitted reviews will be reissued. Future submissions use the selected reviewer. The selected reviewer can open this assignment’s submitted history. Private drafts stay private, and earlier feedback and signatures remain saved.`, [{ text: 'Keep reviewing', style: 'cancel' }, { text: 'Confirm handover', onPress: () => {
      if (consumed || !mounted.current || currentChoice.current !== captured) return;
      consumed = true;
      try { assertCurrent(); void write.run({ endpoint: path, method: 'POST', serverKey: 'command_id', source: { kind: 'assignment', sourceId: source.id, revision: source.revision }, body: { expected_revision: source.revision, reviewer_id: reviewer, preview_hash: source.preview_hash, reason: reason.trim() } }); }
      catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'The handover context changed. Review it again.'); }
    } }]);
  };
  return <Page title={source.title} subtitle="Review handover"><ScreenBack fallbackHref={baseHref} title="Review handovers" disabled={write.busy} />
    <Facts items={[{ label: 'Current reviewer', value: `${source.reviewer.name}${source.reviewer.current ? '' : ' · unavailable'}` }, { label: 'Awaiting review', value: String(source.pending_reviews) }]} />
    <Notice message={source.privacy} />{write.error || error ? <Notice tone="danger" message={write.error || error} /> : null}
    {write.resumeHref ? <Button title="Return to retained learning action" kind="secondary" onPress={() => onNavigate(write.resumeHref!)} /> : write.action ? <Button title={write.action.phase === 'accepted' ? 'Refresh saved handover' : 'Retry identical handover'} busy={write.busy} onPress={() => void write.recover()} /> : null}
    {conflict || write.obsolete ? <><Notice tone="warning" message="Assignment work changed. Your reason is retained; review the current handover before confirming." /><Button title="Review current responsibility" kind="secondary" disabled={write.busy} onPress={() => void reviewCurrent()} /></> : null}
    <Section title="Next reviewer">{source.reviewers.length ? <ChoiceMenu label="Eligible reviewer" value={reviewer} options={[{ value: '', label: 'Choose a reviewer' }, ...source.reviewers.map(item => ({ value: item.id, label: item.name }))]} disabled={!!disabled} onChange={setReviewer} /> : <Empty title="No eligible replacement reviewer" message="Appoint a currently authorized instructor in this learning group or class, then refresh this handover." />}
      <Field label="Reason for handover" value={reason} onChangeText={setReason} multiline maxLength={500} editable={!disabled} />
      <Button title="Review and confirm handover" disabled={!!disabled || !reviewer || reason.trim().length < 3} busy={write.busy} onPress={submit} />
    </Section>
    {source.history.length ? <Disclosure title="Responsibility history">{source.history.map(item => <Row key={item.id} variant="plain" title={`Handover · ${new Date(item.created_at).toLocaleString()}`} detail={item.reason} />)}</Disclosure> : null}
  </Page>;
}
