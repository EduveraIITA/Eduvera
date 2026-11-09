import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  LearnerResultReviews, ResultReview, ResultReviewReceipt, StaffResultReviewDetail, StaffResultReviewQueue,
} from '../../../../packages/contracts/src/assessment-result-reviews';
import { useSession } from '../../auth/SessionProvider';
import { getApiOrigin } from '../../lib/api';
import { reportHref } from '../../lib/academic-report-policy';
import { assertResultReviewReceipt, resultReviewRefreshPath, resultReviewRoot, reviewUuid } from '../../lib/assessment-result-review';
import { useNativePendingAction } from '../../lib/native-pending-action';
import { useApi } from '../../lib/query';
import { useOperationContext } from '../../lib/use-operation-context';
import { ScreenBack, useScreenExitGuard } from '../../ui/BackNavigation';
import { ChoiceMenu, ControlButton, Facts } from '../../ui/DomainControls';
import { Button, Empty, Field, Loading, Notice, Page, Row, Section } from '../../ui/components';

type Navigate = (href: string) => void;
type Writer = ReturnType<typeof useNativePendingAction<ResultReviewReceipt>>;
const stateLabels: Record<ResultReview['state'], string> = {
  submitted: 'Awaiting review', resolved: 'Review complete', correction_requested: 'Correction referred', corrected: 'Revised result published',
};
const availability = {
  previous_review_open: 'Your earlier request is still open. Follow its status below.',
  stale_publication: 'Open your latest published result to request a review.',
  reviewer_unavailable: 'The campus has no eligible reviewer for this result right now.',
};

function useReviewWriter(href: string, schoolId: string, readPath: string, afterSave: (receipt: ResultReviewReceipt) => Promise<void>) {
  const { user, environment, scopeKey } = useSession(), cache = useQueryClient();
  const captureOperation = useOperationContext(readPath);
  return useNativePendingAction<ResultReviewReceipt>({
    scope: { actorId: user!.id, schoolId, mode: environment.mode, namespaceId: environment.namespace_id ?? null, origin: getApiOrigin() },
    domain: 'assessments', ownerHref: href, refreshPath: readPath, captureOperation,
    resolveRefreshPath: resultReviewRefreshPath,
    accepted: async (value, assertCurrent, action) => {
      const receipt = assertResultReviewReceipt(value, action);
      await cache.invalidateQueries({ queryKey: ['campus', scopeKey], refetchType: 'none' });
      assertCurrent();
      await afterSave(receipt);
      assertCurrent();
    },
  });
}

function ReviewRecovery({ writer, refresh, onNavigate }: { writer: Writer; refresh: () => Promise<unknown>; onNavigate: Navigate }) {
  return <>
    {writer.error ? <Notice tone="warning" message={writer.error} /> : null}
    {writer.resumeHref ? <ControlButton title="Return to the pending assessment action" onPress={() => onNavigate(writer.resumeHref!)} />
      : writer.action ? <ControlButton title={writer.action.phase === 'accepted' ? 'Check saved review' : 'Recover original request'} busy={writer.busy} onPress={() => void writer.recover()} />
        : writer.obsolete ? <ControlButton title="Read current review" onPress={() => { void refresh().then(() => writer.reviewed()).catch(() => {}); }} /> : null}
  </>;
}

function ReviewDetails({ item }: { item: ResultReview }) {
  return <>
    <Facts items={[
      { label: 'Status', value: stateLabels[item.state] },
      { label: 'Reviewer', value: item.reviewer.name || 'Campus reviewer' },
      { label: 'Original result', value: `Release ${item.publication_sequence}` },
      ...(item.correction ? [{ label: 'Revised result', value: `Release ${item.correction.sequence}` }] : []),
    ]} />
    <Row title="Request" detail={item.request_note} variant="plain" />
    {item.response_note ? <Row title="Reviewer’s response" detail={item.response_note} variant="plain" /> : null}
  </>;
}

