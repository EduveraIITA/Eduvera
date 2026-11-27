import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { AccessibilityInfo, Animated, AppState, Platform, StyleSheet, Text, View } from 'react-native';
import { useIsFocused, usePathname, useRootNavigationState } from 'expo-router';
import { useSession } from '../auth/SessionProvider';
import { apiFetch, captureApiContext } from '../lib/api';
import { campusHrefForRoute, focusedCampusRoute, type CampusNavigationState } from '../lib/back-policy';
import { copilotCallId, copilotRouteContext, copilotToolNames, copilotToolAvailableOn, readCopilotPlan, validCopilotArgs, type CopilotContext, type CopilotResult, type CopilotToolName } from '../lib/copilot';
import { ControlButton } from './DomainControls';
import { useReducedMotion } from './Motion';
import { useTheme } from './theme';

type ActionRegistration = {
  name: CopilotToolName;
  label: string;
  sourceKey?: string;
  destinationPath?: string;
  available: boolean;
  run(args: Record<string, unknown>, signal: AbortSignal): boolean | Promise<boolean>;
};
type RegisteredAction = Omit<ActionRegistration, 'available'> & { available(): boolean };
type Lease = { binding: string; generation: number; context: CopilotContext; targets: ReadonlyMap<CopilotToolName, RegisteredAction> };
type Run = { id: string; threadId: string; lease: Lease };
type Activity = { label: string; phase: 'preparing' | 'applying' | 'applied' | 'blocked' | 'stopped'; tool?: CopilotToolName; step?: number; total?: number };
type Detail = { id: string; threadId: string };
type OwnedDetail = Detail & { binding: string; action: RegisteredAction; generation: number };
type Execution = { run: Run; controller: AbortController; binding: string; tool?: CopilotToolName; callId?: string; destinationPath?: string };
type Runtime = {
  register(action: RegisteredAction): () => void;
  registerCampusTarget(owner: symbol, id: string): () => void;
  context(): CopilotContext | undefined;
  capture(context: CopilotContext): Lease | undefined;
  follow(run: Run): void;
  inspect(id: string, revealApp: () => void): void;
  takeOver(): void;
  answerDetail(id: string, name: string): Promise<boolean>;
  detail: Detail | null;
  pending: Run | null;
  activity: Activity | null;
};
const noop = () => {};
const RuntimeContext = createContext<Runtime>({
  register: () => noop, registerCampusTarget: () => noop, context: () => undefined, capture: () => undefined,
  follow: noop, inspect: noop, takeOver: noop, answerDetail: async () => false, detail: null, pending: null, activity: null,
});

