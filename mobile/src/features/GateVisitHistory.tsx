import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { VisitHistory } from '../../../packages/contracts/src/wire/features/gate/visitApi';
import { useSession } from '../auth/SessionProvider';
import { ControlButton, Facts } from '../ui/DomainControls';
import { ListGroup, Notice, Row, Section } from '../ui/components';
import { MotionModal } from '../ui/Motion';
import { useTheme } from '../ui/theme';
import { VisitDetailCard } from './GateVisitDetails';

export function GateVisitHistory({ visitId, entries, hasMore, timezone, when }: {
  visitId: string; entries: VisitHistory[]; hasMore?: boolean; timezone: string; when(value: string): string;
}) {
  const { scopeKey } = useSession(), { colors } = useTheme(), focused = useIsFocused();
  const [selected, setSelected] = useState<{ owner: string; revision: number } | null>(null);
  const owner = JSON.stringify([scopeKey, visitId]);
  // The source owns immutable snapshots. Never reconstruct old labels from the
  // current visit, or carry a historical selection into another actor/world.
  useEffect(() => { if (!focused) setSelected(null); }, [focused]);
  const entry = focused && selected?.owner === owner ? entries.find(value => value.revision === selected.revision) : undefined;
  return <Section title="Visit history"><ListGroup inset>{entries.map((value, index) => <Row key={`${value.revision}:${value.action}`} title={historyTitle(value)} detail={`${value.actor.label}\n${when(value.recorded_at)}`} icon="history" variant="plain" separator={index > 0} onPress={() => setSelected({ owner, revision: value.revision })} />)}</ListGroup>
    {hasMore ? <Text style={[styles.caption, { color: colors.muted }]}>Showing the latest {entries.length} versions. Earlier history is retained.</Text> : null}
    <MotionModal visible={!!entry} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelected(null)}><SafeAreaProvider><SafeAreaView accessibilityViewIsModal style={[styles.sheet, { backgroundColor: colors.canvas }]}>
      <View style={styles.heading}><Text accessibilityRole="header" aria-level={2} style={[styles.title, { color: colors.ink }]}>{entry ? historyTitle(entry) : 'Visit history'}</Text><ControlButton title="Done" onPress={() => setSelected(null)} /></View>
      {entry ? <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.support, { color: colors.muted }]}>{entry.actor.label} · {when(entry.recorded_at)}</Text>
        <Facts items={[
          { label: 'Visitors', value: entry.guest_label ?? entry.guest_name ?? 'Recorded visitor identity unavailable' },
          { label: 'Purpose', value: entry.title }, { label: 'People expected', value: String(entry.party_size) },
          { label: 'Arrangement', value: entry.state === 'cancelled' ? 'Cancelled' : 'Confirmed' },
        ]} />
        <VisitDetailCard visit={{ starts_at: entry.starts_at, ends_at: entry.ends_at, place: { label: entry.place_label ?? 'Recorded destination unavailable' }, contact: { label: entry.contact_label ?? 'Recorded contact unavailable' } }} timezone={timezone} />
        {entry.last_movement ? <Section title={entry.action === 'movement_recorded' ? 'Recorded observation' : 'Last observation at this version'}><Facts items={[
          { label: 'Movement', value: entry.last_movement.direction === 'in' ? 'Arrival' : 'Exit' },
          { label: 'People observed', value: String(entry.last_movement.observed_count) },
          { label: 'Observed at', value: when(entry.last_movement.occurred_at) },
        ]} /></Section> : null}
        <Notice message="This is the saved record at that time. Viewing history does not change the current plan or record a movement." />
      </ScrollView> : null}
    </SafeAreaView></SafeAreaProvider></MotionModal>
  </Section>;
}

function historyTitle(entry: VisitHistory): string {
  if (entry.action === 'movement_recorded' && entry.last_movement) return `${entry.last_movement.direction === 'in' ? 'Arrival' : 'Exit'} recorded · ${entry.last_movement.observed_count} ${entry.last_movement.observed_count === 1 ? 'person' : 'people'}`;
  return ({ arranged: 'Visit arranged', changed: 'Plan updated', cancelled: 'Arrangement cancelled', movement_recorded: 'Movement recorded' })[entry.action] ?? 'Visit updated';
}
const styles = StyleSheet.create({
  sheet: { flex: 1 }, heading: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 12 },
  title: { flex: 1, minWidth: 0, fontSize: 24, lineHeight: 30, fontWeight: '700' },
  body: { padding: 20, paddingBottom: 40, gap: 20 }, support: { fontSize: 14, lineHeight: 21 }, caption: { fontSize: 13, lineHeight: 20 },
});
