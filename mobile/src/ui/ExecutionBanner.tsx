import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { useSession } from '../auth/SessionProvider';
import { apiFetch, captureApiContext } from '../lib/api';
import { confirmedSimulationRun, simulationRunId } from '../lib/simulation-policy';
import { useTheme } from './theme';
import { BrandLoadingIcon } from './AssistantMark';
import { useCampusNavigation } from './BackNavigation';

function clockLabel(value: string | undefined, timeZone: string | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Time unavailable';
  try { return `${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(value))}${timeZone ? ` · ${timeZone}` : ''}`; }
  catch { return `${new Date(value).toISOString()} · UTC`; }
}

export function ExecutionBanner() {
  const session = useSession();
  const { colors } = useTheme();
  if (session.status === 'authenticated' && session.publicDemo) return <View style={styles.frame}><View style={[styles.banner,{backgroundColor:colors.row,borderColor:colors.border}]}><Text style={[styles.label,{color:colors.ink}]}>Sample campus · read-only</Text><Text style={[styles.time,{color:colors.muted}]}>Synthetic data. Record changes, uploads and AI are disabled.</Text></View></View>;
  if (session.status !== 'authenticated' || session.environment.mode !== 'simulation' || !session.user || !session.schoolId) return null;
  return <SimulationBanner key={`${session.scopeKey}:${session.environment.run_id}`} session={session} />;
}

function SimulationBanner({ session }: { session: ReturnType<typeof useSession> }) {
  const { colors } = useTheme(), { onNavigate } = useCampusNavigation(), focused = useIsFocused();
  const { environment, scopeKey, schoolId } = session;
  let runId: string | null = null;
  try { runId = simulationRunId(environment.run_id ?? null); } catch { /* Return to Live remains available for an incomplete binding. */ }
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [checkpoint, setCheckpoint] = useState<{ now: string; timeZone: string; status: string } | null>(null);
  const [readError, setReadError] = useState(''), [actionError, setActionError] = useState(''), [busy, setBusy] = useState(false);
  const mounted = useRef(true), changing = useRef(false), latestScope = useRef(scopeKey), foregroundNow = useRef(AppState.currentState === 'active'), focusedNow = useRef(focused), pendingRead = useRef<AbortController | null>(null);
  latestScope.current = scopeKey; focusedNow.current = focused;
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', state => { foregroundNow.current = state === 'active'; if (!foregroundNow.current) pendingRead.current?.abort(); setForeground(foregroundNow.current); });
    return () => { mounted.current = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    if (!focused || !foreground || environment.unavailable || !runId || !schoolId) return;
    let active = true, reading = false;
    const abort = new AbortController(), sourceId = runId, sourceNamespace = environment.namespace_id;
    pendingRead.current = abort;
    async function refresh() {
      if (!active || reading || !focusedNow.current || !foregroundNow.current) return;
      reading = true;
      try {
        const context = captureApiContext();
        const result = await apiFetch(`/api/v1/schools/${encodeURIComponent(schoolId!)}/simulation/runs/${encodeURIComponent(sourceId)}`, { signal: abort.signal });
        context.assertCurrent();
        if (!active || !focusedNow.current || !foregroundNow.current || latestScope.current !== scopeKey) return;
        const run = confirmedSimulationRun(result, sourceId);
        if (run.namespace_id !== sourceNamespace) throw new Error('The run did not match the selected Simulation.');
        setCheckpoint({ now: run.clock.virtual_now, timeZone: run.clock.time_zone, status: run.status }); setReadError('');
      } catch {
        if (active && focusedNow.current && foregroundNow.current && latestScope.current === scopeKey) setReadError('Latest checkpoint unavailable. Showing the last confirmed time.');
      } finally { reading = false; }
    }
    void refresh();
    // Poll committed checkpoints; never advance virtual time on the device.
    const interval = setInterval(() => { void refresh(); }, 60_000);
    return () => { active = false; clearInterval(interval); abort.abort(); if (pendingRead.current === abort) pendingRead.current = null; };
  }, [focused, foreground, environment.unavailable, environment.namespace_id, runId, schoolId, scopeKey]);

  async function returnToLive() {
    if (changing.current) return;
    changing.current = true; setBusy(true); setActionError('');
    const originalScope = scopeKey;
    try {
      // An unavailable world blocks domain transport. SessionProvider owns the
      // guarded auth transition and must still permit returning to Live.
      if (!environment.unavailable) captureApiContext().assertCurrent();
      if (!mounted.current || latestScope.current !== originalScope) return;
      await session.selectEnvironment({ mode: 'live' });
    } catch (cause) {
      if (mounted.current && latestScope.current === originalScope) setActionError(cause instanceof Error ? cause.message : 'Live could not be confirmed. Try again.');
    } finally { changing.current = false; if (mounted.current) setBusy(false); }
  }
  function manage() {
    if (!runId || busy) return;
    try { onNavigate(`/more/simulation?run=${encodeURIComponent(runId)}`); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : 'The selected Simulation could not open.'); }
  }
  const now = checkpoint?.now ?? environment.virtual_clock?.now, zone = checkpoint?.timeZone ?? environment.virtual_clock?.time_zone;
  return <View style={styles.frame}><View style={[styles.banner, { backgroundColor: colors.warningSoft, borderColor: colors.border }]}>
    <View style={styles.summary}>
      <Text style={[styles.label, { color: colors.ink }]}>{environment.unavailable ? 'Simulation unavailable' : `Simulation${checkpoint?.status ? ` · ${checkpoint.status}` : ''}`}</Text>
      <Text style={[styles.time, { color: colors.ink }]}>{environment.unavailable ? 'Return to Live to recover your campus.' : `Last confirmed: ${clockLabel(now, zone)}`}</Text>
    </View>
    <View style={styles.actions}>
      {runId ? <Pressable accessibilityRole="button" accessibilityLabel="Manage the current Simulation" accessibilityState={{ disabled: busy }} disabled={busy} onPress={manage} style={({ pressed }) => [styles.button, { backgroundColor: colors.surface, opacity: busy ? 0.5 : pressed ? 0.7 : 1 }]}><Text style={[styles.buttonText, { color: colors.ink }]}>Manage</Text></Pressable> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Return to Live campus" accessibilityState={{ busy, disabled: busy }} disabled={busy} onPress={() => { void returnToLive(); }} style={({ pressed }) => [styles.button, { backgroundColor: colors.surface, opacity: busy ? 0.5 : pressed ? 0.7 : 1 }]}>{busy ? <BrandLoadingIcon /> : null}<Text style={[styles.buttonText, { color: colors.ink }]}>Return to Live</Text></Pressable>
    </View>
    {actionError ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.ink }]}>{actionError}</Text> : readError && !environment.unavailable ? <Text style={[styles.error, { color: colors.ink }]}>{readError}</Text> : null}
  </View></View>;
}

const styles = StyleSheet.create({
  frame: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4, width: '100%', maxWidth: 1140, alignSelf: 'center' },
  banner: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  summary: { flexGrow: 1, flexBasis: 220, minWidth: 0, gap: 2 },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '700' },
  time: { fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', flexShrink: 1, gap: 8 },
  button: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, flexDirection: 'row', flexShrink: 1, alignItems: 'center', justifyContent: 'center', gap: 6, maxWidth: '100%' },
  buttonText: { fontSize: 14, lineHeight: 20, fontWeight: '600', flexShrink: 1 },
  error: { fontSize: 12, lineHeight: 18, width: '100%' },
});