export function CopilotProvider({ children }: PropsWithChildren) {
  const session = useSession(), pathname = usePathname();
  const tree = useRootNavigationState() as CampusNavigationState | undefined;
  const route = focusedCampusRoute(tree);
  const href = route && tree ? campusHrefForRoute(tree, route.key) ?? pathname : pathname;
  const { screen, identity } = copilotRouteContext(pathname, href);
  // A registered route declares its exact scope selectors. Transient view
  // controls are given to the owning module and do not change this lease.
  const binding = JSON.stringify([session.scopeKey, route?.key, pathname, ...identity]);
  const eligible = session.status === 'authenticated' && session.environment.mode === 'live' && !session.environment.unavailable;
  const current = useRef({ binding, eligible, screen, pathname }); current.current = { binding, eligible, screen, pathname };
  const byTool = useRef(new Map<CopilotToolName, Set<Parameters<Runtime['register']>[0]>>());
  const active = useRef<Run | null>(null), generation = useRef(0), lastResult = useRef<CopilotResult | undefined>(undefined);
  const execution = useRef<Execution | null>(null);
  const campusTargets = useRef(new Map<symbol, string>());
  const detailOwner = useRef<OwnedDetail | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
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
  const registerCampusTarget: Runtime['registerCampusTarget'] = useCallback((owner,id) => {
    campusTargets.current.set(owner,id);
    return () => { if (campusTargets.current.get(owner)===id) campusTargets.current.delete(owner); };
  }, []);
  const clearDetail = useCallback(() => {
    if (!detailOwner.current) return;
    detailOwner.current=null;setDetail(null);
  },[]);
  const context = useCallback((): CopilotContext | undefined => {
    if (!current.current.eligible || AppState.currentState !== 'active') return;
    const tools = copilotToolNames.filter(name => copilotToolAvailableOn(name,current.current.screen) && find(name));
    if (!tools.length && !lastResult.current) return;
    const mapped = current.current.screen==='virtual_campus' ? [...new Set(campusTargets.current.values())] : [];
    return { screen: current.current.screen, tools, ...(mapped.length===1?{campus_id:mapped[0]}:{}),
      ...(lastResult.current ? { last_result: lastResult.current } : {}) };
  }, [find]);
  const capture = useCallback((expected: CopilotContext): Lease | undefined => {
    const available = context();
    if (!available || !expected.tools.length || available.screen !== expected.screen || available.campus_id!==expected.campus_id || expected.tools.some(name => !available.tools.includes(name))) return;
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
    generation.current++;clearDetail();
    if (!run && !execution.current) { setActivity(null); return; }
    execution.current?.controller.abort(); execution.current = null; active.current = null;
    if (tool) lastResult.current = { tool, status: 'stopped', ...(callId ? { call_id:callId } : {}) };
    setPending(null);
    setActivity(previous => previous ? { ...previous, phase: 'stopped' } : null);
  }, [clearDetail]);
  useLayoutEffect(() => {
    if (!mounted.current) return;
    if (detailOwner.current && (!eligible || detailOwner.current.binding!==binding)) clearDetail();
    const expected = execution.current?.binding ?? active.current?.lease.binding;
    if (active.current && (!eligible || (expected !== binding && execution.current?.destinationPath !== pathname))) takeOver();
    else if (!active.current && !execution.current) setActivity(previous => previous?.phase === 'applied' ? null : previous);
  }, [binding, eligible, pathname, takeOver, clearDetail]);
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
    const operation:Execution = { run, controller: new AbortController(), binding:run.lease.binding };
    execution.current = operation;
    const signal = operation.controller.signal, transport = captureApiContext();
    const currentLease = () => {
      if (!mounted.current || signal.aborted || !current.current.eligible || active.current !== run) return false;
      try { transport.assertCurrent(); } catch { return false; }
      return current.current.binding === operation.binding || operation.destinationPath === current.current.pathname;
    };
    const finish = (result?: CopilotResult, label?: string) => {
      if (execution.current !== operation || active.current !== run) return;
      active.current = null; execution.current = null; setPending(null);
      if (result) lastResult.current = { ...result, ...(operation.callId ? { call_id:operation.callId } : {}) };
      setActivity(result && label ? { label, tool: result.tool, phase: result.status } : null);
    };
    const delay = (ms:number) => new Promise<void>(resolve => setTimeout(resolve,ms));
    void (async () => {
      const endpoint = `/api/v1/agent/threads/${encodeURIComponent(run.threadId)}/runs/${encodeURIComponent(run.id)}/events`;
      try {
        const events = await apiFetch<unknown>(endpoint, { signal });
        if (!currentLease()) { finish(); return; }
        const plan = readCopilotPlan(events, run.threadId, run.id);
        if (!plan || !run.lease.context.tools.includes(plan[0]!.name)) { finish(); return; }
        clearDetail();
        for (const [index,intent] of plan.entries()) {
          operation.tool = intent.name; operation.callId=copilotCallId(intent.id)?intent.id:undefined;
          // React may still be mounting the next owning screen after navigation.
          let action=find(intent.name);
          for (let attempt=0; index>0&&!action&&currentLease()&&attempt<50; attempt++) {
            await delay(100);action=find(intent.name);
          }
          if (!currentLease()) { finish(); return; }
          if (!action || !copilotToolAvailableOn(intent.name,current.current.screen) ||
              index===0 && action!==run.lease.targets.get(intent.name)) {
            finish({tool:intent.name,status:'blocked'},'That control isn’t available on this screen');return;
          }
          setActivity({label:action.label,tool:intent.name,phase:'applying',step:index+1,total:plan.length});
          if(index===0)revealApp();
          await delay(180);
          if (!currentLease() || find(intent.name)!==action || current.current.binding!==operation.binding) {
            finish({tool:intent.name,status:'blocked'},'The screen changed before the step could run');return;
          }
          operation.destinationPath = action.destinationPath;
          const applied = await action.run(intent.args,signal);
          if (!currentLease()) { finish();return; }
          if (!applied) { finish({tool:intent.name,status:'blocked'},action.label);return; }
          operation.binding=current.current.binding;operation.destinationPath=undefined;
          if(index===plan.length-1) {
            if(intent.name==='prepare_campus_create' && intent.args.name===undefined && copilotCallId(intent.id)) {
              const request={id:intent.id,threadId:run.threadId};
              detailOwner.current={...request,binding:operation.binding,generation:generation.current,action};
              setDetail(request);
            }
            finish({tool:intent.name,status:'applied'},action.label);
          }
        }
      } catch {
        if (currentLease() && operation.tool) finish({ tool: operation.tool, status: 'blocked' }, 'The control could not be updated');
        else finish();
      }
    })();
  }, [find, clearDetail]);
  const answerDetail = useCallback(async (id:string,name:string) => {
    const request=detailOwner.current,args={name:name.trim()};
    if (!request || request.id!==id || request.binding!==current.current.binding ||
        request.generation!==generation.current || !current.current.eligible ||
        find('prepare_campus_create')!==request.action || !validCopilotArgs('prepare_campus_create',args)) return false;
    const transport=captureApiContext(), controller=new AbortController();
    try {
      transport.assertCurrent();
      const applied=await request.action.run(args,controller.signal);
      transport.assertCurrent();
      if (!applied || detailOwner.current!==request || current.current.binding!==request.binding) return false;
      clearDetail();setActivity({label:'Campus name added',phase:'applied',tool:'prepare_campus_create'});
      return true;
    } catch { return false; }
  },[find,clearDetail]);

  const value = useMemo(() => ({ register, registerCampusTarget, context, capture, follow, inspect, takeOver, answerDetail, detail, pending, activity }),
    [register, registerCampusTarget, context, capture, follow, inspect, takeOver, answerDetail, detail, pending, activity]);
  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}

