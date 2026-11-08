import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { LearningOfferingAcademicReferences, LearningOfferingDetail } from '../../../packages/contracts/src/wire/features/learning/offeringApi';
import { useSession } from '../auth/SessionProvider';
import { courseContextDraft, courseContextInput, type CourseContextDraft } from '../lib/learning-academic-context';
import { learningOfferingRefreshPath } from '../lib/learning-offering-policy';
import { useLearningCommand } from '../lib/learning-write';
import { useOperationContext } from '../lib/use-operation-context';
import { ScreenBack, useScreenExitGuard } from '../ui/BackNavigation';
import { Button, Empty, Field, Loading, Notice, Page } from '../ui/components';
import { ChoiceMenu, ControlButton, Facts } from '../ui/DomainControls';

export function CourseContextFields({ draft, references, disabled, onChange }: { draft: CourseContextDraft; references?: LearningOfferingAcademicReferences; disabled: boolean; onChange: (next: CourseContextDraft) => void }) {
  const set = (key: keyof CourseContextDraft, value: string) => onChange({ ...draft, [key]: value });
  return <>
    <ChoiceMenu label="Term" value={draft.term} options={references?.terms.map(term => ({ value: term.id, label: `${term.name} · ${term.academic_year}` })) ?? []} disabled={disabled} onChange={value => set('term', value)} />
    <ChoiceMenu label="Subject" value={draft.subject} options={references?.subjects.map(subject => ({ value: subject.id, label: subject.name })) ?? []} disabled={disabled} onChange={value => onChange({ ...draft, subject: value, code: draft.code || references?.subjects.find(subject => subject.id === value)?.code || '' })} />
    <Field label="Course code" value={draft.code} onChangeText={value => set('code', value)} maxLength={80} editable={!disabled} autoCapitalize="characters" placeholder="e.g. CS501" />
    <Field label="Credits" value={draft.credits} onChangeText={value => set('credits', value)} keyboardType="decimal-pad" editable={!disabled} placeholder="e.g. 4" />
    <Field label="Programme · optional" value={draft.programme} onChangeText={value => set('programme', value)} maxLength={80} editable={!disabled} autoCapitalize="characters" placeholder="e.g. MTECH-CS" />
    {!references?.terms.length || !references?.subjects.length ? <Notice message="Set up a term and subject in Academic structure before connecting this group to a course." /> : null}
  </>;
}

export function CourseContextFacts({ draft, references }: { draft: CourseContextDraft; references?: LearningOfferingAcademicReferences }) {
  return <Facts items={[{ label: 'Term', value: references?.terms.find(term => term.id === draft.term)?.name ?? draft.term }, { label: 'Subject', value: references?.subjects.find(subject => subject.id === draft.subject)?.name ?? draft.subject }, { label: 'Course code', value: draft.code.trim().toUpperCase() }, { label: 'Credits', value: draft.credits }, ...(draft.programme.trim() ? [{ label: 'Programme', value: draft.programme.trim().toUpperCase() }] : [])]} />;
}