export function LearnerResultReview({ href, schoolId, assessmentId, publicationId, personId, studentId, onNavigate }: {
  href: string; schoolId: string; assessmentId: string; publicationId: string; personId?: string; studentId?: string; onNavigate: Navigate;
}) {
  const endpoint = `${resultReviewRoot(schoolId)}/mine/${assessmentId}/${publicationId}/`;
  const selector: Record<string, string> = personId ? { person_id: personId } : { student_id: studentId! };
  const path = `${endpoint}?${new URLSearchParams(selector)}`;
  const query = useApi<LearnerResultReviews>(path, { staleTime: 0 });
  const [note, setNote] = useState(''), [open, setOpen] = useState(false);
  const writer = useReviewWriter(href, schoolId, path, async () => {
    await query.refetch({ throwOnError: true }); setOpen(false); setNote('');
  });
  useScreenExitGuard({ dirty: !!note.trim() && !writer.action, blocked: writer.busy, title: 'Leave this review?',
    message: 'Your unsent note will be discarded. Submitted requests are retained.' });
  const data = query.data;
  const matches = !query.isError && data?.school_id === schoolId && data.assessment_id === assessmentId
    && data.publication_id === publicationId && (personId ? data.person_id === personId && data.student_id === null : data.student_id === studentId)
    && Array.isArray(data.reviews) && data.reviews.every(item => item.assessment_id === assessmentId && item.school_id === schoolId);
  const ready = matches && !query.isRefetching && !!data.reviewer && reviewUuid(data.reviewer.user_id) && !writer.locked;
  return <Section title="Result review">
    <ReviewRecovery writer={writer} refresh={() => query.refetch({ throwOnError: true })} onNavigate={onNavigate} />
    {query.isPending ? <Notice message="Checking review status…" /> : !matches ? <Empty title="Result review unavailable" onRetry={() => void query.refetch()} /> : <>
      {data.reviews.length === 1 ? <ReviewDetails item={data.reviews[0]!} />
        : data.reviews.map(item => <Section key={item.id} title={`Review of release ${item.publication_sequence}`}><ReviewDetails item={item} /></Section>)}
      {data.unavailable_reason && data.unavailable_reason !== 'already_requested'
        ? <Notice message={availability[data.unavailable_reason]} /> : null}
      {data.reviewer && !open ? <ControlButton title="Request a result review" disabled={!ready} onPress={() => setOpen(true)} /> : null}
      {data.reviewer && open ? <>
        <Notice message={`Your note goes to ${data.reviewer.name}, the named reviewer for this result.`} />
        <Field label="What would you like reviewed?" value={note} onChangeText={setNote} maxLength={1000} multiline editable={ready} />
        <Button title="Send review request" disabled={!ready || note.trim().length < 3} busy={writer.busy} onPress={() => {
          if (!data.reviewer || !ready) return;
          void writer.run({ endpoint, serverKey: 'idempotency_key', body: { ...selector, reviewer_user_id: data.reviewer.user_id, note: note.trim() },
            source: { kind: 'result_review_submit', sourceId: publicationId, revision: 0, fingerprint: assessmentId } });
        }} />
        <ControlButton title="Cancel" disabled={writer.busy || !!writer.action} onPress={() => { setOpen(false); setNote(''); }} />
      </> : null}
    </>}
  </Section>;
}

export function StaffResultReviews({ href, schoolId, reviewId, onNavigate, administrator }: {
  href: string; schoolId: string; reviewId: string | null; onNavigate: Navigate; administrator: boolean;
}) {
  const [page, setPage] = useState(1), root = resultReviewRoot(schoolId);
  const queue = useApi<StaffResultReviewQueue>(reviewId ? null : `${root}/workspace/?page=${page}`);
  const home = reportHref(href, { result_review_id: '', result_reviews: '1' });
  if (reviewId) return <StaffReviewDecision key={reviewId} {...{ href, schoolId, reviewId, onNavigate, administrator, home }} />;
  const valid = !queue.isError && queue.data?.school_id === schoolId && queue.data.page === page && Array.isArray(queue.data.items);
  return <Page title="Result reviews" subtitle={administrator ? 'Open requests and corrections for this campus' : 'Requests assigned to you'}
    refreshing={queue.isRefetching} onRefresh={() => void queue.refetch()}>
    <ScreenBack title="Back to assessments" fallbackHref={reportHref(home, { result_reviews: '' })} />
    {queue.isPending ? <Loading /> : !valid ? <Empty title="Reviews unavailable" onRetry={() => void queue.refetch()} />
      : queue.data.items.length ? <Section title="Open reviews">{queue.data.items.map(item => <Row key={item.id} title={item.assessment_title}
        detail={`${item.learner_name} · Release ${item.publication_sequence}\n${stateLabels[item.state]}${administrator ? ` · ${item.reviewer_name}` : ''}`}
        onPress={() => onNavigate(reportHref(home, { result_review_id: item.id }))} />)}</Section>
        : <Empty title="No open result reviews" />}
    {page > 1 ? <ControlButton title="Previous page" onPress={() => setPage(page - 1)} /> : null}
    {valid && queue.data?.has_more ? <ControlButton title="Next page" onPress={() => setPage(page + 1)} /> : null}
  </Page>;
}

