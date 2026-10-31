import { StyleSheet, Text, View } from 'react-native';
import type { ApiAttendanceRecord } from '../../../../packages/contracts/src/wire/features/school/api';
import { CalendarMonthGrid } from '../../ui/CalendarMonthGrid';
import { Empty } from '../../ui/components';
import { useTheme } from '../../ui/theme';
import { themeRadii } from '../../ui/theme-tokens';
import { SavedRecordDetail } from './AttendanceRecordViews';

/** Dates without source records stay unknown, including weekends and future dates. */
export function SavedRecordCalendar({ month, records, selectedDate, onSelect }: { month: string; records: ApiAttendanceRecord[]; selectedDate: string; onSelect: (value: string) => void }) {
  const { colors } = useTheme();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return <Empty title="Attendance month unavailable" message="Choose a month with saved attendance records." />;
  const date = selectedDate.startsWith(`${month}-`) ? selectedDate : `${month}-01`;
  const rows = records.filter(record => record.date === selectedDate);
  const statusColor = (status: string) => status === 'present' ? colors.positive : status === 'absent' ? colors.danger : status === 'late' || status === 'half_day' ? colors.warning : colors.muted;
  const statusName = (status: string) => status.replaceAll('_', ' ').replace(/^./, first => first.toUpperCase());
  const statuses = [...new Set(records.map(record => record.status))];
  return <View style={{ gap: 12 }}>
    <View style={[styles.calendar, { backgroundColor: colors.row }]}>
      <CalendarMonthGrid date={date} today="" onDateChange={onSelect} getDayInfo={value => {
        const saved = records.filter(record => record.date === value);
        return { disabled: !value.startsWith(`${month}-`), label: saved.length ? saved.map(record => `${statusName(record.status)} in the saved attendance register`).join(', ') : 'No saved attendance record', markers: saved.map(record => ({ key: record.id, color: statusColor(record.status) })) };
      }} />
      <View style={styles.legend}>{statuses.map(status => <Text key={status} style={[styles.caption, { color: statusColor(status) }]}>{statusName(status)}</Text>)}</View>
      <Text style={[styles.caption, { color: colors.muted }]}>Markers show saved attendance decisions. Unmarked dates stay unrecorded.</Text>
    </View>
    {selectedDate ? rows.length ? rows.map(record => <SavedRecordDetail key={record.id} record={record} />) : <Empty title={`No saved attendance for ${selectedDate}`} message="Missing records are not counted as absence." /> : <Text style={[styles.caption, { color: colors.muted }]}>Select a date to review its saved attendance record.</Text>}
  </View>;
}

const styles = StyleSheet.create({
  calendar: { padding: 16, borderRadius: themeRadii.radiusCard, gap: 12 }, legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, caption: { fontSize: 14, lineHeight: 21 },
});
