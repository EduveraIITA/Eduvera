import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as DeviceStorage from '../lib/device-storage';
import type { ApiDiaryItem, ParentDiaryResponse } from '../../../packages/contracts/src/wire/features/school/api';
import { useSession } from '../auth/SessionProvider';
import { captureApiContext, getApiOrigin } from '../lib/api';
import { useApi } from '../lib/query';
import { useNativePendingAction } from '../lib/native-pending-action';
import { useOperationContext } from '../lib/use-operation-context';
import { learningDiaryCommand, learningDiaryRefreshPath } from '../lib/learning-diary-policy';
import { learningAuthoringObsolete } from '../lib/learning-authoring-policy';
import { Button, Empty, Field, Loading, Notice, Page, Row, Section } from '../ui/components';
import { ControlButton, Disclosure, SegmentedControl } from '../ui/DomainControls';
import { ScreenBack, useCampusNavigation, useScreenExitGuard } from '../ui/BackNavigation';
import { TemporalField } from '../ui/TemporalField';
import { useTheme } from '../ui/theme';

const qOf = (href: string) => new URLSearchParams(href.split('?')[1] ?? '');
const changeHref = (href: string, changes: Record<string,string>) => { const q = qOf(href); for (const [key,value] of Object.entries(changes)) value ? q.set(key,value) : q.delete(key); return `${href.split('?')[0]}?${q}`; };
const shift = (date: string, days: number) => new Date(Date.parse(date + 'T12:00:00Z') + days * 86_400_000).toISOString().slice(0,10);
const needsAction = (item: ApiDiaryItem) => item.item_type === 'homework' && item.completed === false || item.requires_acknowledgement && !item.acknowledged;

/** The same student-qualified owners serve the learner and the currently linked
 * guardian. Packing checks are private device state, never completion evidence. */
