import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useOperatingPaneDimensions } from '../../ui/OperatingPane';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { useTheme } from '../../ui/theme';
import { Icon } from '../../ui/Icon';
import { DomainText } from '../ResourcesScreen';

export const insightNumber = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-IN', { maximumFractionDigits: 1 }) : '—';
export const insightPercent = (value: number | null | undefined) => value == null ? '—' : `${insightNumber(value)}%`;
export function InsightMetric({ value, label }: { value: string; label: string }) {
  const { colors } = useTheme();
  return <View style={styles.metric}><Text style={[styles.metricValue, { color: colors.ink }]}>{value}</Text><Text style={[styles.metricLabel, { color: colors.muted }]}>{label}</Text></View>;
}
export function InsightPanel({ title, icon, onPress, children }: { title: string; icon?: string; onPress?: () => void; children: ReactNode }) {
  const { colors } = useTheme();
  const contents = <><View style={styles.heading}>{icon ? <Icon name={icon} size={24} area="insights" /> : null}<Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{title}</Text>{onPress ? <Icon name="chevron" size={18} muted /> : null}</View>{children}</>;
  const panel = [styles.panel, { borderColor: onPress ? 'transparent' : colors.border, backgroundColor: onPress ? colors.row : colors.surface }];
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={`Explore ${title}`} onPress={onPress} style={({ pressed }) => [...panel, { opacity: pressed ? .7 : 1 }]}>{contents}</Pressable> : <View style={panel}>{contents}</View>;
}
export function InsightKpis({ items, onPress }: { items: { label: string; value: string }[]; onPress: () => void }) {
  const { colors } = useTheme(), { width } = useOperatingPaneDimensions();
  return <View style={styles.kpis}>{items.map(item => <Pressable key={item.label} accessibilityRole="button" accessibilityLabel={`${item.label}, ${item.value}; open institution snapshot`} onPress={onPress} style={({ pressed }) => [styles.kpi, { flexBasis: width >= 380 ? '46%' : '100%', backgroundColor: colors.row, opacity: pressed ? .7 : 1 }]}><Text style={[styles.kpiValue, { color: colors.ink }]}>{item.value}</Text><DomainText>{item.label}</DomainText></Pressable>)}</View>;
}
export function InsightMeter({ value, label }: { value: number | null; label: string }) {
  const { colors } = useTheme();
  return value !== null ? <View accessible accessibilityLabel={`${label}: ${insightPercent(value)}`} style={[styles.meter, { backgroundColor: colors.surfaceSoft }]}><View style={[styles.meterFill, { width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: colors.action }]} /></View> : null;
}
export function InsightBars({ rows, reference }: { rows: { name: string; value: number | null; detail?: string }[]; reference?: number | null }) {
  const { colors } = useTheme();
  return <View style={styles.bars}>{rows.map((row, index) => <View key={`${index}:${row.name}`} style={{ gap: 6 }}><View style={styles.barLabel}><Text style={[styles.barName, { color: colors.ink }]}>{row.name}</Text><Text style={[styles.barValue, { color: colors.ink }]}>{insightPercent(row.value)}</Text></View><View style={[styles.meter, { backgroundColor: colors.canvas }]}>{row.value !== null ? <View style={[styles.meterFill, { width: `${Math.max(0, Math.min(100, row.value))}%`, backgroundColor: colors.action }]} /> : null}{reference !== undefined && reference !== null ? <View style={{ position: 'absolute', top: -3, bottom: -3, width: 2, left: `${Math.max(0, Math.min(100, reference))}%`, backgroundColor: colors.muted }} /> : null}</View>{row.detail ? <DomainText>{row.detail}</DomainText> : null}</View>)}</View>;
}
export interface InsightSlice { label: string; value: number; tone?: 'action' | 'positive' | 'warning' | 'muted' | 'danger' }
export function InsightDonut({ label, slices, compact = false }: { label: string; slices: InsightSlice[]; compact?: boolean }) {
  const { colors } = useTheme(), size = compact ? 112 : 144, radius = 43, circumference = Math.PI * radius * 2;
  const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0);
  const palette = { action: colors.action, positive: colors.positive, warning: colors.warning, muted: colors.muted, danger: colors.danger };
  let offset = 0;
  return <View style={styles.donut}><View accessible accessibilityLabel={`${label}: ${slices.map(slice => `${slice.label} ${insightNumber(slice.value)}`).join(', ')}`} style={{ width: size, height: size }}><Svg accessible={Platform.OS === 'web' ? undefined : false} aria-hidden={Platform.OS === 'web' ? true : undefined} width={size} height={size} viewBox="0 0 110 110"><Circle cx={55} cy={55} r={radius} fill="none" stroke={colors.border} strokeWidth={12} />{total ? slices.map((slice, index) => { const length = Math.max(0, slice.value) / total * circumference, start = offset; offset += length; return length ? <Circle key={index} cx={55} cy={55} r={radius} fill="none" stroke={palette[slice.tone ?? 'action']} strokeWidth={12} strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-start} transform="rotate(-90 55 55)" /> : null; }) : null}</Svg><View accessible={false} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.ink, fontSize: compact ? 22 : 28, fontWeight: '700' }}>{insightNumber(total)}</Text><Text style={{ color: colors.muted, fontSize: 12 }}>total</Text></View></View><View style={{ flex: 1, minWidth: 120, gap: 9 }}>{slices.map((slice, index) => <View key={index} style={styles.legend}><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: palette[slice.tone ?? 'action'] }} /><Text style={{ flex: 1, color: colors.muted, fontSize: 14, lineHeight: 20 }}>{slice.label}</Text><Text style={{ color: colors.ink, fontWeight: '600', fontSize: 14 }}>{insightNumber(slice.value)}</Text></View>)}</View></View>;
}
export function InsightDistribution({ counts }: { counts: number[] }) {
  const { colors } = useTheme(), max = Math.max(1, ...counts), labels = ['<20%', '20–<40%', '40–<60%', '60–<80%', '80–100%'];
  return <View accessible accessibilityLabel={counts.map((count, index) => `${labels[index] ?? `Band ${index + 1}`}: ${count} scored results`).join(', ')} style={styles.columns}>{counts.map((count, index) => <View key={index} accessible={false} style={styles.column}><Text style={{ color: colors.ink, fontWeight: '600', fontSize: 14 }}>{insightNumber(count)}</Text><View style={[styles.columnTrack, { borderBottomColor: colors.border }]}><View style={{ width: '72%', height: `${Math.max(0, count) / max * 100}%`, backgroundColor: colors.action, borderTopLeftRadius: 4, borderTopRightRadius: 4 }} /></View><Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center' }}>{labels[index] ?? `Band ${index + 1}`}</Text></View>)}</View>;
}
export function InsightCoverageWeek({ days }: { days: { date: string; planned: number; unassigned: number }[] }) {
  const { colors } = useTheme();
  return <View style={styles.week}>{days.map(day => <View key={day.date} style={{ flex: 1, alignItems: 'center', gap: 6 }}><View accessible accessibilityLabel={`${day.date}: ${day.planned - day.unassigned} of ${day.planned} periods assigned`} style={{ height: 62, width: '70%', justifyContent: 'flex-end', backgroundColor: colors.canvas, borderRadius: 4, overflow: 'hidden' }}><View style={{ height: `${day.planned ? Math.max(0, (day.planned - day.unassigned) / day.planned) * 100 : 0}%`, backgroundColor: colors.action }} /></View><Text style={{ color: colors.muted, fontSize: 12 }}>{new Date(`${day.date}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' })}</Text></View>)}</View>;
}
export function AttendanceSpark({ data, minimum }: { data: { date: string; percentage: number | null }[]; minimum?: number }) {
  const { colors } = useTheme(), recent = data.slice(-12), segments: string[][] = [[]];
  recent.forEach((item, index) => { if (item.percentage === null) { if (segments.at(-1)!.length) segments.push([]); } else segments.at(-1)!.push(`${10 + index * 220 / Math.max(1, recent.length - 1)},${70 - Math.max(0, Math.min(100, item.percentage)) * .6}`); });
  return recent.some(item => item.percentage !== null) ? <View accessible accessibilityLabel={`Recent recorded attendance: ${recent.map(item => `${item.date} ${insightPercent(item.percentage)}`).join(', ')}${minimum !== undefined ? `; minimum ${minimum}%` : ''}`}><Svg accessible={Platform.OS === 'web' ? undefined : false} aria-hidden={Platform.OS === 'web' ? true : undefined} width="100%" height={90} viewBox="0 0 240 90" preserveAspectRatio="none">{minimum !== undefined ? <Polyline points={`10,${70 - minimum * .6} 230,${70 - minimum * .6}`} stroke={colors.warning} strokeWidth={1} strokeDasharray="4 4" fill="none" /> : null}{segments.filter(points => points.length > 1).map((points, index) => <Polyline key={index} points={points.join(' ')} stroke={colors.action} strokeWidth={2.5} fill="none" />)}{recent.map((item, index) => item.percentage !== null ? <Circle key={item.date} cx={10 + index * 220 / Math.max(1, recent.length - 1)} cy={70 - Math.max(0, Math.min(100, item.percentage)) * .6} r={2.5} fill={colors.action} /> : null)}</Svg></View> : null;
}
const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderRadius: 24, padding: 16, gap: 12, minWidth: 0 }, heading: { flexDirection: 'row', alignItems: 'center', gap: 10 }, title: { flex: 1, fontSize: 20, fontWeight: '600', lineHeight: 28 },
  metric: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }, metricValue: { fontSize: 36, lineHeight: 43, fontWeight: '700', letterSpacing: -1.2 }, metricLabel: { flexShrink: 1, fontSize: 14, lineHeight: 21 },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 }, kpi: { flexGrow: 1, minWidth: 0, minHeight: 132, borderRadius: 24, padding: 20, justifyContent: 'space-between', gap: 12 }, kpiValue: { fontSize: 36, lineHeight: 42, fontWeight: '700', letterSpacing: -1 },
  meter: { height: 8, borderRadius: 4, position: 'relative' }, meterFill: { height: 8, borderRadius: 4 }, bars: { gap: 12 }, barLabel: { flexDirection: 'row', gap: 12, justifyContent: 'space-between' }, barName: { flex: 1, fontSize: 14, lineHeight: 21 }, barValue: { fontSize: 14, lineHeight: 21, fontWeight: '600' },
  donut: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 16 }, legend: { flexDirection: 'row', alignItems: 'center', gap: 8 }, columns: { flexDirection: 'row', gap: 8, paddingTop: 8 }, column: { flex: 1, minWidth: 0, alignItems: 'center', gap: 8 }, columnTrack: { height: 104, width: '100%', alignItems: 'center', justifyContent: 'flex-end', borderBottomWidth: 1 }, week: { flexDirection: 'row', gap: 6, paddingVertical: 4 },
});
