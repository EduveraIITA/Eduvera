import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CheckIcon } from 'phosphor-react-native/src/icons/Check';
import { XIcon } from 'phosphor-react-native/src/icons/X';
import { CaretDownIcon } from 'phosphor-react-native/src/icons/CaretDown';
import { ChatTextIcon } from 'phosphor-react-native/src/icons/ChatText';
import { Field } from './components';
import { useTheme } from './theme';
import { themeRadii } from './theme-tokens';

export interface AttendanceStatusOption<TStatus extends string> { value: TStatus; label: string; tone?: 'positive' | 'negative' }
export interface AttendanceParticipantIdentity { id: string; name: string; identifier?: string | null; rollNumber?: string | number | null }

/** The same compact participant interaction serves each owning attendance adapter. */
export function AttendanceParticipantRow<TStatus extends string>({ participant, status, remarks, disabled, readOnly = false, conflict = false, context, statusOptions, quickStatuses, emptyLabel = 'Not recorded', noteMaxLength = 2000, onChange }: {
  participant: AttendanceParticipantIdentity; status: TStatus | null; remarks: string; disabled: boolean; readOnly?: boolean; conflict?: boolean; context?: string;
  statusOptions: readonly AttendanceStatusOption<TStatus>[]; quickStatuses?: readonly AttendanceStatusOption<TStatus>[]; emptyLabel?: string; noteMaxLength?: number;
  onChange?: (value: { status?: TStatus | null; remarks?: string }) => void;
}) {
  const { colors } = useTheme();
  const editingDisabled = disabled || !onChange;
  const [moreOpen, setMoreOpen] = useState(false), [noteOpen, setNoteOpen] = useState(false);
  const quick = quickStatuses ?? statusOptions.filter(option => option.value === 'present' || option.value === 'absent').map(option => ({ ...option, tone: option.value === 'absent' ? 'negative' as const : 'positive' as const }));
  const quickValues = new Set(quick.map(option => option.value)), other = statusOptions.filter(option => !quickValues.has(option.value));
  const chosen = statusOptions.find(option => option.value === status), isOther = status !== null && !quickValues.has(status);
  const statusColor = status === 'present' || status === 'excused' ? colors.positive : status === 'absent' ? colors.danger : status ? colors.warning : colors.muted;
  const initials = participant.name.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join('');
  const identityContext = [participant.rollNumber !== undefined && participant.rollNumber !== null ? `Roll ${String(participant.rollNumber).padStart(2, '0')}` : '', participant.identifier, context].filter(Boolean).join(' · ');
  return <View style={[styles.card, { backgroundColor: conflict ? colors.warningSoft : colors.row, borderColor: conflict ? colors.warning : 'transparent', borderWidth: conflict ? 1 : 0 }]}>
    <View style={styles.identityRow}>
      <View accessible={false} style={[styles.avatar, { backgroundColor: colors.canvas }]}><Text style={[styles.initials, { color: colors.link }]}>{initials}</Text></View>
      <View style={styles.identity}><Text accessibilityRole="header" style={[styles.name, { color: colors.ink }]}>{participant.name}</Text>{identityContext ? <Text style={[styles.context, { color: colors.muted }]}>{identityContext}</Text> : null}{readOnly || status !== null ? <Text style={[styles.context, { color: statusColor }]}>{chosen?.label ?? emptyLabel}</Text> : null}{conflict ? <Text style={[styles.context, { color: colors.warning }]}>Review concurrent change</Text> : null}</View>
      {!readOnly ? <Pressable accessibilityRole="button" accessibilityLabel={`${noteOpen ? 'Hide' : remarks ? 'View' : 'Add'} note for ${participant.name}`} accessibilityState={{ expanded: noteOpen, disabled: editingDisabled && !remarks }} disabled={editingDisabled && !remarks} onPress={() => setNoteOpen(value => !value)} style={({ pressed }) => [styles.noteToggle, { backgroundColor: noteOpen || remarks ? colors.canvas : 'transparent', opacity: pressed ? 0.65 : 1 }]}><ChatTextIcon size={18} color={noteOpen || remarks ? colors.link : colors.muted} /></Pressable> : null}
    </View>
    {readOnly ? remarks ? <Text style={[styles.noteText, { color: colors.muted }]}>{remarks}</Text> : null : <>
      <View accessibilityRole="summary" accessibilityLabel={`Mark attendance for ${participant.name}`} style={styles.choices}>
        {quick.map(option => { const selected = status === option.value, negative = option.tone === 'negative'; const foreground = selected ? negative ? colors.danger : colors.positive : colors.muted; return <Pressable key={option.value} accessibilityRole="button" accessibilityLabel={`${participant.name}: ${option.label}`} accessibilityState={{ selected, disabled: editingDisabled }} disabled={editingDisabled} onPress={() => onChange?.({ status: option.value })} style={({ pressed }) => [styles.choice, { borderColor: selected ? foreground : colors.border, backgroundColor: selected ? negative ? colors.dangerSoft : colors.positiveSoft : colors.canvas, opacity: editingDisabled ? 0.5 : pressed ? 0.7 : 1 }]}>{negative ? <XIcon size={16} color={foreground} /> : <CheckIcon size={16} color={foreground} />}<Text style={[styles.choiceLabel, { color: foreground }]}>{option.label}</Text></Pressable>; })}
        <Pressable accessibilityRole="button" accessibilityLabel={`More attendance statuses for ${participant.name}${isOther && chosen ? `, ${chosen.label} selected` : ''}`} accessibilityState={{ expanded: moreOpen, selected: isOther, disabled: editingDisabled }} disabled={editingDisabled} onPress={() => setMoreOpen(value => !value)} style={({ pressed }) => [styles.choice, { backgroundColor: isOther ? status === 'excused' ? colors.positiveSoft : colors.warningSoft : colors.canvas, borderColor: isOther ? statusColor : colors.border, opacity: editingDisabled ? 0.5 : pressed ? 0.7 : 1 }]}><Text style={[styles.choiceLabel, { color: isOther ? statusColor : colors.muted }]}>{isOther ? chosen?.label ?? emptyLabel : 'More'}</Text><CaretDownIcon size={14} color={isOther ? statusColor : colors.muted} /></Pressable>
      </View>
      {moreOpen ? <View style={[styles.moreChoices, { borderColor: colors.border }]}>{other.map(option => <Pressable key={option.value} accessibilityRole="button" accessibilityLabel={`${participant.name}: ${option.label}`} accessibilityState={{ selected: status === option.value, disabled: editingDisabled }} disabled={editingDisabled} onPress={() => { onChange?.({ status: option.value }); setMoreOpen(false); }} style={({ pressed }) => [styles.extraChoice, { backgroundColor: status === option.value ? colors.warningSoft : colors.canvas, borderColor: status === option.value ? colors.warning : colors.border, opacity: pressed ? 0.7 : 1 }]}><Text style={[styles.choiceLabel, { color: status === option.value ? colors.warning : colors.ink }]}>{option.label}</Text></Pressable>)}<Pressable accessibilityRole="button" accessibilityLabel={`Clear attendance for ${participant.name}`} accessibilityState={{ selected: status === null, disabled: editingDisabled }} disabled={editingDisabled} onPress={() => { onChange?.({ status: null }); setMoreOpen(false); }} style={({ pressed }) => [styles.extraChoice, { borderColor: colors.border, backgroundColor: colors.canvas, opacity: pressed ? 0.7 : 1 }]}><Text style={[styles.choiceLabel, { color: colors.muted }]}>Clear · {emptyLabel.toLowerCase()}</Text></Pressable></View> : null}
      {noteOpen ? <Field label={`Note for ${participant.name}`} value={remarks} onChangeText={value => onChange?.({ remarks: value })} editable={!editingDisabled} maxLength={noteMaxLength} placeholder="Add a short note (optional)" autoFocus={!editingDisabled} /> : null}
    </>}
  </View>;
}

const styles = StyleSheet.create({
  card: { padding: 16, borderRadius: themeRadii.radiusRow, gap: 12 },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, initials: { fontSize: 14, fontWeight: '700' },
  identity: { flex: 1, minWidth: 0, gap: 3 }, name: { fontSize: 16, lineHeight: 23, fontWeight: '600' }, context: { fontSize: 14, lineHeight: 21 },
  noteToggle: { width: 44, minHeight: 44, borderRadius: themeRadii.radiusControl, alignItems: 'center', justifyContent: 'center' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, choice: { flexGrow: 1, flexBasis: 80, minWidth: 0, minHeight: 44, borderWidth: 1, borderRadius: themeRadii.radiusControl, paddingHorizontal: 8, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  choiceLabel: { flexShrink: 1, fontSize: 14, lineHeight: 20, fontWeight: '600', textAlign: 'center' },
  moreChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 }, extraChoice: { minHeight: 44, borderWidth: 1, borderRadius: themeRadii.radiusControl, paddingHorizontal: 12, paddingVertical: 10, justifyContent: 'center' },
  noteText: { fontSize: 14, lineHeight: 21 },
});
