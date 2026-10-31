import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import type { ApiAttendanceRanking, ApiAttendanceRecord as AttendanceRecord, ApiSubjectAttendance as Subject } from '../../../packages/contracts/src/wire/features/school/api';
import { normalizeWorkspaceManifest, assertWorkspaceManifestContext } from '../../../packages/contracts/src/workspace-normalizer';
import { useSession } from '../auth/SessionProvider';
import { attendanceRelationshipHref, attendanceRelationshipOptions, nativeAttendanceRecordsMatches, nativeAttendanceRecordsPath, resolveAttendanceRelationship, type NativeAttendanceRelationship } from '../lib/attendance-access';
import { useApi } from '../lib/query';
import { attendanceAttentionProof } from '../lib/attendance-attention';
import { useAttendanceAttention } from '../lib/use-attendance-attention';
import { Empty, Loading, Notice, Page, Row, Section } from '../ui/components';
import { ChoiceMenu, ControlButton, Disclosure, InfoDisclosure } from '../ui/DomainControls';
import { useTheme } from '../ui/theme';
import { AttendanceAggregate, AttendanceRankingSheet, AttendanceSubjects, SavedRecordDetail } from './attendance/AttendanceRecordViews';
import { SavedRecordCalendar } from './attendance/SavedRecordCalendar';

