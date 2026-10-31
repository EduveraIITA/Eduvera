import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CaretDownIcon } from 'phosphor-react-native/src/icons/CaretDown';
import { useTheme } from './theme';

/** A labelled row opens the existing native date/time picker. */
export function TemporalValueControl({ label, accessibilityLabel, value, disabled, onPress }: { label: string; accessibilityLabel: string; value: string; disabled?: boolean; onPress(): void }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={`${accessibilityLabel}: ${value}`} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.row, { opacity: disabled ? .45 : pressed ? .65 : 1 }]}>
    <Text style={[styles.label, { color: colors.muted }]}>{label}</Text><View style={styles.value}><Text style={[styles.text, { color: colors.link }]}>{value}</Text><View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><CaretDownIcon size={16} color={colors.muted} /></View></View>
  </Pressable>;
}
const styles = StyleSheet.create({ row: { minHeight: 48, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 16, rowGap: 4, paddingVertical: 8 }, label: { fontSize: 16, lineHeight: 24 }, value: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, gap: 8 }, text: { fontSize: 16, lineHeight: 24, fontWeight: '500', flexShrink: 1 } });