function StaffReviewDecision({ href, schoolId, reviewId, onNavigate, administrator, home }: {
  href: string; schoolId: string; reviewId: string; onNavigate: Navigate; administrator: boolean; home: string;
}) {
  const path = `${resultReviewRoot(schoolId)}/${reviewId}/`, query = useApi<StaffResultReviewDetail>(path, { staleTime: 0 });
  const [decision, setDecision] = useState(''), [note, setNote] = useState(''), [replacement, setReplacement] = useState('');
  const writer = useReviewWriter(href, schoolId, path, async () => {
    await query.refetch({ throwOnError: true }); setDecision(''); setNote(''); setReplacement('');
  });
  useScreenExitGuard({ dirty: Boolean(note.trim() || replacement) && !writer.action, blocked: writer.busy, title: 'Leave this review?',
    message: 'Your unsent decision will be discarded. Submitted actions are retained.' });
  const data = query.data;
  const valid = !query.isError && data?.review.id === reviewId && data.review.school_id === schoolId;
  const item = valid ? data.review : null, ready = !writer.locked && !query.isRefetching;
  const perform = (body: { action: 'resolve' | 'refer_correction'; note: string } | { action: 'reassign'; reviewer_user_id: string }) => {
    if (!item || !ready) return;
    void writer.run({ endpoint: path, serverKey: 'idempotency_key', body: { ...body, expected_revision: item.revision },
      source: { kind: 'result_review_decide', sourceId: item.id, revision: item.revision } });
  };
  return <Page title={item?.assessment_title ?? 'Result review'} subtitle={item?.learner_name} refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
    <ScreenBack title="Back to result reviews" fallbackHref={home} disabled={writer.busy} />
    <ReviewRecovery writer={writer} refresh={() => query.refetch({ throwOnError: true })} onNavigate={onNavigate} />
    {query.isPending ? <Loading /> : !item ? <Empty title="Result review unavailable" onRetry={() => void query.refetch()} /> : <>
      <Section title="Review details"><ReviewDetails item={item} /></Section>
      {data?.can_decide ? <Section title="Respond">
        <ChoiceMenu label="Decision" value={decision} options={[{ value: 'resolve', label: 'Complete without a correction' }, { value: 'refer_correction', label: 'Refer for a correction' }]} onChange={setDecision} disabled={!ready} />
        {decision ? <>
          {decision === 'refer_correction' ? <Notice message="This sends the case for correction. The published result changes only after the usual marking, moderation and publication steps." /> : null}
          <Field label="Response to the learner" value={note} onChangeText={setNote} maxLength={1000} multiline editable={ready} />
          <Button title={decision === 'refer_correction' ? 'Refer for correction' : 'Complete review'} disabled={!ready || note.trim().length < 3} busy={writer.busy} onPress={() => {
            if (decision === 'resolve' || decision === 'refer_correction') perform({ action: decision, note: note.trim() });
          }} />
        </> : null}
      </Section> : null}
      {data?.replacement_reviewers.length ? <Section title="Replace unavailable reviewer">
        <ChoiceMenu label="Coordinator" value={replacement} options={data.replacement_reviewers.map(person => ({ value: person.user_id, label: person.name }))} onChange={setReplacement} disabled={!ready} />
        <Button title="Assign this reviewer" disabled={!ready || !data.replacement_reviewers.some(person => person.user_id === replacement)} onPress={() => perform({ action: 'reassign', reviewer_user_id: replacement })} />
      </Section> : null}
      {administrator && item.state === 'correction_requested' && reviewUuid(data?.source_result_id) ? <ControlButton title="Open this learner’s result" disabled={!ready} onPress={() => onNavigate(
        `/areas/assessments/manage?${new URLSearchParams({ assessment: item.assessment_id, correction_result_id: data!.source_result_id })}`,
      )} /> : null}
    </>}
  </Page>;
}
