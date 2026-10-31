import React, { useEffect, useState } from 'react';
import * as Crypto from 'expo-crypto';
import type { ClassPracticeList, ClassPracticeDetail } from '../../../packages/contracts/src/wire/features/notices/classPracticeApi';
import { useApi } from '../lib/query';
import { useLearningCommand } from '../lib/learning-write';
import { useSession } from '../auth/SessionProvider';
import { learningPracticePayload } from '../lib/learning-authoring-policy';
import { Button, Empty, Field, Loading, Notice, Page, Row, Section } from '../ui/components';
import { ChoiceMenu, ControlButton, Disclosure } from '../ui/DomainControls';
import { ScreenBack, useCampusNavigation, useScreenExitGuard } from '../ui/BackNavigation';
import { TemporalField } from '../ui/TemporalField';
import { Alert } from '../ui/Alert';

const queryOf = (href: string) => new URLSearchParams(href.split('?')[1] ?? '');
const changeHref = (href: string, values: Record<string, string>) => { const q = queryOf(href); for (const [key,value] of Object.entries(values)) value ? q.set(key,value) : q.delete(key); return `${href.split('?')[0]}?${q}`; };

export function LearningClassPractice({ href, classId }: { href: string; classId: string }) {
  const { schoolId } = useSession(), navigation = useCampusNavigation(href), q = queryOf(href), id = q.get('practice') ?? q.get('item'), learner = q.get('learner'), page = Math.max(1, Number.parseInt(q.get('page') ?? '1', 10) || 1);
  const listPath = `/api/v1/learning/practice/?${new URLSearchParams({ class_section_id: classId, page: String(page) })}`;
  const list = useApi<ClassPracticeList>(listPath), detailPath = id ? `/api/v1/learning/practice/${encodeURIComponent(id)}/?${new URLSearchParams({ class_section_id: classId, page: String(page), ...(learner ? { student_id: learner } : {}) })}` : null;
  const detail = useApi<ClassPracticeDetail>(detailPath);
  if (list.isPending) return <Page title="Class practice"><Loading /></Page>;
  if (list.isError || !list.data || list.data.class_section.id !== classId || list.data.school_id !== schoolId) return <Page title="Class practice"><Empty title="Class practice is unavailable" message={list.error?.message} onRetry={() => void list.refetch()} /></Page>;
  if (q.get('create') === 'practice') return <LearningPracticeComposer href={href} list={list.data} parentHref={changeHref(href,{ create: '' })} />;
  if (id) return detail.isPending ? <Page title="Practice"><Loading /></Page> : detail.isError || !detail.data || detail.data.item.id !== id ? <Page title="Practice"><Empty title="Practice unavailable" message={detail.error?.message} onRetry={() => void detail.refetch()} /></Page> : <PracticeDetail key={`${id}:${learner ?? ''}`} href={href} learner={learner} data={detail.data} path={detailPath!} />;
  return <Page title="Class practice" subtitle={list.data.class_section.label} onRefresh={() => void list.refetch()} refreshing={list.isRefetching}>
    <ScreenBack fallbackHref="/areas/messages/diary" title="Diary & practice" />
    {list.data.can_publish ? <Button title="Add practice" onPress={() => navigation.onNavigate(changeHref(href,{ create: 'practice' }))} /> : null}
    <Section title="Published instructions">{list.data.items.map(item => <Row key={item.id} title={item.title} detail={`${item.date}${item.due_at ? ` · Due ${new Date(item.due_at).toLocaleString()}` : ''}`} onPress={() => navigation.onNavigate(changeHref(href,{ practice: item.id, learner: '', page: '' }))} />)}{!list.data.items.length ? <Empty title="No published practice yet" /> : null}</Section>
    <PracticePages page={page} more={list.data.has_more} onChange={value => navigation.onNavigate(changeHref(href,{ page: String(value) }))} />
  </Page>;
}

function PracticePages({ page, more, onChange }: { page: number; more: boolean; onChange: (page: number) => void }) { return page > 1 || more ? <><ControlButton title="Previous page" disabled={page <= 1} onPress={() => onChange(page - 1)} /><Notice message={`Page ${page}`} /><ControlButton title="Next page" disabled={!more} onPress={() => onChange(page + 1)} /></> : null; }

