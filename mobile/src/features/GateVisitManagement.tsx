import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PencilSimpleIcon } from 'phosphor-react-native/src/icons/PencilSimple';
import { SignInIcon } from 'phosphor-react-native/src/icons/SignIn';
import { SignOutIcon } from 'phosphor-react-native/src/icons/SignOut';
import { XCircleIcon } from 'phosphor-react-native/src/icons/XCircle';
import { CaretRightIcon } from 'phosphor-react-native/src/icons/CaretRight';
import type { VisitDetail } from '../../../packages/contracts/src/wire/features/gate/visitApi';
import { useOperationContext } from '../lib/use-operation-context';
import { Alert } from '../ui/Alert';
import { SegmentedControl } from '../ui/DomainControls';
import { Button, Field, Section } from '../ui/components';
import { useTheme } from '../ui/theme';
import { productIconAppearance, themeRadii } from '../ui/theme-tokens';

import { GateVisitHistory } from './GateVisitHistory';

type Direction = 'in' | 'out';
interface Props {
  href: string; detail: VisitDetail; locked: boolean; count: string;
  onCount(value: string): void; when(value: string): string; timezone: string;
  onEdit(): void; onRecord(direction: Direction, count: number): void; onCancel(): void;
}

/** Plan changes and physical observations are separate decisions, always visible. */
export function GateVisitManagement({ href, detail, locked, count, onCount, when, timezone, onEdit, onRecord, onCancel }: Props) {
  const { colors, dark } = useTheme(), accent = productIconAppearance('gate', colors, dark);
  const [choice, setChoice] = useState<Direction>('in');
  const direction = choice === 'in' && detail.can_record_arrival || !detail.can_record_exit ? 'in' : 'out';
  const options = [detail.can_record_arrival ? { value: 'in', label: 'Arrival' } : null, detail.can_record_exit ? { value: 'out', label: 'Exit' } : null].filter((value): value is { value: Direction; label: string } => !!value);
  const canRecord = options.some(option => option.value === direction), validCount = /^[1-9]\d{0,3}$/.test(count) && Number(count) <= 5000;
  const capture = useOperationContext(`${href}:visit-management`), mounted = useRef(true), attempt = useRef(0);
  const signature = JSON.stringify([detail.visit.id, detail.visit.revision, detail.can_cancel, detail.can_record_arrival, detail.can_record_exit, count, direction, locked]);
  const current = useRef(signature);
  if (current.current !== signature) { current.current = signature; attempt.current++; }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; attempt.current++; }; }, []);
  const confirm = (kind: 'movement' | 'cancel') => {
    if (locked || kind === 'movement' && (!canRecord || !validCount) || kind === 'cancel' && !detail.can_cancel) return;
    let assertCurrent: () => void;
    try { assertCurrent = capture(); } catch { return; }
    const reviewed = signature, token = ++attempt.current, number = Number(count);
    const noun = number === 1 ? 'person' : 'people', arrival = direction === 'in';
    Alert.alert(kind === 'cancel' ? 'Cancel this arrangement?' : `Record ${arrival ? 'arrival' : 'exit'}?`, kind === 'cancel'
      ? 'The plan will show as cancelled. Previous versions and observed movements are kept. Cancelling does not record an exit.'
      : `Confirm you observed ${number} ${noun} ${arrival ? 'arrive at' : 'leave'} the campus boundary. This records an observation, not live occupancy or attendance.`, [
      { text: kind === 'cancel' ? 'Keep visit' : 'Not now', style: 'cancel', onPress: () => { if (attempt.current === token) attempt.current++; } },
      { text: kind === 'cancel' ? 'Cancel visit' : `Record ${arrival ? 'arrival' : 'exit'}`, style: kind === 'cancel' ? 'destructive' : 'default', onPress: () => {
        try { assertCurrent(); } catch { return; }
        if (!mounted.current || attempt.current !== token || current.current !== reviewed) return;
        attempt.current++; // One confirmation cannot issue the observation twice.
        if (kind === 'cancel') onCancel(); else onRecord(direction, number);
      } },
    ]);
  };
  const movement = detail.visit.last_movement, MovementIcon = movement?.direction === 'out' ? SignOutIcon : SignInIcon;
  return <View style={styles.sections}>
    {detail.can_edit || detail.can_cancel ? <Section title="Manage visit"><View style={[styles.group, { backgroundColor: colors.row, borderColor: colors.border }]}>
      {detail.can_edit ? <Pressable accessibilityRole="button" accessibilityLabel="Edit visit" disabled={locked} accessibilityState={{ disabled: locked }} onPress={onEdit} style={({ pressed }) => [styles.actionRow, { opacity: locked ? .45 : pressed ? .65 : 1 }]}>
        <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><PencilSimpleIcon size={24} color={accent.ink} /></View><View style={styles.actionBody}><Text style={[styles.actionTitle, { color: colors.ink }]}>Edit visit</Text><Text style={[styles.support, { color: colors.muted }]}>Dates, expected people, place and contact</Text></View><View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><CaretRightIcon size={20} color={colors.muted} /></View>
      </Pressable> : null}
      {detail.can_cancel ? <Pressable accessibilityRole="button" accessibilityLabel="Cancel arrangement" disabled={locked} accessibilityState={{ disabled: locked }} onPress={() => confirm('cancel')} style={({ pressed }) => [styles.actionRow, { borderTopWidth: detail.can_edit ? StyleSheet.hairlineWidth : 0, borderColor: colors.border, opacity: locked ? .45 : pressed ? .65 : 1 }]}>
        <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><XCircleIcon size={24} color={colors.danger} /></View><View style={styles.actionBody}><Text style={[styles.actionTitle, { color: colors.danger }]}>Cancel arrangement</Text><Text style={[styles.support, { color: colors.muted }]}>Keep its history and recorded movements</Text></View>
      </Pressable> : null}
    </View></Section> : null}
    <Section title="Arrivals & exits">
      <View style={[styles.observation, { backgroundColor: colors.row, borderColor: colors.border }]}>
        <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><MovementIcon size={26} color={movement ? accent.ink : colors.muted} /></View>
        <View style={styles.actionBody}><Text style={[styles.actionTitle, { color: colors.ink }]}>{movement ? `${movement.direction === 'in' ? 'Arrival' : 'Exit'} · ${movement.observed_count} ${movement.observed_count === 1 ? 'person' : 'people'}` : 'No movement recorded'}</Text>
          <Text style={[styles.support, { color: colors.muted }]}>{movement ? when(movement.occurred_at) : 'A confirmed plan does not mean anyone has arrived.'}</Text>
          {movement ? <Text style={[styles.caption, { color: colors.muted }]}>Latest recorded observation</Text> : null}
        </View>
      </View>
      {canRecord ? <View style={styles.form}>
        <Text style={[styles.formTitle, { color: colors.ink }]}>Record movement</Text>
        <SegmentedControl label="Observed movement" value={direction} options={options} onChange={value => setChoice(value as Direction)} disabled={locked} />
        <Field label="People observed" placeholder="Enter observed count" value={count} onChangeText={onCount} keyboardType="number-pad" maxLength={4} editable={!locked} returnKeyType="done" selectTextOnFocus style={styles.countInput} />
        {count && !validCount ? <Text accessibilityLiveRegion="polite" style={[styles.support, { color: colors.danger }]}>Enter a whole count from 1 to 5,000.</Text> : null}
        <Text style={[styles.support, { color: colors.muted }]}>Count the people you observed at the boundary. This may differ from the {detail.visit.party_size} expected.</Text>
        <Button kind="secondary" title={`Record ${direction === 'in' ? 'arrival' : 'exit'}`} disabled={locked || !validCount} onPress={() => confirm('movement')} />
      </View> : null}
      <Text style={[styles.caption, { color: colors.muted }]}>Boundary records do not confirm attendance, meeting-room arrival or who is currently on campus.</Text>
    </Section>
    {detail.history?.length ? <GateVisitHistory visitId={detail.visit.id} entries={detail.history} hasMore={detail.history_has_more} timezone={timezone} when={when} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  sections: { gap: 20 }, group: { borderRadius: themeRadii.radiusCard, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  actionRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingVertical: 16 },
  actionBody: { flex: 1, minWidth: 0, gap: 4 }, actionTitle: { fontSize: 16, lineHeight: 24, fontWeight: '600' }, support: { fontSize: 14, lineHeight: 21 }, caption: { fontSize: 13, lineHeight: 20 },
  observation: { flexDirection: 'row', alignItems: 'flex-start', gap: 16, padding: 16, borderWidth: StyleSheet.hairlineWidth, borderRadius: themeRadii.radiusCard },
  form: { gap: 12, paddingTop: 12 }, formTitle: { fontSize: 16, lineHeight: 24, fontWeight: '600' }, countInput: { fontVariant: ['tabular-nums'] },
});
