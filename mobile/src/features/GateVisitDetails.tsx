import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CaretRightIcon } from 'phosphor-react-native/src/icons/CaretRight';
import { CheckCircleIcon } from 'phosphor-react-native/src/icons/CheckCircle';
import { InfoIcon } from 'phosphor-react-native/src/icons/Info';
import { MapPinIcon } from 'phosphor-react-native/src/icons/MapPin';
import { ShareIcon } from 'phosphor-react-native/src/icons/Share';
import { SignInIcon } from 'phosphor-react-native/src/icons/SignIn';
import { SignOutIcon } from 'phosphor-react-native/src/icons/SignOut';
import { XCircleIcon } from 'phosphor-react-native/src/icons/XCircle';
import type { ArrangedVisit } from '../../../packages/contracts/src/wire/features/gate/visitApi';
import type { SharedVisit } from '../../../packages/contracts/src/wire/features/gate/visitSharingApi';
import { BrandLoadingIcon } from '../ui/AssistantMark';
import { Icon } from '../ui/Icon';
import { useTheme } from '../ui/theme';
import { productIconAppearance, themeRadii } from '../ui/theme-tokens';

type Visit = ArrangedVisit | SharedVisit;

export function VisitDetailHeader({ visit }: { visit: Visit }) {
  const { colors } = useTheme(), purpose = visit.title.trim();
  const eyebrow = purpose ? /\bvisit$/i.test(purpose) ? purpose : `${purpose} visit` : 'Visit';
  const confirmed = visit.state === 'confirmed', cancelled = visit.state === 'cancelled';
  const status = confirmed ? 'Arrangement confirmed' : cancelled ? 'Visit cancelled' : 'Arrangement status unavailable';
  const statusColor = confirmed ? colors.positive : cancelled ? colors.danger : colors.muted;
  const StatusIcon = confirmed ? CheckCircleIcon : cancelled ? XCircleIcon : InfoIcon;
  const people = Number.isSafeInteger(visit.party_size) && visit.party_size > 0 ? `${visit.party_size} ${visit.party_size === 1 ? 'person' : 'people'} expected` : 'Expected people unavailable';
  return <View style={styles.header}>
    <View style={styles.heading}>
      <Text accessibilityLabel={eyebrow} style={[styles.eyebrow, { color: colors.muted }]}>{eyebrow.toUpperCase()}</Text>
      <Text accessibilityRole="header" aria-level={1} style={[styles.title, { color: colors.ink }]}>{visit.guest_label}</Text>
    </View>
    <View style={styles.summaryRow}><View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><StatusIcon size={24} color={statusColor} weight={confirmed || cancelled ? 'fill' : 'regular'} /></View><Text style={[styles.status, { color: statusColor }]}>{status}</Text></View>
    <View style={styles.summaryRow}><View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Icon name="people" size={24} /></View><Text style={[styles.people, { color: colors.muted }]}>{people}</Text></View>
  </View>;
}

/** These are owning-server instants in an explicit campus zone, never device-local dates. */
function campusTime(value: string, timezone: string): { date: string; time: string; zone: string } | null {
  const zone = timezone.trim();
  if (!zone || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || !Number.isFinite(Date.parse(value))) return null;
  try {
    const instant = new Date(value);
    return {
      date: new Intl.DateTimeFormat('en-GB', { timeZone: zone, day: 'numeric', month: 'short', year: 'numeric' }).format(instant),
      time: new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: true }).format(instant),
      zone,
    };
  } catch { return null; }
}

function DetailRow({ label, value, marker, children, separator = false, onPress, spokenValue = value }: { label: string; value: string; marker: ReactNode; children?: ReactNode; separator?: boolean; onPress?: () => void; spokenValue?: string }) {
  const { colors } = useTheme();
  const content = <><View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{marker}</View><View style={styles.rowBody}><Text style={[styles.rowLabel, { color: colors.muted }]}>{label}</Text>{children ?? <Text style={[styles.rowValue, { color: colors.ink }]}>{value}</Text>}</View>{onPress ? <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><CaretRightIcon size={20} color={colors.muted} /></View> : null}</>;
  const rowStyle = [styles.row, { borderTopWidth: separator ? StyleSheet.hairlineWidth : 0, borderColor: colors.border }];
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={`${label}, ${spokenValue}`} onPress={onPress} style={({ pressed }) => [...rowStyle, { opacity: pressed ? .65 : 1 }]}>{content}</Pressable> : <View accessible accessibilityLabel={`${label}, ${spokenValue}`} style={rowStyle}>{content}</View>;
}

