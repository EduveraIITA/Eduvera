import { useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Icon } from './Icon';
import { useTheme } from './theme';
import { themeRadii } from './theme-tokens';

/** Compact attendance controls retain 44-point targets without using action buttons as filters. */
export function AttendanceIconButton({ label, icon, onPress, expanded, disabled = false }: { label: string; icon: string; onPress: () => void; expanded?: boolean; disabled?: boolean }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, ...(expanded === undefined ? {} : { expanded }) }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.iconButton, { backgroundColor: colors.row, opacity: disabled ? 0.45 : pressed ? 0.65 : 1 }]}><Icon name={icon} size={20} muted={disabled} /></Pressable>;
}

export function AttendanceChoice({ label, selected, onPress, disabled = false }: { label: string; selected: boolean; onPress: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.choice, { backgroundColor: selected ? colors.action : colors.row, borderColor: selected ? colors.action : colors.border, opacity: disabled ? 0.45 : pressed ? 0.7 : 1 }]}><Text style={[styles.choiceLabel, { color: selected ? colors.onAction : colors.ink }]}>{label}</Text></Pressable>;
}

export function AttendanceDateBar({ date, onChange, onToday, disabled = false, children }: { date: string; onChange: (date: string) => void; onToday?: () => void; disabled?: boolean; children?: ReactNode }) {
  const { colors, dark } = useTheme();
  const [pickerOpen, setPickerOpen] = useState(false);
  const parts = date.split('-').map(Number), selected = new Date(parts[0] ?? 0, (parts[1] ?? 1) - 1, parts[2] ?? 1, 12);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(selected.getTime()) && selected.getFullYear() === parts[0] && selected.getMonth() + 1 === parts[1] && selected.getDate() === parts[2];
  const shift = (days: number) => { const next = new Date(`${date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + days); onChange(next.toISOString().slice(0, 10)); };
  return <View style={styles.dateGroup}>
    <View style={styles.dateBar}>
      <Pressable accessibilityRole="button" accessibilityLabel={valid ? `Choose attendance date, ${selected.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}` : 'Attendance date unavailable'} accessibilityState={{ expanded: pickerOpen, disabled: disabled || !valid }} disabled={disabled || !valid} onPress={() => setPickerOpen(value => !value)} style={({ pressed }) => [styles.dateLabel, { opacity: disabled ? 0.45 : pressed ? 0.65 : 1 }]}><Text style={[styles.dateText, { color: colors.ink }]}>{valid ? selected.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : 'Date unavailable'}</Text><View style={{ transform: [{ rotate: pickerOpen ? '-90deg' : '90deg' }] }}><Icon name="chevron" size={14} muted /></View></Pressable>
      <View style={styles.dateActions}>
        <AttendanceIconButton label="Previous attendance day" icon="back" disabled={disabled || !valid} onPress={() => shift(-1)} />
        {onToday ? <Pressable accessibilityRole="button" disabled={disabled} accessibilityState={{ disabled }} onPress={() => { setPickerOpen(false); onToday(); }} style={({ pressed }) => [styles.today, { opacity: disabled ? 0.45 : pressed ? 0.65 : 1 }]}><Text style={[styles.choiceLabel, { color: colors.link }]}>Today</Text></Pressable> : null}
        <AttendanceIconButton label="Next attendance day" icon="arrow" disabled={disabled || !valid} onPress={() => shift(1)} />
        {children}
      </View>
    </View>
    {pickerOpen && valid && !disabled ? <DateTimePicker accessibilityLabel="Select attendance date" mode="date" display={Platform.OS === 'ios' ? 'inline' : 'default'} themeVariant={dark ? 'dark' : 'light'} accentColor={colors.action} value={selected} onChange={(_event, value) => { setPickerOpen(false); if (value) onChange(`${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`); }} /> : null}
  </View>;
}

export function AttendanceSearch({ value, onChangeText, onSubmit, label, placeholder, autoFocus = false }: { value: string; onChangeText: (value: string) => void; onSubmit?: () => void; label: string; placeholder: string; autoFocus?: boolean }) {
  const { colors } = useTheme();
  return <View style={[styles.search, { backgroundColor: colors.row, borderColor: colors.border }]}><Icon name="search" size={20} muted /><TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.muted} autoCorrect={false} autoCapitalize="none" autoFocus={autoFocus} maxLength={120} returnKeyType="search" onSubmitEditing={onSubmit} style={[styles.searchInput, { color: colors.ink }]} />{value ? <AttendanceIconButton label={`Clear ${label.toLowerCase()}`} icon="close" onPress={() => onChangeText('')} /> : null}{onSubmit ? <AttendanceIconButton label={`Search ${label.toLowerCase()}`} icon="arrow" onPress={onSubmit} /> : null}</View>;
}

const styles = StyleSheet.create({
  iconButton: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: themeRadii.radiusControl },
  choice: { minHeight: 44, borderWidth: 1, borderRadius: themeRadii.radiusControl, paddingVertical: 10, paddingHorizontal: 10, justifyContent: 'center', alignItems: 'center' },
  choiceLabel: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  dateGroup: { gap: 8 }, dateBar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  dateLabel: { flex: 1, minWidth: 100, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 }, dateText: { flexShrink: 1, fontSize: 15, lineHeight: 21, fontWeight: '700' },
  dateActions: { flexDirection: 'row', alignItems: 'center', gap: 0 }, today: { minWidth: 44, minHeight: 44, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  search: { minHeight: 50, minWidth: 0, borderWidth: 1, borderRadius: themeRadii.radiusControl, flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingRight: 3, gap: 6 },
  searchInput: { flex: 1, minWidth: 0, minHeight: 48, paddingVertical: 10, fontSize: 16 },
});
