import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type PropsWithChildren, type RefCallback } from 'react';
import { AppState } from 'react-native';
import { useIsFocused, usePathname, useRootNavigationState } from 'expo-router';
import { useSession } from '../auth/SessionProvider';
import { apiFetch, captureApiContext } from '../lib/api';
import { campusHrefForRoute, focusedCampusRoute, type CampusNavigationState } from '../lib/back-policy';
import { copilotCallId, copilotRouteContext, copilotToolNames, copilotToolAvailableOn, readCopilotPlan, validCopilotArgs, type CopilotContext, type CopilotResult, type CopilotToolName } from '../lib/copilot';
import { copilotWait, measureCopilotTarget, type CopilotRect, type CopilotTargetNode } from '../lib/copilot-target';

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
type Execution = { run: Run; controller: AbortController; binding: string; tool?: CopilotToolName; callId?: string; destinationPath?: string; applied?: boolean };
type TargetStage = 'before' | 'after';
type TargetOptions = {
  enabled?: boolean;
  stage?: TargetStage;
  reveal?: (node: CopilotTargetNode, signal: AbortSignal) => void | Promise<void>;
};
type TargetRegistration = {
  node(): CopilotTargetNode | null;
  reveal?(node: CopilotTargetNode, signal: AbortSignal): void | Promise<void>;
};
type Pointer = { binding: string; rect: CopilotRect };
type Runtime = {
  registerTarget(tool: CopilotToolName, stage: TargetStage, target: TargetRegistration): () => void;
  pointer: Pointer | null;
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
  register: () => noop, registerTarget: () => noop, pointer: null, registerCampusTarget: () => noop, context: () => undefined, capture: () => undefined,
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
  const targets = useRef(new Map<string, Set<TargetRegistration>>());
  const active = useRef<Run | null>(null), generation = useRef(0), lastResult = useRef<CopilotResult | undefined>(undefined);
  const execution = useRef<Execution | null>(null);
  const campusTargets = useRef(new Map<symbol, string>());
  const detailOwner = useRef<OwnedDetail | null>(null);
  const detailAnswer = useRef<AbortController | null>(null);
  const [pointer, setPointer] = useState<Pointer | null>(null);
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
  const registerTarget: Runtime['registerTarget'] = useCallback((tool,stage,target) => {
    const key = `${tool}:${stage}`;
    const entries = targets.current.get(key) ?? new Set<TargetRegistration>();
    entries.add(target);
    targets.current.set(key, entries);
    return () => { entries.delete(target); if (!entries.size) targets.current.delete(key); };
  }, []);
  const showTarget = useCallback(async (tool: CopilotToolName, stage: TargetStage, signal: AbortSignal,
    isCurrent: () => boolean) => {
    const key = `${tool}:${stage}`;
    const findTarget = () => {
      const candidates = [...(targets.current.get(key) ?? [])].filter(target => target.node());
      return candidates.length === 1 ? candidates[0] : undefined;
    };
    let target = findTarget();
    for (let attempt=0; !target && stage==='after' && isCurrent() && attempt<9; attempt++) {
      await copilotWait(50, signal);
      target = findTarget();
    }
    const node = target?.node();
    if (!target || !node || !isCurrent()) return false;
    const binding = current.current.binding;
    try {
      if (target.reveal) await Promise.race([target.reveal(node, signal), copilotWait(650,signal)]);
      const rect = await measureCopilotTarget(node, signal);
      if (!rect || !isCurrent() || binding!==current.current.binding || findTarget()!==target || target.node()!==node) return false;
      setPointer({binding,rect});
      return true;
    } catch { return false; }
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
    const run = active.current, operation = execution.current, answering = !!detailAnswer.current;
    generation.current++;
    detailAnswer.current?.abort();
    detailAnswer.current = null;
    setPointer(null);
    clearDetail();
    if (!run && !operation && !answering) { setActivity(null); return; }
    operation?.controller.abort(); execution.current = null; active.current = null;
    if (operation?.tool) lastResult.current = { tool: operation.tool, status: operation.applied ? 'applied' : 'stopped',
      ...(operation.callId ? { call_id: operation.callId } : {}) };
    setPending(null);
    setActivity(previous => previous ? { ...previous, phase: 'stopped' } : null);
  }, [clearDetail]);
  useLayoutEffect(() => {
    if (!mounted.current) return;
    if (detailOwner.current && (!eligible || detailOwner.current.binding!==binding)) { detailAnswer.current?.abort(); clearDetail(); }
    const expected = execution.current?.binding ?? active.current?.lease.binding;
    if (active.current && (!eligible || (expected !== binding && execution.current?.destinationPath !== pathname))) takeOver();
    else if (!active.current && !execution.current) setActivity(previous => previous?.phase === 'applied' ? null : previous);
  }, [binding, eligible, pathname, takeOver, clearDetail]);
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') takeOver(); });
    return () => {
      mounted.current = false; generation.current++; execution.current?.controller.abort(); detailAnswer.current?.abort();
      active.current = null; execution.current = null; subscription.remove();
    };
  }, [takeOver]);

  useEffect(() => {
    if (activity?.phase !== 'applied') return;
    const timer = setTimeout(() => {
      setPointer(null);
      setActivity(previous => previous===activity ? null : previous);
    }, 2400);
    return () => clearTimeout(timer);
  }, [activity]);

  const follow = useCallback((run: Run) => {
    if (!current.current.eligible || run.lease.binding !== current.current.binding || run.lease.generation !== generation.current) return;
    if (active.current || execution.current) return;
    active.current = run; setPointer(null); setPending(run); setActivity({ label: 'Assistant is working', phase: 'preparing' });
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
      if (result?.status!=='applied') setPointer(null);
      setActivity(result && label ? { label, tool: result.tool, phase: result.status } : null);
    };
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
          operation.applied = false;
          // React may still be mounting the next owning screen after navigation.
          let action=find(intent.name);
          for (let attempt=0; index>0&&!action&&currentLease()&&attempt<50; attempt++) {
            await copilotWait(100,signal);action=find(intent.name);
          }
          if (!currentLease()) { finish(); return; }
          if (!action || !copilotToolAvailableOn(intent.name,current.current.screen) ||
              index===0 && action!==run.lease.targets.get(intent.name)) {
            finish({tool:intent.name,status:'blocked'},'That control isn’t available on this screen');return;
          }
          setActivity({label:action.label,tool:intent.name,phase:'applying',step:index+1,total:plan.length});
          if(index===0)revealApp();
          await copilotWait(140,signal);
          const pointed = await showTarget(intent.name,'before',signal,currentLease);
          if (pointed) await copilotWait(250,signal);
          if (!currentLease() || find(intent.name)!==action || current.current.binding!==operation.binding) {
            finish({tool:intent.name,status:'blocked'},'The screen changed before the step could run');return;
          }
          operation.destinationPath = action.destinationPath;
          const applied = await action.run(intent.args,signal);
          operation.applied = applied;
          if (!currentLease()) { finish();return; }
          if (!applied) { finish({tool:intent.name,status:'blocked'},action.label);return; }
          operation.binding=current.current.binding;operation.destinationPath=undefined;
          const final = index===plan.length-1;
          if(final && intent.name==='prepare_campus_create' && intent.args.name===undefined && copilotCallId(intent.id)) {
            const request={id:intent.id,threadId:run.threadId};
            detailOwner.current={...request,binding:operation.binding,generation:generation.current,action};
            setDetail(request);
            // The detail surface expands the dock. Reveal the actual field in
            // the resulting workspace viewport before positioning the pointer.
            await copilotWait(120,signal);
          }
          await showTarget(intent.name,'after',signal,currentLease);
          if (!currentLease()) { finish();return; }
          if(final) finish({tool:intent.name,status:'applied'},action.label);
        }
      } catch {
        if (currentLease() && operation.tool) finish({ tool: operation.tool, status: 'blocked' }, 'The control could not be updated');
        else finish();
      }
    })();
  }, [find, clearDetail, showTarget]);
  const answerDetail = useCallback(async (id:string,name:string) => {
    const request=detailOwner.current,args={name:name.trim()};
    if (execution.current || detailAnswer.current || !request || request.id!==id || request.binding!==current.current.binding ||
        request.generation!==generation.current || !current.current.eligible ||
        find('prepare_campus_create')!==request.action || !validCopilotArgs('prepare_campus_create',args)) return false;
    const transport=captureApiContext(), controller=new AbortController();
    detailAnswer.current = controller;
    const isCurrent = () => {
      if (controller.signal.aborted || detailOwner.current!==request || current.current.binding!==request.binding ||
          !current.current.eligible || find('prepare_campus_create')!==request.action) return false;
      try { transport.assertCurrent(); return true; } catch { return false; }
    };
    try {
      setActivity({label:'Fill campus name',phase:'applying',tool:'prepare_campus_create'});
      const pointed=await showTarget('prepare_campus_create','after',controller.signal,isCurrent);
      if (pointed) await copilotWait(250,controller.signal);
      if (!isCurrent() || !await request.action.run(args,controller.signal) || !isCurrent()) return false;
      clearDetail();setActivity({label:'Campus name added',phase:'applied',tool:'prepare_campus_create'});
      return true;
    } catch { return false; }
    finally {
      if (detailAnswer.current===controller) {
        detailAnswer.current=null;
        setActivity(previous=>previous?.phase==='applying'&&previous.tool==='prepare_campus_create'
          ? { label:'Enter the campus name in the form', phase:'blocked', tool:'prepare_campus_create' } : previous);
      }
    }
  },[find,clearDetail,showTarget]);

  const currentPointer = eligible && pointer?.binding===binding ? pointer : null;
  const value = useMemo(() => ({ register, registerTarget, pointer:currentPointer, registerCampusTarget, context, capture, follow, inspect, takeOver, answerDetail, detail, pending, activity }),
    [register, registerTarget, currentPointer, registerCampusTarget, context, capture, follow, inspect, takeOver, answerDetail, detail, pending, activity]);
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

/** A mounted owner can expose a visual anchor without adding an action or changing its permissions. */
export function useCopilotTarget(tool: CopilotToolName, options: TargetOptions = {}): RefCallback<CopilotTargetNode> {
  const { registerTarget } = useCopilot(), focused = useIsFocused(), stage = options.stage ?? 'before';
  const node = useRef<CopilotTargetNode | null>(null);
  const latest = useRef({ options, focused });
  latest.current = { options, focused };
  useLayoutEffect(() => registerTarget(tool, stage, {
    node: () => latest.current.focused && latest.current.options.enabled!==false ? node.current : null,
    reveal: (target, signal) => latest.current.options.reveal?.(target, signal),
  }), [registerTarget, tool, stage]);
  return useCallback(target => { node.current = target; }, []);
}