export function VisitDetailCard({ visit, timezone, onContactPress, onPlacePress }: { visit: { starts_at: string; ends_at: string; place: { label: string }; contact?: { label: string } }; timezone: string; onContactPress?: () => void; onPlacePress?: () => void }) {
  const { colors, dark } = useTheme(), plan = productIconAppearance('gate', colors, dark), contact = productIconAppearance('people', colors, dark);
  const initials = (visit.contact?.label ?? '').trim().split(/\s+/).filter(Boolean), contactInitials = [initials[0], initials.length > 1 ? initials[initials.length - 1] : undefined].filter(Boolean).map(part => Array.from(part!)[0]).join('').toUpperCase();
  const timeRow = (label: string, value: string, separator: boolean) => {
    const timing = campusTime(value, timezone), unavailable = 'Campus time unavailable';
    const TimingIcon = separator ? SignOutIcon : SignInIcon;
    return <DetailRow label={label} value={timing?.date ?? unavailable} spokenValue={timing ? `${timing.date}, ${timing.time}, ${timing.zone}` : unavailable} separator={separator} marker={<View style={styles.marker}><TimingIcon size={24} color={plan.ink} weight="regular" /></View>}>
      <View style={styles.dateLine}><Text style={[styles.date, { color: colors.ink }]}>{timing?.date ?? unavailable}</Text>{timing ? <Text style={[styles.time, { color: colors.muted }]}>{timing.time}</Text> : null}</View>
    </DetailRow>;
  };
  return <View style={[styles.card, { backgroundColor: colors.row, borderColor: colors.border }]}>
    {timeRow('Starts', visit.starts_at, false)}
    {timeRow('Ends', visit.ends_at, true)}
    <DetailRow label="Destination" value={visit.place.label} separator onPress={onPlacePress} marker={<View style={styles.marker}><MapPinIcon size={24} color={plan.ink} weight="regular" /></View>} />
    {visit.contact ? <DetailRow label="Campus contact" value={visit.contact.label} separator onPress={onContactPress} marker={<View style={[styles.marker, { backgroundColor: contact.fill }]}><Text allowFontScaling={false} style={[styles.initials, { color: contact.ink }]}>{contactInitials}</Text></View>} /> : null}
  </View>;
}

export function VisitPlanNotice() {
  const { colors } = useTheme();
  return <View style={styles.planNotice}><View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><InfoIcon size={22} color={colors.muted} /></View><Text style={[styles.planText, { color: colors.muted }]}>This arrangement is a plan. It does not grant entry, reserve a room or prove attendance.</Text></View>;
}

export function VisitPrimaryAction({ onPress, disabled, busy, title = 'Invite visitors' }: { onPress(): void; disabled?: boolean; busy?: boolean; title?: string }) {
  const { colors } = useTheme(), inactive = !!disabled || !!busy;
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: inactive, busy }} disabled={inactive} onPress={onPress} style={({ pressed }) => [styles.primaryAction, { backgroundColor: colors.action, opacity: inactive ? .5 : pressed ? .75 : 1 }]}>
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{busy ? <BrandLoadingIcon onFilledAction size={22} /> : <ShareIcon size={24} color={colors.onAction} weight="bold" />}</View><Text style={[styles.primaryLabel, { color: colors.onAction }]}>{title}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  header: { gap: 12, marginTop: 8, marginBottom: 12 }, heading: { gap: 8 },
  eyebrow: { fontSize: 13, lineHeight: 18, fontWeight: '600', letterSpacing: 1 }, title: { fontSize: 36, lineHeight: 44, fontWeight: '700', letterSpacing: -1 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, status: { flex: 1, minWidth: 0, fontSize: 16, lineHeight: 24, fontWeight: '600' }, people: { flex: 1, minWidth: 0, fontSize: 16, lineHeight: 24 },
  card: { borderRadius: themeRadii.radiusCard, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { minHeight: 80, flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16 }, marker: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, minWidth: 0, gap: 2 }, rowLabel: { fontSize: 14, lineHeight: 20 }, rowValue: { fontSize: 16, lineHeight: 24, fontWeight: '600', flexShrink: 1 },
  dateLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: 12, rowGap: 4 }, date: { flexGrow: 1, maxWidth: '100%', fontSize: 16, lineHeight: 24, fontWeight: '600' }, time: { flexGrow: 1, maxWidth: '100%', fontSize: 16, lineHeight: 24, textAlign: 'right' }, initials: { fontSize: 16, lineHeight: 20, fontWeight: '600' },
  planNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12 }, planText: { flex: 1, minWidth: 0, fontSize: 14, lineHeight: 21 },
  primaryAction: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 20, borderRadius: themeRadii.radiusControl }, primaryLabel: { flexShrink: 1, fontSize: 16, lineHeight: 24, fontWeight: '600', textAlign: 'center' },
});
