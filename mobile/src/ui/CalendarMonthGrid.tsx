import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { nativeCalendarMonthCells } from '../lib/native-calendar';
import { useTheme } from './theme';

export interface CalendarDayInfo {
  label?: string;
  markers?: readonly { key: string; color: string }[];
  disabled?: boolean;
}
export interface CalendarMonthGridProps {
  date: string;
  today: string;
  onDateChange: (date: string) => void;
  getDayInfo?: (date: string) => CalendarDayInfo;
}

/** Monday-first display only; the owning feature supplies all date evidence. */
export function CalendarMonthGrid({ date, today, onDateChange, getDayInfo }: CalendarMonthGridProps) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const cells = useMemo(() => nativeCalendarMonthCells(date), [date]);
  const formatter = useMemo(() => new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), []);
  const weeks = Array.from({ length: cells.length / 7 }, (_, index) => cells.slice(index * 7, index * 7 + 7));
  const gridWidth = Math.max(308, width);
  return <View onLayout={event => setWidth(event.nativeEvent.layout.width)}><ScrollView horizontal showsHorizontalScrollIndicator={width < 308} contentContainerStyle={{ width: gridWidth }}><View style={styles.grid}>
    <View style={styles.week}>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <Text key={day} style={[styles.weekday, { color: colors.muted }]}>{day}</Text>)}</View>
    {weeks.map((week, index) => <View key={index} style={styles.week}>{week.map(cell => {
      const info = getDayInfo?.(cell.date), selected = cell.date === date, current = cell.date === today;
      const label = formatter.format(new Date(`${cell.date}T12:00:00Z`));
      return <Pressable key={cell.date} accessibilityRole="button" accessibilityLabel={[label, current ? 'Today' : null, info?.label].filter(Boolean).join(', ')} accessibilityState={{ selected, disabled: info?.disabled }} disabled={info?.disabled} onPress={() => onDateChange(cell.date)} style={({ pressed }) => [styles.day, { backgroundColor: selected ? colors.action : 'transparent', borderColor: current && !selected ? colors.link : 'transparent', opacity: info?.disabled ? .45 : pressed ? .7 : 1 }]}>
        <Text style={[styles.number, { color: selected ? colors.onAction : cell.inMonth ? colors.ink : colors.muted, fontWeight: selected || current ? '700' : '500' }]}>{Number(cell.date.slice(8, 10))}</Text>
        <View style={styles.markers}>{info?.markers?.slice(0, 5).map(marker => <View key={marker.key} style={[styles.mark, { backgroundColor: selected ? colors.onAction : marker.color }]} />)}</View>
      </Pressable>;
    })}</View>)}
  </View></ScrollView></View>;
}

const styles = StyleSheet.create({
  grid: { width: '100%', gap: 4 }, week: { flexDirection: 'row', gap: 0 },
  weekday: { flex: 1, minWidth: 44, textAlign: 'center', fontSize: 12, lineHeight: 18, paddingVertical: 4 },
  day: { flex: 1, minWidth: 44, minHeight: 48, borderWidth: 1, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  number: { fontSize: 14, lineHeight: 21 }, markers: { minHeight: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 }, mark: { width: 5, height: 5, borderRadius: 3 },
});