export function useCopilot() { return useContext(RuntimeContext); }
export function useCopilotTakeOver() { return useCopilot().takeOver; }

export function useCopilotAction(action: ActionRegistration) {
  const { register } = useCopilot(), focused = useIsFocused();
  const current = useRef({ action, focused }); current.current = { action, focused };
  useLayoutEffect(() => register({
    name: action.name, label: action.label, destinationPath: action.destinationPath,
    available: () => current.current.focused && current.current.action.available,
    run: (args, signal) => !signal.aborted && current.current.focused && current.current.action.available
      && current.current.action.run(args, signal),
  }), [register, action.name, action.label, action.sourceKey, action.destinationPath]);
}

export function useCopilotCampusTarget(campusId:string | undefined) {
  const { registerCampusTarget }=useCopilot(), focused=useIsFocused(), owner=useRef(Symbol('campus-selection'));
  useLayoutEffect(()=>focused&&campusId&&copilotCallId(campusId)?registerCampusTarget(owner.current,campusId):undefined,
    [campusId,focused,registerCampusTarget]);
}

export function useCopilotActiveAction(tool: CopilotToolName) {
  const { activity } = useCopilot(), focused = useIsFocused();
  return focused && activity?.tool === tool && (activity.phase === 'applying' || activity.phase === 'applied');
}

export function CopilotStatusBar() {
  const { activity, detail, takeOver } = useCopilot(), { colors } = useTheme(), reduced = useReducedMotion();
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
  useEffect(() => {
    if (activity?.phase !== 'applied' || detail) return;
    const timer = setTimeout(takeOver, 3000);
    return () => clearTimeout(timer);
  }, [activity?.phase, activity?.label, detail, takeOver]);
  if (!activity || activity.phase === 'applied' && detail) return null;
  const active = activity.phase === 'preparing' || activity.phase === 'applying';
  return <View pointerEvents="box-none" style={styles.placement}>
    <Animated.View style={[styles.bar, { opacity, backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.copy} accessibilityLiveRegion="polite">
        <Text style={[styles.title, { color: colors.ink }]}>{activity.label}</Text>
        <Text style={[styles.status, { color: colors.muted }]}>{active ? (activity.total && activity.total > 1 ? `Step ${activity.step} of ${activity.total}` : 'Assistant') : activity.phase === 'applied' ? 'Ready for your review' : activity.phase === 'stopped' ? 'You are in control' : 'Make this change directly on the screen'}</Text>
      </View>
      <ControlButton title={active ? 'Take over' : 'Dismiss'} onPress={takeOver} />
    </Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  placement: { alignItems: 'center' },
  bar: { width: '100%', maxWidth: 470, minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1, borderRadius: 14 },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 14, fontWeight: '600' },
  status: { fontSize: 13 },
});