export function LearningPersonalDiary({ href, studentId, self, date }: { href: string; studentId: string; self: boolean; date: string }) {
  const { user, schoolId, environment, scopeKey } = useSession(), navigation = useCampusNavigation(href), { colors } = useTheme();
  const q = qOf(href), itemId = q.get('diary_item') ?? q.get('item') ?? q.get('diary_id'), filter = q.get('filter') ?? 'all', page = Math.max(1,Number.parseInt(q.get('page') ?? '1',10) || 1);
  const listPath = self ? `/api/v1/diary/?${new URLSearchParams({ student_id: studentId, date_from: shift(date,-7), date_to: shift(date,7) })}` : `/api/v1/screens/parent/diary/?${new URLSearchParams({ date, student_id: studentId })}`;
  const detailPath = itemId ? `/api/v1/diary/${encodeURIComponent(itemId)}/?student_id=${encodeURIComponent(studentId)}` : null;
  const list = useApi<ParentDiaryResponse | { results: ApiDiaryItem[] }>(listPath), detail = useApi<ApiDiaryItem>(detailPath), selfIdentity = useApi<{ student: { id: string } }>(self ? '/api/v1/screens/student/home/' : null);
  const [note,setNote] = useState(''), [packing,setPacking] = useState<Record<string,boolean>>({}), [packingKey,setPackingKey] = useState<string | null>(null), [localError,setLocalError] = useState(''), [packingBusy,setPackingBusy] = useState(false);
  const packingBusyRef = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; },[]);
  const captureOperation = useOperationContext(JSON.stringify([href, studentId, date, itemId]));
  const writer = useNativePendingAction<ApiDiaryItem>({ scope: { actorId: user!.id, schoolId: schoolId!, mode: environment.mode, namespaceId: environment.namespace_id ?? null, origin: getApiOrigin() }, domain: 'learning', ownerHref: href, refreshPath: detailPath ?? listPath,
    resolveRefreshPath: learningDiaryRefreshPath, obsolete: learningAuthoringObsolete, captureOperation,
    accepted: async (value,assertCurrent) => { if (!itemId || value.id !== itemId) throw new Error('The saved diary item did not match this source.'); assertCurrent(); await list.refetch({ throwOnError: true }); assertCurrent(); const fresh = await detail.refetch({ throwOnError: true }); assertCurrent(); if (fresh.data?.id !== itemId) throw new Error('The current diary item did not match this source.'); setNote(''); },
  });
  useScreenExitGuard({ blocked: writer.busy, dirty: !!note.trim() && !writer.action, title: 'Leave private diary note?', message: 'Your unsent note will be discarded. Accepted notes stay in the private conversation.' });
  const validList = !list.isError && !!list.data && (self ? !selfIdentity.isError && selfIdentity.data?.student.id === studentId && 'results' in list.data : 'student' in list.data && list.data.student.id === studentId && list.data.date === date);
  const items = validList && list.data ? 'results' in list.data ? list.data.results : list.data.items : [];
  const selected = !detail.isError && detail.data?.id === itemId ? detail.data : null;
  const pack = useMemo(() => items.filter(item => /\b(?:bring|pack|notebook|sheet|kit|uniform|material)\b/i.test(item.body)),[list.data]);
  useEffect(() => {
    let active = true; setPackingKey(null); setPacking({});
    void (async () => { const transport = captureApiContext(); const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify([getApiOrigin(),scopeKey,studentId,date]));
      const key = `thatcampus.learning-packing.${digest}`, raw = await DeviceStorage.getItemAsync(key); transport.assertCurrent();
      const stored: unknown = raw ? JSON.parse(raw) : {};
      if (!active) return;
      setPacking(stored && typeof stored === 'object' && !Array.isArray(stored) ? Object.fromEntries(Object.entries(stored).filter((value): value is [string,boolean] => typeof value[1] === 'boolean')) : {}); setPackingKey(key);
    })().catch(cause => { if (active) setLocalError(cause instanceof Error ? cause.message : 'Device preparation checks could not load.'); });
    return () => { active = false; };
  },[scopeKey,studentId,date]);
  const togglePacked = async (id: string, value: boolean) => { if (!packingKey || packingBusyRef.current) return; packingBusyRef.current = true; setPackingBusy(true); try { const transport = captureApiContext(), next = { ...packing,[id]:value }; await DeviceStorage.setItemAsync(packingKey,JSON.stringify(next),{ keychainAccessible: DeviceStorage.WHEN_UNLOCKED_THIS_DEVICE_ONLY }); transport.assertCurrent(); if (alive.current) setPacking(next); } catch (cause) { if (alive.current) setLocalError(cause instanceof Error ? cause.message : 'This device check could not be saved.'); } finally { packingBusyRef.current = false; if (alive.current) setPackingBusy(false); } };
  const action = (item: ApiDiaryItem, kind: 'complete'|'acknowledge'|'note') => {
    if (writer.locked || item.id !== itemId || kind === 'complete' && typeof item.completed !== 'boolean') return;
    try { void writer.run(learningDiaryCommand(item,studentId,kind,note,Crypto.randomUUID())); } catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'This diary action could not be prepared.'); }
  };
  const visible = items.filter(item => filter === 'attention' ? needsAction(item) : filter === 'homework' ? item.item_type === 'homework' : filter === 'updates' ? item.item_type !== 'homework' : true).sort((a,b) => Number(needsAction(b))-Number(needsAction(a)) || b.date.localeCompare(a.date) || b.published_at.localeCompare(a.published_at));
  return <Page title={selected?.title ?? 'Diary & practice'} subtitle={self ? `${shift(date,-7)} – ${shift(date,7)}` : date} onRefresh={() => { void list.refetch(); if (self) void selfIdentity.refetch(); if (itemId) void detail.refetch(); }} refreshing={list.isRefetching || detail.isRefetching}>
    {writer.error || localError ? <Notice tone="danger" message={writer.error || localError} /> : null}{writer.resumeHref ? <Button title="Open retained learning action" onPress={() => navigation.onNavigate(writer.resumeHref!)} /> : null}{writer.action && !writer.resumeHref ? <><Notice message={writer.action.replayPolicy === 'inspect_only' ? 'This legacy diary action has no exact command receipt. An uncertain result stays retained and can only be inspected.' : 'The original action and command identity are securely retained.'} /><Button title={writer.action.phase === 'accepted' ? 'Refresh saved diary' : writer.action.replayPolicy === 'inspect_only' ? 'Inspect saved state' : 'Retry identical action'} busy={writer.busy} onPress={() => void writer.recover()} /></> : null}
    {itemId ? <><ScreenBack title="Diary & practice" fallbackHref={changeHref(href,{ diary_item:'',item:'',diary_id:'' })} />{detail.isPending ? <Loading /> : !selected ? <Empty title="Diary item unavailable" message={detail.error?.message} onRetry={() => void detail.refetch()} /> : <><Row title={selected.subject?.name ?? selected.item_type_label} detail={`${selected.author_name} · ${new Date(selected.published_at).toLocaleString()}${selected.due_at ? `\nDue ${new Date(selected.due_at).toLocaleString()}` : ''}`} /><Text selectable style={{ color: colors.ink,fontSize:16,lineHeight:24 }}>{selected.body}</Text>{selected.item_type === 'homework' ? <><Notice message={selected.completed === true ? 'Reported complete' : selected.completed === false ? 'Not reported complete' : 'Completion status unavailable. Refresh this record.'} /><Button title={selected.completed ? 'Undo reported completion' : 'Report completed'} kind="secondary" disabled={writer.locked || typeof selected.completed !== 'boolean'} onPress={() => action(selected,'complete')} /><Notice message="Reported practice is separate from a submitted assignment or a verified learning outcome." /></> : null}{selected.requires_acknowledgement ? <Button title={selected.acknowledged ? 'Acknowledged' : 'Acknowledge this update'} disabled={writer.locked || selected.acknowledged} onPress={() => action(selected,'acknowledge')} /> : null}<Section title="Private notes"><Notice message="Private to this learner, current guardians and the authorized source author. Latest 100 notes are shown." />{selected.notes.map(entry => <Row key={entry.id} title={entry.author_name} detail={`${entry.body}\n${new Date(entry.created_at).toLocaleString()}`} />)}<Field label="Private note or question" value={note} onChangeText={setNote} multiline maxLength={2000} editable={!writer.locked} /><Button title="Send note" disabled={writer.locked || note.trim().length < 2} busy={writer.busy} onPress={() => action(selected,'note')} /></Section></>}</> : <>
      <TemporalField label="Learning date" mode="date" value={date} onChange={value => navigation.onNavigate(changeHref(href,{ date:value,page:'' }))} />
      {!self && list.data && 'schedule' in list.data && (list.data.schedule.length || pack.length) ? <Disclosure title="Day plan and preparation">{list.data.schedule.map(slot => <Row key={slot.id} title={slot.display_title} detail={`${slot.starts_at} – ${slot.ends_at}${slot.teacher?.name ? ` · ${slot.teacher.name}` : ''}${slot.room ? ` · ${slot.room}` : ''}`} />)}{pack.length ? <Section title="Preparation checklist"><Notice message="Saved privately on this device. These checks do not report homework completion." />{pack.map(item => <View key={item.id} style={{ flexDirection:'row',alignItems:'center',gap:12 }}><Switch value={packing[item.id] === true} disabled={!packingKey || packingBusy} accessibilityLabel={`Packed: ${item.title}`} onValueChange={value => void togglePacked(item.id,value)} /><Text style={{ flex:1,color:colors.ink,fontSize:16 }}>{item.title}</Text></View>)}</Section> : null}</Disclosure> : null}
      <SegmentedControl label="Diary filter" value={filter} options={[{value:'all',label:'All'},{value:'attention',label:'Needs attention',count:items.filter(needsAction).length},{value:'homework',label:'Practice'},{value:'updates',label:'Updates'}]} onChange={value => navigation.onNavigate(changeHref(href,{filter:value,page:''}))} />
      {list.isPending || self && selfIdentity.isPending ? <Loading /> : !validList ? <Empty title="Diary could not load" message={list.error?.message} onRetry={() => void list.refetch()} /> : <Section title="Published diary">{visible.slice((page-1)*15,page*15).map(item => <Row key={item.id} title={item.title} detail={`${item.item_type_label} · ${item.date} · ${item.author_name}`} status={item.item_type === 'homework' ? item.completed ? 'Reported complete' : 'To do' : item.requires_acknowledgement && !item.acknowledged ? 'Acknowledge' : undefined} onPress={() => navigation.onNavigate(changeHref(href,{ diary_item:item.id }))} />)}{!visible.length ? <Empty title="No diary updates in this filter" /> : null}</Section>}
      {page > 1 || page*15 < visible.length ? <><ControlButton title="Previous diary page" disabled={page <= 1} onPress={() => navigation.onNavigate(changeHref(href,{page:String(page-1)}))} /><ControlButton title="Next diary page" disabled={page*15 >= visible.length} onPress={() => navigation.onNavigate(changeHref(href,{page:String(page+1)}))} /></> : null}
    </>}
  </Page>;
}