function LearningPracticeComposer({ href, parentHref, list }: { href: string; parentHref: string; list: ClassPracticeList }) {
  const navigation = useCampusNavigation(href), [id,setId] = useState(Crypto.randomUUID()), [title,setTitle] = useState(''), [body,setBody] = useState(''), [date,setDate] = useState(list.today), [due,setDue] = useState(''), [term,setTerm] = useState(list.terms[0]?.id ?? ''), [subject,setSubject] = useState(list.can_publish_general ? '' : list.subjects[0]?.id ?? ''), [review,setReview] = useState(false), [saved,setSaved] = useState(false);
  const detailPath = `/api/v1/learning/practice/${encodeURIComponent(id)}/?${new URLSearchParams({ class_section_id: list.class_section.id, page: '1' })}`;
  const writer = useLearningCommand<ClassPracticeDetail>({ ownerHref: href, refreshPath: detailPath, onAccepted: (value, assertCurrent) => { if (value.item.id !== id) throw new Error('The accepted practice source did not match.'); assertCurrent(); setSaved(true); } });
  useEffect(() => { const action = writer.action; if (action?.ownerHref !== href || action.payload.kind !== 'json' || action.endpoint !== '/api/v1/learning/practice/') return; const values = JSON.parse(action.payload.body); setId(values.practice_id); setTitle(values.title); setBody(values.body); setDate(values.date); setDue(values.due_at ?? ''); setTerm(values.term_id); setSubject(values.subject_id ?? ''); },[writer.action,href]);
  useScreenExitGuard({ blocked: writer.busy, dirty: !saved && !writer.action && !!(title || body), title: 'Leave unpublished practice?', message: 'Only a confirmed publication will be kept.' });
  let payload: ReturnType<typeof learningPracticePayload> | null = null;
  try { payload = learningPracticePayload(list,{practiceId:id,term,subject,date,title,body,due}); } catch {}
  const valid = !!payload;
  const publish = () => { if (!payload || writer.locked) return; const reviewedPayload = payload; Alert.alert('Publish this practice?', 'Published instructions stay unchanged. Completion is learner or guardian reported and is separate from a submitted assignment.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Publish practice', onPress: () => void writer.run({ endpoint: '/api/v1/learning/practice/', body: reviewedPayload, source: { kind: 'practice', sourceId: id, revision: 0 } }) }]); };
  return <Page title={saved ? 'Practice published' : review ? 'Review practice' : 'Add class practice'} subtitle={list.class_section.label}><ScreenBack fallbackHref={parentHref} title="Class practice" onPress={review && !saved ? () => setReview(false) : undefined} />
    {writer.error ? <Notice tone="danger" message={writer.error} /> : null}{writer.resumeHref ? <Button title="Open retained learning action" onPress={() => navigation.onNavigate(writer.resumeHref!)} /> : null}{writer.action ? <Button title={writer.action.phase === 'accepted' ? 'Refresh published practice' : 'Retry identical publication'} busy={writer.busy} onPress={() => void writer.recover()} /> : null}
    {saved ? <><Notice tone="success" message="The practice publication is confirmed." /><Button title="Open published practice" onPress={() => navigation.complete(changeHref(parentHref,{ practice: id, learner: '', page: '' }))} /></> : review ? <Section title={title}><Row title="Instructions" detail={body} /><Notice message={`${date}${due ? ` · Due ${new Date(due).toLocaleString()}` : ' · No due date'}`} /><Button title="Publish practice" disabled={!valid || writer.locked} busy={writer.busy} onPress={publish} /></Section> : <Section title="Practice instructions"><Field label="Title" value={title} onChangeText={setTitle} maxLength={180} editable={!writer.locked} /><Field label="Instructions" value={body} onChangeText={setBody} multiline maxLength={4000} editable={!writer.locked} /><TemporalField label="Practice date" mode="date" value={date} onChange={setDate} disabled={writer.locked} /><Disclosure title="Term, subject and due date"><ChoiceMenu label="Term" value={term} options={list.terms.map(value => ({ value: value.id, label: value.name }))} onChange={setTerm} disabled={writer.locked} /><ChoiceMenu label="Subject" value={subject} options={[...(list.can_publish_general ? [{ value: '', label: 'General class practice' }] : []), ...list.subjects.map(value => ({ value: value.id, label: value.name }))]} onChange={setSubject} disabled={writer.locked} /><TemporalField label="Due date (optional)" mode="datetime" value={due} onChange={setDue} disabled={writer.locked} />{due ? <ControlButton title="Remove due date" disabled={writer.locked} onPress={() => setDue('')} /> : null}</Disclosure><Button title="Review practice" disabled={!valid || writer.locked} onPress={() => setReview(true)} /></Section>}
  </Page>;
}