type Props = { href: string; onNavigate: (href: string) => void };
type Report = { student: { id: string; user: { display_name: string }; current_enrollment?: { class_name?: string } }; term: { name: string; academic_year: string; threshold: string | number }; summary: { total: number; present: number; absent: number; late: number; excused: number; half_day: number; percentage: number }; subjects?: Subject[]; calendar?: AttendanceRecord[]; ranking?: ApiAttendanceRanking };
const label = (value: string) => value.replaceAll('_', ' ').replace(/^./, first => first.toUpperCase());
export function AttendanceRecordsScreen(props: Props) {
  const { schoolId, scopeKey, user, environment } = useSession();
  const manifest = useApi<unknown>(schoolId ? '/api/v1/workspace' : null);
  const resolved = useMemo(() => { try { if (!schoolId || !user || !manifest.data) return null; const value = normalizeWorkspaceManifest(manifest.data); return assertWorkspaceManifestContext(value, { actorUserId: user.id, institutionId: schoolId, environment }); } catch { return null; } }, [schoolId, user?.id, environment, manifest.data]);
  if (!schoolId) return <Page title="Attendance"><Empty title="Choose a campus" /></Page>;
  if (manifest.isPending) return <Page title="Attendance"><Loading /></Page>;
  if (manifest.isError || !resolved) return <Page title="Attendance"><Empty title="Attendance access could not be confirmed" message={manifest.error?.message} onRetry={() => void manifest.refetch()} /></Page>;
  const selection = resolveAttendanceRelationship(resolved, props.href), options = attendanceRelationshipOptions(resolved);
  if (selection.state !== 'selected') return <Page title="Attendance"><Empty title={selection.state === 'choose' ? 'Whose attendance would you like to see?' : 'This learner context is unavailable'} message={selection.state === 'invalid' ? 'The selected relationship was not confirmed. Choose a current authorized record.' : 'Choose the exact learner before opening their records.'} /><Section title="Your attendance records">{options.map(option => <Row key={option.surface.key} title={option.label} detail={option.surface.description} onPress={() => props.onNavigate(attendanceRelationshipHref(props.href, option))} />)}</Section></Page>;
  return <RecordView key={`${scopeKey}:${selection.option.surface.key}`} {...props} selected={selection.option} options={options} />;
}
function RecordView({ href, onNavigate, selected, options }: Props & { selected: NativeAttendanceRelationship; options: NativeAttendanceRelationship[] }) {
  const { colors } = useTheme();
  const query = useApi<Report>(nativeAttendanceRecordsPath(selected));
  const pro = useApi<{enabled: boolean}>(selected.relationship === 'self' ? '/api/v1/auth/pro-features/' : null);
  const subjectsQuery = useApi<{ results: Subject[] }>(selected.relationship === 'dependent' ? `/api/v1/students/attendance/subjects/?${new URLSearchParams({ student_id: selected.studentId })}` : null);
  const [selectedDate, setSelectedDate] = useState(''), [ranking, setRanking] = useState(false), [month, setMonth] = useState(''), [page, setPage] = useState(1);
  const params = new URLSearchParams(href.split('?')[1] ?? ''), focusId = params.get('attendance_record_id');
  const data = !query.isError && nativeAttendanceRecordsMatches(query.data, selected) ? query.data : undefined;
  const openedProof = useMemo(() => attendanceAttentionProof(href, selected, data), [href, selected.surface.key, data]);
  useAttendanceAttention(openedProof, query.dataUpdatedAt);
  const calendar = [...(data?.calendar ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const months = [...new Set(calendar.map(record => record.date.slice(0, 7)))];
  const selectedMonth = month || (params.get('date')?.slice(0, 7)) || months[0];
  const records = calendar.filter(record => record.date.startsWith(selectedMonth ?? ''));
  const exactFocus = focusId ? calendar.find(record => record.id === focusId && record.revision === Number(params.get('attendance_revision')) && record.date === params.get('date')) : undefined;
  const pages = Math.max(1, Math.ceil(records.length / 15)), actualPage = Math.min(page, pages);
  const subjects = selected.relationship === 'self' ? data?.subjects : subjectsQuery.data?.results;
  const leaveParams = new URLSearchParams({ scope: selected.relationship, student_id: selected.studentId, ...(selected.relationship === 'dependent' ? { tab: 'apply' } : { view: 'apply' }) });
  const monthLabel = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? new Date(`${value}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : value;
  const visibleMonthOptions = [...new Set([...(selectedMonth ? [selectedMonth] : []), ...months])].map(value => ({ value, label: monthLabel(value) }));
  const day = selectedDate || (exactFocus?.date.startsWith(selectedMonth ?? '') ? exactFocus.date : records[0]?.date) || '';
  return <Page title="Attendance" subtitle={selected.label} refreshing={query.isRefetching || subjectsQuery.isRefetching} onRefresh={() => { void query.refetch(); if (selected.relationship === 'dependent') void subjectsQuery.refetch(); }}>
    {options.length > 1 ? <ChoiceMenu label="Choose learner" value={selected.surface.key} options={options.map(option => ({ value: option.surface.key, label: option.label }))} onChange={value => { const option = options.find(item => item.surface.key === value); if (option) onNavigate(attendanceRelationshipHref(href, option)); }} /> : null}
    {query.isPending ? <Loading /> : !data ? <Empty title="This learner's attendance could not load" message={query.error?.message ?? 'The response did not match the exact selected learner. No other record was substituted.'} onRetry={() => void query.refetch()} /> : <>
      <AttendanceAggregate summary={data.summary} term={data.term} relationship={selected.relationship} />
      {(focusId && !exactFocus || params.has('attention_notification_id') && !openedProof) ? <Notice tone="warning" message="This attendance update no longer matches the saved record. It was not marked as opened." /> : null}
      {exactFocus ? <Section title="Selected attendance update"><Row title={`${exactFocus.date} · ${label(exactFocus.status)}`} detail={exactFocus.remarks} status={`Saved revision ${exactFocus.revision}`} /></Section> : null}
      {selected.relationship === 'dependent' ? <Section title="Attendance calendar">
        {visibleMonthOptions.length ? <ChoiceMenu label="Attendance month" value={selectedMonth ?? ''} options={visibleMonthOptions} onChange={value => { setMonth(value); setPage(1); setSelectedDate(''); }} /> : null}
        {selectedMonth ? <SavedRecordCalendar month={selectedMonth} records={records} selectedDate={day} onSelect={setSelectedDate} /> : <Empty title="No saved attendance calendar" message="Missing records are not counted as absence." />}
      </Section> : null}
      <Section title="Subject attendance">{selected.relationship === 'dependent' && subjectsQuery.isPending ? <Loading /> : selected.relationship === 'dependent' && subjectsQuery.isError ? <Empty title="Subject attendance could not load" message={subjectsQuery.error.message} onRetry={() => void subjectsQuery.refetch()} /> : subjects ? <AttendanceSubjects subjects={subjects} threshold={data.term.threshold} /> : <Empty title="No published subject attendance" />}</Section>
      <Section title="Attendance options">
        {selected.relationship === 'self' ? <Disclosure title="Saved attendance records">
          {visibleMonthOptions.length ? <ChoiceMenu label="Attendance month" value={selectedMonth ?? ''} options={visibleMonthOptions} onChange={value => { setMonth(value); setPage(1); }} /> : null}
          {records.length ? records.slice((actualPage - 1) * 15, actualPage * 15).map(record => <SavedRecordDetail key={record.id} record={record} />) : <Empty title="No saved attendance for this month" message="Missing records are not counted as absence." />}
          {pages > 1 ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><ControlButton title="Newer records" disabled={actualPage <= 1} onPress={() => setPage(actualPage - 1)} /><ControlButton title="Older records" disabled={actualPage >= pages} onPress={() => setPage(actualPage + 1)} /></View> : null}
        </Disclosure> : null}
        {data.ranking?.published ? <><ControlButton title="Published class comparison" onPress={() => setRanking(true)} /><AttendanceRankingSheet ranking={data.ranking} visible={ranking} onClose={() => setRanking(false)} /></> : null}
        <ControlButton title="Request leave or submit supporting documents" onPress={() => onNavigate(`/areas/attendance/leave?${leaveParams}`)} />
        {selected.relationship === 'self' ? <ControlButton title="Published attendance eligibility" onPress={() => onNavigate(`/areas/attendance/records?${new URLSearchParams({scope: 'self',student_id: selected.studentId,view: 'eligibility'})}`)} /> : null}
        {selected.relationship === 'self' && pro.data?.enabled === true ? <ControlButton title="Ask Attendance Copilot" onPress={() => onNavigate(`/areas/attendance/records?${new URLSearchParams({scope: 'self',student_id: selected.studentId,view: 'copilot'})}`)} /> : null}
        <InfoDisclosure title="About attendance records"><Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}>Attendance decisions are distinct from gate presence, journey boarding and physical handover. Missing evidence stays unknown.</Text></InfoDisclosure>
      </Section>
    </>}
  </Page>;
}
