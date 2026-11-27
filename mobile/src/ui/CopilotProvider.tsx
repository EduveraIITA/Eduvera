import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { AccessibilityInfo, Animated, AppState, Platform, StyleSheet, Text, View } from 'react-native';
import { useIsFocused, usePathname, useRootNavigationState } from 'expo-router';
import { useSession } from '../auth/SessionProvider';
import { apiFetch, captureApiContext } from '../lib/api';
import { campusHrefForRoute, focusedCampusRoute, type CampusNavigationState } from '../lib/back-policy';
import { copilotCallId, copilotToolNames, readCopilotIntent, type CopilotContext, type CopilotResult, type CopilotToolName } from '../lib/copilot';
import { ControlButton } from './DomainControls';
import { useReducedMotion } from './Motion';
import { useTheme } from './theme';

type ActionRegistration = {
  name: CopilotToolName;
  label: string;
  sourceKey?: string;
  available: boolean;
  run(args: Record<string, unknown>, signal: AbortSignal): boolean | Promise<boolean>;
};
type RegisteredAction = Omit<ActionRegistration, 'available'> & { available(): boolean };
type Lease = { binding: string; generation: number; context: CopilotContext; targets: ReadonlyMap<CopilotToolName, RegisteredAction> };
type Run = { id: string; threadId: string; lease: Lease };
type Activity = { label: string; phase: 'preparing' | 'applying' | 'applied' | 'blocked' | 'stopped'; tool?: CopilotToolName };
type Runtime = {
  register(action: RegisteredAction): () => void;
  context(): CopilotContext | undefined;
  capture(context: CopilotContext): Lease | undefined;
  follow(run: Run): void;
  inspect(id: string, revealApp: () => void): void;
  takeOver(): void;
  pending: Run | null;
  activity: Activity | null;
};
const noop = () => {};
const RuntimeContext = createContext<Runtime>({
  register: () => noop, context: () => undefined, capture: () => undefined,
  follow: noop, inspect: noop, takeOver: noop, pending: null, activity: null,
});

export function CopilotProvider({ children }: PropsWithChildren) {
  const session = useSession(), pathname = usePathname();
  const tree = useRootNavigationState() as CampusNavigationState | undefined;
  const route = focusedCampusRoute(tree);
  const href = route && tree ? campusHrefForRoute(tree, route.key) ?? pathname : pathname;
  const screen: CopilotContext['screen'] = pathname === '/more/virtual-campus' ? 'virtual_campus' : 'workspace';
  // Panel and highlighted-place changes use the existing route. A different
  // campus, route instance, account or world revokes its pending UI commands.
  const campusId = new URL(href, 'https://thatcampus.invalid').searchParams.get('campus_id');
  const binding = JSON.stringify([session.scopeKey, route?.key, pathname, campusId]);
  const eligible = session.status === 'authenticated' && session.environment.mode === 'live' && !session.environment.unavailable;
  const current = useRef({ binding, eligible, screen }); current.current = { binding, eligible, screen };
  const byTool = useRef(new Map<CopilotToolName, Set<Parameters<Runtime['register']>[0]>>());
  const active = useRef<Run | null>(null), generation = useRef(0), lastResult = useRef<CopilotResult | undefined>(undefined);
  const execution = useRef<{ run: Run; controller: AbortController; tool?: CopilotToolName; callId?: string } | null>(null);
  const [pending, setPending] = useState<Run | null>(null), [activity, setActivity] = useState<Activity | null>(null);
  const mounted = useRef(true);

  const find = useCallback((name: CopilotToolName) => {
    const candidates = [...(byTool.current.get(name) ?? [])].filter(candidate => candidate.available());
    return candidates.length === 1 ? candidates[0] : undefined;
  }, []);
  const register: Runtime['register'] = useCallback(action => {
    const entries = byTool.current.get(action.name) ?? new Set();
    byTool.current.set(action.name, entries); entries.add(action);
    return () => { entries.delete(action); if (!entries.size) byTool.current.delete(action.name); };
  }, []);
  const context = useCallback((): CopilotContext | undefined => {
    if (!current.current.eligible || AppState.currentState !== 'active') return;
    const tools = copilotToolNames.filter(name => (name === 'open_virtual_campus') === (current.current.screen === 'workspace') && find(name));
    if (!tools.length && !lastResult.current) return;
    return { screen: current.current.screen, tools, ...(lastResult.current ? { last_result: lastResult.current } : {}) };
  }, [find]);
  const capture = useCallback((expected: CopilotContext): Lease | undefined => {
    const available = context();
    if (!available || !expected.tools.length || available.screen !== expected.screen || expected.tools.some(name => !available.tools.includes(name))) return;
    const targets = new Map<CopilotToolName, RegisteredAction>();
    for (const name of expected.tools) {
      const target = find(name);
      if (!target) return;
      targets.set(name, target);
    }
    return { binding: current.current.binding, generation: generation.current, context: expected, targets };
  }, [context, find]);
  const takeOver = useCallback(() => {
    const run = active.current, tool = execution.current?.tool, callId = execution.current?.callId;
    generation.current++;
    if (!run && !execution.current) { setActivity(null); return; }
    execution.current?.controller.abort(); execution.current = null; active.current = null;
    if (tool) lastResult.current = { tool, status: 'stopped', ...(callId ? { call_id:callId } : {}) };
    setPending(null);
    setActivity(previous => previous ? { ...previous, phase: 'stopped' } : null);
  }, []);
  useLayoutEffect(() => {
    if (!mounted.current) return;
    if (active.current && (!eligible || active.current.lease.binding !== binding) && execution.current?.tool !== 'open_virtual_campus') takeOver();
    else if (!active.current && !execution.current) setActivity(previous => previous?.phase === 'applied' ? null : previous);
  }, [binding, eligible, takeOver]);
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') takeOver(); });
    return () => {
      mounted.current = false; generation.current++; execution.current?.controller.abort();
      active.current = null; execution.current = null; subscription.remove();
    };
  }, [takeOver]);

  const follow = useCallback((run: Run) => {
    if (!current.current.eligible || run.lease.binding !== current.current.binding || run.lease.generation !== generation.current) return;
    if (active.current || execution.current) return;
    active.current = run; setPending(run); setActivity({ label: 'Assistant is working', phase: 'preparing' });
  }, []);
  const inspect = useCallback((id: string, revealApp: () => void) => {
    const run = active.current;
    if (!run || run.id !== id || execution.current || !current.current.eligible || current.current.binding !== run.lease.binding) return;
    const operation = { run, controller: new AbortController(), tool: undefined as CopilotToolName | undefined, callId: undefined as string | undefined };
    execution.current = operation;
    const signal = operation.controller.signal, transport = captureApiContext();
    const currentLease = () => {
      if (!mounted.current || signal.aborted || !current.current.eligible || active.current !== run) return false;
      try { transport.assertCurrent(); } catch { return false; }
      return operation.tool === 'open_virtual_campus' || current.current.binding === run.lease.binding;
    };
    const finish = (result?: CopilotResult, label?: string) => {
      if (execution.current !== operation || active.current !== run) return;
      active.current = null; execution.current = null; setPending(null);
      if (result) lastResult.current = { ...result, ...(operation.callId ? { call_id:operation.callId } : {}) };
      setActivity(result && label ? { label, tool: result.tool, phase: result.status } : null);
    };
    void (async () => {
      const endpoint = `/api/v1/agent/threads/${encodeURIComponent(run.threadId)}/runs/${encodeURIComponent(run.id)}/events`;
      try {
        const events = await apiFetch<unknown>(endpoint, { signal });
        if (!currentLease()) { finish(); return; }
        const intent = readCopilotIntent(events, run.threadId, run.id);
        if (!intent || !run.lease.context.tools.includes(intent.name)) { finish(); return; }
        if (copilotCallId(intent.id)) operation.callId = intent.id;
        const action = find(intent.name);
        if (!action || action !== run.lease.targets.get(intent.name)) { finish({ tool: intent.name, status: 'blocked' }, 'This control is unavailable on the current screen'); return; }
        operation.tool = intent.name;
        setActivity({ label: action.label, tool: intent.name, phase: 'applying' });
        revealApp();
        // Give the existing page a frame to reveal itself before changing controls.
        await new Promise<void>(resolve => setTimeout(resolve, 180));
        if (!currentLease() || find(intent.name) !== action || current.current.binding !== run.lease.binding) { finish(); return; }
        const applied = await action.run(intent.args, signal);
        if (currentLease()) finish({ tool: intent.name, status: applied ? 'applied' : 'blocked' }, action.label);
        else finish();
      } catch {
        if (currentLease() && operation.tool) finish({ tool: operation.tool, status: 'blocked' }, 'The control could not be updated');
        else finish();
      }
    })();
  }, [find]);

  const value = useMemo(() => ({ register, context, capture, follow, inspect, takeOver, pending, activity }),
    [register, context, capture, follow, inspect, takeOver, pending, activity]);
  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}