/** One course editor, reached from the existing learning group and catalogue. */
export function LearningCourseContext({ href, onNavigate, data, references, loading, error, onRetry }: { href: string; onNavigate: (href: string) => void; data?: LearningOfferingDetail; references?: LearningOfferingAcademicReferences; loading: boolean; error?: string; onRetry: () => Promise<LearningOfferingDetail> }) {
  const { scopeKey } = useSession(), client = useQueryClient();
  const [draft, setDraft] = useState(() => courseContextDraft(data?.academic_context)), [baseRevision, setBaseRevision] = useState(data?.revision ?? 0), [review, setReview] = useState(false), [message, setMessage] = useState(''), [saved, setSaved] = useState(false), [initialized, setInitialized] = useState(!!data);
  const id = data?.id ?? new URLSearchParams(href.split('?')[1]).get('offering_id') ?? '', read = `/api/v1/learning/offerings/${encodeURIComponent(id)}/`;
  const [checking, setChecking] = useState(false), captureRefresh = useOperationContext(JSON.stringify([href,id,'course_setup_refresh']));
  const write = useLearningCommand<LearningOfferingDetail>({ ownerHref: href, refreshPath: read, resolveRefreshPath: learningOfferingRefreshPath, onAccepted: async (current, assertCurrent) => {
    if (!current || current.id !== id || !Number.isSafeInteger(current.revision) || !current.academic_context) throw new Error('The saved course could not be confirmed.');
    await client.invalidateQueries({ queryKey: ['campus', scopeKey], refetchType: 'none' }); assertCurrent(); client.setQueryData(['campus', scopeKey, read], current);
    setDraft(courseContextDraft(current.academic_context)); setBaseRevision(current.revision); setSaved(true); setReview(false);
  } });
  useEffect(() => { if (!initialized && data) { setDraft(courseContextDraft(data.academic_context)); setBaseRevision(data.revision); setInitialized(true); } }, [initialized, data]);
  useEffect(() => { if (!write.ready || !write.action || write.action.ownerHref !== href || write.action.payload.kind !== 'json') return; try { const body = JSON.parse(write.action.payload.body); if (body.academic_context) { setDraft(courseContextDraft(body.academic_context)); setBaseRevision(body.expected_revision); setReview(true); setInitialized(true); } } catch { /* Journal owns malformed action refusal. */ } }, [write.ready, write.action, href]);
  const refreshCurrent = async () => { if (checking || write.busy || write.action) return; setChecking(true); setMessage(''); try { const assertCurrent=captureRefresh(), current=await onRetry(); assertCurrent(); if(!current || current.id!==id || !Number.isSafeInteger(current.revision) || current.revision<1 || !current.can_manage) throw new Error('Current course setup access could not be confirmed.'); setDraft(courseContextDraft(current.academic_context)); setBaseRevision(current.revision); setReview(false); write.reviewed(); } catch(cause) { setMessage(cause instanceof Error?cause.message:'The current course could not be checked.'); } finally { setChecking(false); } };
  const changed = !!data && baseRevision !== data.revision, disabled = write.locked || !data?.can_manage || changed || loading || !!error || checking;
  const edit = (next: CourseContextDraft) => { setDraft(next); setReview(false); setSaved(false); setMessage(''); };
  const dirty = initialized && JSON.stringify(draft) !== JSON.stringify(courseContextDraft(data?.academic_context));
  useScreenExitGuard({ dirty: dirty && !write.action, blocked: write.busy || checking, title: 'Leave course setup?', message: 'Unsaved course details will be lost.' });
  const back = href.replace(/([?&])course_setup=1(&|$)/, '$1').replace(/[?&]$/, '');
  return <Page title={review ? 'Review course details' : 'Course details'} subtitle={data?.name}>
    <ScreenBack title="Back to learning group" fallbackHref={back} disabled={write.busy || checking} />
    {loading ? <Loading /> : !data ? <Empty title="Course access could not be confirmed" message={error} onRetry={()=>void refreshCurrent()} /> : !data.can_manage ? <Notice tone="warning" message="Your current account cannot configure this course." /> : null}
    {data && error ? <><Notice tone="warning" message="Current course setup access could not refresh. Your choices are kept; refresh before saving." /><Button title="Refresh course setup" disabled={write.busy || checking || !!write.action} onPress={()=>void refreshCurrent()} /></> : null}
    {message || write.error ? <Notice tone="danger" message={message || write.error!} /> : null}
    {saved ? <Notice tone="success" message="Course details saved." /> : null}
    {changed || write.obsolete ? <><Notice tone="warning" message="The group changed. Review its current details before saving another command." /><Button title="Review current details" disabled={write.busy || checking || !!write.action} onPress={()=>void refreshCurrent()} /></> : null}
    {write.resumeHref ? <Button title="Return to retained learning action" onPress={() => onNavigate(write.resumeHref!)} /> : write.action ? <><Notice message="Your reviewed course details are retained until the exact result is confirmed." /><Button title={write.action.phase === 'accepted' ? 'Refresh saved course' : 'Retry identical course setup'} busy={write.busy} onPress={() => void write.recover()} /></> : data?.can_manage ? <>
      {review ? <><CourseContextFacts {...{ draft, references }} /><Notice message="Scheduling, attendance and assessments will use this course’s dated enrollment. Existing published records keep their original academic context." /><Button title="Save course details" disabled={disabled} onPress={() => { try { const academic_context = courseContextInput(draft, references); void write.run({ endpoint: `${read}academic-context/`, body: { expected_revision: baseRevision, academic_context }, source: { kind: 'offering', sourceId: id, revision: baseRevision } }); } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Review the course details.'); } }} /><ControlButton title="Keep editing" disabled={disabled} onPress={() => setReview(false)} /></> : <><CourseContextFields {...{ draft, references, disabled }} onChange={edit} /><Button title="Review course details" disabled={disabled} onPress={() => { try { courseContextInput(draft, references); setMessage(''); setReview(true); } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Review the course details.'); } }} /></>}
    </> : null}
  </Page>;
}