function PracticeDetail({ href, learner, data, path }: { href: string; learner: string | null; data: ClassPracticeDetail; path: string }) {
  const navigation = useCampusNavigation(href), [source,setSource] = useState(data), [note,setNote] = useState(''), page = Math.max(1, Number.parseInt(queryOf(href).get('page') ?? '1',10) || 1);
  const writer = useLearningCommand<ClassPracticeDetail>({ ownerHref: href, refreshPath: path, onAccepted: (value, assertCurrent) => { if (value.item.id !== data.item.id) throw new Error('The refreshed private thread did not match.'); assertCurrent(); setSource(value); setNote(''); } });
  useEffect(() => { if (!writer.action && !note) setSource(data); },[data,writer.action,note]);
  useScreenExitGuard({ blocked: writer.busy, dirty: !!note.trim() && !writer.action, title: 'Leave private reply?', message: 'The unsent reply will be discarded. Accepted notes stay in the conversation.' });
  const selected = learner && source.progress.items.find(value => value.id === learner);
  return <Page title={source.item.title}><ScreenBack fallbackHref={changeHref(href,learner ? { learner: '' } : { practice: '', item: '', learner: '', page: '' })} title={learner ? 'Reported completion' : 'Class practice'} />
    <Row title="Instructions" detail={source.item.body} /><Notice message={`${source.progress.completed} of ${source.progress.total} reported complete. This is reported practice, not a verified submission.`} />
    {writer.error ? <Notice tone="danger" message={writer.error} /> : null}{writer.resumeHref ? <Button title="Open retained learning action" onPress={() => navigation.onNavigate(writer.resumeHref!)} /> : null}{writer.action ? <Button title={writer.action.phase === 'accepted' ? 'Refresh saved reply' : 'Retry identical reply'} busy={writer.busy} onPress={() => void writer.recover()} /> : null}
    <Section title="Learners">{source.progress.items.map(person => <Row key={person.id} title={person.name} status={person.completed_at ? 'Reported complete' : 'Not reported complete'} onPress={source.can_reply ? () => navigation.onNavigate(changeHref(href,{ learner: person.id })) : undefined} />)}</Section>
    {learner && source.thread ? <Section title={selected ? `Private conversation · ${selected.name}` : 'Private learner conversation'}><Notice message="Visible to this learner, their current guardians and the authorized instructor. Latest 100 entries are shown." />{source.thread.map(entry => <Row key={entry.id} title={entry.author_name} detail={`${entry.body}\n${new Date(entry.created_at).toLocaleString()}`} />)}{!source.thread.length ? <Empty title="No private notes yet" /> : source.can_reply ? <><Field label="Private reply" value={note} onChangeText={setNote} multiline maxLength={2000} editable={!writer.locked} /><Button title="Send reply" disabled={writer.locked || !note.trim()} busy={writer.busy} onPress={() => void writer.run({ endpoint: `/api/v1/learning/practice/${encodeURIComponent(source.item.id)}/notes/`, body: { note_id: Crypto.randomUUID(), student_id: learner, body: note.trim() }, source: { kind: 'practice', sourceId: source.item.id, revision: 1 } })} /></> : null}</Section> : null}
    <PracticePages page={page} more={page * 20 < source.progress.total} onChange={value => navigation.onNavigate(changeHref(href,{ page: String(value), learner: '' }))} />
  </Page>;
}
