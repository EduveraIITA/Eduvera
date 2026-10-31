import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ApiAttendanceRanking, ApiAttendanceRecord, ApiAttendanceSummary, ApiSubjectAttendance } from '../../../../packages/contracts/src/wire/features/school/api';
import { Empty, Row, SearchField } from '../../ui/components';
import { ChoiceMenu, ControlButton, Disclosure, Facts, InfoDisclosure } from '../../ui/DomainControls';
import { useTheme } from '../../ui/theme';
import { themeRadii } from '../../ui/theme-tokens';
import { AttendanceSheet } from './AttendanceSheet';

const knownPercent = (value: unknown) => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value));
export const attendancePercent = (value: number | string | null | undefined) => knownPercent(value) ? `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}%` : 'Unavailable';
export function SavedRecordDetail({ record }: { record: ApiAttendanceRecord }) {
  const { colors } = useTheme();
  const title = record.status.replaceAll('_', ' ').replace(/^./, first => first.toUpperCase());
  const color = record.status === 'absent' ? colors.danger : record.status === 'late' || record.status === 'half_day' ? colors.warning : record.status === 'present' ? colors.positive : colors.muted;
  return <View style={[styles.subject, { backgroundColor: colors.row }]}>
    <Text style={[styles.name, { color: colors.ink }]}>{record.date}</Text><Text style={[styles.status, { color }]}>{title} in the saved attendance register</Text>
    {record.remarks ? <Text style={[styles.caption, { color: colors.muted }]}>{record.remarks}</Text> : null}
    <InfoDisclosure title="Saved record details"><Facts items={[{ label: 'Revision', value: record.revision }, ...(record.check_in_at ? [{ label: 'Reported check-in', value: new Date(record.check_in_at).toLocaleTimeString() }] : []), ...(record.check_out_at ? [{ label: 'Reported check-out', value: new Date(record.check_out_at).toLocaleTimeString() }] : [])]} /></InfoDisclosure>
  </View>;
}
function minimumState(value: number | string, minimum: number, recorded: boolean) {
  return !recorded ? 'Not recorded' : !knownPercent(value) ? 'Attendance unavailable' : !Number.isFinite(minimum) ? 'Minimum unavailable' : Number(value) < minimum ? 'Below minimum' : Number(value) < minimum + 5 ? 'Near minimum' : 'Above minimum';
}

function Progress({ value, minimum, recorded }: { value: number | string; minimum: number; recorded: boolean }) {
  const { colors } = useTheme();
  if (!recorded || !knownPercent(value)) return null;
  const number = Math.min(100, Math.max(0, Number(value)));
  const color = !Number.isFinite(minimum) ? colors.muted : Number(value) < minimum ? colors.danger : Number(value) < minimum + 5 ? colors.warning : colors.positive;
  return <View accessible accessibilityRole="progressbar" accessibilityLabel="Recorded attendance" accessibilityValue={{ min: 0, max: 100, now: number, text: attendancePercent(value) }} style={[styles.track, { backgroundColor: colors.border }]}><View style={{ width: `${number}%`, height: '100%', backgroundColor: color, borderRadius: 4 }} /></View>;
}

export function AttendanceAggregate({ summary, term, relationship }: { summary: ApiAttendanceSummary; term: { name: string; academic_year: string; threshold: string | number }; relationship: 'self' | 'dependent' }) {
  const { colors } = useTheme(), minimum = knownPercent(term.threshold) ? Number(term.threshold) : NaN;
  const recorded = relationship === 'dependent' ? summary.total > summary.excused : summary.total > 0;
  const state = minimumState(summary.percentage, minimum, recorded);
  const color = state === 'Below minimum' ? colors.danger : state === 'Near minimum' ? colors.warning : state === 'Above minimum' ? colors.positive : colors.muted;
  return <View style={[styles.aggregate, { backgroundColor: colors.row }]}>
    <Text style={[styles.caption, { color: colors.muted }]}>{term.name} · {term.academic_year}</Text>
    <View style={styles.summaryRow}><Text style={[styles.percent, { color: colors.ink }]}>{recorded ? attendancePercent(summary.percentage) : 'Not recorded'}</Text><View style={{ gap: 4 }}><Text style={[styles.status, { color }]}>{state}</Text><Text style={[styles.caption, { color: colors.muted }]}>{attendancePercent(term.threshold)} required</Text></View></View>
    <Progress value={summary.percentage} minimum={minimum} recorded={recorded} />
    <Text style={[styles.caption, { color: colors.muted }]}>{summary.total > 0 ? `${summary.present} present · ${summary.late} late · ${summary.half_day} half days` : 'Attendance appears after the campus publishes a register.'}</Text>
    <Disclosure title="Breakdown"><Facts items={[{ label: 'Saved records', value: summary.total }, { label: 'Absent', value: summary.absent }, { label: 'Excused', value: summary.excused }, { label: 'Half days', value: summary.half_day }]} /></Disclosure>
  </View>;
}