export function useCopilot() { return useContext(RuntimeContext); }
export function useCopilotTakeOver() { return useCopilot().takeOver; }

export function useCopilotAction(action: ActionRegistration) {
  const { register } = useCopilot(), focused = useIsFocused();
  const current = useRef({ action, focused }); current.current = { action, focused };
  useLayoutEffect(() => register({
    name: action.name, label: action.label,
    available: () => current.current.focused && current.current.action.available,
    run: (args, signal) => !signal.aborted && current.current.focused && current.current.action.available
      && current.current.action.run(args, signal),
  }), [register, action.name, action.label, action.sourceKey]);
}

export function useCopilotActiveAction(tool: CopilotToolName) {
  const { activity } = useCopilot(), focused = useIsFocused();
  return focused && activity?.tool === tool && (activity.phase === 'applying' || activity.phase === 'applied');
}

export function CopilotStatusBar() {
  const { activity, takeOver } = useCopilot(), { colors } = useTheme(), reduced = useReducedMotion();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!activity) return;
    if (reduced) { opacity.setValue(1); return; }
    opacity.setValue(0);
    const animation = Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: Platform.OS !== 'web' });
    animation.start();
    return () => animation.stop();
  }, [activity?.phase, opacity, reduced]);
  useEffect(() => {
    if (activity?.phase === 'applying' || activity?.phase === 'preparing') {
      AccessibilityInfo.announceForAccessibility(activity.label);
    }
  }, [activity?.phase, activity?.label]);
  if (!activity) return null;
  const active = activity.phase === 'preparing' || activity.phase === 'applying';
  return <View pointerEvents="box-none" style={styles.placement}>
    <Animated.View style={[styles.bar, { opacity, backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.copy} accessibilityLiveRegion="polite">
        <Text style={[styles.title, { color: colors.ink }]}>{activity.label}</Text>
        <Text style={[styles.status, { color: colors.muted }]}>{active ? 'Assistant' : activity.phase === 'applied' ? 'Ready for your review' : activity.phase === 'stopped' ? 'You are in control' : 'Make this change directly on the screen'}</Text>
      </View>
      <ControlButton title={active ? 'Take over' : 'Dismiss'} onPress={takeOver} />
    </Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  placement: { position: 'absolute', top: 12, right: 12, left: 12, zIndex: 45, alignItems: 'center' },
  bar: { width: '100%', maxWidth: 470, minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1, borderRadius: 14 },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 14, fontWeight: '600' },
  status: { fontSize: 13 },
});