export function AttendanceSubjects({ subjects, threshold }: { subjects: ApiSubjectAttendance[]; threshold: string | number }) {
  const { colors } = useTheme(), minimum = knownPercent(threshold) ? Number(threshold) : NaN;
  const [filter, setFilter] = useState('all'), [page, setPage] = useState(1);
  const attention = subjects.filter(subject => subject.classes_held > 0 && knownPercent(subject.percentage) && Number.isFinite(minimum) && Number(subject.percentage) < minimum + 5);
  const visible = filter === 'near' ? attention : filter === 'unrecorded' ? subjects.filter(subject => subject.classes_held <= 0) : subjects;
  const pages = Math.max(1, Math.ceil(visible.length / 10)), actualPage = Math.min(page, pages);
  return <>
    <ChoiceMenu label="Filter subjects" value={filter} options={[{ value: 'all', label: `All subjects · ${subjects.length}` }, { value: 'near', label: `Needs attention · ${attention.length}` }, { value: 'unrecorded', label: `Not recorded · ${subjects.filter(subject => subject.classes_held <= 0).length}` }]} onChange={value => { setFilter(value); setPage(1); }} />
    {visible.length ? visible.slice((actualPage - 1) * 10, actualPage * 10).map(subject => {
      const recorded = subject.classes_held > 0, state = minimumState(subject.percentage, minimum, recorded);
      const color = state === 'Below minimum' ? colors.danger : state === 'Near minimum' ? colors.warning : state === 'Above minimum' ? colors.positive : colors.muted;
      return <View key={subject.id} style={[styles.subject, { backgroundColor: colors.row }]}>
        <View style={styles.subjectHead}><Text style={[styles.name, { color: colors.ink }]}>{subject.subject.name}</Text><Text style={[styles.subjectPercent, { color: colors.ink }]}>{recorded ? attendancePercent(subject.percentage) : 'Not recorded'}</Text></View>
        <Text style={[styles.caption, { color: colors.muted }]}>{recorded ? `${subject.classes_attended} of ${subject.classes_held} classes attended` : 'No attendance recorded'}</Text>
        {recorded ? <Text style={[styles.status, { color }]}>{state}</Text> : null}
        <Progress value={subject.percentage} minimum={minimum} recorded={recorded} />
        <InfoDisclosure title="Subject details"><Facts items={[{ label: 'Minimum required', value: attendancePercent(threshold) }, { label: 'Excused', value: subject.classes_excused }, ...(subject.teacher ? [{ label: 'Teacher', value: subject.teacher.name }] : []), ...(subject.room ? [{ label: 'Room', value: subject.room }] : []), ...(subject.next_class ? [{ label: 'Next scheduled class', value: `${subject.next_class.weekday_label} · ${subject.next_class.starts_at.slice(0, 5)}` }] : [])]} /></InfoDisclosure>
      </View>;
    }) : <Empty title={subjects.length ? 'No subjects match this view' : 'No published subject attendance'} />}
    {pages > 1 ? <View style={styles.pagination}><ControlButton title="Previous" disabled={actualPage <= 1} onPress={() => setPage(actualPage - 1)} /><Text style={[styles.caption, { color: colors.muted }]}>{actualPage} of {pages}</Text><ControlButton title="Next" disabled={actualPage >= pages} onPress={() => setPage(actualPage + 1)} /></View> : null}
  </>;
}

export function AttendanceRankingSheet({ ranking, visible, onClose }: { ranking: ApiAttendanceRanking; visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const rows = (ranking.students ?? ranking.leaders).filter(person => person.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const pages = Math.max(1, Math.ceil(rows.length / 10)), actualPage = Math.min(page, pages);
  return <AttendanceSheet visible={visible && ranking.published} title="Published class comparison" onClose={onClose}>
    <Text style={[styles.caption, { color: colors.muted }]}>As of {new Date(ranking.as_of).toLocaleDateString()} · {ranking.cohort_size} learners</Text>
    <InfoDisclosure title="How this comparison is calculated"><Text style={[styles.caption, { color: colors.muted }]}>{ranking.methodology}</Text></InfoDisclosure>
    {(ranking.students ?? ranking.leaders).length > 10 ? <SearchField label="Find a learner in the published comparison" value={search} onChangeText={value => { setSearch(value); setPage(1); }} placeholder="Learner name" /> : null}
    {rows.length ? rows.slice((actualPage - 1) * 10, actualPage * 10).map((person, index) => <Row key={`${(actualPage - 1) * 10 + index}:${person.name}`} title={`${person.rank ?? 'Unranked'} · ${person.name}`} detail={'is_current' in person && person.is_current ? 'Selected learner' : undefined} status={person.percentage === null ? 'Not recorded' : attendancePercent(person.percentage)} />) : <Empty title="No published comparison in this view" />}
    {pages > 1 ? <View style={styles.pagination}><ControlButton title="Previous" disabled={actualPage <= 1} onPress={() => setPage(actualPage - 1)} /><Text style={[styles.caption, { color: colors.muted }]}>{actualPage} of {pages}</Text><ControlButton title="Next" disabled={actualPage >= pages} onPress={() => setPage(actualPage + 1)} /></View> : null}
  </AttendanceSheet>;
}

const styles = StyleSheet.create({
  aggregate: { padding: 20, borderRadius: themeRadii.radiusCard, gap: 12 }, caption: { fontSize: 14, lineHeight: 21 }, summaryRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 16 }, percent: { fontSize: 36, lineHeight: 44, fontWeight: '700', fontVariant: ['tabular-nums'] }, status: { fontSize: 14, lineHeight: 21, fontWeight: '600' },
  track: { height: 6, borderRadius: 4, overflow: 'hidden' }, subject: { padding: 16, borderRadius: themeRadii.radiusRow, gap: 8 }, subjectHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 12 }, name: { flex: 1, minWidth: 120, fontSize: 17, lineHeight: 24, fontWeight: '600' }, subjectPercent: { fontSize: 20, lineHeight: 27, fontWeight: '600', fontVariant: ['tabular-nums'] }, pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 12 },
});
